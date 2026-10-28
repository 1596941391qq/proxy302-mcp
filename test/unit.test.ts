import { describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Proxy302Client, buildAuthorization } from '../src/client.js';
import { formatBytes, htmlToMarkdown, htmlToText, mask, proxyUrl } from '../src/format.js';
import { fetchThroughProxy } from '../src/fetchPage.js';
import { createServer } from '../src/server.js';

const envelope = (data: unknown, code = 0, msg = 'success') => new Response(JSON.stringify({ code, msg, data }), { status: 200 });

describe('auth', () => {
  it('builds Basic from id:secret, id+secret, Basic and base64', () => {
    const expected = `Basic ${Buffer.from('k1:s1').toString('base64')}`;
    expect(buildAuthorization('k1:s1')).toBe(expected);
    expect(buildAuthorization('k1', 's1')).toBe(expected);
    expect(buildAuthorization(expected)).toBe(expected);
    expect(buildAuthorization(Buffer.from('k1:s1xxxxxxxxxx').toString('base64'))).toMatch(/^Basic /);
  });
  it('rejects missing or malformed keys with a helpful message', () => {
    expect(() => buildAuthorization(undefined)).toThrow(/PROXY302_API_KEY/);
    expect(() => buildAuthorization('short')).toThrow(/<key id>:<secret>/);
  });
});

describe('client', () => {
  it('sends Basic auth, query params, and unwraps the envelope', async () => {
    let seen: { url: string; auth: string; headers: Record<string, string> } | undefined;
    const c = new Proxy302Client({ apiKey: 'a:b', fetchImpl: (async (u: URL, init: RequestInit) => { seen = { url: String(u), auth: (init.headers as Record<string, string>).authorization, headers: init.headers as Record<string, string> }; return envelope({ data: [] }); }) as never });
    await c.areas('country', undefined, 'ger');
    expect(seen!.url).toBe('https://proxy302.com/open_api/v3/proxy/area/country?name=ger');
    expect(seen!.headers['x-proxy302-client']).toBe('proxy302-mcp/0.1.0');
    expect(seen!.headers['user-agent']).toBe('proxy302-mcp/0.1.0');
    expect(seen!.auth).toBe(`Basic ${Buffer.from('a:b').toString('base64')}`);
  });
  it('turns non-zero envelope codes into errors even on HTTP 200', async () => {
    const c = new Proxy302Client({ apiKey: 'a:b', fetchImpl: (async () => envelope(null, 50301, 'requires a legacy MySQL identity')) as never });
    await expect(c.trafficPool()).rejects.toThrow(/legacy MySQL identity/);
  });
  it('reports 401 and network failures plainly', async () => {
    await expect(new Proxy302Client({ apiKey: 'a:b', fetchImpl: (async () => new Response('', { status: 401 })) as never }).me()).rejects.toThrow(/rejected/);
    await expect(new Proxy302Client({ apiKey: 'a:b', fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as never }).me()).rejects.toThrow(/Could not reach/);
  });
});

describe('format', () => {
  it('formats bytes, masks secrets, encodes proxy urls', () => {
    expect(formatBytes('1073741824')).toBe('1.00 GB');
    expect(mask('abcdefgh')).toBe('ab****gh');
    expect(proxyUrl('http', 'u', 'p@ss', 'h', 2222)).toBe('http://u:p%40ss@h:2222');
  });
  it('converts html to markdown/text and drops scripts', () => {
    const html = '<html><body><h1>Hi</h1><script>evil()</script><p>A <a href="/x">link</a></p></body></html>';
    expect(htmlToMarkdown(html)).toBe('# Hi\n\nA [link](/x)');
    expect(htmlToText(html)).not.toContain('evil');
  });
});

describe('fetchThroughProxy', () => {
  it('routes the request through the proxy with credentials and truncates', async () => {
    const seen: { url?: string; auth?: string } = {};
    const proxy = http.createServer((req, res) => {
      seen.url = req.url; seen.auth = req.headers['proxy-authorization'] as string;
      res.setHeader('content-type', 'text/html'); res.end(`<html><body><h1>Title</h1><p>${'x'.repeat(2000)}</p></body></html>`);
    });
    await new Promise<void>(r => proxy.listen(0, '127.0.0.1', r));
    try {
      const port = (proxy.address() as AddressInfo).port;
      const out = await fetchThroughProxy('http://example.test/page', { host: '127.0.0.1', port, username: 'u', password: 'p' }, { maxChars: 500 });
      expect(seen.url).toBe('http://example.test/page');
      expect(seen.auth).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
      expect(out.content.startsWith('# Title')).toBe(true);
      expect(out.truncated).toBe(true);
    } finally { proxy.close(); }
  });
  it('refuses non-http URLs', async () => {
    await expect(fetchThroughProxy('file:///etc/passwd', { host: 'h', port: 1, username: 'u', password: 'p' })).rejects.toThrow(/http and https/);
  });
});

describe('MCP tools', () => {
  async function connect(fetchImpl: typeof fetch) {
    const server = createServer(new Proxy302Client({ apiKey: 'a:b', fetchImpl }));
    const client = new Client({ name: 't', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }
  const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]!.text);

  it('lists the v1 tools and none can spend money', async () => {
    const client = await connect((async () => envelope({})) as never);
    const names = (await client.listTools()).tools.map(t => t.name).sort();
    expect(names).toEqual(['fetch_url', 'get_account_usage', 'get_dynamic_proxy', 'list_countries', 'list_my_proxies', 'list_products', 'list_regions']);
    expect(names.join()).not.toMatch(/buy|renew|topup|purchase/);
  });
  it('get_dynamic_proxy reuses an existing proxy and refuses to create by default', async () => {
    const calls: string[] = [];
    const client = await connect((async (u: URL) => {
      calls.push(`${u.pathname}`);
      if (u.pathname.endsWith('/area/country')) return envelope({ data: [{ id: 233, name: 'United States', code: 'US' }] });
      if (u.pathname.includes('/tokens/dynamic/traffic')) return envelope({ data: [{ token_id: 7, username: 'uu', passwd: 'pp', host: 'proxy.example', port: 2222, proxy_area: 'United States - - ', network: 'http', status: 1 }], total: 1 });
      return envelope(null, 404, 'nope');
    }) as never);
    const hit = await client.callTool({ name: 'get_dynamic_proxy', arguments: { country: 'US' } });
    expect(JSON.parse(text(hit))).toMatchObject({ reused: true, connection_url: 'http://uu:pp@proxy.example:2222' });
    const miss = await client.callTool({ name: 'get_dynamic_proxy', arguments: { country: 'US', protocol: 'socks5' } });
    expect(miss.isError).toBe(true);
    expect(text(miss)).toMatch(/create_if_missing/);
    expect(calls.some(c => c.includes('/api/proxy/dynamic/traffic'))).toBe(false);
  });
  it('list_my_proxies masks passwords by default', async () => {
    const client = await connect((async () => envelope({ data: [{ token_id: 1, username: 'u', passwd: 'secretpass', host: 'h', port: 1, status: 1 }], total: 1, page: 1, has_more: false })) as never);
    const r = text(await client.callTool({ name: 'list_my_proxies', arguments: {} }));
    expect(r).not.toContain('secretpass');
    expect(r).toContain('se****ss');
  });
  it('surfaces API errors as tool errors, not crashes', async () => {
    const client = await connect((async () => envelope(null, 401, 'invalid API credential')) as never);
    const r = await client.callTool({ name: 'get_account_usage', arguments: {} });
    expect(r.isError).toBe(true);
  });
});
