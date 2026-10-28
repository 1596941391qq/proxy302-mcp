# proxy302-mcp

Give your AI assistant a real residential-proxy toolbox. `proxy302-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server for [Proxy302](https://proxy302.com): check your traffic and usage, browse countries and plans, get a rotating residential proxy URL for any country, list your proxies and static IPs, and fetch a web page through a proxy, all from Claude Code, Claude Desktop, Cursor or any MCP client.

[中文说明](README.zh-CN.md)

> v1 is deliberately **read-only and spend-free**: it never buys, renews or tops up anything. The one write it can do (creating a dynamic proxy credential) is free, off by default, and only bills traffic when you actually use it.

## Quick start

1. Create an API key in the Proxy302 console and note its key id and secret.
2. Install:

```bash
claude mcp add proxy302 -e PROXY302_API_KEY="<key id>:<secret>" -- npx -y proxy302-mcp
```

Requires Node.js 20+.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "proxy302": {
      "command": "npx",
      "args": ["-y", "proxy302-mcp"],
      "env": { "PROXY302_API_KEY": "<key id>:<secret>" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "proxy302": {
      "command": "npx",
      "args": ["-y", "proxy302-mcp"],
      "env": { "PROXY302_API_KEY": "<key id>:<secret>" }
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `get_account_usage` | Account, remaining prepaid traffic, per-pool balance and daily usage for the last N days |
| `list_countries` | Countries you can target, with ids and ISO codes (name filter) |
| `list_regions` | States of a country, or cities of a state |
| `list_products` | Product lines and static IP plans (data center and residential) |
| `get_dynamic_proxy` | A ready `http://user:pass@host:port` rotating residential URL for a country (state/city where supported). Reuses an existing proxy; `create_if_missing=true` creates one |
| `list_my_proxies` | Your dynamic proxies and static IPs, passwords masked unless asked |
| `fetch_url` | Request a URL through your proxy (optionally from a given country) and return Markdown, text or raw |

Not in v1, on purpose: purchases, renewals, top-ups.

## Examples

Ask your assistant:

- "How much proxy traffic do I have left, and what did I use this week?"
- "Which countries can I use? Get me a Germany proxy."
- "Fetch https://example.com/pricing from a US exit and summarise it."
- "List my static IPs that expire in the next 7 days."

### Use the proxy in Playwright

`get_dynamic_proxy` returns host, port, username and password:

```ts
import { chromium } from 'playwright';

const browser = await chromium.launch({
  proxy: { server: 'http://HOST:PORT', username: 'USERNAME', password: 'PASSWORD' },
});
const page = await browser.newPage();
await page.goto('https://ipinfo.io/json');
console.log(await page.textContent('body'));
```

### Use the proxy in browser-use

```python
from browser_use import Agent, Browser, BrowserConfig
from browser_use.browser.context import BrowserContextConfig  # API names vary by version

browser = Browser(config=BrowserConfig(
    proxy={"server": "http://HOST:PORT", "username": "USERNAME", "password": "PASSWORD"},
))
agent = Agent(task="Open ipinfo.io and tell me the country", llm=llm, browser=browser)
```

`fetch_url` is a plain HTTP request without JavaScript rendering. For JavaScript-heavy sites, hand the proxy URL to a browser as above.

## Configuration

| Variable | Meaning |
|---|---|
| `PROXY302_API_KEY` | Required. `<key id>:<secret>`, or a `Basic ...` token |
| `PROXY302_API_SECRET` | Optional; use with `PROXY302_API_KEY` holding only the key id |
| `PROXY302_BASE_URL` | Optional; default `https://proxy302.com` |

Credentials are read from the environment only. Never commit them. Requests identify themselves with `User-Agent: proxy302-mcp/<version>` and `X-Proxy302-Client`.

## Development

```bash
npm install
npm run build
npm test
PROXY302_API_KEY="<id>:<secret>" npm run smoke   # read-only checks against the live API
```

## License

MIT
