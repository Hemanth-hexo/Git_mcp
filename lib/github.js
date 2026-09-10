import { createResponseCache } from './cache.js';

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'github-discovery-mcp/1.0';

// Shared across all requests that don't carry a caller-supplied token (see
// the cacheKey logic in githubFetch below) — this is what actually reduces
// load on the shared/anonymous rate-limit pool for repeated or popular
// lookups (the same repo or search looked up by several different people
// within a few minutes only hits GitHub once).
const responseCache = createResponseCache();

// Test-only escape hatch: clears the shared cache so test cases that reuse
// the same URL with different mocked responses don't see stale cached
// results from an earlier case. Not used by application code.
export function _resetResponseCacheForTest() {
    responseCache.clear();
}

function cachedResponseLike(bodyText, linkHeader) {
    return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === 'link' ? (linkHeader ?? null) : null) },
        json: async () => JSON.parse(bodyText),
        text: async () => bodyText,
    };
}

// GitHub's Contents API returns a download_url for files too large to inline
// (>~1MB). Only ever follow it if it points at GitHub's own raw-content host
// over HTTPS — never fetch a URL taken from an API response without an
// allowlist check first, since an unvalidated outbound fetch driven by
// response data is a classic SSRF vector (e.g. a redirected/spoofed URL
// pointing at an internal address or a cloud metadata endpoint).
const ALLOWED_DOWNLOAD_HOSTS = new Set(['raw.githubusercontent.com']);

export function isAllowedDownloadUrl(urlString) {
    let url;
    try {
        url = new URL(urlString);
    } catch {
        return false;
    }
    return url.protocol === 'https:' && ALLOWED_DOWNLOAD_HOSTS.has(url.hostname);
}

const CONTROL_CHAR_MAX = 31;
const DEL_CHAR = 127;

// Strips control characters (so an embedded newline can't fake a second log
// line or a status line in returned text) and caps length. Applied to any
// text that ultimately came from outside this process — currently, slices of
// GitHub's own error response bodies.
function sanitizeExternalText(text, maxChars = 300) {
    const cleaned = Array.from(String(text ?? ''))
        .map((ch) => {
            const code = ch.codePointAt(0);
            return code <= CONTROL_CHAR_MAX || code === DEL_CHAR ? ' ' : ch;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.slice(0, maxChars);
}

export class GitHubApiError extends Error {
    constructor(message, { status, isRateLimit = false, resetAt = null } = {}) {
        super(message);
        this.name = 'GitHubApiError';
        this.status = status;
        this.isRateLimit = isRateLimit;
        this.resetAt = resetAt;
    }
}

// `token`, when given, is the calling user's own GitHub token (threaded in
// from the HTTP request via lib/auth.js + createGitHubClient below) and
// takes priority over this server's own GITHUB_TOKEN. That's what lets
// public callers spend their own GitHub rate-limit quota instead of one
// shared pool: this server never stores or reuses a caller's token beyond
// the single request it arrived on.
function headers(accept = 'application/vnd.github+json', token) {
    const h = {
        Accept: accept,
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
    };
    const effectiveToken = token || process.env.GITHUB_TOKEN;
    if (effectiveToken) h.Authorization = `Bearer ${effectiveToken}`;
    return h;
}

// Fetches a GitHub REST endpoint. `path` is either an absolute URL (e.g. a
// paginated `next` link) or a path relative to api.github.com. Throws
// GitHubApiError on any non-2xx response; the caller decides how to render it.
//
// Caching only ever applies when `token` is absent (anonymous or this
// server's own GITHUB_TOKEN) — never for a caller-supplied token. Two
// different tokens can have different access to the same URL (e.g. a
// private repo), so sharing a cache entry across them could leak one
// caller's authorized data to another; public/anonymous data carries no
// such risk, and that's the only path this ever caches.
export async function githubFetch(path, { accept, searchParams, allow404 = false, token } = {}) {
    const url = new URL(path.startsWith('http') ? path : `${GITHUB_API}${path}`);
    if (searchParams) {
        for (const [key, value] of Object.entries(searchParams)) {
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
        }
    }

    const cacheKey = !token ? `${url.toString()}::${accept ?? 'default'}` : null;
    if (cacheKey) {
        const cached = responseCache.get(cacheKey);
        if (cached.hit) return cached.value; // value may legitimately be null (cached "not found")
    }

    let res;
    try {
        res = await fetch(url, { headers: headers(accept, token) });
    } catch (err) {
        throw new GitHubApiError(`Network error contacting GitHub API: ${err.message}`);
    }

    if (res.status === 404 && allow404) {
        if (cacheKey) responseCache.set(cacheKey, null);
        return null;
    }

    if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
            const resetHeader = res.headers.get('x-ratelimit-reset');
            const remaining = res.headers.get('x-ratelimit-remaining');
            if (remaining === '0') {
                throw new GitHubApiError('rate_limit', {
                    status: res.status,
                    isRateLimit: true,
                    resetAt: resetHeader ? new Date(Number(resetHeader) * 1000) : null,
                });
            }
        }
        if (res.status === 404) {
            throw new GitHubApiError('not_found', { status: 404 });
        }
        if (res.status === 422) {
            const body = await res.text().catch(() => '');
            throw new GitHubApiError(`GitHub rejected the request as invalid. ${sanitizeExternalText(body)}`, { status: 422 });
        }
        const body = await res.text().catch(() => '');
        throw new GitHubApiError(`GitHub API error: HTTP ${res.status} ${res.statusText}. ${sanitizeExternalText(body)}`, {
            status: res.status,
        });
    }

    if (cacheKey) {
        const bodyText = await res.text();
        const cached = cachedResponseLike(bodyText, res.headers.get('link'));
        responseCache.set(cacheKey, cached);
        return cached;
    }

    return res;
}

