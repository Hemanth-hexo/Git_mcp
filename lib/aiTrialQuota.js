// A small per-caller daily quota, separate from the general HTTP rate
// limiter (lib/rateLimit.js) — that one protects this server's own
// bandwidth/compute; this one protects the operator's AI API spend
// specifically, so it needs its own, much stricter budget and its own
// window (a day, not a minute). Deliberately a plain checkable function
// rather than Express middleware: the AI-explain route only consults this
// when the caller did NOT bring their own AI key, so it can't just run
// unconditionally in the middleware chain.
const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export function createTrialQuota({ windowMs = DAY_MS, max = 5, now = () => Date.now() } = {}) {
    const usage = new Map(); // key -> { count, resetAt }

    function sweepExpired() {
        const t = now();
        for (const [key, entry] of usage) {
            if (t >= entry.resetAt) usage.delete(key);
        }
    }
    const sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();

    // Checks AND consumes one unit of quota in the same call — callers
    // should only call this once they're actually about to spend the
    // operator's API budget, not speculatively.
    function consume(key) {
        const t = now();
        let entry = usage.get(key);
        if (!entry || t >= entry.resetAt) {
            entry = { count: 0, resetAt: t + windowMs };
            usage.set(key, entry);
        }
        if (entry.count >= max) {
            return { ok: false, retryAfterSeconds: Math.ceil((entry.resetAt - t) / 1000) };
        }
        entry.count += 1;
        return { ok: true, remaining: max - entry.count };
    }

    return { consume, stop: () => clearInterval(sweepTimer), _usageForTest: usage };
}
