import * as z from 'zod/v4';
import { toolErrorFromError } from '../lib/github.js';
import { getDependencyRadar } from '../core/depRadar.js';

function callerToken(ctx) {
    return ctx?.http?.authInfo?.githubToken;
}

const CATEGORY_LABEL = {
    permissive: 'Permissive',
    'weak-copyleft': 'Weak copyleft',
    copyleft: 'Copyleft',
    none: 'No license',
    unknown: 'Unrecognized',
};

function formatRadar(radar) {
    const lines = [`License & dependency radar for ${radar.repo}`, ''];

    lines.push(`License: ${radar.license.id ?? 'none declared'} (${CATEGORY_LABEL[radar.license.category]})`);
    lines.push(radar.license.note);
    lines.push('');

    if (!radar.manifest) {
        lines.push('Dependencies: no recognizable manifest file found at the repo root.');
    } else if (!radar.dependencies.supported) {
        lines.push(`Dependencies: found "${radar.manifest}", but this tool doesn't parse that manifest format yet.`);
    } else {
        lines.push(`Dependencies: ${radar.dependencies.total} declared in ${radar.manifest} (${radar.dependencies.direct} direct, ${radar.dependencies.total - radar.dependencies.direct} dev/indirect).`);
        if (radar.vulnerablePackages.length) {
            lines.push('', `⚠ ${radar.vulnerablePackages.length} package(s) with a known-vulnerability history (via osv.dev, checked by package name across all versions - not necessarily your exact pinned version):`);
            for (const pkg of radar.vulnerablePackages) {
                lines.push(`  - ${pkg.name} (${pkg.versionRange}): ${pkg.vulnerabilityIds.join(', ')}`);
            }
        } else {
            lines.push('No known vulnerabilities found for the checked dependencies (via osv.dev - a best-effort check, not a guarantee).');
        }
    }

    lines.push('', 'Maintenance health:');
    lines.push(`  - Archived: ${radar.health.archived ? 'yes' : 'no'}`);
    if (radar.health.possiblyAbandoned) lines.push(`  - Not formally archived, but no push in ${radar.health.daysSinceLastPush} days - worth checking activity before relying on it.`);
    lines.push(`  - Open issues: ${radar.health.openIssues}`);
    if (radar.health.contributorCount != null) lines.push(`  - Contributors: ~${radar.health.contributorCount}`);

    return lines.join('\n');
}

export function registerDepRadarTools(server) {
    server.registerTool(
        'check_license_and_dependencies',
        {
            description:
                "\"Can I use this?\" - a fast, deterministic check (no AI) of a repo's license (with a plain-English " +
                "compatibility note), its declared dependencies (parsed from package.json, composer.json, " +
                "requirements.txt, or go.mod - other manifest formats aren't parsed yet), a best-effort known-" +
                "vulnerability check against osv.dev, and maintenance-health signals (archived status, staleness, " +
                "open issues). Not legal advice - a starting point for a decision, not a substitute for reading the " +
                "actual license text.",
            inputSchema: z.object({
                repo: z.string().min(1).describe("Repo as 'owner/name' (e.g. 'facebook/react') or a GitHub URL."),
            }),
        },
        async ({ repo }, ctx) => {
            try {
                const radar = await getDependencyRadar({ repo, githubToken: callerToken(ctx) });
                return { content: [{ type: 'text', text: formatRadar(radar) }] };
            } catch (err) {
                return toolErrorFromError(err, `checking license/dependencies for ${repo}`);
            }
        }
    );
}
