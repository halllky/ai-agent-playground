import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import {
  stepCountIs,
  streamText,
  tool,
  wrapLanguageModel,
  type ModelMessage,
  type StepResult,
  type StopCondition,
  type Tool,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import { finishToolName, type NodeOf, type RunEventBody, type RunStatus, type StepRecord } from 'protocol';
import { languageModel, stepCost } from '../../llm/index.ts';
import type { RunScope, ToolCall } from '../invoke.ts';
import { Workfolder } from './files.ts';

/** エージェントの呼び出し1回分の結果。失敗したら output はその理由。返すものが「なし」なら成功時の output は null */
export type AgentOutcome = {
  status: Exclude<RunStatus, 'running'>;
  output: string | null;
  error: string | null;
};

/**
 * エージェントに task を依頼する。LLM には、前回までの経緯（history の設定で選んだ1つ）に続けて、
 * 添付ファイルと依頼を並べた今回のメッセージを渡す。
 * 経緯がこのエージェントの呼び出しなら、今回の依頼とそれへの応答を次回のために残す（添付ファイルは毎回その時点の中身で作り直す）。
 * LLM をツールコールのループが終わるまで進め、ステップ・テキスト・ツールのイベントを emit に流す。
 * LLM 呼び出しの失敗や Abort は例外にせず、結果の status として返す。
 */
export async function invokeAgent(
  scope: RunScope,
  node: NodeOf<'agent'>,
  task: string,
  tools: ToolSet,
  emit: (body: RunEventBody) => void,
): Promise<AgentOutcome> {
  const pastCalls = pastCallsOf(scope, node);
  const message: ModelMessage = { role: 'user', content: currentMessageOf(scope, node, task) };
  const loop = await runLoop(node, [...pastCalls, message], { ...tools, ...finishToolOf(node) }, scope.signal, emit);
  storeCalls(scope, node, [...pastCalls, { role: 'user', content: task }, ...loop.responseMessages]);
  return { status: loop.status, output: loop.error ?? loop.output, error: loop.error };
}

/** エージェントを、別のエージェントが呼び出すツールにする。返すものが「なし」なら、終わったことだけを返す */
export function agentTool(node: NodeOf<'agent'>, call: ToolCall): Tool {
  return tool({
    description: node.config.description,
    inputSchema: z.object({ task: z.string().describe('エージェントに依頼する内容') }),
    execute: async ({ task }, options) => (await call(task, options)) ?? '完了しました（このエージェントは結果を返しません）',
  });
}

/** このエージェントのこれまでの呼び出しの依頼と応答。経緯にそれを選んでいなければ空。セッション分は親ターンから受け継いだ状態に入っている */
function pastCallsOf(scope: RunScope, node: NodeOf<'agent'>): ModelMessage[] {
  switch (node.config.history) {
    case 'turnCalls':
      return scope.turnMemory.get(node.id) ?? [];
    case 'sessionCalls':
      return scope.state.memories[node.id] ?? [];
    default:
      return [];
  }
}

function storeCalls(scope: RunScope, node: NodeOf<'agent'>, messages: ModelMessage[]): void {
  switch (node.config.history) {
    case 'turnCalls':
      scope.turnMemory.set(node.id, messages);
      return;
    case 'sessionCalls':
      scope.state.memories[node.id] = messages;
      scope.saveState();
      return;
  }
}

/**
 * 今回のメッセージの本文。経緯がユーザーとの会話ならそれを先頭に置き、添付ファイル・依頼の順にタグで囲んで並べる。
 * 会話も添付ファイルも無ければ、依頼をそのまま本文にする
 */
function currentMessageOf(scope: RunScope, node: NodeOf<'agent'>, task: string): string {
  const conversation = pastConversationOf(scope.conversation, node.config);
  const workfolder = new Workfolder(scope.state.files, () => {});
  const sections = [
    ...(conversation.length > 0 ? [`<conversation>\n${conversation.map(transcriptLineOf).join('\n')}\n</conversation>`] : []),
    ...node.config.attachments.map((path) =>
      workfolder.has(path) ? `<file path="${path}">\n${workfolder.read(path)}\n</file>` : `<file path="${path}" missing="true" />`,
    ),
  ];
  return sections.length > 0 ? [...sections, `<task>\n${task}\n</task>`].join('\n\n') : task;
}

/** 前のターンまでのユーザーとの会話のうち、経緯として入れる分。経緯にそれを選んでいなければ空 */
function pastConversationOf(conversation: ModelMessage[], config: NodeOf<'agent'>['config']): ModelMessage[] {
  switch (config.history) {
    case 'recentConversation':
      return conversation.slice(-config.historyLength);
    case 'conversation':
      return conversation;
    default:
      return [];
  }
}

/** ユーザーとの会話の発言1つ。発言と返答はどちらも文字列で持っている */
function transcriptLineOf(message: ModelMessage): string {
  return `[${message.role}] ${typeof message.content === 'string' ? message.content : ''}`;
}

/**
 * 返すものが「なし」のエージェントが持つ、作業を終えるためのツール。
 * 呼んだステップのほかのツールがすべて成功していれば、応答の文章を待たずにループを止める（stopConditionsOf）
 */
function finishToolOf(node: NodeOf<'agent'>): ToolSet {
  if (node.config.returns !== 'none') return {};
  return {
    [finishToolName]: tool({
      description:
        '作業がすべて終わったら呼ぶ。応答の文章は書かなくてよい。最後のツール呼び出しと同じ応答の中で呼んでよい。' +
        '同じ応答の中のほかのツールが失敗したときは終了しないので、対処してから改めて呼ぶ',
      inputSchema: z.object({}),
      execute: async () => '同じ応答の中のほかのツールがすべて成功していれば、ここで終了します',
    }),
  };
}

function stopConditionsOf(node: NodeOf<'agent'>): StopCondition<ToolSet>[] {
  const conditions = [stepCountIs(node.config.maxSteps)];
  if (node.config.returns === 'none') conditions.push(finishedCleanly);
  return conditions;
}

/** 最後のステップで終了用のツールが呼ばれ、そのステップのツールがどれも失敗していない */
const finishedCleanly: StopCondition<ToolSet> = ({ steps }) => {
  const last = steps.at(-1);
  return !!last && last.toolCalls.some((c) => c.toolName === finishToolName) && !last.content.some((p) => p.type === 'tool-error');
};

/** LLM のループ1回分の結果。responseMessages はこの呼び出しで新たに生成されたメッセージで、Abort 時は途中までのテキストを含む */
type LoopResult = AgentOutcome & { responseMessages: ModelMessage[] };

/** LLM を、ツールコールのループが終わるまで進める。output はノードの returns 設定に従って呼び出し元へ返すもの */
async function runLoop(
  node: NodeOf<'agent'>,
  messages: ModelMessage[],
  tools: ToolSet,
  signal: AbortSignal,
  emit: (body: RunEventBody) => void,
): Promise<LoopResult> {
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
    model: withResponseTiming(languageModel(node.config.provider, node.config.model), (timing) => (response = timing)),
    system: node.config.systemPrompt,
    messages,
    tools,
    stopWhen: stopConditionsOf(node),
    abortSignal: signal,
    onStepFinish: (step) => {
      steps.push(step);
      stepRecords.put(step.stepNumber, stepRecordOf(node, step, durationOf(response)));
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
    if (!signal.aborted) error = messageOf(e);
  }

  const aborted = signal.aborted;
  // 各ステップの response.messages はそれまでの全ステップ分を含むため、最後のステップのものだけで足りる
  const responseMessages = [...(steps.at(-1)?.response.messages ?? [])];
  if (aborted && partialText) {
    // 打ち切られたステップは onStepFinish が呼ばれないため、途中までの出力をここで残す
    emit({ type: 'step.finish', step: abortedStepRecord(node, stepIndex, partialText, durationOf(response)) });
    responseMessages.push({ role: 'assistant', content: partialText });
  }

  return {
    status: aborted ? 'aborted' : error ? 'error' : 'done',
    output: outputOf(node, steps, partialText),
    responseMessages,
    error,
  };
}

function outputOf(node: NodeOf<'agent'>, steps: StepResult<ToolSet>[], partialText: string): string | null {
  switch (node.config.returns) {
    case 'none':
      return null;
    case 'allSteps': {
      const summaries = steps.map((s) => ({
        text: s.text,
        toolCalls: s.toolCalls.map((c) => ({ toolName: c.toolName, input: c.input })),
        toolResults: s.toolResults.map((r) => ({ toolName: r.toolName, output: r.output })),
      }));
      if (partialText) summaries.push({ text: partialText, toolCalls: [], toolResults: [] });
      return JSON.stringify(summaries, null, 2);
    }
    case 'finalText':
      return partialText || steps.at(-1)?.text || '';
  }
}

async function stepRecordOf(node: NodeOf<'agent'>, step: StepResult<ToolSet>, durationMs: number): Promise<StepRecord> {
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

function abortedStepRecord(node: NodeOf<'agent'>, index: number, text: string, durationMs: number): StepRecord {
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
      let resolve: (value: T | PromiseLike<T>) => void = () => { };
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
