import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuthGate, isValidToken } from '../lib/auth.js';

const REAL_TOKEN = 'a-real-secret-value-123456789';

function withServer(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                baseUrl: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(r)),
            });
        });
        server.on('error', reject);
    });
}

describe('isValidToken', () => {
    test('rejects when no expected token is configured (fail closed)', () => {
        assert.equal(isValidToken('anything', undefined), false);
        assert.equal(isValidToken('anything', ''), false);
    });

    test('rejects when no token is provided', () => {
        assert.equal(isValidToken(undefined, REAL_TOKEN), false);
        assert.equal(isValidToken('', REAL_TOKEN), false);
    });

    test('rejects a wrong token', () => {
        assert.equal(isValidToken('wrong-token', REAL_TOKEN), false);
    });

    test('rejects a different-length token without throwing', () => {
        assert.doesNotThrow(() => isValidToken('short', REAL_TOKEN));
        assert.equal(isValidToken('short', REAL_TOKEN), false);
    });

    test('accepts an exact match', () => {
        assert.equal(isValidToken(REAL_TOKEN, REAL_TOKEN), true);
    });
});

describe('createAuthGate', () => {
    test('fails closed: every request is rejected when MCP_BEARER_TOKEN is unset', async () => {
        const logs = [];
        const gate = createAuthGate({ env: {}, log: (msg) => logs.push(msg) });
        const app = express();
        app.get('/protected', gate, (req, res) => res.json({ ok: true }));
        const { baseUrl, close } = await withServer(app);
        try {
            const res = await fetch(`${baseUrl}/protected`);
            assert.equal(res.status, 401);
            const res2 = await fetch(`${baseUrl}/protected`, { headers: { Authorization: 'Bearer anything-at-all' } });
            assert.equal(res2.status, 401);
        } finally {
            await close();
        }
        assert.ok(logs.some((m) => m.includes('MCP_BEARER_TOKEN is not set')), 'should log a clear operator-facing warning');
    });

    test('rejects a request with no Authorization header when a token is configured', async () => {
        const gate = createAuthGate({ env: { MCP_BEARER_TOKEN: REAL_TOKEN }, log: () => {} });
        const app = express();
        app.get('/protected', gate, (req, res) => res.json({ ok: true }));
        const { baseUrl, close } = await withServer(app);
        try {
            const res = await fetch(`${baseUrl}/protected`);
            assert.equal(res.status, 401);
        } finally {
            await close();
        }
    });

    test('rejects a request with the wrong token', async () => {
        const gate = createAuthGate({ env: { MCP_BEARER_TOKEN: REAL_TOKEN }, log: () => {} });
        const app = express();
        app.get('/protected', gate, (req, res) => res.json({ ok: true }));
        const { baseUrl, close } = await withServer(app);
        try {
            const res = await fetch(`${baseUrl}/protected`, { headers: { Authorization: 'Bearer wrong-value' } });
            assert.equal(res.status, 401);
        } finally {
            await close();
        }
    });

    test('allows a request with the correct token', async () => {
        const gate = createAuthGate({ env: { MCP_BEARER_TOKEN: REAL_TOKEN }, log: () => {} });
        const app = express();
        app.get('/protected', gate, (req, res) => res.json({ ok: true }));
        const { baseUrl, close } = await withServer(app);
        try {
            const res = await fetch(`${baseUrl}/protected`, { headers: { Authorization: `Bearer ${REAL_TOKEN}` } });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.ok, true);
        } finally {
            await close();
        }
    });
});
