"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEARTBEAT_INTERVAL_MS = void 0;
exports.reconnectDelayMs = reconnectDelayMs;
exports.startHeartbeatSocket = startHeartbeatSocket;
const ws_1 = __importDefault(require("ws"));
/** Ping often enough that a silently dead connection is replaced within
 * about two intervals. EEW delivery depends on this socket being alive. */
exports.HEARTBEAT_INTERVAL_MS = 15_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
/** A connection counts as stable (and resets the backoff) only after it
 * has stayed up this long, so a server that accepts then drops at once
 * does not get reconnected every second. */
const STABLE_AFTER_MS = 60_000;
function reconnectDelayMs(failures, random = Math.random) {
    const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, Math.min(failures, 10)));
    // Up to 20% jitter so many bots do not reconnect in lockstep after an outage.
    return Math.min(RECONNECT_MAX_MS, Math.round(exponential * (1 + Math.max(0, Math.min(1, random())) * 0.2)));
}
/** Keeps one WebSocket connected: detects half-open connections with
 * ping/pong and reconnects with jittered exponential backoff. */
function startHeartbeatSocket(options) {
    const createSocket = options.createSocket ?? ((url) => new ws_1.default(url));
    const heartbeatMs = options.heartbeatMs ?? exports.HEARTBEAT_INTERVAL_MS;
    const now = options.now ?? Date.now;
    const random = options.random ?? Math.random;
    const schedule = options.setTimeout ?? setTimeout;
    const cancel = options.clearTimeout ?? clearTimeout;
    const repeat = options.setInterval ?? setInterval;
    const cancelRepeat = options.clearInterval ?? clearInterval;
    const log = options.log ?? console;
    let failures = 0;
    let stopped = false;
    let socket;
    let reconnectTimer;
    let heartbeatTimer;
    const connect = () => {
        reconnectTimer = undefined;
        if (stopped)
            return;
        let ws;
        try {
            ws = createSocket(options.url);
        }
        catch (error) {
            log.error('P2P地震情報 WebSocket の作成に失敗しました:', error);
            scheduleReconnect();
            return;
        }
        socket = ws;
        let alive = true;
        let openedAt;
        let closed = false;
        const markAlive = () => { alive = true; };
        ws.on('open', () => {
            openedAt = now();
            alive = true;
            log.log('P2P地震情報 WebSocket に接続しました');
            heartbeatTimer = repeat(() => {
                if (!alive) {
                    log.warn('P2P地震情報 WebSocket の応答がありません。接続し直します。');
                    ws.terminate();
                    return;
                }
                if (openedAt !== undefined && now() - openedAt >= STABLE_AFTER_MS)
                    failures = 0;
                alive = false;
                try {
                    ws.ping();
                }
                catch {
                    ws.terminate();
                }
            }, heartbeatMs);
            heartbeatTimer.unref?.();
        });
        ws.on('pong', markAlive);
        ws.on('message', data => {
            markAlive();
            options.onMessage(data);
        });
        ws.on('error', error => {
            log.error('P2P地震情報 WebSocket エラー:', error);
            ws.terminate();
        });
        ws.on('close', () => {
            if (closed)
                return;
            closed = true;
            if (heartbeatTimer !== undefined)
                cancelRepeat(heartbeatTimer);
            heartbeatTimer = undefined;
            if (socket === ws)
                socket = undefined;
            if (openedAt !== undefined && now() - openedAt >= STABLE_AFTER_MS)
                failures = 0;
            scheduleReconnect();
        });
    };
    const scheduleReconnect = () => {
        if (stopped || reconnectTimer !== undefined)
            return;
        const delay = reconnectDelayMs(failures, random);
        failures++;
        log.warn(`P2P地震情報 WebSocket が切断されました。${Math.round(delay / 1000)}秒後に再接続します。`);
        reconnectTimer = schedule(connect, delay);
    };
    connect();
    return () => {
        stopped = true;
        if (reconnectTimer !== undefined)
            cancel(reconnectTimer);
        if (heartbeatTimer !== undefined)
            cancelRepeat(heartbeatTimer);
        socket?.terminate();
    };
}
