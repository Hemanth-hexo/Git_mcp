import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateExplanation, AiProviderError } from '../lib/aiProvider.js';

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('generateExplanation', () => {
    test('rejects with no API key', async () => {
        await assert.rejects(
            () => generateExplanation({ provider: 'gemini', apiKey: '', systemPrompt: 's', userPrompt: 'u' }),
            AiProviderError
        );
    });

    test('rejects an unsupported provider', async () => {
        await assert.rejects(
            () => generateExplanation({ provider: 'not-a-real-provider', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' }),
            /Unsupported AI provider/
        );
    });

    test('calls Gemini and extracts the text (also the default when no provider given)', async () => {
        let calledUrl;
        globalThis.fetch = async (url) => {
            calledUrl = String(url);
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a Gemini explanation' }] } }] }), { status: 200 });
        };
        const text = await generateExplanation({ provider: undefined, apiKey: 'k', systemPrompt: 's', userPrompt: 'u' });
        assert.equal(text, 'a Gemini explanation');
        assert.match(calledUrl, /generativelanguage\.googleapis\.com/);
        assert.match(calledUrl, /gemini-flash-latest/);
    });

    test('calls Anthropic and extracts the text', async () => {
        let capturedHeaders;
        globalThis.fetch = async (url, init) => {
            capturedHeaders = init.headers;
            return new Response(JSON.stringify({ content: [{ text: 'a Claude explanation' }] }), { status: 200 });
        };
        const text = await generateExplanation({ provider: 'anthropic', apiKey: 'my-key', systemPrompt: 's', userPrompt: 'u' });
        assert.equal(text, 'a Claude explanation');
        assert.equal(capturedHeaders['x-api-key'], 'my-key');
    });

    test('never puts the API key in the request body or a log-visible place other than the auth header/URL param', async () => {
        let capturedBody;
        globalThis.fetch = async (url, init) => {
            capturedBody = init?.body;
            return new Response(JSON.stringify({ content: [{ text: 'ok' }] }), { status: 200 });
        };
        await generateExplanation({ provider: 'anthropic', apiKey: 'super-secret-key', systemPrompt: 's', userPrompt: 'u' });
        assert.ok(!capturedBody.includes('super-secret-key'));
    });

    test('maps a provider HTTP failure to a safe AiProviderError, not raw fetch details', async () => {
        globalThis.fetch = async () => new Response('some internal provider error detail', { status: 500 });
        await assert.rejects(
            () => generateExplanation({ provider: 'gemini', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' }),
            (err) => {
                assert.ok(err instanceof AiProviderError);
                assert.ok(!err.message.includes('some internal provider error detail'));
                return true;
            }
        );
    });

    test('an Anthropic 429 is reported as status 429, without retrying (no fallback model for Anthropic)', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            return new Response('', { status: 429 });
        };
        await assert.rejects(
            () => generateExplanation({ provider: 'anthropic', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' }),
            (err) => {
                assert.equal(err.status, 429);
                return true;
            }
        );
        assert.equal(calls, 1);
    });

    test('a 429 from Gemini\'s primary model falls back to Flash-Lite once, then reports 429 if that also fails', async () => {
        let calls = 0;
        const urls = [];
        globalThis.fetch = async (url) => {
            calls += 1;
            urls.push(String(url));
            return new Response('', { status: 429 });
        };
        await assert.rejects(
            () => generateExplanation({ provider: 'gemini', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' }),
            (err) => {
                assert.equal(err.status, 429);
                assert.match(err.message, /both the primary and fallback/);
                return true;
            }
        );
        assert.equal(calls, 2);
        assert.match(urls[0], /gemini-flash-latest/);
        assert.match(urls[1], /gemini-3\.5-flash-lite/);
    });

    test('recovers from a 429 on Gemini\'s primary model via the Flash-Lite fallback', async () => {
        let calls = 0;
        globalThis.fetch = async (url) => {
            calls += 1;
            if (String(url).includes('gemini-flash-latest')) return new Response('', { status: 429 });
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from the fallback model' }] } }] }), { status: 200 });
        };
        const text = await generateExplanation({ provider: 'gemini', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' });
        assert.equal(text, 'from the fallback model');
        assert.equal(calls, 2);
    });

    test('retries a transient Gemini 503 ("model overloaded") and succeeds once it clears', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            if (calls === 1) return new Response('overloaded', { status: 503 });
            return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'recovered' }] } }] }), { status: 200 });
        };
        const text = await generateExplanation({ provider: 'gemini', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' });
        assert.equal(text, 'recovered');
        assert.equal(calls, 2);
    });

    test('gives up after repeated 503s from Gemini instead of retrying forever', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            return new Response('still overloaded', { status: 503 });
        };
        await assert.rejects(
            () => generateExplanation({ provider: 'gemini', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' }),
            (err) => {
                assert.ok(err instanceof AiProviderError);
                assert.equal(err.status, 502);
                return true;
            }
        );
        assert.equal(calls, 3); // 1 initial attempt + 2 retries, then give up
    });

    test('retries Anthropic\'s 529 "overloaded_error" the same way', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            if (calls === 1) return new Response('overloaded', { status: 529 });
            return new Response(JSON.stringify({ content: [{ text: 'recovered' }] }), { status: 200 });
        };
        const text = await generateExplanation({ provider: 'anthropic', apiKey: 'k', systemPrompt: 's', userPrompt: 'u' });
        assert.equal(text, 'recovered');
        assert.equal(calls, 2);
    });
});
