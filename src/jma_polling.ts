/** JMA's public lists are CDN cached (currently max-age=60). Faster checks do
 * not guarantee faster upstream publication. Never bypass that cache. */
export const DEFAULT_JMA_POLL_INTERVAL_MS = 30_000
const MAX_INTERVAL_MS = 300_000
const HEALTH_WINDOW_MS = 120_000

export function getJmaPollIntervalMs(value = process.env.JMA_POLL_INTERVAL_MS): number {
    if (!value?.trim()) return DEFAULT_JMA_POLL_INTERVAL_MS
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0
        ? Math.min(MAX_INTERVAL_MS, Math.max(DEFAULT_JMA_POLL_INTERVAL_MS, Math.floor(parsed)))
        : DEFAULT_JMA_POLL_INTERVAL_MS
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
    if (!value?.trim()) return 0
    if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
        const milliseconds = Number(value) * 1000
        return Number.isFinite(milliseconds) ? milliseconds : 0
    }
    const date = Date.parse(value)
    return Number.isFinite(date) ? Math.max(0, date - now) : 0
}

export function pollDelayMs(failures: number, interval = getJmaPollIntervalMs(), random = Math.random): number {
    const base = getJmaPollIntervalMs(String(interval))
    if (failures <= 0) return base
    const exponential = Math.min(MAX_INTERVAL_MS, base * 2 ** Math.min(failures, 10))
    return Math.min(MAX_INTERVAL_MS, Math.round(exponential * (1 + Math.max(0, Math.min(1, random())) * 0.1)))
}

export class JmaPollError extends Error {
    constructor(message: string, public readonly retryAt = 0) {
        super(message)
        this.name = 'JmaPollError'
    }
}

type FeedOptions = {
    intervalMs?: number
    now?: () => number
    random?: () => number
    fetch?: typeof globalThis.fetch
}

export function createCachedJsonFeed<T>(url: string, options: FeedOptions = {}): {
    get(): Promise<T>
    healthy(): boolean
} {
    const now = options.now ?? Date.now
    const random = options.random ?? Math.random
    const interval = getJmaPollIntervalMs(String(options.intervalMs ?? getJmaPollIntervalMs()))
    let cached: T
    let hasCache = false
    let etag: string | null = null
    let modified: string | null = null
    let lastSuccess: number | undefined
    let lastError: JmaPollError | undefined
    let nextRequestAt = 0
    let failures = 0
    let inflight: Promise<T> | undefined

    const request = async (): Promise<T> => {
        nextRequestAt = now() + interval
        let serverRetryAt = 0
        try {
            const headers: Record<string, string> = {}
            if (hasCache && etag) headers['If-None-Match'] = etag
            if (hasCache && modified) headers['If-Modified-Since'] = modified
            const response = await (options.fetch ?? globalThis.fetch)(url, {
                headers,
                signal: AbortSignal.timeout(12_000),
            })
            if (response.status === 429 || response.status === 503) {
                serverRetryAt = now() + retryAfterMs(response.headers.get('Retry-After'), now())
            }
            if (response.status === 304) {
                if (!hasCache) throw new Error('JMA returned 304 without a cached response')
            } else {
                if (!response.ok) throw new Error(`JMA list fetch failed: ${response.status}`)
                // Do not commit cache metadata until the body has parsed successfully.
                const parsed = await response.json() as T
                cached = parsed
                hasCache = true
                etag = response.headers.get('ETag')
                modified = response.headers.get('Last-Modified')
            }
            lastSuccess = now()
            lastError = undefined
            failures = 0
            return cached
        } catch (error) {
            failures++
            nextRequestAt = Math.max(nextRequestAt, serverRetryAt, now() + pollDelayMs(failures, interval, random))
            lastError = new JmaPollError(error instanceof Error ? error.message : String(error), nextRequestAt)
            throw lastError
        }
    }

    return {
        get(): Promise<T> {
            if (inflight) return inflight
            if (now() < nextRequestAt) {
                if (lastError) return Promise.reject(lastError)
                if (hasCache) return Promise.resolve(cached)
            }
            inflight = request().finally(() => { inflight = undefined })
            return inflight
        },
        healthy(): boolean {
            return lastSuccess !== undefined && !lastError && now() - lastSuccess <= HEALTH_WINDOW_MS
        },
    }
}

type SchedulerOptions = {
    intervalMs?: number
    now?: () => number
    random?: () => number
    onError?: (error: unknown) => void
    setTimeout?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
    clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void
}

/** Starts immediately and only schedules the next tick after work settles. */
export function scheduleJmaPoll(task: () => Promise<void>, options: SchedulerOptions = {}): () => void {
    const interval = getJmaPollIntervalMs(String(options.intervalMs ?? getJmaPollIntervalMs()))
    const now = options.now ?? Date.now
    const schedule = options.setTimeout ?? setTimeout
    const clear = options.clearTimeout ?? clearTimeout
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const tick = async () => {
        let retryAt = 0
        try {
            await task()
            failures = 0
        } catch (error) {
            failures++
            if (error instanceof JmaPollError) retryAt = error.retryAt
            try {
                if (options.onError) options.onError(error)
                else console.error('気象庁監視エラー:', error)
            } catch { /* An observer must not stop monitoring. */ }
        }
        if (stopped) return
        const delay = Math.max(pollDelayMs(failures, interval, options.random), retryAt - now())
        // Node's timers overflow beyond ~24 days; recheck rather than retry early.
        const wake = () => {
            if (stopped) return
            if (retryAt > now()) {
                timer = schedule(wake, Math.min(2_147_483_647, retryAt - now()))
                timer.unref?.()
            } else void tick()
        }
        timer = schedule(wake, Math.min(2_147_483_647, delay))
        timer.unref?.()
    }
    void tick()
    return () => {
        stopped = true
        if (timer !== undefined) clear(timer)
    }
}
