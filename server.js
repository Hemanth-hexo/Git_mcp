import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'github-discovery-mcp/1.0';

function daysSince(dateStr) {
    return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

function relativeTime(dateStr) {
    const days = daysSince(dateStr);
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 30) return `${Math.floor(days)} days ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
}

function formatStars(n) {
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
}

function buildSearchQuery(query, { minStars, language }) {
    const qualifiers = [];
    if (minStars > 0) qualifiers.push(`stars:>=${minStars}`);
    if (language) qualifiers.push(`language:${language}`);
    return [query.trim(), ...qualifiers].join(' ');
}

// Ranks by stars first, but discounts repos that have gone stale so an
// actively maintained project can outrank a similarly popular abandoned one.
function rankRepos(items, limit) {
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

function buildSnippet(repo) {
    const lead = repo.description?.trim() || `${repo.language ? repo.language + ' ' : ''}project (no description provided).`;
    const extras = [
        `${formatStars(repo.stargazers_count ?? 0)} stars`,
        `last pushed ${relativeTime(repo.pushed_at ?? repo.updated_at)}`,
    ];
    if (repo.forks_count) extras.push(`${formatStars(repo.forks_count)} forks`);
    if (repo.topics?.length) extras.push(`topics: ${repo.topics.slice(0, 5).join(', ')}`);
    if (repo.archived) extras.push('ARCHIVED');
    return `${lead} (${extras.join(' · ')})`;
}

function createServer() {
    const server = new McpServer({ name: 'github-discovery', version: '1.0.0' });

    server.registerTool(
        'search_github_repos',
        {
            description:
                "Search GitHub for open-source repositories relevant to a research topic, technology, or project idea. " +
                "Returns the top matching repos ranked by a blend of popularity (stars) and how recently they've been " +
                "maintained, each with a short summary of what makes it useful. Good for requests like 'find me RAG " +
                "implementation repos' or 'show me containerization examples in Go'.",
            inputSchema: z.object({
                query: z
                    .string()
                    .min(1, 'query must not be empty')
                    .describe(
                        "What the user is building, researching, or learning, phrased as GitHub search terms, e.g. " +
                        "'retrieval augmented generation vector database' or 'containerization examples'."
                    ),
                filters: z
                    .object({
                        min_stars: z
                            .number()
                            .int()
                            .min(0)
                            .optional()
                            .describe('Only include repos with at least this many stars. Default: 0 (no minimum).'),
                        language: z
                            .string()
                            .optional()
                            .describe("Restrict results to one programming language, e.g. 'Python' or 'TypeScript'."),
                        limit: z
                            .number()
                            .int()
                            .min(1)
                            .max(25)
                            .optional()
                            .describe('How many repos to return. Default: 10, max: 25.'),
                    })
                    .optional()
                    .describe('Optional filters to narrow or broaden the search.'),
            }),
        },
        async ({ query, filters }) => {
            const minStars = filters?.min_stars ?? 0;
            const language = filters?.language?.trim();
            const limit = filters?.limit ?? 10;

            const searchQuery = buildSearchQuery(query, { minStars, language });
            const perFetch = Math.min(Math.max(limit * 3, 30), 100);

            const headers = {
                Accept: 'application/vnd.github+json',
                'User-Agent': USER_AGENT,
                'X-GitHub-Api-Version': '2022-11-28',
            };
            if (process.env.GITHUB_TOKEN) {
                headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
            }

            const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc&per_page=${perFetch}`;

            let res;
            try {
                res = await fetch(url, { headers });
            } catch (err) {
                return {
                    content: [{ type: 'text', text: `Network error contacting GitHub API: ${err.message}` }],
                    isError: true,
                };
            }

            if (!res.ok) {
                if (res.status === 403 || res.status === 429) {
                    const remaining = res.headers.get('x-ratelimit-remaining');
                    const resetHeader = res.headers.get('x-ratelimit-reset');
                    const resetDate = resetHeader ? new Date(Number(resetHeader) * 1000).toLocaleTimeString() : 'shortly';
                    const hint = process.env.GITHUB_TOKEN
                        ? ''
                        : ' Set a GITHUB_TOKEN environment variable to raise the search limit from 10 to 30 requests/minute.';
                    return {
                        content: [{
                            type: 'text',
                            text: `GitHub API rate limit hit (remaining: ${remaining ?? 0}). Try again after ${resetDate}.${hint}`,
                        }],
                        isError: true,
                    };
                }
                if (res.status === 422) {
                    return {
                        content: [{ type: 'text', text: `GitHub rejected the search query as invalid: "${searchQuery}". Try simplifying it.` }],
                        isError: true,
                    };
                }
                const body = await res.text().catch(() => '');
                return {
                    content: [{ type: 'text', text: `GitHub API error: HTTP ${res.status} ${res.statusText}. ${body.slice(0, 300)}` }],
                    isError: true,
                };
            }

            const data = await res.json();
            const items = data.items ?? [];

            if (items.length === 0) {
                const constraints = [language && `language ${language}`, minStars && `${minStars}+ stars`].filter(Boolean).join(', ');
                return {
                    content: [{
                        type: 'text',
                        text: `No repositories found for "${query}"${constraints ? ` (${constraints})` : ''}. Try broadening the query or lowering min_stars.`,
                    }],
                };
            }

            const ranked = rankRepos(items, limit);

            const lines = ranked.map((repo, i) => [
                `${i + 1}. ${repo.full_name}${repo.archived ? ' [ARCHIVED]' : ''}`,
                `   URL: ${repo.html_url}`,
                `   Stars: ${repo.stargazers_count.toLocaleString()} | Language: ${repo.language ?? 'Not specified'} | Last pushed: ${relativeTime(repo.pushed_at)} (${repo.pushed_at.slice(0, 10)})`,
                `   ${buildSnippet(repo)}`,
            ].join('\n'));

            const header = `Found ${data.total_count.toLocaleString()} total matches for "${query}". Showing top ${ranked.length}, ranked by stars + recent activity:`;

            return {
                content: [{ type: 'text', text: `${header}\n\n${lines.join('\n\n')}` }],
            };
        }
    );

    return server;
}

void serveStdio(createServer);
console.error('GitHub Discovery MCP server running on stdio');
