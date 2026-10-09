import { randomUUID } from 'node:crypto';
import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultGraph, type CallSettings, type GraphDefinition, type RunEvent, type RunEventOf } from 'protocol';
import { db, graphs, sessions, turns } from '../db/index.ts';
import { abortTurn, followTurn, startTurn } from './index.ts';

/** モデルID ごとに、受け取ったプロンプトから返すストリームを決める台本 */
const scripts = new Map<string, (prompt: LanguageModelV3Prompt, options: LanguageModelV3CallOptions) => ReadableStream<LanguageModelV3StreamPart>>();

vi.mock('../openrouter/index.ts', () => ({
  languageModel: (modelId: string) =>
    new MockLanguageModelV3({
      modelId,
      doStream: async (options) => ({ stream: scripts.get(modelId)!(options.prompt, options) }),
    }),
  modelCatalog: async () => [],
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
});

function graphOf(subDefaults: Pick<CallSettings, 'memory'>): GraphDefinition {
  const graph = createDefaultGraph();
  graph.nodes[0].config.model = 'main';
  graph.nodes.push({
    id: 'researcher',
    kind: 'subAgent',
    position: { x: 0, y: 0 },
    config: {
      name: 'researcher',
      description: '調べもの担当',
      model: 'sub',
      systemPrompt: 'You research.',
      maxSteps: 5,
      callDefaults: { pass: 'task', returns: 'finalText', ...subDefaults },
    },
  });
  graph.edges.push({ id: 'main-researcher', kind: 'call', source: 'main', target: 'researcher', settings: {} });
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
