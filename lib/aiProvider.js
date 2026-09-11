// Thin wrappers over each AI provider's REST API - just enough to send a
// system+user prompt and get text back. Used two ways: the operator's own
// Gemini key for a tightly-quota'd free trial (see lib/aiTrialQuota.js), or
// a caller's own key (any supported provider) for unlimited use at their
// own cost. Never used for anything but this one "explain a repo" feature -
// no chat history, no tool use, no state.
export const SUPPORTED_PROVIDERS = ['gemini', 'anthropic'];

// gemini-flash-latest is a stable alias Google maintains for whichever Flash
// model is current and free-tier-eligible, rather than a pinned dated model
// name that goes stale as they ship new versions (verified live against
// Google's own docs: the pinned-version landscape churns fast - 3.5, 3.6,
// 3.7, 3.8-flash all coexist).
const GEMINI_MODEL = 'gemini-flash-latest';
// Gemini's free-tier RPM/RPD quota is allocated per model, not shared across
// a project (verified against Google's own rate-limit docs and current
// reporting) - so funneling every trial request through one model alias
// means they all compete for one quota bucket. Flash-Lite is a separate
// model family with a materially higher reported free-tier daily quota than
// Flash, so it's a real, independent fallback when Flash's bucket is
// exhausted, not just a retry of the same failing thing. No "-latest" alias
// exists for Flash-Lite (checked), so this is pinned to the current GA
// model rather than self-updating - acceptable here since it's only a
// fallback, exercised occasionally, not the primary path.
const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const ANTHROPIC_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';
// The explain prompt (core/explain.js) asks for a structured, ~350-500 word
// answer across five sections - a low cap here was cutting the response off
// mid-section (often losing the Verdict entirely, the most important part).
// 1200 gives real headroom without meaningfully changing trial/BYO cost.
const MAX_OUTPUT_TOKENS = 1200;

class AiProviderError extends Error {
    constructor(message, { status } = {}) {
        super(message);
        this.name = 'AiProviderError';
        this.status = status;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Both providers' free/shared-capacity tiers occasionally answer a healthy
// request with "the model is overloaded, try again" (Gemini: 503, Anthropic:
// 529) rather than a real client- or server-side failure - retrying almost
// always succeeds within a second or two. A plain 500 or a 429 (rate limit)
// is NOT retried here: 500 usually means something is actually wrong, and
// hammering a rate limit only makes it worse.
const RETRY_DELAYS_MS = [400, 1200];

async function fetchWithRetry(url, options, retryableStatuses) {
    let res;
    for (let attempt = 0; ; attempt++) {
        res = await fetch(url, options);
        if (res.ok || !retryableStatuses.has(res.status) || attempt >= RETRY_DELAYS_MS.length) {
            return res;
        }
        await res.text().catch(() => ''); // drain the body of the attempt we're discarding
        await sleep(RETRY_DELAYS_MS[attempt]);
    }
}

function geminiUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

async function callGemini(apiKey, systemPrompt, userPrompt) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 },
        }),
    };

    let res;
    let modelUsed = GEMINI_MODEL;
    try {
        res = await fetchWithRetry(geminiUrl(GEMINI_MODEL, apiKey), options, new Set([503]));
        if (res.status === 429) {
            await res.text().catch(() => ''); // drain the exhausted attempt before reusing the connection
            modelUsed = GEMINI_FALLBACK_MODEL;
            res = await fetchWithRetry(geminiUrl(GEMINI_FALLBACK_MODEL, apiKey), options, new Set([503]));
        }
    } catch (err) {
        throw new AiProviderError(`Network error contacting Gemini: ${err.message}`);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[aiProvider] Gemini API error (HTTP ${res.status}, model ${modelUsed}): ${body.slice(0, 500)}`);
        const message = res.status === 429 && modelUsed === GEMINI_FALLBACK_MODEL
            ? "Gemini's free-tier request limit was hit on both the primary and fallback models (HTTP 429) - Google's quota for this key is likely exhausted for now. Wait a while and try again, or add your own AI API key in Settings for uncontended use."
            : `Gemini API error (HTTP ${res.status}).`;
        throw new AiProviderError(message, { status: res.status === 429 ? 429 : 502 });
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new AiProviderError('Gemini returned no text (the content may have been blocked).', { status: 502 });
    return text;
}

async function callAnthropic(apiKey, systemPrompt, userPrompt) {
    let res;
    try {
        res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
            },
            body: JSON.stringify({
                model: ANTHROPIC_MODEL,
                max_tokens: MAX_OUTPUT_TOKENS,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
            }),
        }, new Set([503, 529]));
    } catch (err) {
        throw new AiProviderError(`Network error contacting Anthropic: ${err.message}`);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[aiProvider] Anthropic API error (HTTP ${res.status}): ${body.slice(0, 500)}`);
        throw new AiProviderError(`Anthropic API error (HTTP ${res.status}).`, { status: res.status === 429 ? 429 : 502 });
    }
    const data = await res.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new AiProviderError('Anthropic returned no text.', { status: 502 });
    return text;
}

export async function generateExplanation({ provider, apiKey, systemPrompt, userPrompt }) {
    if (!apiKey) throw new AiProviderError('No API key provided.', { status: 400 });
    if (provider === 'anthropic') return callAnthropic(apiKey, systemPrompt, userPrompt);
    if (provider === 'gemini' || !provider) return callGemini(apiKey, systemPrompt, userPrompt);
    throw new AiProviderError(`Unsupported AI provider: "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`, { status: 400 });
}

export { AiProviderError };
