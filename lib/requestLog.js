// Lightweight visibility into who's using the server and what they're
// calling, without logging anything sensitive: no query text, no file
// paths/arguments, no tokens — just enough to answer "is this being used,
// and by roughly how many distinct callers, calling what." Shows up in
// Render's Logs tab (or stdout/stderr wherever this runs).
export function createRequestLogger({ log = console.error } = {}) {
    return function requestLogger(req, _res, next) {
        const body = req.body;
        const method = body?.method ?? 'unknown';
        const toolName = method === 'tools/call' ? body?.params?.name : undefined;
        const hasOwnToken = Boolean(req.auth?.githubToken);
        log(
            `[mcp] ${new Date().toISOString()} ip=${req.ip} method=${method}` +
            `${toolName ? ` tool=${toolName}` : ''} byo_token=${hasOwnToken}`
        );
        next();
    };
}
