import * as z from 'zod/v4';
import { toolErrorFromError } from '../lib/github.js';
import { relativeTime, formatCount } from '../lib/format.js';
import { searchRepos, searchByTopic, trendingRepos } from '../core/discovery.js';

const filtersShape = {
    min_stars: z.number().int().min(0).optional().describe('Only include repos with at least this many stars. Default: 0 (no minimum).'),
    language: z.string().optional().describe("Restrict results to one programming language, e.g. 'Python' or 'TypeScript'."),
    limit: z.number().int().min(1).max(25).optional().describe('How many repos to return. Default: 10, max: 25.'),
};

function callerToken(ctx) {
    return ctx?.http?.authInfo?.githubToken;
}

function buildSnippet(repo) {
    const lead = repo.description?.trim() || `${repo.language ? repo.language + ' ' : ''}project (no description provided).`;
    const extras = [
        `${formatCount(repo.stargazers_count ?? 0)} stars`,
        `last pushed ${relativeTime(repo.pushed_at ?? repo.updated_at)}`,
    ];
    if (repo.forks_count) extras.push(`${formatCount(repo.forks_count)} forks`);
    if (repo.topics?.length) extras.push(`topics: ${repo.topics.slice(0, 5).join(', ')}`);
    if (repo.archived) extras.push('ARCHIVED');
    return `${lead} (${extras.join(' · ')})`;
}

function formatRepoList(repos, headerText) {
    const lines = repos.map((repo, i) => [
        `${i + 1}. ${repo.full_name}${repo.archived ? ' [ARCHIVED]' : ''}`,
        `   URL: ${repo.html_url}`,
        `   Stars: ${repo.stargazers_count.toLocaleString()} | Language: ${repo.language ?? 'Not specified'} | Last pushed: ${relativeTime(repo.pushed_at)} (${repo.pushed_at.slice(0, 10)})`,
        `   ${buildSnippet(repo)}`,
    ].join('\n'));
    return `${headerText}\n\n${lines.join('\n\n')}`;
}

export function registerDiscoveryTools(server) {
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
                filters: z.object(filtersShape).optional().describe('Optional filters to narrow or broaden the search.'),
            }),
        },
        async ({ query, filters }, ctx) => {
            const minStars = filters?.min_stars ?? 0;
            const language = filters?.language?.trim();
            const limit = filters?.limit ?? 10;
            const constraints = [language && `language ${language}`, minStars && `${minStars}+ stars`].filter(Boolean).join(', ');

            try {
                const result = await searchRepos({ query, minStars, language, limit, token: callerToken(ctx) });
                if (result.repos.length === 0) {
                    return {
                        content: [{
                            type: 'text',
                            text: `No repositories found for "${query}"${constraints ? ` (${constraints})` : ''}. Try broadening the query or lowering min_stars.`,
                        }],
                    };
                }
                const headerText = `Found ${result.totalCount.toLocaleString()} total matches. Showing top ${Math.min(limit, result.repos.length)}, ranked by stars + recent activity:`;
                return { content: [{ type: 'text', text: formatRepoList(result.repos, headerText) }] };
            } catch (err) {
                return toolErrorFromError(err, `searching for "${query}"`);
            }
        }
    );

    server.registerTool(
        'search_by_topic',
        {
            description:
                "Find GitHub repositories tagged with a specific topic label (GitHub's own categorization tags, e.g. " +
                "'machine-learning', 'llm-agent', 'containerization'). More precise than free-text search when you " +
                "already know the ecosystem's term for what you want, since it matches curated tags rather than " +
                "description text.",
            inputSchema: z.object({
                topic: z
                    .string()
                    .min(1)
                    .describe("A GitHub topic tag, e.g. 'rag', 'llm-agent', 'docker', 'vector-database'. Lowercase, hyphenated, no spaces."),
                filters: z.object(filtersShape).optional().describe('Optional filters to narrow or broaden the search.'),
            }),
        },
        async ({ topic, filters }, ctx) => {
            const minStars = filters?.min_stars ?? 0;
            const language = filters?.language?.trim();
            const limit = filters?.limit ?? 10;

            try {
                const result = await searchByTopic({ topic, minStars, language, limit, token: callerToken(ctx) });
                if (result.repos.length === 0) {
                    return {
                        content: [{
                            type: 'text',
                            text: `No repositories found tagged with topic "${result.topic}". Double-check the topic spelling on GitHub, or try search_github_repos with free text instead.`,
                        }],
                    };
                }
                const headerText = `Found ${result.totalCount.toLocaleString()} total matches. Showing top ${Math.min(limit, result.repos.length)}, ranked by stars + recent activity:`;
                return { content: [{ type: 'text', text: formatRepoList(result.repos, headerText) }] };
            } catch (err) {
                return toolErrorFromError(err, `searching topic "${topic}"`);
            }
        }
    );

    server.registerTool(
        'get_trending_repos',
        {
            description:
                "Surface repos that are new and already gaining traction, as a proxy for 'what's trending' (GitHub's " +
                "REST API has no official trending endpoint, so this approximates it: repos created within the chosen " +
                "window, ranked by stars accumulated so far). Good for open-ended exploration like 'what's hot in agent " +
                "frameworks right now', as opposed to search_github_repos which needs a specific query.",
            inputSchema: z.object({
                since: z
                    .enum(['daily', 'weekly', 'monthly'])
                    .optional()
                    .describe("How new a repo must be to count as trending. Default: 'weekly'."),
                filters: z.object(filtersShape).optional().describe('Optional filters to narrow or broaden the results.'),
            }),
        },
        async ({ since, filters }, ctx) => {
            const minStars = filters?.min_stars ?? 0;
            const language = filters?.language?.trim();
            const limit = filters?.limit ?? 10;

            try {
                const result = await trendingRepos({ since, minStars, language, limit, token: callerToken(ctx) });
                if (result.repos.length === 0) {
                    return {
                        content: [{
                            type: 'text',
                            text: `No new repos found in the last ${result.windowDays} day(s) matching those filters. Try a wider window (monthly) or fewer filters.`,
                        }],
                    };
                }
                const lines = result.repos.map((repo, i) => [
                    `${i + 1}. ${repo.full_name}`,
                    `   URL: ${repo.html_url}`,
                    `   Stars: ${repo.stargazers_count.toLocaleString()} | Language: ${repo.language ?? 'Not specified'} | Created: ${relativeTime(repo.created_at)}`,
                    `   ${repo.description?.trim() || 'No description provided.'}`,
                ].join('\n'));
                const text =
                    `Repos created in the last ${result.windowDays} day(s), ranked by stars so far ` +
                    `(an approximation of "trending" — GitHub doesn't expose real trend data via API):\n\n${lines.join('\n\n')}`;
                return { content: [{ type: 'text', text }] };
            } catch (err) {
                return toolErrorFromError(err, 'fetching trending repos');
            }
        }
    );
}
