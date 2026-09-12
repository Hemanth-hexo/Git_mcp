// End-to-end check of the real server-http.js process: boots it as a child
// process and confirms /mcp is genuinely open (no token required to use it)
// while still accepting an optional caller-supplied token without error.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server-http.js');
const PORT = 34519;
const baseUrl = `http://127.0.0.1:${PORT}`;

let child;

function waitForServerReady(proc, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error(`server did not start in time. Output so far: ${output}`)), timeoutMs);
        proc.stderr.on('data', (chunk) => {
            output += chunk.toString();
            if (output.includes('listening on')) {
                clearTimeout(timer);
                resolve();
            }
        });
        proc.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`server exited early with code ${code}. Output: ${output}`));
        });
    });
}

before(async () => {
    child = spawn(process.execPath, [SERVER_PATH], {
        env: { ...process.env, PORT: String(PORT), GITHUB_TOKEN: '', PUBLIC_HOST: '' },
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    await waitForServerReady(child);
});

after(() => {
    child?.kill();
});

test('health check root route is reachable', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
});

test('/mcp works with NO Authorization header at all (public, no gate)', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const toolName of ['search_github_repos', 'get_repo_overview', 'get_file_content', 'compare_repos', 'check_license_and_dependencies']) {
        assert.ok(text.includes(toolName), `expected tools/list to include ${toolName}`);
    }
});

test('/mcp also works with an Authorization header present (a caller bringing their own GitHub token)', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: 'Bearer some-github-personal-access-token',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('search_github_repos'));
});

test('/mcp does not reject a malformed Authorization header either (never blocks the request)', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: 'not-a-bearer-header-at-all',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 200);
});
