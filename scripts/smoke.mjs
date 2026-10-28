// Read-only smoke test against the real Proxy302 API through the built stdio server.
// Usage: PROXY302_API_KEY="<id>:<secret>" node scripts/smoke.mjs
// Only calls read-only tools (plus one tiny page fetch through your own proxy). Never buys or creates anything.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

if (!process.env.PROXY302_API_KEY) { console.error('Set PROXY302_API_KEY'); process.exit(2); }
const transport = new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname], env: { ...process.env } });
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(transport);
const key = process.env.PROXY302_API_KEY;
const scrub = (s) => s.split(key).join('<key>').replace(/("password"|"passwd"): "[^"]*"/g, '$1: "<hidden>"').replace(/:\/\/([^:@/]+):[^@/]+@/g, '://$1:<hidden>@');
let failed = 0;
async function step(name, args, check) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.map(c => c.text).join('\n');
  const pass = !r.isError && (!check || check(text));
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(args)} -> ${scrub(text).replace(/\s+/g, ' ').slice(0, 220)}`);
  return text;
}
const tools = (await client.listTools()).tools.map(t => t.name);
console.log('tools:', tools.join(', '));
await step('get_account_usage', { days: 7 }, t => t.includes('traffic_remaining'));
await step('list_countries', { name: 'United' }, t => t.includes('United States'));
await step('list_regions', { country: 'United States' }, t => t.includes('states'));
await step('list_products', {}, t => t.includes('static_data_center_plans'));
await step('list_my_proxies', { kind: 'dynamic', billing: 'traffic', page_size: 5 }, t => t.includes('proxies'));
await step('list_my_proxies', { kind: 'static', billing: 'ip', page_size: 5 }, t => t.includes('proxies'));
// Expected: either reuses an existing proxy or refuses to create one by default (smoke never creates).
const r = await client.callTool({ name: 'get_dynamic_proxy', arguments: { country: 'United States' } });
const dt = r.content[0].text;
const dynOk = r.isError ? /create_if_missing/.test(dt) : dt.includes('connection_url');
if (!dynOk) failed++;
console.log(`${dynOk ? 'PASS' : 'FAIL'} get_dynamic_proxy {"country":"United States"} -> ${r.isError ? 'refused to create by default (expected)' : 'reused existing proxy'}`);
await step('fetch_url', { url: 'https://api.ipify.org?format=json', format: 'text', max_chars: 500 }, t => /"ip"/.test(t));
await client.close();
console.log(failed ? `${failed} step(s) failed` : 'all smoke steps passed');
process.exit(failed ? 1 : 0);
