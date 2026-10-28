/** Thin client for the Proxy302 open API (/open_api/v3). Every response is HTTP 200; success is envelope code 0. */

import { VERSION } from './version.js';

/** Identifies MCP traffic to the backend (User-Agent and X-Proxy302-Client). */
export const CLIENT_ID = `proxy302-mcp/${VERSION}`;

export class Proxy302Error extends Error {
  constructor(message: string, readonly code?: number) { super(message); this.name = 'Proxy302Error'; }
}

export interface ClientOptions {
  /** "keyId:secret", a ready "Basic ..." header value, or a bare base64 token. */
  apiKey?: string;
  /** Used together with apiKey when apiKey holds only the key id. */
  apiSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function buildAuthorization(apiKey: string | undefined, apiSecret?: string): string {
  const key = (apiKey ?? '').trim();
  if (!key) throw new Proxy302Error('PROXY302_API_KEY is not set. Create an API key in the Proxy302 console and set PROXY302_API_KEY="<key id>:<secret>".');
  if (/^basic\s+/i.test(key)) return key;
  if (apiSecret) return `Basic ${Buffer.from(`${key}:${apiSecret}`).toString('base64')}`;
  if (key.includes(':')) return `Basic ${Buffer.from(key).toString('base64')}`;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(key) && key.length >= 16) return `Basic ${key}`;
  throw new Proxy302Error('PROXY302_API_KEY must look like "<key id>:<secret>" (or set PROXY302_API_SECRET too).');
}

export interface TokenRow {
  id?: number | string; token_id?: number | string; username?: string; passwd?: string;
  host?: string; port?: number | null; proxy_area?: string; network?: string;
  generate?: string; proxy_type?: string; status?: number; expired_on?: number | null;
  traffic_usage?: string; remark?: string; connection_complete?: boolean; connection_state?: string;
  ip_addr?: string; [k: string]: unknown;
}

export class Proxy302Client {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  constructor(private readonly options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://proxy302.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Proxy302Client {
    return new Proxy302Client({ apiKey: env.PROXY302_API_KEY, apiSecret: env.PROXY302_API_SECRET, baseUrl: env.PROXY302_BASE_URL });
  }

  async request<T = unknown>(method: 'GET' | 'POST', path: string, query?: Record<string, string | number | undefined>, body?: unknown): Promise<T> {
    const authorization = buildAuthorization(this.options.apiKey, this.options.apiSecret);
    const url = new URL(`${this.baseUrl}/open_api/v3/${path.replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { authorization, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), 'user-agent': CLIENT_ID, 'x-proxy302-client': CLIENT_ID },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new Proxy302Error(`Could not reach Proxy302 (${(e as Error).message})`);
    }
    if (res.status === 401) throw new Proxy302Error('Proxy302 rejected the API key (401).', 401);
    let json: { code?: number; msg?: string; data?: unknown };
    try { json = await res.json() as typeof json; } catch { throw new Proxy302Error(`Unexpected response from Proxy302 (HTTP ${res.status}).`); }
    if (json.code !== 0) throw new Proxy302Error(json.msg || `Proxy302 error code ${json.code}`, json.code);
    return json.data as T;
  }

  me() { return this.request<{ name: string; email: string; is_use: number; uid: number | string }>('GET', 'user/users/me'); }
  wallet() { return this.request<{ balance: string; balance_milli_ptc: number; currency: string }>('GET', 'user/users/wallet'); }
  areas(type: 'country' | 'state' | 'city', pid?: string, name?: string) {
    return this.request<{ data: Array<{ id: number; name: string; code?: string; pid?: number }> }>('GET', `proxy/area/${type}`, { pid, name });
  }
  payways(name: 'static_data_center' | 'static_residential') {
    return this.request<{ data: Array<{ id: number; name: string; en_name: string }> }>('GET', `proxy/payway/${name}`);
  }
  trafficPool() {
    return this.request<{ remaining_traffic: string; traffic_pools: Array<Record<string, unknown>> }>('GET', 'proxy/traffic/pool/remaining');
  }
  consumeSummary(startTime: number, endTime: number) {
    return this.request<{ keys: string[]; summary: Record<string, string>; values: Record<string, string[]> }>('GET', 'proxy/traffic/consume/log/summary', { start_time: startTime, end_time: endTime });
  }
  costSummary(kind: 'day' | 'month') { return this.request<{ keys: string[]; summary: Record<string, number>; values: Record<string, number[]> }>('GET', `proxy/summary/cost/${kind}`); }
  tokens(generate: 'dynamic' | 'static', proxyType: 'ip' | 'traffic', query: { page?: number; page_size?: number; status?: number } = {}) {
    return this.request<{ data: TokenRow[]; total: number; page: number; page_size: number; has_more: boolean }>('GET', `proxy/tokens/${generate}/${proxyType}`, query);
  }
  /** Creates a dynamic proxy credential (no charge at creation; traffic is billed on use). */
  generateDynamic(body: { s: number; protocol: 'http' | 'socks5'; country_id: number; state_id?: number; city_id?: number; idempotency_key: string }) {
    return this.request<{ token_id: number; username: string; password: string; host: string; port: number; protocol: string }>('POST', 'proxy/api/proxy/dynamic/traffic', undefined, body);
  }
}
