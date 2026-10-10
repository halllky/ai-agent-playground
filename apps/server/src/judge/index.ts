import { choice, noul, score, TypeSafeClient, type Question, type Questions, type ResultFor, type ScoreCriteria } from '@typesafe-ai/sdk';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { judgeQuestionTypeLabels, type FlowCondition, type JudgeQuestion, type NodeOf } from 'protocol';

/** Jev が一度に受け付ける、state と質問を合わせた入力の目安 */
const maxInputTokens = 32_000;

/** 判定1回分の結果。answers は質問の key ごとの回答 */
export type Verdict = Awaited<ReturnType<typeof judge>>;

/**
 * 判定ノードに定義した質問を、呼び出し元が渡した state について Jev に答えさせるツール。
 * 質問文はツールの説明に載せ、回答には含めない（会話履歴に毎回積まれてノイズになるため）。
 */
export function judgeTool(node: NodeOf<'judge'>): Tool {
  return tool({
    description: descriptionOf(node),
    inputSchema: z.object({ state: z.string().describe('判定してほしい内容。文章か JSON') }),
    execute: ({ state }, { abortSignal }) => judge(node, state, abortSignal),
  });
}

/**
 * 判定ノードに定義した質問に、state について Jev に答えさせる。
 * 受け取った側が値を取り違えないよう、回答は選択肢の意味を添えた確率にする。
 * 入力が大きすぎるときや API キーが無いときは例外にする。
 */
export async function judge(node: NodeOf<'judge'>, state: string, signal: AbortSignal | undefined) {
  const questions = Object.fromEntries(node.config.questions.map((q) => [q.key, questionOf(q)]));
  const tokens = estimatedTokens(state + JSON.stringify(questions));
  if (tokens > maxInputTokens) {
    throw new Error(`入力が約 ${tokens} トークンあり、上限の約 ${maxInputTokens} トークンを超えています。state を短くしてください`);
  }
  const result = await client().systemOne(
    { state, questions: questions as Questions, ...(node.config.model ? { model: node.config.model } : {}) },
    { signal },
  );
  const answers = Object.fromEntries(node.config.questions.map((q) => [q.key, answerOf(q, result.answers[q.key])]));
  return { answers, model: result.model, usage: result.usage };
}

/**
 * verdict が condition を満たすか。
 * 回答は最も確率の高いもので決める（はい/いいえは確率 0.5 以上なら yes、段階評価は最も確率の高い段階）。
 * 条件の質問がノードに無ければ満たさない。
 */
export function meetsCondition(node: NodeOf<'judge'>, verdict: Verdict, condition: FlowCondition): boolean {
  const question = node.config.questions.find((q) => q.key === condition.questionKey);
  const answer = verdict.answers[condition.questionKey];
  if (!question || !answer) return false;
  return condition.anyOf.includes(decidedValueOf(answer));
}

function descriptionOf(node: NodeOf<'judge'>): string {
  const questions = node.config.questions.map((q) => `- ${q.key}（${judgeQuestionTypeLabels[q.type]}）: ${q.instructions}`);
  return [
    node.config.description || '渡した state について、あらかじめ決められた質問に確率付きで答える',
    '',
    '質問（回答は answers の同じキーに入る）:',
    ...questions,
    '',
    'probabilityOfYes や probability は「その答えである確率」であり、程度や度合いではない。',
    '例えば probabilityOfYes が 0.7 なら「答えがはいである見込みが 70%」という意味で、「70% くらい当てはまる」という意味ではない。',
    '段階評価の expectedScore は、各段階の確率から求めた点数の期待値。',
  ].join('\n');
}

function questionOf(question: JudgeQuestion): Question {
  switch (question.type) {
    case 'noul':
      return noul(question.instructions, { true: question.yes || null, false: question.no || null });
    case 'choice':
      return choice(question.instructions, Object.fromEntries(question.choices.map((c) => [c.label, c.description || null])));
    case 'score':
      // 段階が2つ未満なら SDK が例外を投げ、ツールのエラーとして返る
      return score(question.instructions, question.levels.map((l) => l || null) as unknown as ScoreCriteria);
  }
}

/** Jev の回答を、各選択肢の意味を並べた、質問のキーと合わせれば読める形にする */
function answerOf(question: JudgeQuestion, response: ResultFor<Question> | undefined): Answer {
  if (question.type === 'noul' && response?.type === 'noul') {
    return {
      probabilityOfYes: response.noul,
      ...(question.yes ? { yesMeans: question.yes } : {}),
      ...(question.no ? { noMeans: question.no } : {}),
    };
  }
  if (question.type === 'choice' && response?.type === 'choice') {
    return {
      mostLikely: response.choice,
      choices: question.choices.map((c) => ({
        label: c.label,
        ...(c.description ? { means: c.description } : {}),
        probability: response.probabilities[c.label],
      })),
    };
  }
  if (question.type === 'score' && response?.type === 'score') {
    return {
      expectedScore: response.score,
      levels: question.levels.map((l, i) => ({
        score: i,
        ...(l ? { means: l } : {}),
        probability: (response.probabilities as Record<string, number>)[i],
      })),
    };
  }
  throw new Error(`質問 ${question.key}（${question.type}）への回答が想定と異なります: ${JSON.stringify(response)}`);
}

type Answer =
  | { probabilityOfYes: number; yesMeans?: string; noMeans?: string }
  | { mostLikely: string; choices: { label: string; means?: string; probability: number | undefined }[] }
  | { expectedScore: number; levels: { score: number; means?: string; probability: number | undefined }[] };

/** 回答として決まった値。値の書き方は protocol の judgeAnswerOptions に合わせる */
function decidedValueOf(answer: Answer): string {
  if ('probabilityOfYes' in answer) return answer.probabilityOfYes >= 0.5 ? 'yes' : 'no';
  if ('mostLikely' in answer) return answer.mostLikely;
  const best = answer.levels.reduce((a, b) => ((b.probability ?? 0) > (a.probability ?? 0) ? b : a));
  return String(best.score);
}

/** トークナイザーを持たないための、トークン数の概算。日本語を多く含むときは多めに見積もる側に倒れる */
function estimatedTokens(text: string): number {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 4) + (text.length - ascii);
}

let cachedClient: TypeSafeClient | undefined;

function client(): TypeSafeClient {
  if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY が設定されていないため判定できません');
  cachedClient ??= new TypeSafeClient();
  return cachedClient;
}
