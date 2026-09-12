// "Can I use this?" - a fast, deterministic (no AI) check combining license
// compatibility, a best-effort dependency vulnerability scan, and the
// maintenance-health signals already available from the repo overview.
// Deliberately not an AI explanation: this is meant to be quick, factual,
// and reproducible, not a long write-up - see core/explain.js for the
// narrative version.
import { getRepoOverview, getRepoStructure, getFileContent } from './inspect.js';
import { classifyLicense } from '../lib/licenseInfo.js';
import { parseDependencies, SUPPORTED_MANIFESTS } from '../lib/dependencyParser.js';
import { checkVulnerabilities, SUPPORTED_VULN_ECOSYSTEMS } from '../lib/osv.js';
import { daysSince } from '../lib/format.js';

// A repo untouched for well over a year, with no recent releases, is worth
// flagging as possibly unmaintained even if it isn't formally archived -
// GitHub's own "archived" flag is opt-in and many abandoned projects never
// get it set.
const STALE_DAYS = 365;

// Manifest names recognized but not (yet) parsed by lib/dependencyParser.js -
// surfaced so "found Cargo.toml, can't parse dependencies from it yet" is
// distinguishable from "no manifest at all", even though only
// SUPPORTED_MANIFESTS actually yields a parsed dependency list.
const OTHER_KNOWN_MANIFESTS = new Set(['pyproject.toml', 'Cargo.toml', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'setup.py', 'Pipfile']);

async function findManifest(repo, token) {
    try {
        const root = await getRepoStructure({ repo, path: '', token });
        const entries = root.entries || [];
        // Prefer a manifest this project can actually parse dependencies
        // from, but fall back to any other recognized manifest so the
        // license section (which doesn't need parsing) still gets a data
        // point, and the response can say "found X, can't parse it yet".
        const parsable = entries.find((e) => e.type === 'file' && SUPPORTED_MANIFESTS.includes(e.name));
        if (parsable) return parsable.name;
        return entries.find((e) => e.type === 'file' && OTHER_KNOWN_MANIFESTS.has(e.name))?.name ?? null;
    } catch {
        return null;
    }
}

export async function getDependencyRadar({ repo, githubToken }) {
    const { info, contributorCount } = await getRepoOverview({ repo, token: githubToken });
    const license = classifyLicense(info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : info.license?.name);

    const manifestName = await findManifest(repo, githubToken);
    let dependencies = { ecosystem: null, supported: false, dependencies: [] };
    if (manifestName) {
        try {
            const file = await getFileContent({ repo, path: manifestName, token: githubToken });
            if (file.text) dependencies = parseDependencies(manifestName, file.text);
        } catch {
            // manifest existed but couldn't be read (rate limit, odd shape) -
            // fall through with the "unsupported/empty" default above.
        }
    }

    let vulnerable = [];
    if (dependencies.supported && SUPPORTED_VULN_ECOSYSTEMS.includes(dependencies.ecosystem)) {
        try {
            vulnerable = await checkVulnerabilities(dependencies.dependencies, dependencies.ecosystem);
        } catch {
            vulnerable = [];
        }
    }

    const daysSincePush = daysSince(info.pushed_at);
    const health = {
        archived: Boolean(info.archived),
        possiblyAbandoned: !info.archived && daysSincePush > STALE_DAYS,
        daysSinceLastPush: Math.floor(daysSincePush),
        openIssues: info.open_issues_count,
        contributorCount: contributorCount ?? null,
    };

    return {
        repo: info.full_name,
        license,
        manifest: manifestName,
        dependencies: {
            ecosystem: dependencies.ecosystem,
            supported: dependencies.supported,
            total: dependencies.dependencies.length,
            direct: dependencies.dependencies.filter((d) => !d.dev).length,
        },
        vulnerablePackages: vulnerable,
        health,
    };
}
