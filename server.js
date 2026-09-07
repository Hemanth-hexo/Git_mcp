import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './lib/createServer.js';

void serveStdio(createServer);
console.error('GitHub Discovery MCP server running on stdio');
