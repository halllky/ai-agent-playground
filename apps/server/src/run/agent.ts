import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { stepCountIs, streamText, wrapLanguageModel, type ModelMessage, type StepResult, type ToolSet } from 'ai';
import type { NodeOf, RunEventBody, RunStatus, StepRecord } from 'protocol';
import { languageModel, stepCost } from '../llm/index.ts';

/** エージェントの LLM ループ1回分の結果 */
export type AgentOutcome = {
  status: Exclude<RunStatus, 'running'>;
  /** ノードの returns 設定に従って呼び出し元へ返す文章 */
  output: string;
  /** この呼び出しで新たに生成されたメッセージ。Abort 時は途中までのテキストを含む */
  responseMessages: ModelMessage[];
  error: string | null;
};

/**
 * エージェントの LLM を、ツールコールのループが終わるまで進め、ステップ・テキスト・ツールのイベントを emit に流す。
 * LLM 呼び出しの失敗や Abort は例外にせず、結果の status として返す。
 */
export async function runAgent(
  node: NodeOf<'agent'>,
  messages: ModelMessage[],
  tools: ToolSet,
  signal: AbortSignal,
  emit: (body: RunEventBody) => void,
): Promise<AgentOutcome> {
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
    stopWhen: stepCountIs(node.config.maxSteps),
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

function outputOf(node: NodeOf<'agent'>, steps: StepResult<ToolSet>[], partialText: string): string {
  if (node.config.returns === 'allSteps') {
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
