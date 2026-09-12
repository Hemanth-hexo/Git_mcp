import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLicense } from '../lib/licenseInfo.js';

describe('classifyLicense', () => {
    test('classifies a well-known permissive license', () => {
        const result = classifyLicense('MIT');
        assert.equal(result.category, 'permissive');
        assert.equal(result.id, 'MIT');
        assert.ok(result.note.length > 0);
    });

    test('classifies a weak-copyleft license', () => {
        assert.equal(classifyLicense('MPL-2.0').category, 'weak-copyleft');
        assert.equal(classifyLicense('LGPL-3.0').category, 'weak-copyleft');
    });

    test('classifies a strong-copyleft license and flags AGPL specifically', () => {
        assert.equal(classifyLicense('GPL-3.0').category, 'copyleft');
        assert.match(classifyLicense('AGPL-3.0').note, /network service/i);
    });

    test('treats no license, empty string, and NOASSERTION the same way', () => {
        for (const input of [null, undefined, '', 'NOASSERTION', 'NONE']) {
            const result = classifyLicense(input);
            assert.equal(result.category, 'none');
            assert.equal(result.id, null);
        }
    });

    test('flags an unrecognized SPDX id as unknown rather than guessing', () => {
        const result = classifyLicense('SomeMadeUpLicense-9.9');
        assert.equal(result.category, 'unknown');
        assert.equal(result.id, 'SomeMadeUpLicense-9.9');
    });
});
