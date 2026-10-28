import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Proxy302Client } from './client.js';
import { VERSION } from './version.js';
import { registerTools } from './tools.js';

export function createServer(client: Proxy302Client = Proxy302Client.fromEnv()): McpServer {
  const server = new McpServer({ name: 'proxy302', version: VERSION });
  registerTools(server, client);
  return server;
}
