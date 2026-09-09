import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractCallerToken } from '../lib/auth.js';

function mockReq(authorizationHeader) {
    return { headers: authorizationHeader !== undefined ? { authorization: authorizationHeader } : {} };
}

function runMiddleware(authorizationHeader) {
    const req = mockReq(authorizationHeader);
    let nextCalled = false;
    extractCallerToken(req, {}, () => {
        nextCalled = true;
    });
    return { req, nextCalled };
}

describe('extractCallerToken', () => {
    test('never rejects: next() is always called, with or without a header', () => {
        assert.equal(runMiddleware(undefined).nextCalled, true);
        assert.equal(runMiddleware('Bearer abc123').nextCalled, true);
        assert.equal(runMiddleware('garbage, not a bearer header').nextCalled, true);
    });

    test('with no Authorization header, githubToken is undefined (anonymous)', () => {
        const { req } = runMiddleware(undefined);
        assert.equal(req.auth.githubToken, undefined);
        assert.equal(req.auth.clientId, 'anonymous');
    });

    test('extracts the token from a well-formed Bearer header', () => {
        const { req } = runMiddleware('Bearer ghp_abc123def456');
        assert.equal(req.auth.githubToken, 'ghp_abc123def456');
        assert.equal(req.auth.clientId, 'byo-github-token');
    });

    test('is case-insensitive on the "Bearer" scheme', () => {
        const { req } = runMiddleware('bearer some-token-value');
        assert.equal(req.auth.githubToken, 'some-token-value');
    });

    test('trims incidental whitespace around the token', () => {
        const { req } = runMiddleware('Bearer   token-with-leading-spaces  ');
        assert.equal(req.auth.githubToken, 'token-with-leading-spaces');
    });

    test('malformed header (not "Bearer <token>") yields no token, but still proceeds', () => {
        const { req, nextCalled } = runMiddleware('Basic dXNlcjpwYXNz');
        assert.equal(req.auth.githubToken, undefined);
        assert.equal(nextCalled, true);
    });

    test('always attaches a populated expiresAt (the SDK requires one on AuthInfo-shaped objects)', () => {
        const { req } = runMiddleware('Bearer abc');
        assert.equal(typeof req.auth.expiresAt, 'number');
        assert.ok(req.auth.expiresAt > Date.now() / 1000);
    });
});
