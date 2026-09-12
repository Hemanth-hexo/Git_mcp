import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkVulnerabilities } from '../lib/osv.js';

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('checkVulnerabilities', () => {
    test('returns only the packages that actually have recorded vulnerabilities', async () => {
        let capturedBody;
        globalThis.fetch = async (url, init) => {
            assert.equal(String(url), 'https://api.osv.dev/v1/querybatch');
            capturedBody = JSON.parse(init.body);
            return new Response(JSON.stringify({
                results: [
                    { vulns: [{ id: 'GHSA-xxxx-yyyy-zzzz', modified: '2024-01-01T00:00:00Z' }] },
                    { vulns: [] },
                ],
            }), { status: 200 });
        };
        const deps = [{ name: 'vulnerable-pkg', versionRange: '^1.0.0', dev: false }, { name: 'clean-pkg', versionRange: '^2.0.0', dev: false }];
        const result = await checkVulnerabilities(deps, 'npm');
        assert.equal(result.length, 1);
        assert.equal(result[0].name, 'vulnerable-pkg');
        assert.deepEqual(result[0].vulnerabilityIds, ['GHSA-xxxx-yyyy-zzzz']);
        assert.equal(capturedBody.queries[0].package.ecosystem, 'npm');
    });

    test('maps this project\'s ecosystem names to OSV\'s own identifiers', async () => {
        const seenEcosystems = [];
        globalThis.fetch = async (url, init) => {
            seenEcosystems.push(JSON.parse(init.body).queries[0].package.ecosystem);
            return new Response(JSON.stringify({ results: [{ vulns: [] }] }), { status: 200 });
        };
        await checkVulnerabilities([{ name: 'x', versionRange: '1', dev: false }], 'pip');
        await checkVulnerabilities([{ name: 'x', versionRange: '1', dev: false }], 'go');
        await checkVulnerabilities([{ name: 'x', versionRange: '1', dev: false }], 'composer');
        assert.deepEqual(seenEcosystems, ['PyPI', 'Go', 'Packagist']);
    });

    test('returns an empty list for an unsupported ecosystem or no dependencies, without calling fetch', async () => {
        let called = false;
        globalThis.fetch = async () => { called = true; return new Response('{}'); };
        assert.deepEqual(await checkVulnerabilities([{ name: 'x', versionRange: '1', dev: false }], 'cargo'), []);
        assert.deepEqual(await checkVulnerabilities([], 'npm'), []);
        assert.equal(called, false);
    });

    test('degrades to an empty list on a network failure, HTTP error, or malformed response - never throws', async () => {
        const deps = [{ name: 'x', versionRange: '1', dev: false }];

        globalThis.fetch = async () => { throw new Error('network down'); };
        assert.deepEqual(await checkVulnerabilities(deps, 'npm'), []);

        globalThis.fetch = async () => new Response('', { status: 500 });
        assert.deepEqual(await checkVulnerabilities(deps, 'npm'), []);

        globalThis.fetch = async () => new Response('not json', { status: 200 });
        assert.deepEqual(await checkVulnerabilities(deps, 'npm'), []);
    });

    test('caps how many packages are checked and prioritizes non-dev dependencies', async () => {
        let queryCount = 0;
        let sawDevPackage = false;
        globalThis.fetch = async (url, init) => {
            const queries = JSON.parse(init.body).queries;
            queryCount = queries.length;
            sawDevPackage = queries.some((q) => q.package.name === 'dev-pkg-0');
            return new Response(JSON.stringify({ results: queries.map(() => ({ vulns: [] })) }), { status: 200 });
        };
        const many = Array.from({ length: 40 }, (_, i) => ({ name: `direct-pkg-${i}`, versionRange: '1', dev: false }));
        many.push({ name: 'dev-pkg-0', versionRange: '1', dev: true });
        await checkVulnerabilities(many, 'npm');
        assert.ok(queryCount <= 25, `expected the batch to be capped, got ${queryCount}`);
        assert.equal(sawDevPackage, false, 'a dev dependency should be deprioritized out of a capped, mostly-direct-deps batch');
    });
});
