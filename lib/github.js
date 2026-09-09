const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'github-discovery-mcp/1.0';

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

function headers(accept = 'application/vnd.github+json') {
    const h = {
        Accept: accept,
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return h;
}

// Fetches a GitHub REST endpoint. `path` is either an absolute URL (e.g. a
// paginated `next` link) or a path relative to api.github.com. Throws
// GitHubApiError on any non-2xx response; the caller decides how to render it.
export async function githubFetch(path, { accept, searchParams, allow404 = false } = {}) {
    const url = new URL(path.startsWith('http') ? path : `${GITHUB_API}${path}`);
    if (searchParams) {
        for (const [key, value] of Object.entries(searchParams)) {
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
        }
    }

    let res;
    try {
        res = await fetch(url, { headers: headers(accept) });
    } catch (err) {
        throw new GitHubApiError(`Network error contacting GitHub API: ${err.message}`);
    }

    if (res.status === 404 && allow404) return null;

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

    return res;
}

// GitHub doesn't expose a contributor-count field; requesting per_page=1 makes
// each page correspond to exactly one contributor, so the last page number in
// the Link header IS the total count. No Link header means <=1 contributor.
export async function approximateContributorCount(owner, name) {
    try {
        const res = await githubFetch(`/repos/${owner}/${name}/contributors`, {
            searchParams: { per_page: 1, anon: true },
            allow404: true,
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
            const hint = process.env.GITHUB_TOKEN
                ? ''
                : ' Set a GITHUB_TOKEN environment variable to raise GitHub’s limit (60/hr unauthenticated → 5000/hr with a token).';
            return `GitHub API rate limit hit${where}. Try again after ${resetStr}.${hint}`;
        }
        if (err.status === 404) {
            return `Not found on GitHub${where}. Check the owner/repo/path and try again.`;
        }
        return err.message;
    }
    log(`[github-discovery] unexpected error${where}:`, err);
    return `Unexpected internal error${where}. It has been logged server-side; please try again.`;
}

export function toolErrorFromError(err, context = '') {
    return { content: [{ type: 'text', text: describeErrorSafely(err, context) }], isError: true };
}
