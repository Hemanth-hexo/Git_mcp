// Extracts a manifest's declared dependencies for the ecosystems it's
// practical to parse without pulling in a TOML/YAML library - npm, Composer,
// pip's plain requirements.txt, and Go modules. Any other manifest
// (Cargo.toml, pyproject.toml, Gemfile, pom.xml, build.gradle, Pipfile) is
// reported as `supported: false` rather than guessed at - hand-rolling a
// partial TOML/Gemfile/XML parser is a worse failure mode than plainly
// saying "can't read this one yet".

function parsePackageJson(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return { ecosystem: 'npm', supported: true, dependencies: [] };
    }
    const devNames = new Set(Object.keys(data.devDependencies || {}));
    const entries = [...Object.entries(data.dependencies || {}), ...Object.entries(data.devDependencies || {})];
    return {
        ecosystem: 'npm',
        supported: true,
        dependencies: entries.map(([name, versionRange]) => ({ name, versionRange, dev: devNames.has(name) })),
    };
}

function parseComposerJson(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return { ecosystem: 'composer', supported: true, dependencies: [] };
    }
    const devNames = new Set(Object.keys(data['require-dev'] || {}));
    const entries = [
        ...Object.entries(data.require || {}).filter(([name]) => name !== 'php'),
        ...Object.entries(data['require-dev'] || {}),
    ];
    return {
        ecosystem: 'composer',
        supported: true,
        dependencies: entries.map(([name, versionRange]) => ({ name, versionRange, dev: devNames.has(name) })),
    };
}

// One requirement per line, optionally with a version specifier (==, >=,
// ~=, etc), inline comments, and extras (package[extra]). Skips blank
// lines, comments, and non-package lines (-r other.txt, -e ., --index-url
// ...) rather than mis-parsing them as package names.
function parseRequirementsTxt(text) {
    const dependencies = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.split('#')[0].trim();
        if (!line || line.startsWith('-')) continue;
        const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(==|>=|<=|~=|!=|>|<)?\s*([^\s;]*)/.exec(line);
        if (!match) continue;
        const [, name, operator, version] = match;
        dependencies.push({ name, versionRange: operator ? `${operator}${version}` : (version || '*'), dev: false });
    }
    return { ecosystem: 'pip', supported: true, dependencies };
}

// Dependencies live in `require (...)` blocks or single-line
// `require module version`. Indirect (transitive) deps are marked
// "// indirect" - treated like dev deps since they're not something the
// project team chose directly, just something one of their real deps needs.
function parseGoMod(text) {
    const dependencies = [];
    let inBlock = false;
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('require (')) {
            inBlock = true;
            continue;
        }
        if (inBlock && line === ')') {
            inBlock = false;
            continue;
        }
        const body = inBlock ? line : (line.startsWith('require ') ? line.slice('require '.length) : null);
        if (body == null) continue;
        const indirect = /\/\/\s*indirect/.test(body);
        const match = /^(\S+)\s+(\S+)/.exec(body.replace(/\/\/.*$/, '').trim());
        if (!match) continue;
        dependencies.push({ name: match[1], versionRange: match[2], dev: indirect });
    }
    return { ecosystem: 'go', supported: true, dependencies };
}

const PARSERS = {
    'package.json': parsePackageJson,
    'composer.json': parseComposerJson,
    'requirements.txt': parseRequirementsTxt,
    'go.mod': parseGoMod,
};

export const SUPPORTED_MANIFESTS = Object.keys(PARSERS);

export function parseDependencies(manifestName, manifestText) {
    const parser = PARSERS[manifestName];
    if (!parser) return { ecosystem: null, supported: false, dependencies: [] };
    return parser(manifestText || '');
}
