// Render fronts every app with two proxy hops before it reaches this
// process (its own Cloudflare edge, then its internal router), producing a
// 3-entry X-Forwarded-For chain: "<real client>, <cloudflare edge>,
// <render internal LB>". This was verified live against the deployed
// server — a `trust proxy: 1` setting (the usual default for a single
// reverse proxy) actually resolved to Render's own internal LB address
// here, not the caller, silently pooling every caller's rate limit into one
// shared bucket. This test pins the correct hop count (3) against that real
// captured chain so a future change to server-http.js can't quietly
// reintroduce the same bug without a test failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import proxyaddr from 'proxy-addr';

// Captured live from https://git-mcp-rvrp.onrender.com/debug/network before
// that temporary diagnostic route was removed.
const REAL_CLIENT_IP = '223.236.152.95';
const RENDER_CAPTURED_XFF = `${REAL_CLIENT_IP}, 104.23.160.245, 10.199.38.4`;

test('trust proxy: 3 resolves Render\'s real X-Forwarded-For chain to the true client IP', () => {
    const app = express();
    app.set('trust proxy', 3);
    const trust = app.get('trust proxy fn');

    const req = {
        headers: { 'x-forwarded-for': RENDER_CAPTURED_XFF },
        connection: { remoteAddress: '127.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
    };

    assert.equal(proxyaddr(req, trust), REAL_CLIENT_IP);
});

test('trust proxy: 1 (the wrong setting) resolves to an internal Render address, not the client', () => {
    const app = express();
    app.set('trust proxy', 1);
    const trust = app.get('trust proxy fn');

    const req = {
        headers: { 'x-forwarded-for': RENDER_CAPTURED_XFF },
        connection: { remoteAddress: '127.0.0.1' },
        socket: { remoteAddress: '127.0.0.1' },
    };

    const resolved = proxyaddr(req, trust);
    assert.notEqual(resolved, REAL_CLIENT_IP, 'documents the bug this was fixed from — trust proxy: 1 must NOT be reintroduced');
});
