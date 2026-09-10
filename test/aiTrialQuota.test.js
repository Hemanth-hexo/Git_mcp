import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTrialQuota } from '../lib/aiTrialQuota.js';

describe('createTrialQuota', () => {
    test('allows up to max consumptions per key', () => {
        let clock = 0;
        const quota = createTrialQuota({ windowMs: 1000, max: 3, now: () => clock });
        after(() => quota.stop());

        for (let i = 0; i < 3; i++) {
            const result = quota.consume('caller-a');
            assert.equal(result.ok, true, `consumption ${i + 1} should be allowed`);
        }
    });

    test('rejects once the max is exceeded, with a retryAfterSeconds', () => {
        let clock = 0;
        const quota = createTrialQuota({ windowMs: 1000, max: 1, now: () => clock });
        after(() => quota.stop());

        assert.equal(quota.consume('caller-a').ok, true);
        const blocked = quota.consume('caller-a');
        assert.equal(blocked.ok, false);
        assert.ok(blocked.retryAfterSeconds > 0);
    });

    test('tracks each caller independently', () => {
        let clock = 0;
        const quota = createTrialQuota({ windowMs: 1000, max: 1, now: () => clock });
        after(() => quota.stop());

        assert.equal(quota.consume('caller-a').ok, true);
        assert.equal(quota.consume('caller-b').ok, true, 'a different caller should have their own budget');
        assert.equal(quota.consume('caller-a').ok, false);
    });

    test('resets after the window elapses', () => {
        let clock = 0;
        const quota = createTrialQuota({ windowMs: 1000, max: 1, now: () => clock });
        after(() => quota.stop());

        assert.equal(quota.consume('caller-a').ok, true);
        assert.equal(quota.consume('caller-a').ok, false);
        clock += 1001;
        assert.equal(quota.consume('caller-a').ok, true);
    });
});
