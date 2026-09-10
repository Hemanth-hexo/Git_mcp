// Lightweight visibility into who's using the server and what they're
// calling, without logging anything sensitive: no query text, no file
// paths/arguments, no tokens — just enough to answer "is this being used,
// and by roughly how many distinct callers, calling what." Shows up in
// Render's Logs tab (or stdout/stderr wherever this runs).
export function createRequestLogger({ log = console.error } = {}) {
    return function requestLogger(req, _res, next) {
        const hasOwnToken = Boolean(req.auth?.githubToken);
        const body = req.body;
        // MCP requests are JSON-RPC (a `method` field); plain REST calls
        // through routes/api.js aren't, so fall back to the HTTP method and
        // route path — no query string or arguments either way.
        if (typeof body?.method === 'string') {
            const toolName = body.method === 'tools/call' ? body?.params?.name : undefined;
            log(
                `[mcp] ${new Date().toISOString()} ip=${req.ip} method=${body.method}` +
                `${toolName ? ` tool=${toolName}` : ''} byo_token=${hasOwnToken}`
            );
        } else {
            log(`[api] ${new Date().toISOString()} ip=${req.ip} ${req.method} ${req.path} byo_token=${hasOwnToken}`);
        }
        next();
    };
}
