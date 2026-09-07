const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'github-discovery-mcp/1.0';

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
            throw new GitHubApiError(`GitHub rejected the request as invalid. ${body.slice(0, 300)}`, { status: 422 });
        }
        const body = await res.text().catch(() => '');
        throw new GitHubApiError(`GitHub API error: HTTP ${res.status} ${res.statusText}. ${body.slice(0, 300)}`, {
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

export function toolErrorFromError(err, context = '') {
    const where = context ? ` while ${context}` : '';
    if (err instanceof GitHubApiError) {
        if (err.isRateLimit) {
            const resetStr = err.resetAt ? err.resetAt.toLocaleTimeString() : 'shortly';
            const hint = process.env.GITHUB_TOKEN
                ? ''
                : ' Set a GITHUB_TOKEN environment variable to raise GitHub’s limit (60/hr unauthenticated → 5000/hr with a token).';
            return {
                content: [{ type: 'text', text: `GitHub API rate limit hit${where}. Try again after ${resetStr}.${hint}` }],
                isError: true,
            };
        }
        if (err.status === 404) {
            return {
                content: [{ type: 'text', text: `Not found on GitHub${where}. Check the owner/repo/path and try again.` }],
                isError: true,
            };
        }
        return { content: [{ type: 'text', text: err.message }], isError: true };
    }
    return { content: [{ type: 'text', text: `Unexpected error${where}: ${err.message}` }], isError: true };
}
