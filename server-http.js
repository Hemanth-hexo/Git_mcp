import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createServer } from './lib/createServer.js';

// Deployed/shared entry point: exposes the same tools as server.js (stdio)
// over Streamable HTTP, so the server can be added to Claude as a custom
// connector via a URL instead of a local command.
const PORT = Number(process.env.PORT) || 3000;

// Render (and most hosts) assign the public hostname only after the first
// deploy. Leave PUBLIC_HOST unset to run open on all interfaces; once you
// know the deployed hostname, set it to enable Host-header validation.
const allowedHosts = process.env.PUBLIC_HOST ? [process.env.PUBLIC_HOST] : undefined;

const handler = createMcpHandler(createServer);
const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts });
const node = toNodeHandler(handler);

app.all('/mcp', (req, res) => void node(req, res, req.body));

app.get('/', (_req, res) => {
    res.type('text/plain').send('GitHub Discovery MCP server is running. Connect an MCP client to POST /mcp.');
});

app.listen(PORT, '0.0.0.0', () => {
    console.error(`GitHub Discovery MCP server listening on 0.0.0.0:${PORT} (POST /mcp)`);
    if (!allowedHosts) {
        console.error('PUBLIC_HOST is not set — Host header validation is disabled. Set it to your deployed hostname to lock this down.');
    }
});

async function shutdown() {
    await handler.close();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
