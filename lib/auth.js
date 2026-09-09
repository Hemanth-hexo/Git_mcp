import { timingSafeEqual } from 'node:crypto';
import { requireBearerAuth } from '@modelcontextprotocol/express';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';

const SHARED_SCOPE = 'mcp';
// A long-lived shared secret has no natural expiry; verifyAccessToken is
// called per-request anyway, so this just satisfies the SDK's requirement
// that every AuthInfo carry a (rolling) expiresAt.
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;

// Constant-time comparison so a wrong guess can't be narrowed down byte-by-byte
// via response-time differences. A length mismatch short-circuits before
// timingSafeEqual (which requires equal-length buffers) — that leaks the
// *length* of the secret through timing, not its bytes, which is the
// standard, accepted tradeoff for this kind of check.
export function isValidToken(provided, expected) {
    if (!provided || !expected) return false;
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Builds the Express auth gate for the /mcp route.
 *
 * Fails CLOSED: if MCP_BEARER_TOKEN isn't configured, isValidToken rejects
 * every token (including no token), so every request gets 401 instead of
 * the server silently running open. The same generic "invalid or missing
 * bearer token" message is used whether the server is misconfigured or the
 * caller's token is simply wrong — an external prober should not be able to
 * distinguish "misconfigured" from "wrong guess" from the response alone.
 * The operator-facing detail goes to `log` (server-side only), not to the
 * response body.
 */
export function createAuthGate({ env = process.env, log = console.error } = {}) {
    const expectedToken = env.MCP_BEARER_TOKEN;

    if (!expectedToken) {
        log(
            'SECURITY: MCP_BEARER_TOKEN is not set. The /mcp endpoint will reject every request until it is ' +
            'configured — this server does not fall back to running open. Set MCP_BEARER_TOKEN to a long, ' +
            'random secret (e.g. the output of `openssl rand -hex 32`) and share it only with intended users.'
        );
    } else if (expectedToken.length < 20) {
        log('SECURITY WARNING: MCP_BEARER_TOKEN is shorter than 20 characters — use a longer, random value.');
    }

    const verifier = {
        async verifyAccessToken(token) {
            if (!isValidToken(token, expectedToken)) {
                throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or missing bearer token.');
            }
            return {
                token,
                clientId: 'shared-secret',
                scopes: [SHARED_SCOPE],
                expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
            };
        },
    };

    return requireBearerAuth({ verifier, requiredScopes: [SHARED_SCOPE] });
}
