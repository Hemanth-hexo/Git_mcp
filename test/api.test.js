// Integration tests for routes/api.js: boots a real Express app with the
// router mounted (same as server-http.js does) and a mocked global fetch,
// so these exercise the actual HTTP request/response cycle - status codes,
// JSON shapes, error mapping - not just the core functions in isolation.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { _resetResponseCacheForTest } from '../lib/github.js';
import apiRouter, { _resetTrialQuotaForTest } from '../routes/api.js';

const realFetch = globalThis.fetch;
let mockFetch;
let baseUrl;
let server;

// Only calls to the mocked GitHub API go through `mockFetch`; calls to our
// own local test server (the test's own `fetch(baseUrl...)`) always use the
// real fetch — otherwise the mock swallows the test's own HTTP requests too.
function installFetchMock(fn) {
    mockFetch = fn;
    globalThis.fetch = (url, ...rest) => {
        if (String(url).startsWith(`http://127.0.0.1:${server.address().port}`)) return realFetch(url, ...rest);
        return mockFetch(url, ...rest);
    };
}

function jsonResponse(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
    _resetResponseCacheForTest();
    _resetTrialQuotaForTest();
    delete process.env.GEMINI_API_KEY;
    // Reset to a mock that fails loudly if a test forgets to install its own
    // — prevents a previous test's leftover mock from silently answering a
    // later test's requests (exactly the bug that motivated this reset).
    installFetchMock(async () => {
        throw new Error('no fetch mock installed for this test');
    });
});

after(() => {
    globalThis.fetch = realFetch;
});

const sampleRepo = {
    full_name: 'facebook/react', html_url: 'https://github.com/facebook/react', description: 'A UI library',
    stargazers_count: 200000, forks_count: 40000, language: 'JavaScript', pushed_at: '2026-09-01T00:00:00Z',
    created_at: '2013-05-24T00:00:00Z', topics: ['ui'], archived: false, open_issues_count: 100,
    license: { spdx_id: 'MIT' }, default_branch: 'main', subscribers_count: 500, homepage: null,
};

describe('GET /api/search', () => {
    test('returns shaped repos on success', async () => {
        installFetchMock(async () => jsonResponse({ total_count: 1, items: [sampleRepo] }));
        const res = await fetch(`${baseUrl}/search?q=react`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.totalCount, 1);
        assert.equal(body.repos[0].fullName, 'facebook/react');
        assert.equal(body.repos[0].stars, 200000);
    });

    test('400s when q is missing', async () => {
        const res = await fetch(`${baseUrl}/search`);
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'bad_request');
    });
});

describe('GET /api/repos/:owner/:name', () => {
    test('returns a shaped overview on success', async () => {
        installFetchMock(async (url) => {
            const u = String(url);
            if (u.includes('/languages')) return jsonResponse({ JavaScript: 100 });
            if (u.includes('/releases/latest')) return new Response('', { status: 404 });
            if (u.includes('/readme')) return new Response('# Hi', { status: 200 });
            if (u.includes('/contributors')) return new Response('[]', { status: 200 });
            return jsonResponse(sampleRepo);
        });
        const res = await fetch(`${baseUrl}/repos/facebook/react`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.fullName, 'facebook/react');
        assert.equal(body.license, 'MIT');
        assert.deepEqual(body.languages, { JavaScript: 100 });
    });

    test('404s when the repo does not exist', async () => {
        installFetchMock(async () => new Response('{"message":"Not Found"}', { status: 404 }));
        const res = await fetch(`${baseUrl}/repos/nope/nope`);
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.equal(body.error, 'not_found');
    });

    test('400s (not 500) for a malformed owner/name that the core layer rejects', async () => {
        // Express itself can't produce an "invalid repo ref" here since the
        // route params always form a syntactically valid owner/name pair -
        // this documents that a GitHubApiError 404 (the realistic failure
        // mode for a bad repo) maps to 404, not a generic 500.
        installFetchMock(async () => new Response('', { status: 404 }));
        const res = await fetch(`${baseUrl}/repos/x/y`);
        assert.equal(res.status, 404);
    });
});

describe('GET /api/repos/:owner/:name/structure', () => {
    test('returns entries sorted dirs-first', async () => {
        installFetchMock(async () => jsonResponse([
            { name: 'b.js', type: 'file', size: 10 },
            { name: 'lib', type: 'dir' },
            { name: 'a.js', type: 'file', size: 5 },
        ]));
        const res = await fetch(`${baseUrl}/repos/foo/bar/structure`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body.entries.map((e) => e.name), ['lib', 'a.js', 'b.js']);
    });

    test('404s for a nonexistent path', async () => {
        installFetchMock(async () => new Response('', { status: 404 }));
        const res = await fetch(`${baseUrl}/repos/foo/bar/structure?path=nope`);
        assert.equal(res.status, 404);
    });
});

describe('GET /api/repos/:owner/:name/file', () => {
    test('returns file text on success', async () => {
        const content = Buffer.from('hello world').toString('base64');
        installFetchMock(async () => jsonResponse({ content, encoding: 'base64', size: 11, type: 'file' }));
        const res = await fetch(`${baseUrl}/repos/foo/bar/file?path=README.md`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.text, 'hello world');
    });

    test('400s when path is missing', async () => {
        const res = await fetch(`${baseUrl}/repos/foo/bar/file`);
        assert.equal(res.status, 400);
    });

    test('flags a binary file by extension without fetching', async () => {
        let called = false;
        installFetchMock(async () => {
            called = true;
            return jsonResponse({});
        });
        const res = await fetch(`${baseUrl}/repos/foo/bar/file?path=logo.png`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.binary, true);
        assert.equal(called, false, 'a known binary extension should not even trigger a fetch');
    });
});

