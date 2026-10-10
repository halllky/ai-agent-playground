import { randomUUID } from 'node:crypto';
import { stepCountIs, streamText, tool, type ModelMessage, type StepResult, type ToolSet } from 'ai';
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
import { languageModel, modelCatalog } from '../openrouter/index.ts';
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
  let stepStartedAt = Date.now();
  // まだ完了していないステップで生成済みのテキスト。Abort 時はこれが最後の出力になる
  let partialText = '';
  let error: string | null = null;

  const result = streamText({
    model: languageModel(req.node.config.model),
    system: req.node.config.systemPrompt,
    messages: req.messages,
    tools: toolsFor(scope, req.node, header, req.depth),
    stopWhen: stepCountIs(req.node.config.maxSteps),
    abortSignal: scope.signal,
    onStepFinish: async (step) => {
      steps.push(step);
      partialText = '';
      emit({ type: 'step.finish', step: await stepRecordOf(step, steps.length - 1, Date.now() - stepStartedAt) });
    },
  });

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
          stepStartedAt = Date.now();
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
    emit({ type: 'step.finish', step: abortedStepRecord(req.node, steps.length, partialText, Date.now() - stepStartedAt) });
    responseMessages.push({ role: 'assistant', content: partialText });
  }

  const outcome: AgentCallOutcome = {
    status: aborted ? 'aborted' : error ? 'error' : 'done',
    output: outputOf(steps, partialText, req.settings),
    responseMessages,
    error,
  };
  if (error) emit({ type: 'log', level: 'error', message: error });
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

async function stepRecordOf(step: StepResult<ToolSet>, index: number, durationMs: number): Promise<StepRecord> {
  const inputTokens = step.usage.inputTokens ?? 0;
  const outputTokens = step.usage.outputTokens ?? 0;
  return {
    index,
    model: step.model.modelId,
    text: step.text,
    reasoning: step.reasoningText ?? null,
    finishReason: step.finishReason,
    usage: { inputTokens, outputTokens },
    cost: reportedCost(step) ?? (await estimatedCost(step.model.modelId, inputTokens, outputTokens)),
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

function reportedCost(step: StepResult<ToolSet>): number | null {
  const usage = step.providerMetadata?.openrouter?.usage as { cost?: number } | undefined;
  return typeof usage?.cost === 'number' ? usage.cost : null;
}

async function estimatedCost(modelId: string, inputTokens: number, outputTokens: number): Promise<number | null> {
  const model = await modelCatalog().then(
    (models) => models.find((m) => m.id === modelId),
    () => undefined,
  );
  if (!model) return null;
  return inputTokens * model.pricing.prompt + outputTokens * model.pricing.completion;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
