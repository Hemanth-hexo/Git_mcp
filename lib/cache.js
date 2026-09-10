// A small in-memory TTL cache for GitHub API responses. Only ever used for
// anonymous/server-token requests (see githubFetch in lib/github.js) —
// never for a caller-supplied token, since two different tokens can have
// different access to the same URL (e.g. a private repo) and sharing a
// cache entry across them would leak one caller's authorized data to
// another. Public GitHub data (what the shared/anonymous path always is)
// carries no such risk.
const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
const SWEEP_INTERVAL_MS = 5 * 60_000;

export function createResponseCache({ ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES, now = () => Date.now() } = {}) {
    const store = new Map(); // key -> { expiresAt, value }

    function sweepExpired() {
        const t = now();
        for (const [key, entry] of store) {
            if (t >= entry.expiresAt) store.delete(key);
        }
    }

    const sweepTimer = setInterval(sweepExpired, SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();

    function get(key) {
        const entry = store.get(key);
        if (!entry) return { hit: false };
        if (now() >= entry.expiresAt) {
            store.delete(key);
            return { hit: false };
        }
        return { hit: true, value: entry.value };
    }

    // `value` may legitimately be `null` (a cached "not found" for an
    // allow404 lookup) — callers must use the `{ hit }` flag, not truthiness.
    function set(key, value) {
        if (store.size >= maxEntries && !store.has(key)) {
            const oldestKey = store.keys().next().value;
            store.delete(oldestKey);
        }
        store.set(key, { expiresAt: now() + ttlMs, value });
    }

    function clear() {
        store.clear();
    }

    return { get, set, clear, stop: () => clearInterval(sweepTimer), _storeForTest: store };
}
