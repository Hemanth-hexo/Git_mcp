import * as z from 'zod/v4';
import { githubFetch, approximateContributorCount, describeErrorSafely } from '../lib/github.js';
import { relativeTime, formatCount, parseRepoRef } from '../lib/format.js';

function mdEscape(s) {
    return String(s ?? '').replace(/\|/g, '\\|');
}

async function fetchOneForCompare(rawRepo) {
    let owner, name;
    try {
        ({ owner, name } = parseRepoRef(rawRepo));
    } catch (err) {
        return { input: rawRepo, error: err.message };
    }
    try {
        const [infoRes, contributorCount] = await Promise.all([
            githubFetch(`/repos/${owner}/${name}`),
            approximateContributorCount(owner, name),
        ]);
        const info = await infoRes.json();
        return { input: rawRepo, info, contributorCount };
    } catch (err) {
        return { input: rawRepo, error: describeErrorSafely(err, `fetching ${owner}/${name}`) };
    }
}

export function registerCompareTools(server) {
    server.registerTool(
        'compare_repos',
        {
            description:
                "Compare 2-4 GitHub repos side by side as a table: stars, forks, open issues, license, primary " +
                "language, approximate contributor count, and how recently each was created/updated. Use this to " +
                "help decide between finalists after search_github_repos, instead of eyeballing separate results.",
            inputSchema: z.object({
                repos: z
                    .array(z.string().min(1))
                    .min(2)
                    .max(4)
                    .describe("2 to 4 repos, each as 'owner/name' or a GitHub URL, e.g. ['facebook/react', 'vuejs/vue']."),
            }),
        },
        async ({ repos }) => {
            const results = await Promise.all(repos.map(fetchOneForCompare));
            const ok = results.filter((r) => !r.error);
            const failed = results.filter((r) => r.error);

            if (ok.length < 2) {
                const lines = failed.map((f) => `- ${f.input}: ${f.error}`);
                return {
                    content: [{ type: 'text', text: `Need at least 2 valid repos to compare. Problems:\n${lines.join('\n')}` }],
                    isError: true,
                };
            }

            const headers = ['Repo', 'Stars', 'Forks', 'Open issues', 'Language', 'License', 'Contributors', 'Created', 'Last pushed', 'Archived'];
            const rows = ok.map(({ info, contributorCount }) => [
                mdEscape(info.full_name),
                info.stargazers_count.toLocaleString(),
                info.forks_count.toLocaleString(),
                info.open_issues_count.toLocaleString(),
                info.language ?? '—',
                info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : info.license?.name ?? 'None',
                contributorCount != null ? `~${formatCount(contributorCount)}` : '—',
                relativeTime(info.created_at),
                relativeTime(info.pushed_at),
                info.archived ? 'yes' : 'no',
            ]);

            const table = [
                `| ${headers.join(' | ')} |`,
                `| ${headers.map(() => '---').join(' | ')} |`,
                ...rows.map((r) => `| ${r.join(' | ')} |`),
            ].join('\n');

            const urlList = ok.map(({ info }) => `- ${info.full_name}: ${info.html_url}`).join('\n');
            const failedNote = failed.length ? `\n\nCouldn't fetch:\n${failed.map((f) => `- ${f.input}: ${f.error}`).join('\n')}` : '';

            return { content: [{ type: 'text', text: `${table}\n\n${urlList}${failedNote}` }] };
        }
    );
}
