// Plain REST API over the same core/ logic the MCP tools use — for a web
// frontend (or anything else that isn't an MCP client). Every route shares
// the /mcp route's rate limiting and caller-token support (mounted once in
// server-http.js), so the same protections and bring-your-own-token
// behavior apply here too.
import express from 'express';
import { GitHubApiError } from '../lib/github.js';
import { searchRepos, searchByTopic, trendingRepos } from '../core/discovery.js';
import { getRepoOverview, getRepoStructure, getFileContent, getRecentCommits, listBranches } from '../core/inspect.js';
import { compareRepos } from '../core/compare.js';

const router = express.Router();

// Unlike /mcp (a server-to-server connection, never a browser), this API is
// meant to be called directly from a web frontend's own JavaScript — which
// means the browser enforces CORS. This is a fully public, unauthenticated
// read-only API (same trust model /mcp already has), so a permissive
// wildcard origin is appropriate; it doesn't widen access, since the data
// behind it was already reachable from anywhere with no credentials.
router.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
});

function shapeRepo(repo) {
    return {
        fullName: repo.full_name,
        url: repo.html_url,
        description: repo.description?.trim() || null,
        stars: repo.stargazers_count ?? 0,
        forks: repo.forks_count ?? 0,
        language: repo.language ?? null,
        pushedAt: repo.pushed_at,
        createdAt: repo.created_at,
        topics: repo.topics ?? [],
        archived: Boolean(repo.archived),
    };
}

function shapeRepoInfo(info, contributorCount) {
    return {
        fullName: info.full_name,
        url: info.html_url,
        description: info.description?.trim() || null,
        stars: info.stargazers_count,
        forks: info.forks_count,
        openIssues: info.open_issues_count,
        language: info.language ?? null,
        license: info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : info.license?.name ?? null,
        topics: info.topics ?? [],
        homepage: info.homepage ?? null,
        defaultBranch: info.default_branch,
        createdAt: info.created_at,
        pushedAt: info.pushed_at,
        archived: Boolean(info.archived),
        contributorCount: contributorCount ?? null,
    };
}

function clampLimit(value, { def = 10, min = 1, max = 25 } = {}) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}

function callerToken(req) {
    return req.auth?.githubToken;
}

// Wraps a route handler so a thrown GitHubApiError/Error becomes a clean
// JSON error response instead of an unhandled rejection: 404 stays 404, a
// rate limit stays 429 (with Retry-After when known), input problems the
// core layer flags via `err.expected` (e.g. a bad repo ref) come back as
// 400, and anything else is logged server-side and reduced to a generic
// 500 - the same "never leak internals" policy as the MCP error path.
function asyncRoute(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (err) {
            if (err instanceof GitHubApiError) {
                if (err.isRateLimit) {
                    if (err.resetAt) res.set('Retry-After', String(Math.max(0, Math.ceil((err.resetAt.getTime() - Date.now()) / 1000))));
                    return res.status(429).json({ error: 'rate_limited', message: err.message === 'rate_limit' ? 'GitHub API rate limit hit.' : err.message });
                }
                if (err.status === 404) return res.status(404).json({ error: 'not_found', message: 'Not found on GitHub.' });
                return res.status(502).json({ error: 'github_api_error', message: err.message });
            }
            if (err?.expected) return res.status(400).json({ error: 'bad_request', message: err.message });
            console.error('[github-discovery] unexpected REST error:', err);
            return res.status(500).json({ error: 'internal_error', message: 'Unexpected internal error. It has been logged server-side.' });
        }
    };
}

router.get('/search', asyncRoute(async (req, res) => {
    const query = String(req.query.q ?? '').trim();
    if (!query) return res.status(400).json({ error: 'bad_request', message: 'Query parameter "q" is required.' });
    const result = await searchRepos({
        query,
        minStars: clampLimit(req.query.minStars, { def: 0, min: 0, max: 1_000_000 }),
        language: req.query.language?.trim() || undefined,
        limit: clampLimit(req.query.limit),
        token: callerToken(req),
    });
    res.json({ query: result.query, totalCount: result.totalCount, repos: result.repos.map(shapeRepo) });
}));

router.get('/search/topic', asyncRoute(async (req, res) => {
    const topic = String(req.query.topic ?? '').trim();
    if (!topic) return res.status(400).json({ error: 'bad_request', message: 'Query parameter "topic" is required.' });
    const result = await searchByTopic({
        topic,
        minStars: clampLimit(req.query.minStars, { def: 0, min: 0, max: 1_000_000 }),
        language: req.query.language?.trim() || undefined,
        limit: clampLimit(req.query.limit),
        token: callerToken(req),
    });
    res.json({ topic: result.topic, totalCount: result.totalCount, repos: result.repos.map(shapeRepo) });
}));

