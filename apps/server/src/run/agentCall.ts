import { randomUUID } from 'node:crypto';
import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { stepCountIs, streamText, tool, wrapLanguageModel, type ModelMessage, type StepResult, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  resolveCallSettings,
  resourceSpecOf,
  type AgentNode,
  type CallSettings,
  type EdgeOf,
  type GraphDefinition,
  type NodeOf,
  type RunEventBody,
  type RunEventHeader,
  type RunStatus,
  type StepRecord,
  workfolderSpec,
} from 'protocol';
import { judgeTool } from '../judge/index.ts';
import { languageModel, stepCost } from '../llm/index.ts';
import { volumeTools } from '../volume/tools.ts';
import { webSearchTool } from '../webSearch/index.ts';
import { recallMemory, storeMemory, type TurnMemory } from './memory.ts';
import { transcriptOf } from './transcript.ts';

/** ターン実行1回分のうち、エージェント呼び出しが必要とするもの */
export type RunScope = {
  turnId: string;
  graph: GraphDefinition;
  signal: AbortSignal;
  turnMemory: TurnMemory;
  emit(header: CallHeader, body: RunEventBody): void;
};

/** イベントのヘッダのうち、どの呼び出しで発生したかを表す部分 */
export type CallHeader = Pick<RunEventHeader, 'callId' | 'parentCallId' | 'nodeId'>;

/** エージェント呼び出し1回分の指定 */
export type AgentCallRequest = {
  node: AgentNode;
  parentCallId: string | null;
  toolCallId: string | null;
  depth: number;
  settings: CallSettings | null;
  /** イベントに残す、この呼び出しで与えた指示 */
  task: string;
  /** モデルに渡すメッセージ全体（記憶・履歴と、最後に今回の指示） */
  messages: ModelMessage[];
};

/** エージェント呼び出し1回分の結果 */
export type AgentCallOutcome = {
  status: Exclude<RunStatus, 'running'>;
  output: string;
  /** この呼び出しで新たに生成されたメッセージ。Abort 時は途中までのテキストを含む */
  responseMessages: ModelMessage[];
  error: string | null;
};

/**
 * エージェントを1回呼び出し、ツールコールのループが終わるまで進める。
 * 呼び出し先がサブエージェントを持つ場合は、ツールの実行として再帰的に呼び出す。
 * LLM 呼び出しの失敗や Abort は例外にせず、結果の status として返す。
 */
export async function callAgent(scope: RunScope, req: AgentCallRequest): Promise<AgentCallOutcome> {
  const header: CallHeader = { callId: randomUUID(), parentCallId: req.parentCallId, nodeId: req.node.id };
  const emit = (body: RunEventBody) => scope.emit(header, body);
  emit({ type: 'call.start', depth: req.depth, toolCallId: req.toolCallId, settings: req.settings, task: req.task });

  const steps: StepResult<ToolSet>[] = [];
  // onStepFinish は fullStream の読み出しを待たずに呼ばれるので、記録はここで受け渡して fullStream の finish-step の位置で送る。
  // onStepFinish で直接送ると、同じステップの tool.result より先に step.finish が届くことがある
  const stepRecords = slots<StepRecord>();
  let stepIndex = -1;
  // ステップの所要時間はツールの実行を除いた LLM の応答時間にするため、ステップの区切りではなく応答そのものを計る
  let response: ResponseTiming = { startedAt: Date.now(), endedAt: null };
  // まだ完了していないステップで生成済みのテキスト。Abort 時はこれが最後の出力になる
  let partialText = '';
  let error: string | null = null;

  const result = streamText({
    model: withResponseTiming(languageModel(req.node.config.provider, req.node.config.model), (timing) => (response = timing)),
    system: req.node.config.systemPrompt,
    messages: req.messages,
    tools: toolsFor(scope, req.node, header, req.depth),
    stopWhen: stepCountIs(req.node.config.maxSteps),
    abortSignal: scope.signal,
    onStepFinish: (step) => {
      steps.push(step);
      stepRecords.put(step.stepNumber, stepRecordOf(req.node, step, durationOf(response)));
    },
  });

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
          stepIndex++;
          emit({ type: 'step.start', index: stepIndex });
          break;
        case 'finish-step':
          partialText = '';
          emit({ type: 'step.finish', step: await stepRecords.take(stepIndex) });
          break;
        case 'text-delta':
          partialText += part.text;
          emit({ type: 'text.delta', text: part.text });
          break;
        case 'tool-call':
          emit({ type: 'tool.call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
          break;
        case 'tool-result':
          emit({ type: 'tool.result', toolCallId: part.toolCallId, toolName: part.toolName, output: part.output, isError: false });
          break;
        case 'tool-error':
          emit({ type: 'tool.result', toolCallId: part.toolCallId, toolName: part.toolName, output: messageOf(part.error), isError: true });
          break;
        case 'error':
          error = messageOf(part.error);
          break;
      }
    }
  } catch (e) {
    if (!scope.signal.aborted) error = messageOf(e);
  }

  const aborted = scope.signal.aborted;
  // 各ステップの response.messages はそれまでの全ステップ分を含むため、最後のステップのものだけで足りる
  const responseMessages = [...(steps.at(-1)?.response.messages ?? [])];
  if (aborted && partialText) {
    // 打ち切られたステップは onStepFinish が呼ばれないため、途中までの出力をここで残す
    emit({ type: 'step.finish', step: abortedStepRecord(req.node, stepIndex, partialText, durationOf(response)) });
    responseMessages.push({ role: 'assistant', content: partialText });
  }

  const outcome: AgentCallOutcome = {
    status: aborted ? 'aborted' : error ? 'error' : 'done',
    output: outputOf(steps, partialText, req.settings),
    responseMessages,
    error,
  };
  emit({ type: 'call.finish', status: outcome.status, output: outcome.output, error });
  return outcome;
}

