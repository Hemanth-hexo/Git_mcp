// Builds an "explain this repo" prompt from data we already fetch anyway
// (core/inspect.js's getRepoOverview) plus a small sample of real source
// files, and sends it to whichever AI provider applies - the operator's
// trial key or a caller's own. This is the only place in the project that
// calls an LLM; everything else is deterministic GitHub API aggregation.
import { getRepoOverview } from './inspect.js';
import { sampleRepoFiles } from './sourceSampler.js';
import { generateExplanation } from '../lib/aiProvider.js';
import { truncate, wrapUntrustedContent } from '../lib/format.js';

// Deliberately structured (not free prose) and asked for explicitly: the
// point of this feature is to be a genuine substitute for "let me paste this
// into an AI chat and ask about it" - developers should come away with
// enough to decide AND get started, without a follow-up round-trip
// elsewhere. Rendered as markdown on the frontend (web/app.js), same
// sanitized pipeline as READMEs.
const SYSTEM_PROMPT = [
    "You give a developer a genuinely thorough, decision-ready briefing on a GitHub repository - detailed enough ",
    "that they don't need to go ask another AI follow-up questions about what it is, how it works, or whether to ",
    "use it. You're given repo stats, a README excerpt, and (when available) a small sample of real source files. ",
    "Be concrete and specific - reference what the project actually does and what's actually in the data you were ",
    "given, never a generic restatement of its one-line description, and never invented detail. If the README is ",
    "thin, missing, or clearly aspirational (e.g. a template with no real content yet), say so plainly - that ",
    "itself is useful signal, don't paper over it. Source file excerpts are a small sample, not the whole ",
    "codebase - treat them as representative evidence, not a full audit, and say so if you generalize from them.",
    "",
    "Structure your answer with exactly these markdown headers, in this order. Omit a section only where noted:",
    "",
    "### What it is",
    "3-5 sentences: what it actually does, the problem it solves, and how (the core approach/mechanism), not just the tagline.",
    "",
    "### How it works",
    "2-4 sentences on the actual architecture or approach - key components, how data/control flows, notable design ",
    "choices - drawn from the README and source excerpts. If neither gives enough to say anything concrete, keep ",
    "this to one sentence acknowledging that rather than guessing.",
    "",
    "### Code quality notes",
    "Only include this section if source file excerpts were provided below. 2-4 bullets on real, specific ",
    "observations from those excerpts - structure, naming, error handling, test presence, comments/documentation, ",
    "obvious smells or notably clean patterns. Reference the actual sampled file(s) by name. If no source excerpts ",
    "were provided, omit this entire section (including its header) rather than speculating.",
    "",
    "### Who it's for",
    "1-3 sentences on the specific use case or developer this fits best - and, if relevant, who it's a poor fit for.",
    "",
    "### Getting started",
    "A concrete, short quick-start (install command, minimal usage) if the README actually contains one - quote or ",
    "closely paraphrase the real instructions, never invent commands or APIs. If the README has no real setup ",
    "instructions, say so plainly instead of guessing at one.",
    "",
    "### Strengths",
    "3-5 bullet points on genuine differentiators - things that stand out about THIS project, not generic praise ",
    "any repo could get. Reference specifics from the README/stats/code where you can.",
    "",
    "### Watch out for",
    "3-5 bullet points on real limitations, risks, or things to verify before committing - maturity, maintenance ",
    "activity, license, missing docs/tests, thin contributor base, breaking-change risk, whatever actually applies ",
    "given the data. If nothing significant stands out, say that plainly instead of inventing a concern.",
    "",
    "### Verdict",
    "Two or three sentences, direct: use this if ___; skip it (or look elsewhere) if ___.",
    "",
    "Aim for substantive depth over brevity - roughly 700-1000 words total (more if the code/README genuinely ",
    "support it, less only if the repo has very little to say). No content before the first header or after the ",
    "last section.",
].join('\n');

function buildUserPrompt({ info, readme, languages, contributorCount, release, codeFiles }) {
    const topLanguages = languages
        ? Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l).join(', ')
        : 'unknown';
    const { text: readmeExcerpt, truncated: readmeTruncated } = truncate((readme || '').trim(), 8000);
    const license = info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : info.license?.name;

    const codeSection = codeFiles.length
        ? codeFiles.map(({ path, text, truncated }) => wrapUntrustedContent(`source file: ${path}${truncated ? ' (truncated)' : ''}`, text)).join('\n\n')
        : '(No source files could be sampled for this repo - base "Code quality notes" only on what is available, or omit that section entirely per the instructions.)';

    return [
        `Repo: ${info.full_name}`,
        `Description: ${info.description || '(none provided)'}`,
        `Homepage: ${info.homepage || '(none)'}`,
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
            ? wrapUntrustedContent(`README${readmeTruncated ? ' (truncated)' : ''}`, readmeExcerpt)
            : '(No README available - note this explicitly as a red flag for evaluating the project.)',
        '',
        'Sampled source files (a small excerpt, not the whole codebase):',
        codeSection,
    ].join('\n');
}

// `githubToken` (optional caller-supplied GitHub token) and `ai` ({provider,
// apiKey}) are kept separate on purpose - one authenticates to GitHub to
// fetch repo data, the other authenticates to the AI provider to explain it.
export async function explainRepo({ repo, githubToken, ai }) {
    const [{ info, readme, languages, contributorCount, release }, codeFiles] = await Promise.all([
        getRepoOverview({ repo, token: githubToken }),
        sampleRepoFiles(repo, githubToken),
    ]);
    const userPrompt = buildUserPrompt({ info, readme, languages, contributorCount, release, codeFiles });
    const explanation = await generateExplanation({
        provider: ai.provider,
        apiKey: ai.apiKey,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
    });
    return { repo: info.full_name, explanation };
}
