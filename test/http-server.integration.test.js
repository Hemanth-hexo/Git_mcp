// End-to-end check of the real server-http.js process: boots it as a child
// process with a known MCP_BEARER_TOKEN and confirms the auth gate actually
// wired up correctly on the real /mcp route, not just in isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server-http.js');
const TEST_TOKEN = 'test-only-secret-do-not-use-in-real-deploys-000';
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
        env: { ...process.env, PORT: String(PORT), MCP_BEARER_TOKEN: TEST_TOKEN, GITHUB_TOKEN: '', PUBLIC_HOST: '' },
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    await waitForServerReady(child);
});

after(() => {
    child?.kill();
});

test('health check root route is reachable without auth', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
});

test('/mcp rejects a request with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
});

test('/mcp rejects the wrong bearer token', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: 'Bearer definitely-the-wrong-token',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 401);
});

test('/mcp accepts the correct bearer token and lists all tools', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${TEST_TOKEN}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    for (const toolName of ['search_github_repos', 'get_repo_overview', 'get_file_content', 'compare_repos']) {
        assert.ok(text.includes(toolName), `expected tools/list to include ${toolName}`);
    }
});
