import { randomUUID } from 'node:crypto';
import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import {
  createNode,
  type AccessPermission,
  type EdgeOf,
  type FlowCondition,
  type GraphDefinition,
  type JudgeQuestion,
  type ModelProvider,
  type NodeOf,
  type RunEvent,
  type RunEventOf,
} from 'protocol';
import { db, sessions } from '../db/index.ts';
import { abortTurn, followTurn, startTurn, turnFiles } from './index.ts';

/** モデルID ごとに、受け取ったプロンプトから返すストリームを決める台本 */
const scripts = new Map<string, (prompt: LanguageModelV3Prompt, options: LanguageModelV3CallOptions) => ReadableStream<LanguageModelV3StreamPart>>();

/** 呼び出した LLM の `プロバイダ:モデルID` */
const calledModels: string[] = [];

vi.mock('../llm/index.ts', () => ({
  languageModel: (provider: ModelProvider, modelId: string) =>
    new MockLanguageModelV3({
      modelId,
      doStream: async (options) => {
        calledModels.push(`${provider}:${modelId}`);
        return { stream: scripts.get(modelId)!(options.prompt, options) };
      },
    }),
  stepCost: async () => null,
}));

/** 判定ノードが Jev に送ったリクエスト */
const judgeRequests: unknown[] = [];

vi.mock('@typesafe-ai/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@typesafe-ai/sdk')>()),
  TypeSafeClient: class {
    async systemOne(request: unknown) {
      judgeRequests.push(request);
      const answers = {
        urgent: { type: 'noul', noul: 0.9 },
        kind: { type: 'choice', choice: 'bug', confidence: 0.8, probabilities: { bug: 0.8, question: 0.2 } },
        severity: { type: 'score', score: 1.5, confidence: 0.6, legend: {}, probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 } },
      };
      return { model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } };
    }
  },
}));

