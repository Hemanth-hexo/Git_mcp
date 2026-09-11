import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './lib/createServer.js';

void serveStdio(createServer);
console.error('Gitty MCP server running on stdio');
