// Core repo-inspection logic, shared by the MCP tools (tools/inspect.js) and
// the REST API (routes/api.js). Returns plain data plus outcome flags
// (notFound, isFile, binaryDetected, etc.) for the "this isn't really an
// error, just a different case" branches — never MCP's {content, isError}
// shape or any HTTP-specific concern, and never pre-truncated (truncation
// policy differs per caller). Throws GitHubApiError/Error on real failures.
import { githubFetch, isAllowedDownloadUrl, approximateContributorCount } from '../lib/github.js';
import { parseRepoRef } from '../lib/format.js';

export const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'webp', 'bmp', 'pdf',
    'zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'woff', 'woff2', 'ttf', 'eot', 'otf',
    'mp3', 'mp4', 'mov', 'avi', 'wav', 'exe', 'dll', 'so', 'dylib',
    'class', 'jar', 'wasm', 'db', 'sqlite', 'pyc', 'o', 'a', 'bin',
]);

export function looksBinary(buffer) {
    const sampleLen = Math.min(buffer.length, 8000);
    if (sampleLen === 0) return false;
    let suspicious = 0;
    for (let i = 0; i < sampleLen; i++) {
        const byte = buffer[i];
        if (byte === 0) return true;
        if (byte < 7 || (byte > 14 && byte < 32 && byte !== 27)) suspicious++;
    }
    return suspicious / sampleLen > 0.3;
}

export async function getRepoOverview({ repo, token } = {}) {
    const { owner, name } = parseRepoRef(repo);

    const res = await githubFetch(`/repos/${owner}/${name}`, { token });
    const info = await res.json();

    const [languages, release, readme, contributorCount] = await Promise.all([
        githubFetch(`/repos/${owner}/${name}/languages`, { token }).then((r) => r.json()).catch(() => null),
        githubFetch(`/repos/${owner}/${name}/releases/latest`, { allow404: true, token }).then((r) => (r ? r.json() : null)).catch(() => null),
        githubFetch(`/repos/${owner}/${name}/readme`, { accept: 'application/vnd.github.raw+json', allow404: true, token })
            .then((r) => (r ? r.text() : null))
            .catch(() => null),
        approximateContributorCount(owner, name, token),
    ]);

    return { owner, name, info, languages, release, readme, contributorCount };
}

export async function getRepoStructure({ repo, path, token } = {}) {
    const { owner, name } = parseRepoRef(repo);
    const cleanPath = (path ?? '').trim().replace(/^\/+|\/+$/g, '');

    const res = await githubFetch(`/repos/${owner}/${name}/contents/${cleanPath}`, { allow404: true, token });
    if (!res) return { owner, name, path: cleanPath, notFound: true };

    const data = await res.json();
    if (!Array.isArray(data)) return { owner, name, path: cleanPath, isFile: true };

    const entries = [...data].sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    return { owner, name, path: cleanPath, entries };
}

export async function getFileContent({ repo, path, token } = {}) {
    const { owner, name } = parseRepoRef(repo);
    const cleanPath = path.trim().replace(/^\/+/, '');
    const ext = cleanPath.includes('.') ? cleanPath.split('.').pop().toLowerCase() : '';

    if (BINARY_EXTENSIONS.has(ext)) {
        return { owner, name, path: cleanPath, binaryByExtension: true, ext, htmlUrl: `https://github.com/${owner}/${name}/blob/HEAD/${cleanPath}` };
    }

    const res = await githubFetch(`/repos/${owner}/${name}/contents/${cleanPath}`, { allow404: true, token });
    if (!res) return { owner, name, path: cleanPath, notFound: true };

    const data = await res.json();
    if (Array.isArray(data)) return { owner, name, path: cleanPath, isDirectory: true };

    let text;
    if (typeof data.content === 'string' && data.encoding === 'base64') {
        const buf = Buffer.from(data.content, 'base64');
        if (looksBinary(buf)) {
            return { owner, name, path: cleanPath, binaryDetected: true, size: data.size, htmlUrl: data.html_url };
        }
        text = buf.toString('utf8');
    } else if (data.download_url) {
        if (!isAllowedDownloadUrl(data.download_url)) {
            return { owner, name, path: cleanPath, downloadRefused: true, htmlUrl: data.html_url };
        }
        const rawRes = await fetch(data.download_url, { headers: { 'User-Agent': 'gitty-mcp/1.0' } });
        if (!rawRes.ok) throw new Error(`Could not download large file (HTTP ${rawRes.status}).`);
        text = await rawRes.text();
    } else {
        return { owner, name, path: cleanPath, unexpectedShape: true };
    }

    return { owner, name, path: cleanPath, text, size: data.size ?? text.length };
}

export async function getRecentCommits({ repo, branch, limit = 10, token } = {}) {
    const { owner, name } = parseRepoRef(repo);
    const res = await githubFetch(`/repos/${owner}/${name}/commits`, { searchParams: { sha: branch, per_page: limit }, token });
    const commits = await res.json();
    return { owner, name, branch, commits };
}

export async function listBranches({ repo, limit = 20, token } = {}) {
    const { owner, name } = parseRepoRef(repo);
    const [branchesRes, repoRes] = await Promise.all([
        githubFetch(`/repos/${owner}/${name}/branches`, { searchParams: { per_page: limit }, token }),
        githubFetch(`/repos/${owner}/${name}`, { token }),
    ]);
    const branches = await branchesRes.json();
    const info = await repoRes.json();
    return { owner, name, branches, defaultBranch: info.default_branch };
}
