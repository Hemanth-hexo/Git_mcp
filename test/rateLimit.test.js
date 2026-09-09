import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../lib/rateLimit.js';

function mockReqRes(ip) {
    const req = { ip };
    let statusCode = 200;
    let jsonBody;
    const headers = {};
    const res = {
        set: (k, v) => {
            headers[k] = v;
        },
        status: (code) => {
            statusCode = code;
            return res;
        },
        json: (body) => {
            jsonBody = body;
        },
    };
    return { req, res, headers, getStatus: () => statusCode, getBody: () => jsonBody };
}

describe('createRateLimiter', () => {
    test('allows requests under the limit', () => {
        let clock = 0;
        const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: () => clock });
        after(() => limiter.stop());

        for (let i = 0; i < 3; i++) {
            const { req, res, getStatus } = mockReqRes('1.2.3.4');
            let nextCalled = false;
            limiter(req, res, () => (nextCalled = true));
            assert.equal(nextCalled, true, `request ${i + 1} should be allowed`);
            assert.equal(getStatus(), 200);
        }
    });

    test('blocks the request once the limit is exceeded, with a 429 and Retry-After', () => {
        let clock = 0;
        const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: () => clock });
        after(() => limiter.stop());

        for (let i = 0; i < 2; i++) {
            const { req, res } = mockReqRes('5.6.7.8');
            limiter(req, res, () => {});
        }
        const { req, res, headers, getStatus, getBody } = mockReqRes('5.6.7.8');
        let nextCalled = false;
        limiter(req, res, () => (nextCalled = true));
        assert.equal(nextCalled, false, 'the request over the limit must not reach next()');
        assert.equal(getStatus(), 429);
        assert.equal(getBody().error, 'rate_limited');
        assert.ok(headers['Retry-After']);
    });

    test('tracks each caller (by key) independently', () => {
        let clock = 0;
        const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: () => clock });
        after(() => limiter.stop());

        const a1 = mockReqRes('1.1.1.1');
        limiter(a1.req, a1.res, () => {});
        assert.equal(a1.getStatus(), 200);

        // A different caller is not affected by caller A's usage.
        const b1 = mockReqRes('2.2.2.2');
        let bNextCalled = false;
        limiter(b1.req, b1.res, () => (bNextCalled = true));
        assert.equal(bNextCalled, true);

        // Caller A's second request in the same window is blocked.
        const a2 = mockReqRes('1.1.1.1');
        let a2NextCalled = false;
        limiter(a2.req, a2.res, () => (a2NextCalled = true));
        assert.equal(a2NextCalled, false);
    });

    test('resets after the window elapses', () => {
        let clock = 0;
        const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: () => clock });
        after(() => limiter.stop());

        const first = mockReqRes('9.9.9.9');
        limiter(first.req, first.res, () => {});
        assert.equal(first.getStatus(), 200);

        const blocked = mockReqRes('9.9.9.9');
        let blockedNext = false;
        limiter(blocked.req, blocked.res, () => (blockedNext = true));
        assert.equal(blockedNext, false);

        clock += 1001; // advance past the window
        const afterWindow = mockReqRes('9.9.9.9');
        let allowedAgain = false;
        limiter(afterWindow.req, afterWindow.res, () => (allowedAgain = true));
        assert.equal(allowedAgain, true);
    });

    test('falls back to a shared "unknown" bucket when no IP is available, without throwing', () => {
        let clock = 0;
        const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: () => clock });
        after(() => limiter.stop());

        const { req, res, getStatus } = mockReqRes(undefined);
        assert.doesNotThrow(() => limiter(req, res, () => {}));
        assert.equal(getStatus(), 200);
    });
});
