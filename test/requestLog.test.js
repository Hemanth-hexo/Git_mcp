import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestLogger } from '../lib/requestLog.js';

describe('createRequestLogger', () => {
    test('logs the method and tool name for a tools/call request, and calls next()', () => {
        const logs = [];
        const logger = createRequestLogger({ log: (msg) => logs.push(msg) });
        const req = {
            ip: '1.2.3.4',
            auth: { githubToken: undefined },
            body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_github_repos', arguments: { query: 'secret query text' } } },
        };
        let nextCalled = false;
        logger(req, {}, () => (nextCalled = true));

        assert.equal(nextCalled, true);
        assert.equal(logs.length, 1);
        assert.match(logs[0], /method=tools\/call/);
        assert.match(logs[0], /tool=search_github_repos/);
        assert.match(logs[0], /ip=1\.2\.3\.4/);
    });

    test('never logs tool arguments or query content', () => {
        const logs = [];
        const logger = createRequestLogger({ log: (msg) => logs.push(msg) });
        const req = {
            ip: '1.2.3.4',
            auth: {},
            body: { method: 'tools/call', params: { name: 'get_file_content', arguments: { repo: 'owner/name', path: 'super/secret/path.txt' } } },
        };
        logger(req, {}, () => {});
        assert.ok(!logs[0].includes('super/secret/path.txt'));
        assert.ok(!logs[0].includes('owner/name'));
    });

    test('never logs a caller-supplied token, only whether one was present', () => {
        const logs = [];
        const logger = createRequestLogger({ log: (msg) => logs.push(msg) });
        const req = {
            ip: '1.2.3.4',
            auth: { githubToken: 'ghp_super_secret_value_should_not_appear' },
            body: { method: 'tools/list' },
        };
        logger(req, {}, () => {});
        assert.ok(!logs[0].includes('ghp_super_secret_value_should_not_appear'));
        assert.match(logs[0], /byo_token=true/);
    });

    test('reports byo_token=false when no token is present', () => {
        const logs = [];
        const logger = createRequestLogger({ log: (msg) => logs.push(msg) });
        const req = { ip: '1.2.3.4', auth: {}, body: { method: 'tools/list' } };
        logger(req, {}, () => {});
        assert.match(logs[0], /byo_token=false/);
    });

    test('does not throw when body or auth is missing', () => {
        const logger = createRequestLogger({ log: () => {} });
        assert.doesNotThrow(() => logger({ ip: '1.2.3.4' }, {}, () => {}));
    });
});
