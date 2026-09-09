// Verifies the actual token-priority logic (caller's own token > this
// server's GITHUB_TOKEN > anonymous) without hitting the real network: swaps
// out global fetch for a spy that records the outgoing request and returns a
// canned 200 response.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../lib/github.js';

const realFetch = globalThis.fetch;
let lastRequestHeaders;

function installFetchSpy() {
    globalThis.fetch = async (_url, init) => {
        lastRequestHeaders = init?.headers ?? {};
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
}

function restoreFetch() {
    globalThis.fetch = realFetch;
}

describe('createGitHubClient token priority', () => {
    beforeEach(() => {
        installFetchSpy();
        delete process.env.GITHUB_TOKEN;
    });
    afterEach(() => {
        restoreFetch();
        delete process.env.GITHUB_TOKEN;
    });

    test('with no caller token and no server GITHUB_TOKEN, sends no Authorization header (anonymous)', async () => {
        const gh = createGitHubClient(undefined);
        await gh.fetch('/repos/foo/bar');
        assert.equal(lastRequestHeaders.Authorization, undefined);
    });

    test('with only a server GITHUB_TOKEN set, uses it', async () => {
        process.env.GITHUB_TOKEN = 'server-side-token';
        const gh = createGitHubClient(undefined);
        await gh.fetch('/repos/foo/bar');
        assert.equal(lastRequestHeaders.Authorization, 'Bearer server-side-token');
    });

    test('with only a caller token, uses it', async () => {
        const gh = createGitHubClient('callers-own-token');
        await gh.fetch('/repos/foo/bar');
        assert.equal(lastRequestHeaders.Authorization, 'Bearer callers-own-token');
    });

    test('when both are set, the caller-supplied token wins over the server token', async () => {
        process.env.GITHUB_TOKEN = 'server-side-token';
        const gh = createGitHubClient('callers-own-token');
        await gh.fetch('/repos/foo/bar');
        assert.equal(lastRequestHeaders.Authorization, 'Bearer callers-own-token');
    });

    test('a request never carries the same token for two different clients (no cross-caller leakage)', async () => {
        const ghA = createGitHubClient('token-for-caller-a');
        await ghA.fetch('/repos/foo/bar');
        assert.equal(lastRequestHeaders.Authorization, 'Bearer token-for-caller-a');

        const ghB = createGitHubClient('token-for-caller-b');
        await ghB.fetch('/repos/foo/bar');
        assert.equal(lastRequestHeaders.Authorization, 'Bearer token-for-caller-b');
    });
});