router.get('/trending', asyncRoute(async (req, res) => {
    const since = ['daily', 'weekly', 'monthly'].includes(req.query.since) ? req.query.since : 'weekly';
    const result = await trendingRepos({
        since,
        minStars: clampLimit(req.query.minStars, { def: 0, min: 0, max: 1_000_000 }),
        language: req.query.language?.trim() || undefined,
        limit: clampLimit(req.query.limit),
        token: callerToken(req),
    });
    res.json({ since: result.since, windowDays: result.windowDays, totalCount: result.totalCount, repos: result.repos.map(shapeRepo) });
}));

router.get('/repos/:owner/:name', asyncRoute(async (req, res) => {
    const repo = `${req.params.owner}/${req.params.name}`;
    const { info, languages, release, readme, contributorCount } = await getRepoOverview({ repo, token: callerToken(req) });
    res.json({
        ...shapeRepoInfo(info, contributorCount),
        languages: languages ?? {},
        latestRelease: release ? { tag: release.tag_name, publishedAt: release.published_at } : null,
        readme: readme ?? null,
    });
}));

router.get('/repos/:owner/:name/structure', asyncRoute(async (req, res) => {
    const repo = `${req.params.owner}/${req.params.name}`;
    const path = req.query.path ? String(req.query.path) : '';
    const result = await getRepoStructure({ repo, path, token: callerToken(req) });

    if (result.notFound) return res.status(404).json({ error: 'not_found', message: `No such path "${result.path || '/'}".` });
    if (result.isFile) return res.status(400).json({ error: 'is_file', message: `"${result.path}" is a file, not a directory. Use the file endpoint instead.` });

    res.json({
        owner: result.owner,
        name: result.name,
        path: result.path,
        entries: result.entries.map((e) => ({ name: e.name, type: e.type === 'dir' ? 'dir' : 'file', size: e.type === 'dir' ? null : e.size })),
    });
}));

router.get('/repos/:owner/:name/file', asyncRoute(async (req, res) => {
    const repo = `${req.params.owner}/${req.params.name}`;
    const path = req.query.path ? String(req.query.path) : '';
    if (!path) return res.status(400).json({ error: 'bad_request', message: 'Query parameter "path" is required.' });

    const result = await getFileContent({ repo, path, token: callerToken(req) });

    if (result.binaryByExtension) return res.json({ owner: result.owner, name: result.name, path: result.path, binary: true, htmlUrl: result.htmlUrl });
    if (result.notFound) return res.status(404).json({ error: 'not_found', message: `No such file "${result.path}".` });
    if (result.isDirectory) return res.status(400).json({ error: 'is_directory', message: `"${result.path}" is a directory. Use the structure endpoint instead.` });
    if (result.binaryDetected) return res.json({ owner: result.owner, name: result.name, path: result.path, binary: true, size: result.size, htmlUrl: result.htmlUrl });
    if (result.downloadRefused) return res.json({ owner: result.owner, name: result.name, path: result.path, binary: true, refused: true, htmlUrl: result.htmlUrl });
    if (result.unexpectedShape) return res.status(502).json({ error: 'unexpected_response', message: 'Unexpected response shape from GitHub.' });

    res.json({ owner: result.owner, name: result.name, path: result.path, size: result.size, text: result.text });
}));

router.get('/repos/:owner/:name/commits', asyncRoute(async (req, res) => {
    const repo = `${req.params.owner}/${req.params.name}`;
    const { owner, name, branch, commits } = await getRecentCommits({
        repo,
        branch: req.query.branch?.trim() || undefined,
        limit: clampLimit(req.query.limit, { def: 10, min: 1, max: 30 }),
        token: callerToken(req),
    });
    res.json({
        owner, name, branch: branch ?? null,
        commits: commits.map((c) => ({
            sha: c.sha,
            shortSha: c.sha.slice(0, 7),
            message: c.commit.message,
            author: c.commit.author?.name ?? c.author?.login ?? null,
            date: c.commit.author?.date ?? null,
            url: c.html_url,
        })),
    });
}));

router.get('/repos/:owner/:name/branches', asyncRoute(async (req, res) => {
    const repo = `${req.params.owner}/${req.params.name}`;
    const { owner, name, branches, defaultBranch } = await listBranches({
        repo,
        limit: clampLimit(req.query.limit, { def: 20, min: 1, max: 100 }),
        token: callerToken(req),
    });
    res.json({
        owner, name, defaultBranch,
        branches: branches.map((b) => ({ name: b.name, protected: Boolean(b.protected), sha: b.commit.sha, isDefault: b.name === defaultBranch })),
    });
}));

router.post('/compare', asyncRoute(async (req, res) => {
    const repos = Array.isArray(req.body?.repos) ? req.body.repos.filter((r) => typeof r === 'string' && r.trim()) : [];
    if (repos.length < 2 || repos.length > 4) {
        return res.status(400).json({ error: 'bad_request', message: 'Provide 2 to 4 repos in the "repos" array.' });
    }
    const { ok, failed } = await compareRepos({ repos, token: callerToken(req) });
    res.json({
        repos: ok.map(({ info, contributorCount }) => shapeRepoInfo(info, contributorCount)),
        failed: failed.map(({ input, error }) => ({ input, error })),
    });
}));

export default router;
