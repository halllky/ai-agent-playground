import { tavily, type TavilyClient } from '@tavily/core';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type { NodeOf } from 'protocol';
import type { ToolCall } from '../invoke.ts';

/** Web検索ノードの設定で Tavily を検索し、関連するページのタイトル・URL・本文の抜粋を返す。API キーが無ければ例外にする */
export async function search(node: NodeOf<'webSearch'>, query: string) {
  const response = await client().search(query, { maxResults: node.config.maxResults, searchDepth: node.config.searchDepth });
  return response.results.map((r) => ({ title: r.title, url: r.url, content: r.content }));
}

/** Web検索ノードを、エージェントが呼び出すツールにする。description が空なら既定の説明を使う */
export function webSearchTool(description: string, call: ToolCall): Tool {
  return tool({
    description: description || 'Web を検索し、関連するページのタイトル・URL・本文の抜粋を返す',
    inputSchema: z.object({ query: z.string().describe('検索語句') }),
    execute: ({ query }, options) => call(query, options),
  });
}

let cachedClient: TavilyClient | undefined;

function client(): TavilyClient {
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY が設定されていないため検索できません');
  cachedClient ??= tavily({ apiKey: process.env.TAVILY_API_KEY });
  return cachedClient;
}
