// Builds an "explain this repo" prompt from data we already fetch anyway
// (core/inspect.js's getRepoOverview) and sends it to whichever AI provider
// applies - the operator's trial key or a caller's own. This is the only
// place in the project that calls an LLM; everything else is deterministic
// GitHub API aggregation.
import { getRepoOverview } from './inspect.js';
import { generateExplanation } from '../lib/aiProvider.js';
import { truncate } from '../lib/format.js';

const SYSTEM_PROMPT =
    'You explain open-source GitHub repositories to a developer deciding whether to use or learn from them. ' +
    'Be concrete and specific about what the project actually does, what problem it solves, and what stands out ' +
    'about it - not a generic restatement of the description. If the README is thin or missing, say so rather ' +
    'than inventing detail. 3-5 short paragraphs, no headers, no bullet lists, plain prose.';

function buildUserPrompt({ info, readme, languages }) {
    const topLanguages = languages ? Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l).join(', ') : 'unknown';
    const { text: readmeExcerpt } = truncate((readme || '').trim(), 4000);
    return [
        `Repo: ${info.full_name}`,
        `Description: ${info.description || '(none provided)'}`,
        `Primary languages: ${topLanguages}`,
        `Stars: ${info.stargazers_count} | Forks: ${info.forks_count} | Topics: ${(info.topics || []).join(', ') || '(none)'}`,
        `Last pushed: ${info.pushed_at}`,
        '',
        readmeExcerpt ? `README excerpt:\n${readmeExcerpt}` : '(No README available.)',
    ].join('\n');
}

// `githubToken` (optional caller-supplied GitHub token) and `ai` ({provider,
// apiKey}) are kept separate on purpose - one authenticates to GitHub to
// fetch repo data, the other authenticates to the AI provider to explain it.
export async function explainRepo({ repo, githubToken, ai }) {
    const { info, readme, languages } = await getRepoOverview({ repo, token: githubToken });
    const userPrompt = buildUserPrompt({ info, readme, languages });
    const explanation = await generateExplanation({
        provider: ai.provider,
        apiKey: ai.apiKey,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
    });
    return { repo: info.full_name, explanation };
}
