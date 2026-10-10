import { choice, noul, score, TypeSafeClient, type Question, type Questions, type ScoreCriteria } from '@typesafe-ai/sdk';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type { JudgeQuestion, NodeOf } from 'protocol';

/** Jev が一度に受け付ける、state と質問を合わせた入力の目安 */
const maxInputTokens = 32_000;

/**
 * 判定ノードに定義した質問を、呼び出し元が渡した state について Jev に答えさせるツール。
 * 入力が大きすぎるときや API キーが無いときは、呼び出し時にエラーにする。
 */
export function judgeTool(node: NodeOf<'judge'>): Tool {
  return tool({
    description: node.config.description || '渡した state について、あらかじめ決められた質問に確率付きで答える',
    inputSchema: z.object({ state: z.string().describe('判定してほしい内容。文章か JSON') }),
    execute: async ({ state }, { abortSignal }) => {
      const questions = Object.fromEntries(node.config.questions.map((q) => [q.key, questionOf(q)]));
      const tokens = estimatedTokens(state + JSON.stringify(questions));
      if (tokens > maxInputTokens) {
        throw new Error(`入力が約 ${tokens} トークンあり、上限の約 ${maxInputTokens} トークンを超えています。state を短くしてください`);
      }
      const result = await client().systemOne(
        { state, questions: questions as Questions, ...(node.config.model ? { model: node.config.model } : {}) },
        { signal: abortSignal },
      );
      return { model: result.model, answers: result.answers, usage: result.usage };
    },
  });
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
