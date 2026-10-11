import { tavily, type TavilyClient } from '@tavily/core';
import type { NodeOf } from 'protocol';

/** Web検索ノードの設定で Tavily を検索し、関連するページのタイトル・URL・本文の抜粋を返す。API キーが無ければ例外にする */
export async function search(node: NodeOf<'webSearch'>, query: string) {
  const response = await client().search(query, { maxResults: node.config.maxResults, searchDepth: node.config.searchDepth });
  return response.results.map((r) => ({ title: r.title, url: r.url, content: r.content }));
}

let cachedClient: TavilyClient | undefined;

function client(): TavilyClient {
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY が設定されていないため検索できません');
  cachedClient ??= tavily({ apiKey: process.env.TAVILY_API_KEY });
  return cachedClient;
}