/** 呼び出し元ノードから出るエッジを、そのノードが使えるツールに変換する。ツールは呼び出しごとに逐次実行される */
function toolsFor(scope: RunScope, caller: AgentNode, header: CallHeader, depth: number): ToolSet {
  const tools: ToolSet = {};
  for (const edge of scope.graph.edges) {
    if (edge.source !== caller.id) continue;
    const target = scope.graph.nodes.find((n) => n.id === edge.target);
    if (edge.kind === 'call' && target?.kind === 'subAgent') {
      tools[target.config.name] = subAgentTool(scope, edge, target, header, depth);
    }
    if (edge.kind === 'access' && (target?.kind === 'workfolder' || target?.kind === 'resource')) {
      const spec = target.kind === 'workfolder' ? workfolderSpec : resourceSpecOf(target);
      const context = { turnId: scope.turnId, emit: (body: RunEventBody) => scope.emit(header, body) };
      Object.assign(tools, volumeTools(spec, edge.permission, context));
    }
    if (edge.kind === 'use' && target?.kind === 'webSearch') {
      tools[target.config.name] = webSearchTool(target);
    }
    if (edge.kind === 'use' && target?.kind === 'judge') {
      tools[target.config.name] = judgeTool(target);
    }
  }
  return serialized(tools);
}

function subAgentTool(scope: RunScope, edge: EdgeOf<'call'>, target: NodeOf<'subAgent'>, caller: CallHeader, callerDepth: number) {
  const settings = resolveCallSettings(edge, target);
  return tool({
    description: target.config.description,
    inputSchema: z.object({ task: z.string().describe('サブエージェントに依頼する内容') }),
    execute: async ({ task }, { toolCallId, messages }): Promise<string> => {
      const depth = callerDepth + 1;
      if (depth > scope.graph.settings.maxCallDepth) {
        const message = `呼び出しの深さが上限（${scope.graph.settings.maxCallDepth}）に達したため ${target.config.name} を呼び出しませんでした`;
        scope.emit(caller, { type: 'log', level: 'warn', message });
        return message;
      }

      const memory = recallMemory(scope, edge.id, settings.memory);
      const prompt = settings.pass === 'taskWithHistory' ? withCallerHistory(task, messages) : task;
      const userMessage: ModelMessage = { role: 'user', content: prompt };
      const outcome = await callAgent(scope, {
        node: target,
        parentCallId: caller.callId,
        toolCallId,
        depth,
        settings,
        task,
        messages: [...memory, userMessage],
      });
      storeMemory(scope, edge.id, settings.memory, [...memory, userMessage, ...outcome.responseMessages]);

      if (outcome.status === 'error') return `サブエージェントの実行に失敗しました: ${outcome.error}`;
      return outcome.output;
    },
  });
}

