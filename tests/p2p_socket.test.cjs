const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { startHeartbeatSocket, reconnectDelayMs } = require('../build/p2p_socket')

const quiet = { log() {}, warn() {}, error() {} }

class FakeSocket extends EventEmitter {
    constructor() { super(); this.pings = 0; this.terminated = 0 }
    ping() { this.pings++ }
    terminate() {
        this.terminated++
        if (this.terminated === 1) this.emit('close')
    }
}

// Manual clock: timers run only when the test advances time.
function harness() {
    let now = 0
    let seq = 0
    const timers = new Map()
    const sockets = []
    const add = (callback, delay, interval) => {
        const id = { id: ++seq }
        timers.set(id, { callback, at: now + delay, delay, interval })
        return id
    }
    const options = {
        url: 'wss://example.test',
        onMessage: data => messages.push(String(data)),
        createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s },
        heartbeatMs: 15000,
        now: () => now,
        random: () => 0,
        setTimeout: (cb, ms) => add(cb, ms, false),
        clearTimeout: id => timers.delete(id),
        setInterval: (cb, ms) => add(cb, ms, true),
        clearInterval: id => timers.delete(id),
        log: quiet,
    }
    const messages = []
    const advance = ms => {
        const end = now + ms
        for (;;) {
            const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
            if (!next) break
            const [id, t] = next
            now = t.at
            if (t.interval) t.at += t.delay
            else timers.delete(id)
            t.callback()
        }
        now = end
    }
    return { options, sockets, messages, advance, timers }
}

test('reconnect delay grows exponentially, is capped and jittered', () => {
    assert.equal(reconnectDelayMs(0, () => 0), 1000)
    assert.equal(reconnectDelayMs(1, () => 0), 2000)
    assert.equal(reconnectDelayMs(3, () => 0), 8000)
    assert.equal(reconnectDelayMs(20, () => 0), 60000)
    assert.equal(reconnectDelayMs(0, () => 1), 1200)
    assert.equal(reconnectDelayMs(20, () => 1), 60000)
})

test('silent half-open connection is terminated and replaced', () => {
    const h = harness()
    const stop = startHeartbeatSocket(h.options)
    h.sockets[0].emit('open')
    h.advance(15000)
    assert.equal(h.sockets[0].pings, 1)
    // No pong arrives: the next tick terminates and a reconnect follows.
    h.advance(15000)
    assert.equal(h.sockets[0].terminated, 1)
    h.advance(1000)
    assert.equal(h.sockets.length, 2)
    stop()
})

test('pong or incoming messages keep the connection alive and are delivered', () => {
    const h = harness()
    const stop = startHeartbeatSocket(h.options)
    const ws = h.sockets[0]
    ws.emit('open')
    for (let i = 0; i < 4; i++) {
        h.advance(15000)
        if (i % 2) ws.emit('pong'); else ws.emit('message', Buffer.from(`m${i}`))
    }
    assert.equal(ws.terminated, 0)
    assert.equal(h.sockets.length, 1)
    assert.deepEqual(h.messages, ['m0', 'm2'])
    stop()
})

test('repeated failures back off, and a stable connection resets the backoff', () => {
    const h = harness()
    const stop = startHeartbeatSocket(h.options)
    h.sockets[0].emit('error', new Error('refused'))
    h.advance(1000)
    assert.equal(h.sockets.length, 2)
    h.sockets[1].emit('error', new Error('refused'))
    h.advance(1999)
    assert.equal(h.sockets.length, 2)
    h.advance(1)
    assert.equal(h.sockets.length, 3)
    // Stays connected past the stable window, then drops: reconnect quickly again.
    const ws = h.sockets[2]
    ws.emit('open')
    for (let i = 0; i < 5; i++) { h.advance(15000); ws.emit('pong') }
    ws.emit('close')
    h.advance(1000)
    assert.equal(h.sockets.length, 4)
    stop()
})

test('error followed by close schedules only one reconnect; stop cancels everything', () => {
    const h = harness()
    const stop = startHeartbeatSocket(h.options)
    const ws = h.sockets[0]
    ws.emit('open')
    ws.emit('error', new Error('reset'))
    ws.emit('close')
    h.advance(1000)
    assert.equal(h.sockets.length, 2)
    stop()
    assert.equal(h.sockets[1].terminated, 1)
    h.advance(120000)
    assert.equal(h.sockets.length, 2)
    assert.equal(h.timers.size, 0)
})
