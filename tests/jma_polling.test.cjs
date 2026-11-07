const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createCachedJsonFeed, scheduleJmaPoll, getJmaPollIntervalMs, retryAfterMs, pollDelayMs, JmaPollError } = require('../build/jma_polling')
const flush = () => new Promise(resolve => setImmediate(resolve))
const response = (data, headers = {}) => new Response(JSON.stringify(data), { headers })

test('poll configuration and delays stay bounded; Retry-After supports seconds and HTTP dates', () => {
    for (const value of ['', 'wat', 'Infinity', '-1', '0', '1000']) assert.equal(getJmaPollIntervalMs(value), 30000)
    assert.equal(getJmaPollIntervalMs('45000'), 45000)
    assert.equal(getJmaPollIntervalMs('900000'), 300000)
    assert.equal(pollDelayMs(0, 30000), 30000)
    assert.equal(pollDelayMs(1, 30000, () => 0), 60000)
    assert.equal(pollDelayMs(1, 30000, () => 1), 66000)
    assert.equal(pollDelayMs(30, 30000, () => 1), 300000)
    assert.equal(retryAfterMs('90', 0), 90000)
    assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:02:00 GMT', 30000), 90000)
    assert.equal(retryAfterMs('bad', 0), 0)
})

test('feed shares inflight requests, throttles, conditionally revalidates and expires health', async () => {
    let now = 0
    let release
    const calls = []
    const feed = createCachedJsonFeed('https://example.test/list.json', {
        now: () => now,
        fetch: async (url, init) => {
            calls.push({url, init})
            if (calls.length === 1) await new Promise(resolve => { release = resolve })
            return calls.length === 1 ? response([1], {ETag: '"abc"', 'Last-Modified': 'date'}) : new Response(null, {status:304})
        },
    })
    assert.equal(feed.healthy(), false)
    const first = feed.get()
    assert.equal(feed.get(), first)
    release()
    assert.deepEqual(await first, [1])
    assert.equal(feed.healthy(), true)
    now = 29999
    assert.deepEqual(await feed.get(), [1])
    assert.equal(calls.length, 1)
    now = 30000
    assert.deepEqual(await feed.get(), [1])
    assert.equal(calls.length, 2)
    assert.equal(calls[1].url, 'https://example.test/list.json')
    assert.deepEqual(calls[1].init.headers, {'If-None-Match':'"abc"', 'If-Modified-Since':'date'})
    assert.ok(calls[1].init.signal instanceof AbortSignal)
    now = 150001
    assert.equal(feed.healthy(), false)
})

test('failed request is unhealthy and Retry-After cannot be bypassed by another caller', async () => {
    let now = 0, calls = 0
    const feed = createCachedJsonFeed('https://example.test/list.json', {
        now: () => now, random: () => 0,
        fetch: async () => { calls++; return calls === 1 ? response([1], {ETag:'"abc"'}) : calls === 2 ? new Response(null, {status:429, headers:{'Retry-After':'600'}}) : new Response(null, {status:304}) },
    })
    await feed.get()
    now = 30000
    await assert.rejects(feed.get(), error => error.retryAt === 630000)
    assert.equal(feed.healthy(), false)
    now = 629999
    await assert.rejects(feed.get(), /429/)
    assert.equal(calls, 2)
    now = 630000
    assert.deepEqual(await feed.get(), [1])
    assert.equal(feed.healthy(), true)
})

test('invalid JSON and unsolicited 304 are failures; cache survives for later revalidation', async () => {
    let now = 0, calls = 0
    const feed = createCachedJsonFeed('https://example.test/list.json', {
        now: () => now, random: () => 0,
        fetch: async () => { calls++; return calls === 1 ? new Response(null, {status:304}) : calls === 2 ? response([1], {ETag:'old'}) : calls === 3 ? new Response('bad', {headers:{ETag:'bad'}}) : new Response(null, {status:304}) },
    })
    await assert.rejects(feed.get(), /without a cached/)
    now = 60000
    await feed.get()
    now = 90000
    await assert.rejects(feed.get())
    assert.equal(feed.healthy(), false)
    now = 150000
    assert.deepEqual(await feed.get(), [1])
})

test('scheduler never overlaps, backs off, resets on success and stops', async () => {
    let calls = 0, release, cleared
    const timers = []
    const stop = scheduleJmaPoll(async () => {
        calls++
        if (calls === 1) await new Promise(resolve => {release = resolve})
        if (calls === 2) throw new JmaPollError('busy', 180000)
    }, {
        now: () => 0, random: () => 0, onError: () => {},
        setTimeout: (callback, delay) => {const timer = {callback,delay,unref(){}}; timers.push(timer); return timer},
        clearTimeout: timer => { cleared = timer },
    })
    assert.equal(calls, 1)
    assert.equal(timers.length, 0)
    release(); await flush()
    assert.equal(timers[0].delay, 30000)
    timers[0].callback(); await flush()
    assert.equal(timers[1].delay, 180000)
    stop()
    assert.equal(cleared, timers[1])
    timers[1].callback(); await flush()
    assert.equal(calls, 2)
})

test('scheduler resets backoff after recovery and stop during inflight prevents rescheduling', async () => {
    let calls = 0, release
    const timers = []
    const stop = scheduleJmaPoll(async () => {
        if (++calls === 1) throw Error('offline')
        if (calls === 3) await new Promise(resolve => { release = resolve })
    }, {
        random: () => 0, onError: () => {throw Error('observer')},
        setTimeout: (callback, delay) => {const timer = {callback,delay,unref(){}}; timers.push(timer); return timer}, clearTimeout: () => {},
    })
    await flush()
    assert.equal(timers[0].delay, 60000)
    timers[0].callback(); await flush()
    assert.equal(timers[1].delay, 30000)
    timers[1].callback(); await flush()
    stop(); release(); await flush()
    assert.equal(timers.length, 2)
})

test('503 HTTP-date cooldown and network timeout remain unhealthy until a successful retry', async () => {
    let now = 0, calls = 0
    const feed = createCachedJsonFeed('https://example.test/list.json', {
        now: () => now, random: () => 0,
        fetch: async () => {
            if (++calls === 1) return new Response(null, {status:503, headers:{'Retry-After':'Thu, 01 Jan 1970 00:10:00 GMT'}})
            if (calls === 2) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
            return response([])
        },
    })
    await assert.rejects(feed.get(), error => error.retryAt === 600000)
    now = 599999
    await assert.rejects(feed.get())
    assert.equal(calls, 1)
    now = 600000
    await assert.rejects(feed.get(), /timeout/)
    assert.equal(feed.healthy(), false)
    now = 719999
    await assert.rejects(feed.get())
    assert.equal(calls, 2)
    now = 720000
    assert.deepEqual(await feed.get(), [])
    assert.equal(feed.healthy(), true)
})

test('fresh cached reads do not reset the last upstream success timestamp', async () => {
    let now = 0, calls = 0
    const feed = createCachedJsonFeed('https://example.test/list.json', {
        intervalMs: 300000, now: () => now,
        fetch: async () => {calls++; return response([])},
    })
    await feed.get()
    now = 120000
    assert.equal(feed.healthy(), true)
    now++
    await feed.get()
    assert.equal(calls, 1)
    assert.equal(feed.healthy(), false)
})