describe('ターン実行', () => {
  it('既定の構成では、エージェントの応答が返答になり、次のターンでは前の会話を覚えている', async () => {
    const seen: string[][] = [];
    scripts.set('main', (prompt) => {
      seen.push(prompt.flatMap((m) => (m.role === 'user' || m.role === 'assistant' ? [textOf(m.content)] : [])));
      return streamOf(textParts(`「${userTextOf(prompt)}」への返事`));
    });
    const graph = graphWithMain();
    const sessionId = createSession(graph);

    const first = await runTurn(graph, 'こんにちは', undefined, { sessionId, parentTurnId: null });
    await runTurn(graph, '覚えてる？', undefined, { sessionId, parentTurnId: first[0].turnId });

    expect(ofType(first, 'turn.finish')[0]).toMatchObject({ status: 'done', reply: '「こんにちは」への返事' });
    expect(seen[1]).toEqual(['こんにちは', '「こんにちは」への返事', '覚えてる？']);
  });

  it('エージェントから別のエージェントをツールとして呼び出し、同じステップの複数ツールコールは逐次実行する', async () => {
    let running = 0;
    let maxRunning = 0;
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt)
        ? streamOf(textParts('まとめました'))
        : streamOf(toolCallParts([{ name: 'researcher', input: { task: 'A' } }, { name: 'researcher', input: { task: 'B' } }])),
    );
    scripts.set('sub', () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      return delayedStream(textParts('調査結果'), () => running--);
    });

    const events = await runTurn(graphOf({}), 'こんにちは');

    const subStarts = ofType(events, 'call.start').filter((e) => e.nodeId === 'researcher');
    const mainStart = ofType(events, 'call.start').find((e) => e.nodeId === 'main')!;
    expect(subStarts).toHaveLength(2);
    expect(subStarts.every((e) => e.parentCallId === mainStart.callId && e.toolCallId !== null)).toBe(true);
    expect(mainStart).toMatchObject({ parentCallId: null, toolCallId: null, input: 'こんにちは' });
    expect(maxRunning).toBe(1);
    expect(ofType(events, 'turn.finish')[0]).toMatchObject({ status: 'done', reply: 'まとめました' });
  });

  it('ステップのイベントはツールコールを挟んで順に届き、所要時間にツールの実行を含めない', async () => {
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt)
        ? streamOf(textParts('まとめました'))
        : streamOf(toolCallParts([{ name: 'researcher', input: { task: 'A' } }, { name: 'researcher', input: { task: 'B' } }])),
    );
    scripts.set('sub', () => delayedStream(textParts('調査結果'), () => {}));

    const events = await runTurn(graphOf({}), 'こんにちは');

    const mainCallId = ofType(events, 'call.start').find((e) => e.nodeId === 'main')!.callId;
    const mainEvents = events.filter((e) => e.callId === mainCallId);
    expect(mainEvents.filter((e) => e.type.startsWith('step.') || e.type.startsWith('tool.')).map((e) => e.type)).toEqual([
      'step.start',
      'tool.call',
      'tool.call',
      'tool.result',
      'tool.result',
      'step.finish',
      'step.start',
      'step.finish',
    ]);
    const [start] = ofType(mainEvents, 'step.start');
    const [finish] = ofType(mainEvents, 'step.finish');
    expect(finish.step.durationMs).toBeLessThan(finish.at - start.at);
  });

  it('ノードごとに指定したプロバイダのモデルを呼び出す', async () => {
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('まとめました')) : streamOf(toolCallParts([{ name: 'researcher', input: { task: 'A' } }])),
    );
    scripts.set('sub', () => streamOf(textParts('調査結果')));
    calledModels.length = 0;

    await runTurn(graphOf({ provider: 'gemini' }), 'こんにちは');

    expect(calledModels).toEqual(['openrouter:main', 'gemini:sub', 'openrouter:main']);
  });

  it('ツールとしての呼び出しのネストが上限に達したら、その呼び出しを失敗にする', async () => {
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('完了')) : streamOf(toolCallParts([{ name: 'researcher', input: { task: 'go' } }])),
    );
    scripts.set('sub', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('戻ります')) : streamOf(toolCallParts([{ name: 'researcher', input: { task: 'deeper' } }])),
    );
    const graph = graphOf({});
    graph.edges.push(toolEdge('researcher', 'researcher'));
    graph.settings.maxCallDepth = 3;

    const events = await runTurn(graph, '再帰して');

    const subFinishes = ofType(events, 'call.finish').filter((e) => e.nodeId === 'researcher');
    expect(subFinishes).toHaveLength(4);
    expect(subFinishes.filter((e) => e.status === 'error').map((e) => e.error)).toEqual([expect.stringContaining('上限（3）')]);
    expect(ofType(events, 'turn.finish')[0]).toMatchObject({ status: 'done' });
  });

  it('Abort するとツールとして呼び出し中のエージェントも止まり、途中までの出力が残る', async () => {
    scripts.set('main', () => streamOf(toolCallParts([{ name: 'researcher', input: { task: 'ずっと考えて' } }])));
    scripts.set('sub', (_prompt, options) => hangingStream('途中まで', options.abortSignal!));

    const events = await runTurn(graphOf({}), '長い仕事', (event) => {
      if (event.type === 'text.delta' && event.nodeId === 'researcher') abortTurn(event.turnId);
    });

    const subFinish = ofType(events, 'call.finish').find((e) => e.nodeId === 'researcher');
    expect(subFinish).toMatchObject({ status: 'aborted', output: '途中まで' });
    expect(ofType(events, 'step.finish').some((e) => e.step.aborted && e.step.text === '途中まで')).toBe(true);
    expect(ofType(events, 'turn.finish')[0]).toMatchObject({ status: 'aborted' });
  });

  it('セッション継続の記憶は分岐をたどって引き継がれ、別の分岐には漏れない', async () => {
    const seenBySub: string[][] = [];
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('ok')) : streamOf(toolCallParts([{ name: 'researcher', input: { task: userTextOf(prompt) } }])),
    );
    scripts.set('sub', (prompt) => {
      seenBySub.push(prompt.filter((m) => m.role === 'user').map((m) => textOf(m.content)));
      return streamOf(textParts('覚えました'));
    });
    const graph = graphOf({ history: 'sessionCalls' });
    const sessionId = createSession(graph);

    const first = await runTurn(graph, '一つ目', undefined, { sessionId, parentTurnId: null });
    await runTurn(graph, '二つ目', undefined, { sessionId, parentTurnId: first[0].turnId });
    await runTurn(graph, '別の一つ目', undefined, { sessionId, parentTurnId: null });

    expect(seenBySub).toEqual([['一つ目'], ['一つ目', '二つ目'], ['別の一つ目']]);
  });

  it('ファイルへの書き込みは同じ分岐の後のターンから読め、別の分岐からは読めない', async () => {
    scripts.set('main', (prompt) => {
      if (lastIsToolResult(prompt)) return streamOf(textParts('ok'));
      return streamOf(
        userTextOf(prompt) === '書いて'
          ? toolCallParts([{ name: 'workfolder_write', input: { path: 'memo.md', content: 'メモ' } }])
          : toolCallParts([{ name: 'workfolder_read', input: { path: 'memo.md' } }]),
      );
    });
    const graph = workfolderGraphOf('write');
    const sessionId = createSession(graph);

    const written = await runTurn(graph, '書いて', undefined, { sessionId, parentTurnId: null });
    const readAfter = await runTurn(graph, '読んで', undefined, { sessionId, parentTurnId: written[0].turnId });
    const readElsewhere = await runTurn(graph, '読んで', undefined, { sessionId, parentTurnId: null });

    expect(turnFiles(written[0].turnId)).toEqual({ files: { 'memo.md': 'メモ' }, changed: ['memo.md'] });
    expect(turnFiles(readAfter[0].turnId)).toEqual({ files: { 'memo.md': 'メモ' }, changed: [] });
    expect(ofType(readAfter, 'tool.result')[0]).toMatchObject({ output: 'メモ', isError: false });
    expect(ofType(readElsewhere, 'tool.result')[0]).toMatchObject({ isError: true });
  });

  it('参照のみのアクセスでは書き込み系のツールを渡さない', async () => {
    let toolNames: string[] = [];
    scripts.set('main', (_prompt, options) => {
      toolNames = (options.tools ?? []).map((t) => t.name);
      return streamOf(textParts('ok'));
    });

    await runTurn(workfolderGraphOf('read'), '一覧を見て');

    expect(toolNames.sort()).toEqual(['workfolder_list', 'workfolder_read']);
  });

  it('ファイルは会話で初めて使うときに設定から写され、編集は分岐ごとに残る', async () => {
    scripts.set('main', (prompt) => {
      if (lastIsToolResult(prompt)) return streamOf(textParts('ok'));
      return streamOf(
        userTextOf(prompt) === '増やして'
          ? toolCallParts([{ name: 'workfolder_patch_json', input: { path: 'stock/items.json', operations: [{ op: 'replace', path: '/count', value: 2 }] } }])
          : toolCallParts([{ name: 'workfolder_read', input: { path: 'stock/items.json' } }]),
      );
    });
    const graph = graphWithMain();
    graph.nodes.push({
      id: 'inventory',
      kind: 'files',
      position: { x: 0, y: 0 },
      config: { path: 'stock', description: '在庫', files: [{ path: 'items.json', content: '{"count":1}' }] },
    });
    graph.edges.push(toolEdge('main', 'inventory', 'write'));
    const sessionId = createSession(graph);

    const edited = await runTurn(graph, '増やして', undefined, { sessionId, parentTurnId: null });
    const readAfter = await runTurn(graph, '見て', undefined, { sessionId, parentTurnId: edited[0].turnId });
    const readElsewhere = await runTurn(graph, '見て', undefined, { sessionId, parentTurnId: null });

    expect(ofType(edited, 'tool.result')[0]).toMatchObject({ isError: false });
    expect(turnFiles(edited[0].turnId)?.changed).toEqual(['stock/items.json']);
    expect(turnFiles(readAfter[0].turnId)?.changed).toEqual([]);
    expect(JSON.parse(ofType(readAfter, 'tool.result')[0].output as string)).toEqual({ count: 2 });
    expect(JSON.parse(ofType(readElsewhere, 'tool.result')[0].output as string)).toEqual({ count: 1 });
    expect(graph.nodes.find((n) => n.kind === 'files')?.config).toMatchObject({ files: [{ content: '{"count":1}' }] });
  });

  it('Web検索は API キーが無ければツールのエラーとして返す', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('ok')) : streamOf(toolCallParts([{ name: 'search', input: { query: 'AI SDK' } }])),
    );
    const graph = graphWithMain();
    graph.nodes.push({ id: 'web', kind: 'webSearch', position: { x: 0, y: 0 }, config: { name: 'search', maxResults: 3, searchDepth: 'basic' } });
    graph.edges.push(toolEdge('main', 'web'));

    const events = await runTurn(graph, '調べて');
    vi.unstubAllEnvs();

    expect(ofType(events, 'tool.result')[0]).toMatchObject({ toolName: 'search', isError: true });
    expect(String(ofType(events, 'tool.result')[0].output)).toContain('TAVILY_API_KEY');
    expect(ofType(events, 'call.start').find((e) => e.nodeId === 'web')).toMatchObject({ input: 'AI SDK' });
  });

  it('判定ノードは定義した質問を state と一緒に送り、大きすぎる state は送らない', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test');
    let description = '';
    scripts.set('main', (prompt, options) => {
      const tool = options.tools?.find((t) => t.name === 'triage');
      description = tool?.type === 'function' ? (tool.description ?? '') : '';
      return lastIsToolResult(prompt)
        ? streamOf(textParts('ok'))
        : streamOf(toolCallParts([{ name: 'triage', input: { state: userTextOf(prompt) } }]));
    });
    const graph = graphWithMain();
    graph.nodes.push(
      judgeNodeOf([
        { key: 'urgent', type: 'noul', instructions: '急ぎか', yes: '', no: '急がない' },
        { key: 'kind', type: 'choice', instructions: '種類', choices: [{ label: 'bug', description: '' }, { label: 'question', description: '質問' }] },
        { key: 'severity', type: 'score', instructions: '深刻度', levels: ['軽微', '', '致命的'] },
      ]),
    );
    graph.edges.push(toolEdge('main', 'triage'));
    judgeRequests.length = 0;

    const judged = await runTurn(graph, '本番が落ちています');
    const tooLarge = await runTurn(graph, 'あ'.repeat(40_000));
    vi.unstubAllEnvs();

    expect(judgeRequests).toEqual([
      {
        state: '本番が落ちています',
        questions: {
          urgent: { type: 'noul', instructions: '急ぎか', criteria: { true: null, false: '急がない' } },
          kind: { type: 'choice', instructions: '種類', criteria: { bug: null, question: '質問' } },
          severity: { type: 'score', instructions: '深刻度', criteria: ['軽微', null, '致命的'] },
        },
      },
    ]);
    expect(description).toContain('- urgent（はい/いいえ）: 急ぎか');
    const result = ofType(judged, 'tool.result')[0];
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.output as string)).toEqual({
      urgent: { probabilityOfYes: 0.9, noMeans: '急がない' },
      kind: {
        mostLikely: 'bug',
        choices: [
          { label: 'bug', probability: 0.8 },
          { label: 'question', means: '質問', probability: 0.2 },
        ],
      },
      severity: {
        expectedScore: 1.5,
        levels: [
          { score: 0, means: '軽微', probability: 0.1 },
          { score: 1, probability: 0.3 },
          { score: 2, means: '致命的', probability: 0.6 },
        ],
      },
    });
    // 質問文はツールの説明にだけ載せ、回答には繰り返さない
    expect(String(result.output)).not.toContain('急ぎか');
    expect(ofType(tooLarge, 'tool.result')[0]).toMatchObject({ isError: true });
  });

  it('フォルダごとの権限で読み書きでき、ワークフォルダのツールは1組にまとまる', async () => {
    let toolNames: string[] = [];
    scripts.set('main', (prompt, options) => {
      toolNames = (options.tools ?? []).map((t) => t.name);
      return lastIsToolResult(prompt)
        ? streamOf(textParts('ok'))
        : streamOf(
            toolCallParts([
              { name: 'workfolder_write', input: { path: 'notes/a.md', content: 'x' } },
              { name: 'workfolder_write', input: { path: 'drafts/b.md', content: 'y' } },
              { name: 'workfolder_read', input: { path: 'other/c.md' } },
              { name: 'workfolder_list', input: {} },
            ]),
          );
    });
    const graph = graphWithMain();
    graph.nodes.push(folderOf('notes', 'notes', []), folderOf('drafts', 'drafts', []), folderOf('other', 'other', [{ path: 'c.md', content: 'z' }]));
    graph.edges.push(toolEdge('main', 'notes', 'read'), toolEdge('main', 'drafts', 'write'));

    const events = await runTurn(graph, '書いて');

    expect(toolNames.sort()).toEqual(fileToolNames);
    const results = ofType(events, 'tool.result');
    expect(results[0]).toMatchObject({ isError: true, output: expect.stringContaining('編集できる範囲: drafts/') });
    expect(results[1]).toMatchObject({ isError: false });
    expect(results[2]).toMatchObject({ isError: true, output: expect.stringContaining('参照する権限がありません') });
    expect(results[3]).toMatchObject({ output: ['drafts/b.md'] });
    expect(turnFiles(events[0].turnId)?.files).toEqual({ 'drafts/b.md': 'y', 'other/c.md': 'z' });
  });

  it('経緯がユーザーとの会話なら、前のターンまでの直近の発言を今回のメッセージの先頭に、添付ファイル・依頼と並べる', async () => {
    const prompts: string[][] = [];
    scripts.set('main', (prompt) => {
      prompts.push(prompt.flatMap((m) => (m.role === 'user' || m.role === 'assistant' ? [textOf(m.content)] : [])));
      return streamOf(textParts(`返事${prompts.length}`));
    });
    const graph = graphWithMain();
    const main = graph.nodes.find((n) => n.id === 'main') as NodeOf<'agent'>;
    main.config = { ...main.config, history: 'recentConversation', historyLength: 2, attachments: ['notes/概要.md', 'notes/無い.md'] };
    graph.nodes.push(folderOf('notes', 'notes', [{ path: '概要.md', content: '# 概要' }]));
    const sessionId = createSession(graph);

    const first = await runTurn(graph, '一つ目', undefined, { sessionId, parentTurnId: null });
    const second = await runTurn(graph, '二つ目', undefined, { sessionId, parentTurnId: first[0].turnId });
    await runTurn(graph, '三つ目', undefined, { sessionId, parentTurnId: second[0].turnId });

    expect(prompts[2]).toEqual([
      [
        '<conversation>\n[user] 二つ目\n[assistant] 返事2\n</conversation>',
        '<file path="notes/概要.md">\n# 概要\n</file>',
        '<file path="notes/無い.md" missing="true" />',
        '<task>\n三つ目\n</task>',
      ].join('\n\n'),
    ]);
  });

  it('経緯がこのエージェントの呼び出しなら、前回までの依頼と応答だけを残し、添付ファイルは毎回その時点の中身にする', async () => {
    const prompts: string[][] = [];
    scripts.set('main', (prompt) => {
      prompts.push(prompt.flatMap((m) => (m.role === 'user' || m.role === 'assistant' ? [textOf(m.content)] : [])));
      return streamOf(textParts(`返事${prompts.length}`));
    });
    const graph = graphWithMain();
    const main = graph.nodes.find((n) => n.id === 'main') as NodeOf<'agent'>;
    main.config = { ...main.config, history: 'sessionCalls', attachments: ['概要.md'] };
    graph.nodes.push(folderOf('root', '', [{ path: '概要.md', content: '# 概要' }]));
    const sessionId = createSession(graph);

    const first = await runTurn(graph, '一つ目', undefined, { sessionId, parentTurnId: null });
    await runTurn(graph, '二つ目', undefined, { sessionId, parentTurnId: first[0].turnId });

    expect(prompts[1]).toEqual(['一つ目', '返事1', '<file path="概要.md">\n# 概要\n</file>\n\n<task>\n二つ目\n</task>']);
  });

  it('ツールとして呼ばれたエージェントの経緯の会話は、呼び出し元のやりとりではなくユーザーとの会話', async () => {
    const subPrompts: string[] = [];
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('ok')) : streamOf(toolCallParts([{ name: 'researcher', input: { task: '調べて' } }])),
    );
    scripts.set('sub', (prompt) => {
      subPrompts.push(userTextOf(prompt));
      return streamOf(textParts('調べました'));
    });
    const graph = graphOf({ history: 'conversation' });
    const sessionId = createSession(graph);

    const first = await runTurn(graph, '旅行の計画を立てたい', undefined, { sessionId, parentTurnId: null });
    await runTurn(graph, '京都にしたい', undefined, { sessionId, parentTurnId: first[0].turnId });

    expect(subPrompts).toEqual(['調べて', '<conversation>\n[user] 旅行の計画を立てたい\n[assistant] ok\n</conversation>\n\n<task>\n調べて\n</task>']);
  });

  it('返すものが「なし」なら、終了用のツールで応答を待たずに終え、後段には順序だけを伝える', async () => {
    const mainPrompts: string[] = [];
    let secretaryCalls = 0;
    scripts.set('main', (prompt) => {
      mainPrompts.push(userTextOf(prompt));
      return streamOf(textParts('回答'));
    });
    scripts.set('sub', () => {
      secretaryCalls++;
      // 1回目は書き込みが失敗するので終了せず、2回目で書き込みと終了を同じ応答で行う
      const path = secretaryCalls === 1 ? '../x.md' : 'notes/概要.md';
      return streamOf(
        toolCallParts([
          { name: 'workfolder_write', input: { path, content: '更新' } },
          { name: 'finish', input: {} },
        ]),
      );
    });
    const graph = graphWithMain();
    graph.nodes.push(agentOf('secretary', { model: 'sub', returns: 'none' }), folderOf('notes', 'notes', []));
    graph.edges = [flowEdge('user', 'secretary'), flowEdge('secretary', 'main'), flowEdge('user', 'main'), flowEdge('main', 'user'), toolEdge('secretary', 'notes', 'write')];

    const events = await runTurn(graph, 'こんにちは');

    expect(secretaryCalls).toBe(2);
    expect(mainPrompts).toEqual(['こんにちは']);
    expect(ofType(events, 'call.finish').find((e) => e.nodeId === 'secretary')).toMatchObject({ status: 'done', output: '' });
    expect(turnFiles(events[0].turnId)?.files).toEqual({ 'notes/概要.md': '更新' });
  });

  it('フローのノードを流れの順に実行して後段に出力を渡し、条件を満たさないノードは飛ばす', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test');
    const mainPrompts: string[] = [];
    const subPrompts: string[] = [];
    scripts.set('main', (prompt) => {
      mainPrompts.push(userTextOf(prompt));
      return streamOf(textParts('回答'));
    });
    scripts.set('sub', (prompt) => {
      subPrompts.push(userTextOf(prompt));
      return streamOf(textParts('集めた情報'));
    });
    // ユーザー → 判定 →（条件を満たせば）調べもの → メイン → ユーザー。メインにはユーザーの発言も流す
    const flowGraphOf = (anyOf: string[]) => {
      const graph = graphWithMain();
      graph.nodes.push(judgeNodeOf([{ key: 'urgent', type: 'noul', instructions: '急ぎか', yes: '', no: '' }]), agentOf('researcher', { model: 'sub' }));
      graph.edges.push(flowEdge('user', 'triage'), flowEdge('triage', 'researcher', { questionKey: 'urgent', anyOf }), flowEdge('researcher', 'main'));
      return graph;
    };
    judgeRequests.length = 0;

    const passed = await runTurn(flowGraphOf(['yes']), '急いで調べて');
    const skipped = await runTurn(flowGraphOf(['no']), '急いで調べて');
    vi.unstubAllEnvs();

    expect(judgeRequests).toMatchObject([{ state: '急いで調べて' }, { state: '急いで調べて' }]);
    expect(subPrompts).toHaveLength(1);
    expect(JSON.parse(subPrompts[0])).toMatchObject({ urgent: { probabilityOfYes: 0.9 } });
    // 流れてきた出力は、ユーザーの発言と取り違えないよう別のタグに入れる
    expect(mainPrompts[0]).toMatch(
      /^<user_message>\n急いで調べて\n<\/user_message>\n<preprocessing_results>\n[\s\S]*<researcher>\n集めた情報\n<\/researcher>\n<\/preprocessing_results>$/,
    );
    expect(mainPrompts[1]).toBe('急いで調べて');

    expect(ofType(passed, 'call.start').map((e) => [e.nodeId, e.parentCallId])).toEqual([
      ['triage', null],
      ['researcher', null],
      ['main', null],
    ]);
    expect(ofType(passed, 'turn.finish')[0]).toMatchObject({ status: 'done', reply: '回答' });
    expect(ofType(skipped, 'log').some((e) => e.message.includes('researcher には何も流れてこなかった'))).toBe(true);
  });

  it('判定の結果で、返答するエージェントを振り分けられる', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'test');
    calledModels.length = 0;
    scripts.set('urgent', () => streamOf(textParts('すぐ対応します')));
    scripts.set('calm', () => streamOf(textParts('順に対応します')));
    const graph: GraphDefinition = {
      nodes: [
        createNode('user', 'user', { x: 0, y: 0 }),
        judgeNodeOf([{ key: 'urgent', type: 'noul', instructions: '急ぎか', yes: '', no: '' }]),
        agentOf('urgentAgent', { model: 'urgent' }),
        agentOf('calmAgent', { model: 'calm' }),
      ],
      edges: [
        flowEdge('user', 'triage'),
        flowEdge('triage', 'urgentAgent', { questionKey: 'urgent', anyOf: ['yes'] }),
        flowEdge('triage', 'calmAgent', { questionKey: 'urgent', anyOf: ['no'] }),
        flowEdge('urgentAgent', 'user'),
        flowEdge('calmAgent', 'user'),
      ],
      settings: { maxCallDepth: 5 },
    };

    const events = await runTurn(graph, '本番が落ちています');
    vi.unstubAllEnvs();

    expect(calledModels).toEqual(['openrouter:urgent']);
    expect(ofType(events, 'turn.finish')[0]).toMatchObject({ status: 'done', reply: 'すぐ対応します' });
  });

  it('フローが循環していたらターンをエラーにする', async () => {
    const graph = graphWithMain();
    graph.nodes.push(agentOf('researcher', { model: 'sub' }));
    graph.edges.push(flowEdge('main', 'researcher'), flowEdge('researcher', 'main'));

    const events = await runTurn(graph, 'こんにちは');

    expect(ofType(events, 'call.start')).toEqual([]);
    expect(ofType(events, 'turn.finish')[0]).toMatchObject({ status: 'error', error: expect.stringContaining('循環') });
  });
});

