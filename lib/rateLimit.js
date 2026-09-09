// A minimal fixed-window rate limiter, keyed per caller (by default, IP).
// This exists to protect this server's own compute/bandwidth from a caller
// hammering it directly — a separate concern from GitHub's own API limits,
// which only throttle GitHub calls, not requests that never get that far
// (malformed input, etc.). No dependency pulled in for this: the logic is
// small enough to own directly and test directly.
const SWEEP_INTERVAL_MS = 5 * 60_000;

export function createRateLimiter({ windowMs = 60_000, max = 30, keyFn = (req) => req.ip, now = () => Date.now() } = {}) {
    const hits = new Map(); // key -> { count, resetAt }

    function sweepExpired() {
        const t = now();
        for (const [key, entry] of hits) {
            if (t >= entry.resetAt) hits.delete(key);
        }
    }

    const sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();

    function middleware(req, res, next) {
        const key = keyFn(req) || 'unknown';
        const t = now();
        let entry = hits.get(key);
        if (!entry || t >= entry.resetAt) {
            entry = { count: 0, resetAt: t + windowMs };
            hits.set(key, entry);
        }
        entry.count += 1;

        if (entry.count > max) {
            const retryAfterSeconds = Math.ceil((entry.resetAt - t) / 1000);
            res.set('Retry-After', String(retryAfterSeconds));
            res.status(429).json({
                error: 'rate_limited',
                error_description: `Too many requests. Limit is ${max} per ${Math.round(windowMs / 1000)}s per caller. Try again in ${retryAfterSeconds}s.`,
            });
            return;
        }

        next();
    }

    middleware.stop = () => clearInterval(sweepTimer);
    middleware._hitsForTest = hits;
    return middleware;
}
