import { tavily, type TavilyClient } from '@tavily/core';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type { NodeOf } from 'protocol';

/** Web検索ノードの設定で Tavily を検索するツール。API キーが無ければ、呼び出し時にエラーにする */
export function webSearchTool(node: NodeOf<'webSearch'>): Tool {
  return tool({
    description: 'Web を検索し、関連するページのタイトル・URL・本文の抜粋を返す',
    inputSchema: z.object({ query: z.string().describe('検索語句') }),
    execute: async ({ query }) => {
      const response = await client().search(query, { maxResults: node.config.maxResults, searchDepth: node.config.searchDepth });
      return response.results.map((r) => ({ title: r.title, url: r.url, content: r.content }));
    },
  });
}

let cachedClient: TavilyClient | undefined;

function client(): TavilyClient {
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY が設定されていないため検索できません');
  cachedClient ??= tavily({ apiKey: process.env.TAVILY_API_KEY });
  return cachedClient;
}
