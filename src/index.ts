#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

// stdout is the protocol channel; log to stderr only.
createServer().connect(new StdioServerTransport()).then(() => {
  console.error('proxy302-mcp ready' + (process.env.PROXY302_API_KEY ? '' : ' (PROXY302_API_KEY is not set: tools will report an error)'));
}).catch((e) => { console.error(e); process.exit(1); });
