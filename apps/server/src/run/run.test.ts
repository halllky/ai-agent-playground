import { randomUUID } from 'node:crypto';
import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultGraph, findMainAgent, type AccessPermission, type CallSettings, type GraphDefinition, type ModelProvider, type RunEvent, type RunEventOf } from 'protocol';
import { db, graphs, sessions, turns } from '../db/index.ts';
import { abortTurn, followTurn, startTurn } from './index.ts';

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
  it('メインからサブエージェントを呼び出し、同じステップの複数ツールコールは逐次実行する', async () => {
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

    const events = await runTurn(graphOf({ memory: 'fresh' }), 'こんにちは');

    const subStarts = ofType(events, 'call.start').filter((e) => e.nodeId === 'researcher');
    const mainStart = ofType(events, 'call.start').find((e) => e.nodeId === 'main')!;
    expect(subStarts).toHaveLength(2);
    expect(subStarts.every((e) => e.parentCallId === mainStart.callId && e.depth === 1)).toBe(true);
    expect(maxRunning).toBe(1);
    expect(ofType(events, 'turn.finish')[0]).toMatchObject({ status: 'done' });
    expect(ofType(events, 'step.finish').at(-1)?.step.text).toBe('まとめました');
  });

  it('ステップのイベントはツールコールを挟んで順に届き、所要時間にツールの実行を含めない', async () => {
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt)
        ? streamOf(textParts('まとめました'))
        : streamOf(toolCallParts([{ name: 'researcher', input: { task: 'A' } }, { name: 'researcher', input: { task: 'B' } }])),
    );
    scripts.set('sub', () => delayedStream(textParts('調査結果'), () => {}));

    const events = await runTurn(graphOf({ memory: 'fresh' }), 'こんにちは');

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

    await runTurn(graphOf({ memory: 'fresh' }, 'gemini'), 'こんにちは');

    expect(calledModels).toEqual(['openrouter:main', 'gemini:sub', 'openrouter:main']);
  });

  it('呼び出しのネストが上限に達したら打ち切る', async () => {
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('完了')) : streamOf(toolCallParts([{ name: 'researcher', input: { task: 'go' } }])),
    );
    scripts.set('sub', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('戻ります')) : streamOf(toolCallParts([{ name: 'researcher', input: { task: 'deeper' } }])),
    );
    const graph = graphOf({ memory: 'fresh' });
    graph.edges.push({ id: 'loop', kind: 'call', source: 'researcher', target: 'researcher', settings: {} });
    graph.settings.maxCallDepth = 3;

    const events = await runTurn(graph, '再帰して');

    expect(Math.max(...ofType(events, 'call.start').map((e) => e.depth))).toBe(3);
    expect(ofType(events, 'log').some((e) => e.level === 'warn' && e.message.includes('上限'))).toBe(true);
    expect(ofType(events, 'turn.finish')[0]).toMatchObject({ status: 'done' });
  });

  it('Abort すると実行中のサブエージェントも止まり、途中までの出力が残る', async () => {
    scripts.set('main', () => streamOf(toolCallParts([{ name: 'researcher', input: { task: 'ずっと考えて' } }])));
    scripts.set('sub', (_prompt, options) => hangingStream('途中まで', options.abortSignal!));

    const events = await runTurn(graphOf({ memory: 'fresh' }), '長い仕事', (event) => {
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
      seenBySub.push(prompt.filter((m) => m.role === 'user').map((m) => (m.content[0] as { text: string }).text));
      return streamOf(textParts('覚えました'));
    });
    const graph = graphOf({ memory: 'session' });
    const sessionId = createSession(graph);

    const first = await runTurn(graph, '一つ目', undefined, { sessionId, parentTurnId: null });
    await runTurn(graph, '二つ目', undefined, { sessionId, parentTurnId: first[0].turnId });
    await runTurn(graph, '別の一つ目', undefined, { sessionId, parentTurnId: null });

    expect(seenBySub).toEqual([['一つ目'], ['一つ目', '二つ目'], ['別の一つ目']]);
  });

  it('ワークフォルダへの書き込みは同じ分岐の後のターンから読め、別の分岐からは読めない', async () => {
    scripts.set('main', (prompt) => {
      if (lastIsToolResult(prompt)) return streamOf(textParts('ok'));
      const text = userTextOf(prompt);
      return streamOf(
        text === '書いて'
          ? toolCallParts([{ name: 'workfolder_write', input: { path: 'memo.md', content: 'メモ' } }])
          : toolCallParts([{ name: 'workfolder_read', input: { path: 'memo.md' } }]),
      );
    });
    const graph = workfolderGraphOf('write');
    const sessionId = createSession(graph);

    const written = await runTurn(graph, '書いて', undefined, { sessionId, parentTurnId: null });
    const readAfter = await runTurn(graph, '読んで', undefined, { sessionId, parentTurnId: written[0].turnId });
    const readElsewhere = await runTurn(graph, '読んで', undefined, { sessionId, parentTurnId: null });

    expect(ofType(written, 'file.change')).toMatchObject([{ volume: 'work', path: 'memo.md', deleted: false, nodeId: 'main' }]);
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

  it('リソースは会話で初めて使うときに設定から写され、編集は分岐ごとに残る', async () => {
    scripts.set('main', (prompt) => {
      if (lastIsToolResult(prompt)) return streamOf(textParts('ok'));
      return streamOf(
        userTextOf(prompt) === '増やして'
          ? toolCallParts([{ name: 'inventory_patch_json', input: { path: 'items.json', operations: [{ op: 'replace', path: '/count', value: 2 }] } }])
          : toolCallParts([{ name: 'inventory_read', input: { path: 'items.json' } }]),
      );
    });
    const graph = graphWithMain();
    graph.nodes.push({
      id: 'inventory',
      kind: 'resource',
      position: { x: 0, y: 0 },
      config: { name: 'inventory', description: '在庫', files: [{ path: 'items.json', content: '{"count":1}' }] },
    });
    graph.edges.push({ id: 'main-inventory', kind: 'access', source: 'main', target: 'inventory', permission: 'write' });
    const sessionId = createSession(graph);

    const edited = await runTurn(graph, '増やして', undefined, { sessionId, parentTurnId: null });
    const readAfter = await runTurn(graph, '見て', undefined, { sessionId, parentTurnId: edited[0].turnId });
    const readElsewhere = await runTurn(graph, '見て', undefined, { sessionId, parentTurnId: null });

    expect(ofType(edited, 'tool.result')[0]).toMatchObject({ isError: false });
    expect(JSON.parse(ofType(readAfter, 'tool.result')[0].output as string)).toEqual({ count: 2 });
    expect(JSON.parse(ofType(readElsewhere, 'tool.result')[0].output as string)).toEqual({ count: 1 });
    expect(graph.nodes.find((n) => n.kind === 'resource')?.config).toMatchObject({ files: [{ content: '{"count":1}' }] });
  });

  it('Web検索は API キーが無ければツールのエラーとして返す', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    scripts.set('main', (prompt) =>
      lastIsToolResult(prompt) ? streamOf(textParts('ok')) : streamOf(toolCallParts([{ name: 'search', input: { query: 'AI SDK' } }])),
    );
    const graph = graphWithMain();
    graph.nodes.push({ id: 'web', kind: 'webSearch', position: { x: 0, y: 0 }, config: { name: 'search', maxResults: 3, searchDepth: 'basic' } });
    graph.edges.push({ id: 'main-web', kind: 'use', source: 'main', target: 'web' });

    const events = await runTurn(graph, '調べて');
    vi.unstubAllEnvs();

    expect(ofType(events, 'tool.result')[0]).toMatchObject({ toolName: 'search', isError: true });
    expect(String(ofType(events, 'tool.result')[0].output)).toContain('TAVILY_API_KEY');
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
    graph.nodes.push({
      id: 'triage',
      kind: 'judge',
      position: { x: 0, y: 0 },
      config: {
        name: 'triage',
        description: '',
        model: '',
        questions: [
          { key: 'urgent', type: 'noul', instructions: '急ぎか', yes: '', no: '急がない' },
          { key: 'kind', type: 'choice', instructions: '種類', choices: [{ label: 'bug', description: '' }, { label: 'question', description: '質問' }] },
          { key: 'severity', type: 'score', instructions: '深刻度', levels: ['軽微', '', '致命的'] },
        ],
      },
    });
    graph.edges.push({ id: 'main-triage', kind: 'use', source: 'main', target: 'triage' });
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
    expect(ofType(judged, 'tool.result')[0]).toMatchObject({
      isError: false,
      output: {
        answers: {
          urgent: { question: '急ぎか', probabilityOfYes: 0.9, noMeans: '急がない' },
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
        },
      },
    });
    expect(ofType(tooLarge, 'tool.result')[0]).toMatchObject({ isError: true });
  });
});

