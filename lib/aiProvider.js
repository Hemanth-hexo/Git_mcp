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

async function callGemini(apiKey, systemPrompt, userPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 },
            }),
        });
    } catch (err) {
        throw new AiProviderError(`Network error contacting Gemini: ${err.message}`);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[aiProvider] Gemini API error (HTTP ${res.status}): ${body.slice(0, 500)}`);
        throw new AiProviderError(`Gemini API error (HTTP ${res.status}).`, { status: res.status === 429 ? 429 : 502 });
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new AiProviderError('Gemini returned no text (the content may have been blocked).', { status: 502 });
    return text;
}

async function callAnthropic(apiKey, systemPrompt, userPrompt) {
    let res;
    try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
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
        });
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