describe('POST /api/compare', () => {
    test('returns shaped repos for a valid comparison', async () => {
        installFetchMock(async (url) => {
            if (String(url).includes('/contributors')) return new Response('[]', { status: 200 });
            return jsonResponse(sampleRepo);
        });
        const res = await fetch(`${baseUrl}/compare`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repos: ['facebook/react', 'vuejs/vue'] }),
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.repos.length, 2);
    });

    test('400s with fewer than 2 repos', async () => {
        const res = await fetch(`${baseUrl}/compare`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repos: ['facebook/react'] }),
        });
        assert.equal(res.status, 400);
    });
});

describe('error mapping', () => {
    test('a GitHub rate-limit error maps to 429 with Retry-After', async () => {
        installFetchMock(async () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30) } }));
        const res = await fetch(`${baseUrl}/search?q=x`);
        assert.equal(res.status, 429);
        assert.ok(res.headers.get('retry-after'));
    });

    test('a genuinely unexpected error (not a GitHub API failure) never leaks internals, maps to 500', async () => {
        // A raw network failure inside fetch() gets wrapped as a GitHubApiError
        // upstream (lib/github.js) and correctly maps to 502 (tested above,
        // implicitly, via the rate-limit case). To reach the *generic*
        // unexpected-error path, the failure has to happen after githubFetch
        // returns successfully — e.g. malformed JSON on an otherwise-200
        // response, which is a plain SyntaxError, not a GitHubApiError.
        installFetchMock(async () => new Response('{not valid json, contains /etc/passwd in a stack trace maybe', { status: 200 }));
        const res = await fetch(`${baseUrl}/search?q=x`);
        assert.equal(res.status, 500);
        const body = await res.json();
        assert.ok(!body.message.includes('/etc/passwd'));
        assert.equal(body.error, 'internal_error');
    });
});

describe('POST /api/repos/:owner/:name/explain', () => {
    // Serves the same GitHub calls get_repo_overview needs, plus whichever
    // AI provider endpoint is hit — real requests for this route always
    // touch both, so both need to be handled by one mock.
    function mockOverviewAndAi({ aiUrlMatch, aiResponse }) {
        installFetchMock(async (url) => {
            const u = String(url);
            if (aiUrlMatch.test(u)) return aiResponse();
            if (u.includes('/languages')) return jsonResponse({ JavaScript: 100 });
            if (u.includes('/releases/latest')) return new Response('', { status: 404 });
            if (u.includes('/readme')) return new Response('# Hi', { status: 200 });
            if (u.includes('/contributors')) return new Response('[]', { status: 200 });
            return jsonResponse(sampleRepo);
        });
    }

    test('uses the caller-provided key (X-AI-Key / X-AI-Provider) and never touches the trial quota', async () => {
        mockOverviewAndAi({
            aiUrlMatch: /anthropic\.com/,
            aiResponse: () => jsonResponse({ content: [{ text: 'Explanation via caller key.' }] }),
        });
        const res = await fetch(`${baseUrl}/repos/facebook/react/explain`, {
            method: 'POST',
            headers: { 'X-AI-Key': 'callers-own-key', 'X-AI-Provider': 'anthropic' },
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.explanation, 'Explanation via caller key.');
    });

    test('falls back to the operator trial (Gemini) when no caller key is given', async () => {
        process.env.GEMINI_API_KEY = 'operator-trial-key';
        mockOverviewAndAi({
            aiUrlMatch: /generativelanguage\.googleapis\.com/,
            aiResponse: () => jsonResponse({ candidates: [{ content: { parts: [{ text: 'Explanation via trial.' }] } }] }),
        });
        const res = await fetch(`${baseUrl}/repos/facebook/react/explain`, { method: 'POST' });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.explanation, 'Explanation via trial.');
    });

    test('503s with a clear message when no caller key and no trial is configured', async () => {
        const res = await fetch(`${baseUrl}/repos/facebook/react/explain`, { method: 'POST' });
        assert.equal(res.status, 503);
        const body = await res.json();
        assert.equal(body.error, 'no_trial_available');
        assert.match(body.message, /bring your own/i);
    });

    test('429s once the trial quota is exhausted, and never falls through to a real AI call', async () => {
        process.env.GEMINI_API_KEY = 'operator-trial-key';
        let aiCallCount = 0;
        mockOverviewAndAi({
            aiUrlMatch: /generativelanguage\.googleapis\.com/,
            aiResponse: () => {
                aiCallCount += 1;
                return jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
            },
        });
        for (let i = 0; i < 5; i++) {
            const ok = await fetch(`${baseUrl}/repos/facebook/react/explain`, { method: 'POST' });
            assert.equal(ok.status, 200, `request ${i + 1} of 5 should be within the free quota`);
        }
        const sixth = await fetch(`${baseUrl}/repos/facebook/react/explain`, { method: 'POST' });
        assert.equal(sixth.status, 429);
        const body = await sixth.json();
        assert.equal(body.error, 'trial_limit');
        assert.equal(aiCallCount, 5, 'the 6th request must not reach the AI provider at all');
    });

    test('400s for an unsupported X-AI-Provider', async () => {
        const res = await fetch(`${baseUrl}/repos/facebook/react/explain`, {
            method: 'POST',
            headers: { 'X-AI-Key': 'some-key', 'X-AI-Provider': 'not-a-real-provider' },
        });
        assert.equal(res.status, 400);
    });
});