/** モデル main のメインエージェントだけを持つグラフ */
function graphWithMain(): GraphDefinition {
  const graph = createDefaultGraph();
  findMainAgent(graph)!.config.model = 'main';
  return graph;
}

function graphOf(subDefaults: Pick<CallSettings, 'memory'>, subProvider: ModelProvider = 'openrouter'): GraphDefinition {
  const graph = graphWithMain();
  graph.nodes.push({
    id: 'researcher',
    kind: 'subAgent',
    position: { x: 0, y: 0 },
    config: {
      name: 'researcher',
      description: '調べもの担当',
      provider: subProvider,
      model: 'sub',
      systemPrompt: 'You research.',
      maxSteps: 5,
      callDefaults: { pass: 'task', returns: 'finalText', ...subDefaults },
    },
  });
  graph.edges.push({ id: 'main-researcher', kind: 'call', source: 'main', target: 'researcher', settings: {} });
  return graph;
}

function workfolderGraphOf(permission: AccessPermission): GraphDefinition {
  const graph = graphWithMain();
  graph.nodes.push({ id: 'work', kind: 'workfolder', position: { x: 0, y: 0 }, config: {} });
  graph.edges.push({ id: 'main-work', kind: 'access', source: 'main', target: 'work', permission });
  return graph;
}

function createSession(graph: GraphDefinition): string {
  const graphId = randomUUID();
  const sessionId = randomUUID();
  db.insert(graphs).values({ id: graphId, name: 'test', definition: graph, updatedAt: Date.now() }).run();
  db.insert(sessions).values({ id: sessionId, title: 'test', graphId, activeTurnId: null, createdAt: Date.now() }).run();
  return sessionId;
}

/** ターンを保存して実行し、終わるまでのイベントを返す */
function runTurn(
  graph: GraphDefinition,
  userText: string,
  onEvent?: (event: RunEvent) => void,
  placement: { sessionId: string; parentTurnId: string | null } = { sessionId: createSession(graph), parentTurnId: null },
): Promise<RunEvent[]> {
  const turn = {
    id: randomUUID(),
    ...placement,
    userText,
    graph,
    status: 'running' as const,
    mainMessages: [],
    createdAt: Date.now(),
  };
  db.insert(turns).values(turn).run();
  startTurn(turn);
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
  const last = prompt.findLast((m) => m.role === 'user')!;
  return (last.content[0] as { text: string }).text;
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