/** ユーザーの発言をモデル main のエージェント main が受けて返すグラフ */
function graphWithMain(): GraphDefinition {
  return {
    nodes: [createNode('user', 'user', { x: 0, y: 0 }), agentOf('main', { model: 'main', history: 'sessionCalls' })],
    edges: [flowEdge('user', 'main'), flowEdge('main', 'user')],
    settings: { maxCallDepth: 5 },
  };
}

/** main がモデル sub のエージェント researcher をツールとして呼び出すグラフ */
function graphOf(researcher: Partial<NodeOf<'agent'>['config']>): GraphDefinition {
  const graph = graphWithMain();
  graph.nodes.push(agentOf('researcher', { model: 'sub', description: '調べもの担当', ...researcher }));
  graph.edges.push(toolEdge('main', 'researcher'));
  return graph;
}

/** id をツール名にもするエージェント。指定がなければ経緯なしで、最終テキストを返す */
function agentOf(id: string, config: Partial<NodeOf<'agent'>['config']>): NodeOf<'agent'> {
  const node = createNode('agent', id, { x: 0, y: 0 });
  node.config = { ...node.config, name: id, maxSteps: 5, ...config };
  return node;
}

/** 判定ノード triage */
function judgeNodeOf(questions: JudgeQuestion[]): NodeOf<'judge'> {
  return { id: 'triage', kind: 'judge', position: { x: 0, y: 0 }, config: { name: 'triage', description: '', model: '', questions } };
}

