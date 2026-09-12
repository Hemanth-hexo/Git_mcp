// Thin wrapper over OSV.dev's public, unauthenticated vulnerability database
// (https://osv.dev) - checks a batch of dependencies for any recorded
// vulnerabilities. Queried by package name only, with no version: a
// manifest without a lockfile only declares a version RANGE ("^5.0.0"), and
// guessing a single exact version out of that range to check would be more
// misleading than useful. So results here mean "this package has N known
// vulnerabilities somewhere in its history", not "your exact pinned version
// is vulnerable" - real signal (a package with a long CVE history is worth
// scrutiny), just not version-precise. Best effort only: any failure here
// (network, OSV downtime, unexpected response shape) degrades to "no
// vulnerability data available" rather than failing the whole radar.
const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
// OSV's own ecosystem identifiers (case-sensitive, verified against the OSV
// schema docs) - not the same strings this project's own dependencyParser.js
// uses for its `ecosystem` field, hence the mapping.
const ECOSYSTEM_MAP = { npm: 'npm', pip: 'PyPI', go: 'Go', composer: 'Packagist' };
const MAX_PACKAGES_CHECKED = 25;

export const SUPPORTED_VULN_ECOSYSTEMS = Object.keys(ECOSYSTEM_MAP);

export async function checkVulnerabilities(dependencies, ecosystem) {
    const osvEcosystem = ECOSYSTEM_MAP[ecosystem];
    if (!osvEcosystem || dependencies.length === 0) return [];

    // Direct (non-dev) dependencies first - what actually ships/runs is a
    // higher-value signal than a lint tool's own dependency tree, and the
    // check is capped to keep one radar request fast against a free,
    // unauthenticated public API.
    const sample = [...dependencies].sort((a, b) => Number(a.dev) - Number(b.dev)).slice(0, MAX_PACKAGES_CHECKED);

    let res;
    try {
        res = await fetch(OSV_BATCH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queries: sample.map((d) => ({ package: { name: d.name, ecosystem: osvEcosystem } })) }),
        });
    } catch {
        return [];
    }
    if (!res.ok) return [];

    let data;
    try {
        data = await res.json();
    } catch {
        return [];
    }
    const results = Array.isArray(data.results) ? data.results : [];
    return sample
        .map((dep, i) => ({ name: dep.name, versionRange: dep.versionRange, vulnerabilityIds: (results[i]?.vulns || []).map((v) => v.id) }))
        .filter((d) => d.vulnerabilityIds.length > 0);
}
