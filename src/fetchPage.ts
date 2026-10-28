import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { htmlToMarkdown, htmlToText, truncate } from './format.js';
import { Proxy302Error } from './client.js';

export interface ProxyEndpoint { host: string; port: number; username: string; password: string }
export type FetchFormat = 'markdown' | 'text' | 'raw';

export interface FetchResult { url: string; finalUrl: string; status: number; contentType: string; format: FetchFormat; truncated: boolean; content: string }

export function assertHttpUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Proxy302Error(`Not a valid URL: ${raw}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Proxy302Error('Only http and https URLs can be fetched.');
  return u;
}

export async function fetchThroughProxy(
  rawUrl: string, proxy: ProxyEndpoint,
  opts: { format?: FetchFormat; maxChars?: number; timeoutMs?: number; fetchImpl?: typeof undiciFetch } = {},
): Promise<FetchResult> {
  const url = assertHttpUrl(rawUrl);
  const format = opts.format ?? 'markdown';
  const maxChars = Math.min(Math.max(opts.maxChars ?? 20000, 500), 200000);
  const token = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`;
  const agent = new ProxyAgent({ uri: `http://${proxy.host}:${proxy.port}`, token });
  try {
    const res = await (opts.fetchImpl ?? undiciFetch)(url, {
      dispatcher: agent,
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; proxy302-mcp/0.1; +https://proxy302.com)',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.8',
      },
    });
    const contentType = res.headers.get('content-type') ?? '';
    // Cap the download before decoding so a huge page cannot exhaust memory.
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 5_000_000);
    const body = buf.toString('utf8');
    const isHtml = /html|xml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body);
    const converted = format === 'raw' || !isHtml ? body : format === 'text' ? htmlToText(body) : htmlToMarkdown(body);
    const { text, truncated } = truncate(converted, maxChars);
    return { url: rawUrl, finalUrl: res.url || rawUrl, status: res.status, contentType, format, truncated, content: text };
  } catch (e) {
    if (e instanceof Proxy302Error) throw e;
    throw new Proxy302Error(`Request through the proxy failed: ${(e as Error).message}`);
  } finally {
    await agent.close().catch(() => undefined);
  }
}