/** ワークフォルダの中のフォルダ path を表す files ノード */
function folderOf(id: string, path: string, files: { path: string; content: string }[]): NodeOf<'files'> {
  return { id, kind: 'files', position: { x: 0, y: 0 }, config: { path, description: '', files } };
}

const fileToolNames = ['workfolder_delete', 'workfolder_edit_markdown', 'workfolder_list', 'workfolder_patch_json', 'workfolder_read', 'workfolder_write'];

function workfolderGraphOf(permission: AccessPermission): GraphDefinition {
  const graph = graphWithMain();
  graph.nodes.push(createNode('files', 'work', { x: 0, y: 0 }));
  graph.edges.push(toolEdge('main', 'work', permission));
  return graph;
}

function toolEdge(source: string, target: string, permission: AccessPermission = 'read'): EdgeOf<'tool'> {
  return { id: `${source}-${target}`, kind: 'tool', source, target, permission };
}

function flowEdge(source: string, target: string, condition: FlowCondition | null = null): EdgeOf<'flow'> {
  return { id: `${source}-${target}`, kind: 'flow', source, target, condition };
}

function createSession(graph: GraphDefinition): string {
  const sessionId = randomUUID();
  db.insert(sessions).values({ id: sessionId, title: 'test', graph, activeTurnId: null, createdAt: Date.now() }).run();
  return sessionId;
}

