import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseDependencies } from '../lib/dependencyParser.js';

describe('parseDependencies', () => {
    test('parses package.json dependencies and devDependencies, flagging dev ones', () => {
        const text = JSON.stringify({
            dependencies: { express: '^5.0.0', zod: '^4.2.0' },
            devDependencies: { nodemon: '^3.0.0' },
        });
        const result = parseDependencies('package.json', text);
        assert.equal(result.ecosystem, 'npm');
        assert.equal(result.supported, true);
        assert.equal(result.dependencies.length, 3);
        const express = result.dependencies.find((d) => d.name === 'express');
        assert.equal(express.versionRange, '^5.0.0');
        assert.equal(express.dev, false);
        assert.equal(result.dependencies.find((d) => d.name === 'nodemon').dev, true);
    });

    test('does not throw on invalid JSON in package.json', () => {
        const result = parseDependencies('package.json', '{not valid json');
        assert.equal(result.supported, true);
        assert.deepEqual(result.dependencies, []);
    });

    test('parses composer.json require/require-dev, excluding the "php" pseudo-package', () => {
        const text = JSON.stringify({
            require: { php: '>=8.0', 'symfony/console': '^6.0' },
            'require-dev': { 'phpunit/phpunit': '^10.0' },
        });
        const result = parseDependencies('composer.json', text);
        assert.equal(result.ecosystem, 'composer');
        assert.equal(result.dependencies.some((d) => d.name === 'php'), false);
        assert.equal(result.dependencies.find((d) => d.name === 'symfony/console').dev, false);
        assert.equal(result.dependencies.find((d) => d.name === 'phpunit/phpunit').dev, true);
    });

    test('parses requirements.txt, skipping comments, blanks, and non-package lines', () => {
        const text = [
            '# a comment',
            '',
            'flask==2.3.0',
            'requests>=2.28,<3',
            'numpy',
            '-r other-requirements.txt',
            '-e .',
            'pandas[excel]==1.5.0  # inline comment',
        ].join('\n');
        const result = parseDependencies('requirements.txt', text);
        assert.equal(result.ecosystem, 'pip');
        const names = result.dependencies.map((d) => d.name).sort();
        assert.deepEqual(names, ['flask', 'numpy', 'pandas', 'requests']);
        assert.equal(result.dependencies.find((d) => d.name === 'flask').versionRange, '==2.3.0');
        assert.equal(result.dependencies.find((d) => d.name === 'numpy').versionRange, '*');
    });

    test('parses go.mod, handling both single-line and block require forms, flagging indirect deps', () => {
        const text = [
            'module example.com/foo',
            '',
            'go 1.21',
            '',
            'require github.com/single/dep v1.0.0',
            '',
            'require (',
            '\tgithub.com/direct/dep v2.3.4',
            '\tgithub.com/transitive/dep v0.0.0-20210101000000-abcdef123456 // indirect',
            ')',
        ].join('\n');
        const result = parseDependencies('go.mod', text);
        assert.equal(result.ecosystem, 'go');
        assert.equal(result.dependencies.length, 3);
        assert.equal(result.dependencies.find((d) => d.name === 'github.com/single/dep').versionRange, 'v1.0.0');
        assert.equal(result.dependencies.find((d) => d.name === 'github.com/direct/dep').dev, false);
        assert.equal(result.dependencies.find((d) => d.name === 'github.com/transitive/dep').dev, true);
    });

    test('reports an unsupported manifest type plainly instead of guessing', () => {
        const result = parseDependencies('Cargo.toml', '[dependencies]\nserde = "1.0"');
        assert.equal(result.supported, false);
        assert.equal(result.ecosystem, null);
        assert.deepEqual(result.dependencies, []);
    });
});
