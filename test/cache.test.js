import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { createResponseCache } from '../lib/cache.js';

describe('createResponseCache', () => {
    test('a miss reports hit: false', () => {
        const cache = createResponseCache();
        after(() => cache.stop());
        assert.deepEqual(cache.get('missing-key'), { hit: false });
    });

    test('set then get returns the stored value', () => {
        const cache = createResponseCache();
        after(() => cache.stop());
        cache.set('k', { some: 'data' });
        assert.deepEqual(cache.get('k'), { hit: true, value: { some: 'data' } });
    });

    test('distinguishes a cached null value from a true miss', () => {
        const cache = createResponseCache();
        after(() => cache.stop());
        cache.set('was-not-found', null);
        assert.deepEqual(cache.get('was-not-found'), { hit: true, value: null });
        assert.deepEqual(cache.get('never-set'), { hit: false });
    });

    test('an entry expires after its TTL', () => {
        let clock = 0;
        const cache = createResponseCache({ ttlMs: 1000, now: () => clock });
        after(() => cache.stop());
        cache.set('k', 'v');
        assert.equal(cache.get('k').hit, true);
        clock += 1001;
        assert.equal(cache.get('k').hit, false);
    });

    test('evicts the oldest entry once maxEntries is exceeded', () => {
        const cache = createResponseCache({ maxEntries: 2 });
        after(() => cache.stop());
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3); // should evict 'a'
        assert.equal(cache.get('a').hit, false);
        assert.equal(cache.get('b').hit, true);
        assert.equal(cache.get('c').hit, true);
    });

    test('clear() empties the cache', () => {
        const cache = createResponseCache();
        after(() => cache.stop());
        cache.set('k', 'v');
        cache.clear();
        assert.equal(cache.get('k').hit, false);
    });
});