function withCallerHistory(task: string, callerMessages: ModelMessage[]): string {
  return `<caller_conversation>\n${transcriptOf(callerMessages)}\n</caller_conversation>\n\n<task>\n${task}\n</task>`;
}

/**
 * tools の実行を1つずつ順に行うようにする。
 * AI SDK は1ステップ内の複数ツールコールを並行実行するため、これで逐次実行にしている。
 * エージェント呼び出しごとに行うので、親のツール実行中に子がツールを実行しても待ち合わせにならない。
 */
function serialized(tools: ToolSet): ToolSet {
  let tail: Promise<unknown> = Promise.resolve();
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const execute = t.execute;
      if (!execute) return [name, t];
      return [
        name,
        {
          ...t,
          execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
            const result = tail.then(() => execute(input, options));
            tail = result.catch(() => undefined);
            return result;
          },
        },
      ];
    }),
  );
}

function outputOf(steps: StepResult<ToolSet>[], partialText: string, settings: CallSettings | null): string {
  if (settings?.returns === 'allSteps') {
    const summaries = steps.map((s) => ({
      text: s.text,
      toolCalls: s.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
      toolResults: s.toolResults.map((r) => ({ toolName: r.toolName, output: r.output })),
    }));
    if (partialText) summaries.push({ text: partialText, toolCalls: [], toolResults: [] });
    return JSON.stringify(summaries, null, 2);
  }
  return partialText || steps.at(-1)?.text || '';
}

async function stepRecordOf(node: AgentNode, step: StepResult<ToolSet>, durationMs: number): Promise<StepRecord> {
  const inputTokens = step.usage.inputTokens ?? 0;
  const outputTokens = step.usage.outputTokens ?? 0;
  return {
    index: step.stepNumber,
    model: step.model.modelId,
    text: step.text,
    reasoning: step.reasoningText ?? null,
    finishReason: step.finishReason,
    usage: { inputTokens, outputTokens },
    cost: await stepCost(node.config.provider, step),
    durationMs,
    request: step.request.body ?? null,
    response: {
      id: step.response.id,
      modelId: step.response.modelId,
      content: step.content,
      finishReason: step.finishReason,
      usage: step.usage,
      providerMetadata: step.providerMetadata,
      warnings: step.warnings,
    },
    aborted: false,
  };
}

function abortedStepRecord(node: AgentNode, index: number, text: string, durationMs: number): StepRecord {
  return {
    index,
    model: node.config.model,
    text,
    reasoning: null,
    finishReason: 'aborted',
    usage: { inputTokens: 0, outputTokens: 0 },
    cost: null,
    durationMs,
    request: null,
    response: null,
    aborted: true,
  };
}

/** LLM への1回の要求について、要求した時刻と応答を受け取り終えた時刻。受け取り終える前は endedAt が null */
type ResponseTiming = { startedAt: number; endedAt: number | null };

/** model への要求のたびに ResponseTiming を作って onRequest に渡し、応答を受け取り終えたらその endedAt を埋める */
function withResponseTiming(model: LanguageModelV3, onRequest: (timing: ResponseTiming) => void): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapStream: async ({ doStream }) => {
        const timing: ResponseTiming = { startedAt: Date.now(), endedAt: null };
        onRequest(timing);
        const result = await doStream();
        const stream = result.stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            flush: () => {
              timing.endedAt = Date.now();
            },
          }),
        );
        return { ...result, stream };
      },
    },
  });
}

/** 応答にかかった時間。受け取り終えていなければ今までの時間 */
function durationOf(timing: ResponseTiming): number {
  return (timing.endedAt ?? Date.now()) - timing.startedAt;
}

/** 番号ごとに値を受け渡す。置く側と受け取る側のどちらが先でもよい */
function slots<T>() {
  const entries = new Map<number, { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void }>();
  const entryOf = (key: number) => {
    let entry = entries.get(key);
    if (!entry) {
      let resolve: (value: T | PromiseLike<T>) => void = () => {};
      const promise = new Promise<T>((r) => (resolve = r));
      entry = { promise, resolve };
      entries.set(key, entry);
    }
    return entry;
  };
  return {
    put: (key: number, value: T | PromiseLike<T>) => entryOf(key).resolve(value),
    take: (key: number) => entryOf(key).promise,
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
