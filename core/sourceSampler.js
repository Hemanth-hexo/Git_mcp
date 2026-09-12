// Samples a small, representative slice of a repo's real files - one
// manifest (package.json, pyproject.toml, go.mod, etc.) plus one or two
// actual source files - for anything that wants to reason about real code
// instead of just what a README claims. Originally built for core/explain.js
// (the AI explanation feature); extracted so core/bundle.js (the "copy
// context for AI" feature) can reuse the exact same, live-verified file
// selection instead of duplicating it.
import { getRepoStructure, getFileContent } from './inspect.js';
import { truncate } from '../lib/format.js';

export const MANIFEST_FILES = new Set([
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
// Bounds how many extra directory-listing calls one sampling pass can cost
// hunting for source - verified live (see the repos in the comment on
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
async function findSourceFiles(repo, token, rootEntries, maxFiles) {
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
            return candidates.slice(0, maxFiles).map((e) => `${path}/${e.name}`);
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

    return rootCandidates.slice(0, maxFiles).map((e) => e.name);
}

// Samples a handful of real files - one manifest plus up to `maxCodeFiles`
// actual source files. Best effort only: any failure here (rate limit, empty
// repo, non-standard layout, private submodule quirks) just means the
// caller gets fewer/no files back, never a thrown error - callers should
// treat this as "nice to have" context, not a required input.
export async function sampleRepoFiles(repo, token, { maxCodeFiles = 2, excerptChars = 3500 } = {}) {
    try {
        const root = await getRepoStructure({ repo, path: '', token });
        const rootEntries = root.entries || [];

        const paths = [];
        const manifest = rootEntries.find((e) => e.type === 'file' && MANIFEST_FILES.has(e.name));
        if (manifest) paths.push(manifest.name);
        paths.push(...await findSourceFiles(repo, token, rootEntries, maxCodeFiles));

        const files = await Promise.all(paths.map(async (path) => {
            try {
                const file = await getFileContent({ repo, path, token });
                if (!file.text) return null;
                const { text, truncated } = truncate(file.text.trim(), excerptChars);
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