/** ターンを保存して実行し、終わるまでのイベントを返す */
function runTurn(
  graph: GraphDefinition,
  userText: string,
  onEvent?: (event: RunEvent) => void,
  placement: { sessionId: string; parentTurnId: string | null } = { sessionId: createSession(graph), parentTurnId: null },
): Promise<RunEvent[]> {
  const turn = startTurn(placement.sessionId, graph, placement.parentTurnId, userText);
  return new Promise((resolve) => {
    const events: RunEvent[] = [];
    const following = followTurn(turn.id, (event) => {
      events.push(event);
      onEvent?.(event);
      if (event.type === 'turn.finish') {
        following.stop();
        resolve(events);
      }
    });
  });
}

function ofType<T extends RunEvent['type']>(events: RunEvent[], type: T): RunEventOf<T>[] {
  return events.filter((e): e is RunEventOf<T> => e.type === type);
}

function lastIsToolResult(prompt: LanguageModelV3Prompt): boolean {
  return prompt.at(-1)?.role === 'tool';
}

function userTextOf(prompt: LanguageModelV3Prompt): string {
  return textOf(prompt.findLast((m) => m.role === 'user')!.content);
}

/** メッセージの最初のテキスト */
function textOf(content: LanguageModelV3Prompt[number]['content']): string {
  return typeof content === 'string' ? content : ((content.find((p) => p.type === 'text') as { text: string } | undefined)?.text ?? '');
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function textParts(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  ];
}

function toolCallParts(calls: { name: string; input: unknown }[]): LanguageModelV3StreamPart[] {
  return [
    ...calls.map((c): LanguageModelV3StreamPart => ({ type: 'tool-call', toolCallId: randomUUID(), toolName: c.name, input: JSON.stringify(c.input) })),
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
  ];
}

function streamOf(parts: LanguageModelV3StreamPart[]): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/** 少し待ってから流し終え、終わったら onDone を呼ぶ */
function delayedStream(parts: LanguageModelV3StreamPart[], onDone: () => void): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    async start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      await new Promise((r) => setTimeout(r, 20));
      for (const part of parts) controller.enqueue(part);
      onDone();
      controller.close();
    },
  });
}

/** テキストを途中まで流したあと、Abort されるまで止まる */
function hangingStream(text: string, signal: AbortSignal): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'text-start', id: 't' });
      controller.enqueue({ type: 'text-delta', id: 't', delta: text });
      signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    },
  });
}
