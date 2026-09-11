// Builds an "explain this repo" prompt from data we already fetch anyway
// (core/inspect.js's getRepoOverview) plus a small sample of real source
// files, and sends it to whichever AI provider applies - the operator's
// trial key or a caller's own. This is the only place in the project that
// calls an LLM; everything else is deterministic GitHub API aggregation.
import { getRepoOverview, getRepoStructure, getFileContent } from './inspect.js';
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

const MANIFEST_FILES = new Set([
    'package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod',
    'composer.json', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'setup.py', 'Pipfile',
]);
const CODE_EXTENSIONS = new Set([
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'rb', 'php',
    'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'kt', 'swift', 'm', 'mm', 'scala', 'ex', 'exs',
]);
// Skips minified bundles, type-declaration stubs, test/spec files, and
// build-tool config (webpack.config.js, .prettierrc.js, etc) - none of these
// are representative "what does this codebase actually look like" samples,
// which is the whole point of picking a file at all. Verified live against
// real repos (see below) - without the dotfile/config exclusion, this was
// picking things like React's own ".prettierrc.js" as its "sampled source".
const SKIP_NAME_PATTERN = /^\.|\.min\.|\.d\.ts$|[._-](test|spec)\.|^test[._-]|^spec[._-]|\.config\.|rc\.[jt]s$|^(webpack|rollup|vite|babel|jest|karma|gulpfile|gruntfile)\b/i;
// Directories worth descending into for real source, and ones never worth
// the API call - both checked before falling back to "just take whatever's
// at the top level", so a repo that keeps its entry point at the root next
// to a real "lib"/"src" (e.g. Express) samples the substantive directory,
// not the one-line re-export.
const PRIORITY_DIR_NAMES = ['src', 'lib', 'app', 'pkg', 'cmd', 'internal', 'source', 'packages', 'apps'];
const SKIP_DIR_PATTERN = /^\.|^(node_modules|dist|build|vendor|coverage|docs?|examples?|tests?|__tests__|__mocks__|fixtures|third[_-]?party|website|scripts|benchmarks?)$/i;
const MAX_CODE_FILE_BYTES = 20_000;
const MIN_CODE_FILE_BYTES = 150;
const MAX_CODE_FILES = 2;
const CODE_EXCERPT_CHARS = 3500;
// Bounds how many extra directory-listing calls one explain request can
// cost hunting for source - verified live (see the repos in the comment on
// findSourceFiles) that this is enough to reach real code through at least
// one level of nesting (src/<pkg>/, packages/<pkg>/) without being unbounded
// for a repo with an unusual or very deep layout.
const MAX_DIR_LOOKUPS = 6;
const FANOUT_PER_LEVEL = 3;

function pickCodeCandidates(entries) {
    return entries
        .filter((e) => e.type === 'file' && e.size >= MIN_CODE_FILE_BYTES && e.size <= MAX_CODE_FILE_BYTES)
        .filter((e) => {
            const ext = e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : '';
            return CODE_EXTENSIONS.has(ext) && !SKIP_NAME_PATTERN.test(e.name);
        })
        .sort((a, b) => b.size - a.size);
}

function orderDirsByPriority(dirs) {
    return [...dirs].sort((a, b) => {
        const pa = PRIORITY_DIR_NAMES.indexOf(a.name);
        const pb = PRIORITY_DIR_NAMES.indexOf(b.name);
        if (pa !== -1 && pb !== -1) return pa - pb;
        if (pa !== -1) return -1;
        if (pb !== -1) return 1;
        return 0;
    });
}

// Breadth-first search for real source, preferring conventionally-named
// directories over root-level files - live-verified against Express
// (lib/*.js, not the root re-export index.js), Flask (src/flask/*.py, two
// levels deep), React (packages/<subpackage>/*.js, a monorepo layout), a Go
// repo (internal/cmd/*/*.go), and a "source/"-named TypeScript project.
// Falls back to root-level files only if no priority directory panned out,
// so a simple flat repo still gets sampled.
async function findSourceFiles(repo, token, rootEntries) {
    const rootCandidates = pickCodeCandidates(rootEntries);
    const priorityRootDirs = rootEntries.filter((e) => e.type === 'dir' && PRIORITY_DIR_NAMES.includes(e.name));

    let lookups = 0;
    const visited = new Set(['']);
    const queue = priorityRootDirs.map((d) => d.name);
    for (const p of queue) visited.add(p);

    while (queue.length && lookups < MAX_DIR_LOOKUPS) {
        const path = queue.shift();
        lookups += 1;
        let sub;
        try {
            sub = await getRepoStructure({ repo, path, token });
        } catch {
            continue;
        }
        const entries = sub.entries || [];
        const candidates = pickCodeCandidates(entries);
        if (candidates.length) {
            return candidates.slice(0, MAX_CODE_FILES).map((e) => `${path}/${e.name}`);
        }
        const dirs = orderDirsByPriority(entries.filter((e) => e.type === 'dir' && !SKIP_DIR_PATTERN.test(e.name))).slice(0, FANOUT_PER_LEVEL);
        for (const d of dirs) {
            const childPath = `${path}/${d.name}`;
            if (!visited.has(childPath)) {
                visited.add(childPath);
                queue.push(childPath);
            }
        }
    }

    return rootCandidates.slice(0, MAX_CODE_FILES).map((e) => e.name);
}

// Samples a handful of real files - one manifest (package.json, etc, for a
// quick read on dependencies/tooling) plus one or two actual source files -
// so the AI can comment on real code, not just what the README claims. Best
// effort only: any failure here (rate limit, empty repo, non-standard
// layout, private submodule quirks) just means the explanation falls back
// to README + stats alone, never a hard failure of the whole feature.
async function pickCodeFiles(repo, token) {
    try {
        const root = await getRepoStructure({ repo, path: '', token });
        const rootEntries = root.entries || [];

        const paths = [];
        const manifest = rootEntries.find((e) => e.type === 'file' && MANIFEST_FILES.has(e.name));
        if (manifest) paths.push(manifest.name);
        paths.push(...await findSourceFiles(repo, token, rootEntries));

        const files = await Promise.all(paths.map(async (path) => {
            try {
                const file = await getFileContent({ repo, path, token });
                if (!file.text) return null;
                const { text, truncated } = truncate(file.text.trim(), CODE_EXCERPT_CHARS);
                return text ? { path, text, truncated } : null;
            } catch {
                return null;
            }
        }));
        return files.filter(Boolean);
    } catch {
        return [];
    }
}

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
        pickCodeFiles(repo, githubToken),
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
