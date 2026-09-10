// Core compare logic, shared by the MCP tool (tools/compare.js) and the REST
// API (routes/api.js). Per-repo failures are collected rather than thrown,
// since "3 of 4 repos resolved" is a normal, useful partial result for both
// callers — not an exceptional case.
import { githubFetch, approximateContributorCount, describeErrorSafely } from '../lib/github.js';
import { parseRepoRef } from '../lib/format.js';

async function fetchOneForCompare(rawRepo, token) {
    let owner, name;
    try {
        ({ owner, name } = parseRepoRef(rawRepo));
    } catch (err) {
        return { input: rawRepo, error: err.message };
    }
    try {
        const [infoRes, contributorCount] = await Promise.all([
            githubFetch(`/repos/${owner}/${name}`, { token }),
            approximateContributorCount(owner, name, token),
        ]);
        const info = await infoRes.json();
        return { input: rawRepo, info, contributorCount };
    } catch (err) {
        return { input: rawRepo, error: describeErrorSafely(err, `fetching ${owner}/${name}`) };
    }
}

export async function compareRepos({ repos, token } = {}) {
    const results = await Promise.all(repos.map((r) => fetchOneForCompare(r, token)));
    const ok = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    return { ok, failed };
}
