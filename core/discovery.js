// Core discovery logic, shared by the MCP tools (tools/discovery.js) and the
// REST API (routes/api.js). Returns plain data — raw-ish GitHub repo objects
// plus the metadata each caller needs to format its own response — never
// MCP's {content, isError} shape or any HTTP-specific concern. Throws
// GitHubApiError/Error on failure; the caller decides how to report it.
import { githubFetch } from '../lib/github.js';
import { daysSince } from '../lib/format.js';

// Ranks by stars first, but discounts repos that have gone stale so an
// actively maintained project can outrank a similarly popular abandoned one.
export function rankRepos(items, limit) {
    const scored = items.map((repo) => {
        const stars = repo.stargazers_count ?? 0;
        const starScore = Math.log10(stars + 1);
        const days = daysSince(repo.pushed_at ?? repo.updated_at);
        const recencyScore = 1 / (1 + days / 90);
        const combined = starScore * (0.7 + 0.3 * recencyScore);
        return { repo, combined };
    });
    scored.sort((a, b) => b.combined - a.combined);
    return scored.slice(0, limit).map((s) => s.repo);
}

async function runRepoSearch({ searchQuery, limit, token }) {
    const perFetch = Math.min(Math.max(limit * 3, 30), 100);
    const res = await githubFetch('/search/repositories', {
        searchParams: { q: searchQuery, sort: 'stars', order: 'desc', per_page: perFetch },
        token,
    });
    const data = await res.json();
    const items = data.items ?? [];
    const repos = rankRepos(items, limit);
    return { totalCount: data.total_count, repos };
}

export async function searchRepos({ query, minStars = 0, language, limit = 10, token } = {}) {
    const qualifiers = [];
    if (minStars > 0) qualifiers.push(`stars:>=${minStars}`);
    if (language) qualifiers.push(`language:${language}`);
    const searchQuery = [query.trim(), ...qualifiers].join(' ');
    const result = await runRepoSearch({ searchQuery, limit, token });
    return { query, minStars, language, limit, searchQuery, ...result };
}

export async function searchByTopic({ topic, minStars = 0, language, limit = 10, token } = {}) {
    const normalizedTopic = topic.trim().toLowerCase().replace(/\s+/g, '-');
    const qualifiers = [`topic:${normalizedTopic}`];
    if (minStars > 0) qualifiers.push(`stars:>=${minStars}`);
    if (language) qualifiers.push(`language:${language}`);
    const result = await runRepoSearch({ searchQuery: qualifiers.join(' '), limit, token });
    return { topic: normalizedTopic, minStars, language, limit, ...result };
}

// Unlike search/topic, trending intentionally does NOT re-rank via
// rankRepos — GitHub's own stars-desc order over a recency-bounded window
// (created:>=) already IS the ranking; re-applying rankRepos's own recency
// discount on top would double-penalize newer repos within that window.
export async function trendingRepos({ since = 'weekly', minStars = 0, language, limit = 10, token } = {}) {
    const windowDays = { daily: 1, weekly: 7, monthly: 30 }[since] ?? 7;
    const sinceDate = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
    const qualifiers = [`created:>=${sinceDate}`];
    if (minStars > 0) qualifiers.push(`stars:>=${minStars}`);
    if (language) qualifiers.push(`language:${language}`);
    const perFetch = Math.min(Math.max(limit * 3, 30), 100);
    const res = await githubFetch('/search/repositories', {
        searchParams: { q: qualifiers.join(' '), sort: 'stars', order: 'desc', per_page: perFetch },
        token,
    });
    const data = await res.json();
    const items = data.items ?? [];
    const repos = items.slice(0, limit);
    return { since, windowDays, minStars, language, limit, totalCount: data.total_count, repos };
}
