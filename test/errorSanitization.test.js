import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubApiError, describeErrorSafely, toolErrorFromError } from '../lib/github.js';

describe('describeErrorSafely', () => {
    test('never leaks the raw message of an unexpected exception to the caller', () => {
        const secretDetail = '/Users/someone/.secret-config token=abc123 at Object.<anonymous> (/app/lib/internal.js:42:7)';
        const err = new TypeError(secretDetail);
        const logged = [];
        const result = describeErrorSafely(err, 'doing something', { log: (...args) => logged.push(args) });

        assert.ok(!result.includes(secretDetail), 'client-facing message must not include the raw error text');
        assert.ok(!result.includes('/Users/'), 'client-facing message must not include filesystem paths');
        assert.match(result, /unexpected internal error/i);
    });

    test('still logs the full error server-side so operators can debug', () => {
        const err = new Error('some internal detail');
        const logged = [];
        describeErrorSafely(err, 'context here', { log: (...args) => logged.push(args) });
        assert.ok(logged.length > 0);
        assert.ok(logged[0].includes(err), 'the full error object should reach the log function');
    });

    test('surfaces the intended message for a 404 GitHubApiError', () => {
        const err = new GitHubApiError('not_found', { status: 404 });
        const result = describeErrorSafely(err, 'looking up foo/bar');
        assert.match(result, /not found on github/i);
    });

    test('surfaces a rate-limit message for a rate-limited GitHubApiError', () => {
        const err = new GitHubApiError('rate_limit', { status: 403, isRateLimit: true, resetAt: new Date(Date.now() + 60_000) });
        const result = describeErrorSafely(err, 'searching');
        assert.match(result, /rate limit/i);
    });

    test('a GitHubApiError message never includes an Authorization header value', () => {
        // GitHubApiError messages only ever come from GitHub's own response body
        // or values this server computed - never from request headers - but
        // assert it directly so a future change that threads headers through
        // would fail this test.
        const err = new GitHubApiError('GitHub API error: HTTP 500 Internal Server Error. some body text', { status: 500 });
        const result = describeErrorSafely(err, 'fetching x');
        assert.ok(!/bearer/i.test(result));
        assert.ok(!/authorization/i.test(result));
    });
});

describe('toolErrorFromError', () => {
    test('returns an isError tool result with the safe text, not the raw error', () => {
        const err = new Error('internal detail: /etc/passwd credentials=xyz');
        const result = toolErrorFromError(err, 'doing X');
        assert.equal(result.isError, true);
        assert.equal(result.content[0].type, 'text');
        assert.ok(!result.content[0].text.includes('/etc/passwd'));
        assert.ok(!result.content[0].text.includes('credentials=xyz'));
    });
});
