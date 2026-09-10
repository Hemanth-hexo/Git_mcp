// Verifies the actual token-priority logic (caller's own token > this
// server's GITHUB_TOKEN > anonymous) without hitting the real network: swaps
// out global fetch for a spy that records the outgoing request and returns a
// canned 200 response.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient, _resetResponseCacheForTest } from '../lib/github.js';

const realFetch = globalThis.fetch;
let lastRequestHeaders;
let fetchCallCount;

function installFetchSpy() {
    fetchCallCount = 0;
    globalThis.fetch = async (_url, init) => {
        fetchCallCount += 1;
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
        // Anonymous/server-token requests are cached (see lib/cache.js);
        // several cases below reuse the same URL with no caller token and
        // expect a fresh fetch each time, so start each case with a clean
        // cache rather than seeing a previous case's cached response.
        _resetResponseCacheForTest();
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

describe('response caching', () => {
    beforeEach(() => {
        installFetchSpy();
        delete process.env.GITHUB_TOKEN;
        _resetResponseCacheForTest();
    });
    afterEach(() => {
        restoreFetch();
        delete process.env.GITHUB_TOKEN;
    });

    test('a second anonymous request to the same URL is served from cache, not a second fetch', async () => {
        const gh = createGitHubClient(undefined);
        await gh.fetch('/repos/foo/bar');
        assert.equal(fetchCallCount, 1);
        await gh.fetch('/repos/foo/bar');
        assert.equal(fetchCallCount, 1, 'second call should be a cache hit, not a new network call');
    });

    test('two different callers bringing their OWN tokens are never cached (each fetches fresh)', async () => {
        const ghA = createGitHubClient('token-a');
        await ghA.fetch('/repos/foo/bar');
        assert.equal(fetchCallCount, 1);

        const ghB = createGitHubClient('token-b');
        await ghB.fetch('/repos/foo/bar');
        assert.equal(fetchCallCount, 2, 'a caller-token request must never be served from cache');
    });

    test('a caller-token request does not pollute the anonymous cache for the same URL', async () => {
        const ghWithToken = createGitHubClient('some-callers-token');
        await ghWithToken.fetch('/repos/foo/bar');
        assert.equal(fetchCallCount, 1);

        const ghAnonymous = createGitHubClient(undefined);
        await ghAnonymous.fetch('/repos/foo/bar');
        assert.equal(fetchCallCount, 2, 'the anonymous request must still fetch fresh, not reuse a token-scoped response');
    });

    test('different URLs never share a cache entry', async () => {
        const gh = createGitHubClient(undefined);
        await gh.fetch('/repos/foo/bar');
        assert.equal(fetchCallCount, 1);
        await gh.fetch('/repos/foo/baz');
        assert.equal(fetchCallCount, 2);
    });

    test('a cached response can be read (json/text) more than once', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            return new Response(JSON.stringify({ hello: 'world' }), { status: 200 });
        };
        const gh = createGitHubClient(undefined);
        const first = await gh.fetch('/repos/foo/bar');
        const second = await gh.fetch('/repos/foo/bar'); // cache hit
        assert.deepEqual(await first.json(), { hello: 'world' });
        assert.deepEqual(await second.json(), { hello: 'world' });
        assert.equal(calls, 1, 'the second read should come from cache, not a new network call');
    });

    test('a cached "not found" (allow404) stays a null result on the second call', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            return new Response('', { status: 404 });
        };
        const gh = createGitHubClient(undefined);
        const first = await gh.fetch('/repos/foo/bar', { allow404: true });
        const second = await gh.fetch('/repos/foo/bar', { allow404: true });
        assert.equal(first, null);
        assert.equal(second, null);
        assert.equal(calls, 1, 'the cached null result should avoid a second network call');
    });
});