// GitHub doesn't expose a contributor-count field; requesting per_page=1 makes
// each page correspond to exactly one contributor, so the last page number in
// the Link header IS the total count. No Link header means <=1 contributor.
export async function approximateContributorCount(owner, name, token) {
    try {
        const res = await githubFetch(`/repos/${owner}/${name}/contributors`, {
            searchParams: { per_page: 1, anon: true },
            allow404: true,
            token,
        });
        if (!res) return null;
        const link = res.headers.get('link');
        if (!link) {
            const items = await res.json();
            return Array.isArray(items) ? items.length : null;
        }
        const lastMatch = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
        return lastMatch ? Number(lastMatch[1]) : null;
    } catch {
        return null;
    }
}

// Binds a per-request GitHub token (the caller's own, if they brought one —
// see lib/auth.js) to a small client so tool handlers don't have to thread
// `token` through every individual call by hand.
export function createGitHubClient(token) {
    return {
        fetch: (path, options = {}) => githubFetch(path, { ...options, token }),
        contributorCount: (owner, name) => approximateContributorCount(owner, name, token),
    };
}

// Turns any thrown error into a short, safe-to-return string. Known
// GitHubApiError cases get their normal user-facing text (which never
// includes request headers, tokens, or local paths — only GitHub's own
// sanitized error body and values this server already computed). Anything
// else — a bug, an unexpected exception shape from a dependency — is logged
// in full server-side and reduced to a generic message, so internal details
// (stack traces, file paths, environment values) never reach the client.
export function describeErrorSafely(err, context = '', { log = console.error } = {}) {
    const where = context ? ` while ${context}` : '';
    if (err instanceof GitHubApiError) {
        if (err.isRateLimit) {
            const resetStr = err.resetAt ? err.resetAt.toLocaleTimeString() : 'shortly';
            return (
                `GitHub API rate limit hit${where}. Try again after ${resetStr}. This server is shared by ` +
                `everyone using it without their own token — bring your own GitHub personal access token ` +
                `(sent as the Authorization header when connecting) to get your own 5,000 requests/hour ` +
                `instead of sharing the anonymous pool.`
            );
        }
        if (err.status === 404) {
            return `Not found on GitHub${where}. Check the owner/repo/path and try again.`;
        }
        return err.message;
    }
    // Marked `expected` by the thrower (e.g. parseRepoRef in lib/format.js)
    // to indicate the message is already safe and user-facing — pass it
    // through rather than treating it as a bug to sanitize and log.
    if (err?.expected) return err.message;
    log(`[github-discovery] unexpected error${where}:`, err);
    return `Unexpected internal error${where}. It has been logged server-side; please try again.`;
}

export function toolErrorFromError(err, context = '') {
    return { content: [{ type: 'text', text: describeErrorSafely(err, context) }], isError: true };
}
