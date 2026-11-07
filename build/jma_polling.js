"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JmaPollError = exports.DEFAULT_JMA_POLL_INTERVAL_MS = void 0;
exports.getJmaPollIntervalMs = getJmaPollIntervalMs;
exports.retryAfterMs = retryAfterMs;
exports.pollDelayMs = pollDelayMs;
exports.createCachedJsonFeed = createCachedJsonFeed;
exports.scheduleJmaPoll = scheduleJmaPoll;
/** JMA's public lists are CDN cached (currently max-age=60). Faster checks do
 * not guarantee faster upstream publication. Never bypass that cache. */
exports.DEFAULT_JMA_POLL_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 300_000;
const HEALTH_WINDOW_MS = 120_000;
function getJmaPollIntervalMs(value = process.env.JMA_POLL_INTERVAL_MS) {
    if (!value?.trim())
        return exports.DEFAULT_JMA_POLL_INTERVAL_MS;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.min(MAX_INTERVAL_MS, Math.max(exports.DEFAULT_JMA_POLL_INTERVAL_MS, Math.floor(parsed)))
        : exports.DEFAULT_JMA_POLL_INTERVAL_MS;
}
function retryAfterMs(value, now = Date.now()) {
    if (!value?.trim())
        return 0;
    if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
        const milliseconds = Number(value) * 1000;
        return Number.isFinite(milliseconds) ? milliseconds : 0;
    }
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
function pollDelayMs(failures, interval = getJmaPollIntervalMs(), random = Math.random) {
    const base = getJmaPollIntervalMs(String(interval));
    if (failures <= 0)
        return base;
    const exponential = Math.min(MAX_INTERVAL_MS, base * 2 ** Math.min(failures, 10));
    return Math.min(MAX_INTERVAL_MS, Math.round(exponential * (1 + Math.max(0, Math.min(1, random())) * 0.1)));
}
class JmaPollError extends Error {
    retryAt;
    constructor(message, retryAt = 0) {
        super(message);
        this.retryAt = retryAt;
        this.name = 'JmaPollError';
    }
}
exports.JmaPollError = JmaPollError;
function createCachedJsonFeed(url, options = {}) {
    const now = options.now ?? Date.now;
    const random = options.random ?? Math.random;
    const interval = getJmaPollIntervalMs(String(options.intervalMs ?? getJmaPollIntervalMs()));
    let cached;
    let hasCache = false;
    let etag = null;
    let modified = null;
    let lastSuccess;
    let lastError;
    let nextRequestAt = 0;
    let failures = 0;
    let inflight;
    const request = async () => {
        nextRequestAt = now() + interval;
        let serverRetryAt = 0;
        try {
            const headers = {};
            if (hasCache && etag)
                headers['If-None-Match'] = etag;
            if (hasCache && modified)
                headers['If-Modified-Since'] = modified;
            const response = await (options.fetch ?? globalThis.fetch)(url, {
                headers,
                signal: AbortSignal.timeout(12_000),
            });
            if (response.status === 429 || response.status === 503) {
                serverRetryAt = now() + retryAfterMs(response.headers.get('Retry-After'), now());
            }
            if (response.status === 304) {
                if (!hasCache)
                    throw new Error('JMA returned 304 without a cached response');
            }
            else {
                if (!response.ok)
                    throw new Error(`JMA list fetch failed: ${response.status}`);
                // Do not commit cache metadata until the body has parsed successfully.
                const parsed = await response.json();
                cached = parsed;
                hasCache = true;
                etag = response.headers.get('ETag');
                modified = response.headers.get('Last-Modified');
            }
            lastSuccess = now();
            lastError = undefined;
            failures = 0;
            return cached;
        }
        catch (error) {
            failures++;
            nextRequestAt = Math.max(nextRequestAt, serverRetryAt, now() + pollDelayMs(failures, interval, random));
            lastError = new JmaPollError(error instanceof Error ? error.message : String(error), nextRequestAt);
            throw lastError;
        }
    };
    return {
        get() {
            if (inflight)
                return inflight;
            if (now() < nextRequestAt) {
                if (lastError)
                    return Promise.reject(lastError);
                if (hasCache)
                    return Promise.resolve(cached);
            }
            inflight = request().finally(() => { inflight = undefined; });
            return inflight;
        },
        healthy() {
            return lastSuccess !== undefined && !lastError && now() - lastSuccess <= HEALTH_WINDOW_MS;
        },
    };
}
/** Starts immediately and only schedules the next tick after work settles. */
function scheduleJmaPoll(task, options = {}) {
    const interval = getJmaPollIntervalMs(String(options.intervalMs ?? getJmaPollIntervalMs()));
    const now = options.now ?? Date.now;
    const schedule = options.setTimeout ?? setTimeout;
    const clear = options.clearTimeout ?? clearTimeout;
    let stopped = false;
    let timer;
    let failures = 0;
    const tick = async () => {
        let retryAt = 0;
        try {
            await task();
            failures = 0;
        }
        catch (error) {
            failures++;
            if (error instanceof JmaPollError)
                retryAt = error.retryAt;
            try {
                if (options.onError)
                    options.onError(error);
                else
                    console.error('気象庁監視エラー:', error);
            }
            catch { /* An observer must not stop monitoring. */ }
        }
        if (stopped)
            return;
        const delay = Math.max(pollDelayMs(failures, interval, options.random), retryAt - now());
        // Node's timers overflow beyond ~24 days; recheck rather than retry early.
        const wake = () => {
            if (stopped)
                return;
            if (retryAt > now()) {
                timer = schedule(wake, Math.min(2_147_483_647, retryAt - now()));
                timer.unref?.();
            }
            else
                void tick();
        };
        timer = schedule(wake, Math.min(2_147_483_647, delay));
        timer.unref?.();
    };
    void tick();
    return () => {
        stopped = true;
        if (timer !== undefined)
            clear(timer);
    };
}
