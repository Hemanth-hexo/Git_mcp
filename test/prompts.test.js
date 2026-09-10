// Prompts are MCP's native slash-command mechanism (clients that support
// them surface each registered prompt as e.g. /github-discovery:getinfo).
// These tests exercise the real McpServer wiring end-to-end (list + get),
// not just the template functions in isolation, since the argsSchema
// plumbing and message shape are exactly what a client actually depends on.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../lib/createServer.js';

let client;

before(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

after(async () => {
    await client.close();
});

describe('prompts', () => {
    test('all four shortcuts are registered', async () => {
        const { prompts } = await client.listPrompts();
        const names = prompts.map((p) => p.name).sort();
        assert.deepEqual(names, ['comparerepos', 'findrepos', 'getcodeinfo', 'getinfo']);
    });

    test('getinfo fills in the repo name in a user message', async () => {
        const result = await client.getPrompt({ name: 'getinfo', arguments: { repo: 'facebook/react' } });
        assert.equal(result.messages.length, 1);
        assert.equal(result.messages[0].role, 'user');
        assert.match(result.messages[0].content.text, /facebook\/react/);
        assert.match(result.messages[0].content.text, /overview/i);
    });

    test('getcodeinfo fills in both repo and path', async () => {
        const result = await client.getPrompt({ name: 'getcodeinfo', arguments: { repo: 'facebook/react', path: 'package.json' } });
        const text = result.messages[0].content.text;
        assert.match(text, /facebook\/react/);
        assert.match(text, /package\.json/);
    });

    test('findrepos fills in the query', async () => {
        const result = await client.getPrompt({ name: 'findrepos', arguments: { query: 'containerization examples' } });
        assert.match(result.messages[0].content.text, /containerization examples/);
    });

    test('comparerepos fills in the repo list', async () => {
        const result = await client.getPrompt({ name: 'comparerepos', arguments: { repos: 'facebook/react, vuejs/vue' } });
        assert.match(result.messages[0].content.text, /facebook\/react, vuejs\/vue/);
    });

    test('a missing required argument is rejected rather than silently producing a broken prompt', async () => {
        await assert.rejects(() => client.getPrompt({ name: 'getinfo', arguments: {} }));
    });
});
