// This server is public by design: no login, no shared secret required to
// use it. Instead, a caller may optionally bring their OWN GitHub personal
// access token via the standard Authorization header. When present, that
// token is used for GitHub API calls made on their behalf (see
// lib/github.js's createGitHubClient) — spending their own rate-limit quota
// instead of the shared anonymous one. This middleware never rejects a
// request; it only extracts whatever credential (if any) came with it.
export function extractCallerToken(req, _res, next) {
    const header = req.headers.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
    const githubToken = match ? match[1].trim() : undefined;

    // Shaped like an SDK AuthInfo (token/clientId/scopes/expiresAt) so it
    // slots into ctx.http.authInfo the same way an authenticated gate's
    // result would, but nothing here is actually verified — githubToken is
    // opaque to this server; GitHub itself is what validates it, per-request.
    req.auth = {
        token: githubToken,
        clientId: githubToken ? 'byo-github-token' : 'anonymous',
        scopes: ['mcp'],
        expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
        githubToken,
    };

    next();
}
