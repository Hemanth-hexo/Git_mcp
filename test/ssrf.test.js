import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedDownloadUrl } from '../lib/github.js';

describe('isAllowedDownloadUrl (download_url SSRF guard)', () => {
    test('allows the real GitHub raw-content host over https', () => {
        assert.equal(isAllowedDownloadUrl('https://raw.githubusercontent.com/owner/repo/main/file.txt'), true);
    });

    test('rejects http (non-TLS)', () => {
        assert.equal(isAllowedDownloadUrl('http://raw.githubusercontent.com/owner/repo/main/file.txt'), false);
    });

    test('rejects lookalike hosts', () => {
        assert.equal(isAllowedDownloadUrl('https://raw.githubusercontent.com.evil.example/x'), false);
        assert.equal(isAllowedDownloadUrl('https://evil-raw.githubusercontent.com/x'), false);
        assert.equal(isAllowedDownloadUrl('https://raw.githubusercontent.com@evil.example/x'), false);
    });

    test('rejects internal, loopback, and metadata-service targets', () => {
        assert.equal(isAllowedDownloadUrl('https://169.254.169.254/latest/meta-data/'), false);
        assert.equal(isAllowedDownloadUrl('https://localhost/x'), false);
        assert.equal(isAllowedDownloadUrl('http://127.0.0.1:8080/x'), false);
        assert.equal(isAllowedDownloadUrl('https://[::1]/x'), false);
    });

    test('rejects other real but unexpected domains', () => {
        assert.equal(isAllowedDownloadUrl('https://api.github.com/some/path'), false);
        assert.equal(isAllowedDownloadUrl('https://example.com/file.txt'), false);
    });

    test('rejects malformed or empty input without throwing', () => {
        assert.doesNotThrow(() => isAllowedDownloadUrl('not a url'));
        assert.equal(isAllowedDownloadUrl('not a url'), false);
        assert.equal(isAllowedDownloadUrl(''), false);
        assert.equal(isAllowedDownloadUrl(undefined), false);
        assert.equal(isAllowedDownloadUrl(null), false);
    });
});
