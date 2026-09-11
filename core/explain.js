// Builds an "explain this repo" prompt from data we already fetch anyway
// (core/inspect.js's getRepoOverview) and sends it to whichever AI provider
// applies - the operator's trial key or a caller's own. This is the only
// place in the project that calls an LLM; everything else is deterministic
// GitHub API aggregation.
import { getRepoOverview } from './inspect.js';
import { generateExplanation } from '../lib/aiProvider.js';
import { truncate } from '../lib/format.js';

// Deliberately structured (not free prose) and asked for explicitly: the
// point of this feature is a fast use-it-or-skip-it read, which needs
// scannable sections more than it needs elegant paragraphs. Rendered as
// markdown on the frontend (web/app.js), same sanitized pipeline as READMEs.
const SYSTEM_PROMPT = [
    "You help a developer quickly decide whether to use, learn from, or skip a GitHub repository, based on its ",
    "README and stats. Be concrete and specific - reference what the project actually does and what's actually ",
    "in the data you were given, never a generic restatement of its one-line description, and never invented ",
    "detail. If the README is thin, missing, or clearly aspirational (e.g. a template with no real content yet), ",
    "say so plainly - that itself is useful signal, don't paper over it.",
    "",
    "Structure your answer with exactly these markdown headers, in this order:",
    "",
    "### What it is",
    "2-4 sentences: what it actually does, the problem it solves, and how (the core approach/mechanism), not just the tagline.",
    "",
    "### Who it's for",
    "1-3 sentences on the specific use case or developer this fits best - and, if relevant, who it's a poor fit for.",
    "",
    "### Strengths",
    "2-4 bullet points on genuine differentiators - things that stand out about THIS project, not generic praise ",
    "any repo could get. Reference specifics from the README/stats where you can.",
    "",
    "### Watch out for",
    "2-4 bullet points on real limitations, risks, or things to verify before committing - maturity, maintenance ",
    "activity, license, missing docs/tests, thin contributor base, breaking-change risk, whatever actually applies ",
    "given the data. If nothing significant stands out, say that plainly instead of inventing a concern.",
    "",
    "### Verdict",
    "One or two sentences, direct: use this if ___; skip it (or look elsewhere) if ___.",
    "",
    "Aim for substantive but skimmable - roughly 350-500 words total. No content before the first header or after the last section.",
].join('\n');

function buildUserPrompt({ info, readme, languages, contributorCount, release }) {
    const topLanguages = languages
        ? Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l).join(', ')
        : 'unknown';
    const { text: readmeExcerpt, truncated } = truncate((readme || '').trim(), 6000);
    const license = info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : info.license?.name;

    return [
        `Repo: ${info.full_name}`,
        `Description: ${info.description || '(none provided)'}`,
        `Primary languages: ${topLanguages}`,
        `Stars: ${info.stargazers_count} | Forks: ${info.forks_count} | Open issues: ${info.open_issues_count}`,
        `Topics: ${(info.topics || []).join(', ') || '(none)'}`,
        `License: ${license || 'none declared'}`,
        `Archived/read-only: ${info.archived ? 'YES - no longer maintained' : 'no'}`,
        `Contributors: ${contributorCount != null ? `~${contributorCount}` : 'unknown'}`,
        `Created: ${info.created_at} | Last pushed: ${info.pushed_at}`,
        `Latest release: ${release ? `${release.tag_name} (${release.published_at})` : 'none published'}`,
        '',
        readmeExcerpt
            ? `README excerpt${truncated ? ' (truncated)' : ''}:\n${readmeExcerpt}`
            : '(No README available - note this explicitly as a red flag for evaluating the project.)',
    ].join('\n');
}

// `githubToken` (optional caller-supplied GitHub token) and `ai` ({provider,
// apiKey}) are kept separate on purpose - one authenticates to GitHub to
// fetch repo data, the other authenticates to the AI provider to explain it.
export async function explainRepo({ repo, githubToken, ai }) {
    const { info, readme, languages, contributorCount, release } = await getRepoOverview({ repo, token: githubToken });
    const userPrompt = buildUserPrompt({ info, readme, languages, contributorCount, release });
    const explanation = await generateExplanation({
        provider: ai.provider,
        apiKey: ai.apiKey,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
    });
    return { repo: info.full_name, explanation };
}
