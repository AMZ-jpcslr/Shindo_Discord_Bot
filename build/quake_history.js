"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistorySearch = exports.HistoryService = exports.INTENSITIES = exports.JMA_DATABASE = exports.HISTORY_API = exports.HISTORY_START = void 0;
exports.intensityLabel = intensityLabel;
exports.todayJst = todayJst;
exports.validateHistoryQuery = validateHistoryQuery;
exports.buildHistoryUrl = buildHistoryUrl;
exports.matchHistoryReport = matchHistoryReport;
const http_1 = require("./http");
exports.HISTORY_START = '2015-01-10';
exports.HISTORY_API = 'https://api.p2pquake.net/v2/jma/quake';
exports.JMA_DATABASE = 'https://www.data.jma.go.jp/eqdb/data/shindo/index.html';
exports.INTENSITIES = [10, 20, 30, 40, 45, 50, 55, 60, 70];
const labels = { 10: '1', 20: '2', 30: '3', 40: '4', 45: '5弱', 46: '5弱以上（未確定）', 50: '5強', 55: '6弱', 60: '6強', 70: '7' };
function intensityLabel(value) { return labels[value ?? -1] ?? '不明'; }
function todayJst(now = new Date()) {
    return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function validateHistoryQuery(query, today = todayJst()) {
    for (const [label, date] of [['開始日', query.start], ['終了日', query.end]]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
            throw new Error(`${label}は YYYY-MM-DD 形式の実在する日付で指定してください。`);
        }
    }
    if (query.start < exports.HISTORY_START || query.end < exports.HISTORY_START)
        throw new Error(`Bot内の履歴は ${exports.HISTORY_START} 以降です。それ以前は気象庁の震度データベース検索をご利用ください。\n${exports.JMA_DATABASE}`);
    if (query.start > query.end)
        throw new Error('開始日は終了日以前にしてください。');
    if (query.end > today)
        throw new Error('終了日は今日（日本時間）以前にしてください。');
    for (const scale of [query.min, query.max]) {
        if (scale !== undefined && !exports.INTENSITIES.includes(scale))
            throw new Error('震度は候補から選択してください。');
    }
    if (query.min !== undefined && query.max !== undefined && query.min > query.max)
        throw new Error('最低震度は最高震度以下にしてください。同じ値ならその震度だけ検索できます。');
    if (query.region !== undefined && (!normalize(query.region) || query.region.length > 80))
        throw new Error('地域は1〜80文字の都道府県・市区町村・観測点名で指定してください。');
    if (!['observed', 'epicenter'].includes(query.regionType) || ![1, -1].includes(query.order))
        throw new Error('検索条件が不正です。');
}
function normalize(value) { return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ''); }
function regionMatches(text, region) {
    return region.normalize('NFKC').trim().split(/\s+/).every(token => normalize(text).includes(normalize(token)));
}
const prefectures = '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');
function buildHistoryUrl(query, offset) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_547)
        throw new Error('検索位置が上限に達しました。日付で範囲を絞り直してください。');
    const url = new URL(exports.HISTORY_API);
    url.searchParams.set('limit', '100');
    url.searchParams.set('quake_type', 'DetailScale');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('order', String(query.order));
    url.searchParams.set('since_date', query.start.replaceAll('-', ''));
    // Older records can contain an unpadded hour (e.g. 4:09:00), while the
    // upstream compares timestamps as strings. Include the following day then
    // enforce the requested occurrence dates locally so end-date mornings survive.
    const through = new Date(`${query.end}T00:00:00Z`);
    through.setUTCDate(through.getUTCDate() + 1);
    url.searchParams.set('until_date', through.toISOString().slice(0, 10).replaceAll('-', ''));
    // Maximum national intensity is at least the regional intensity. A regional
    // upper bound must NOT be sent as a national upper bound.
    if (query.min !== undefined)
        url.searchParams.set('min_scale', String(query.min));
    if (query.max !== undefined && !(query.region && query.regionType === 'observed'))
        url.searchParams.set('max_scale', String(query.max));
    if (query.region && query.regionType === 'observed') {
        const region = normalize(query.region);
        const pref = prefectures.find(name => region.startsWith(name));
        if (pref)
            url.searchParams.append('prefectures[]', `${pref},${query.min ?? 10}`);
    }
    return url.toString();
}
function matchHistoryReport(report, query) {
    const quake = report.earthquake;
    if (report.issue?.type !== 'DetailScale' || report.code !== 551 || typeof report.id !== 'string' || !report.id || !quake)
        return undefined;
    const dateParts = quake.time?.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T]/);
    if (!dateParts)
        return undefined;
    const occurrenceDate = `${dateParts[1]}-${dateParts[2].padStart(2, '0')}-${dateParts[3].padStart(2, '0')}`;
    if (occurrenceDate < query.start || occurrenceDate > query.end)
        return undefined;
    const points = Array.isArray(report.points) ? report.points : [];
    const regional = Boolean(query.region && query.regionType === 'observed');
    const matching = regional ? points.filter(p => p && regionMatches(`${p.pref ?? ''}${p.addr ?? ''}`, query.region)) : points;
    if (query.region && (regional ? !matching.length : !regionMatches(quake.hypocenter?.name ?? '', query.region)))
        return undefined;
    const known = matching.map(p => p.scale).filter((s) => exports.INTENSITIES.includes(s));
    const estimated = regional && matching.some(p => p.scale === 46);
    const localScale = known.length || estimated ? Math.max(...known, estimated ? 45 : 0) : undefined;
    const uncertain = estimated && localScale !== 70;
    const lower = regional ? localScale : quake.maxScale;
    const upper = uncertain ? 70 : lower;
    if (query.min !== undefined || query.max !== undefined) {
        if (!exports.INTENSITIES.includes(lower))
            return undefined;
        // An unresolved 5- or greater is not falsely claimed to be exactly 5-.
        if (query.min !== undefined && lower < query.min)
            return undefined;
        if (query.max !== undefined && upper > query.max)
            return undefined;
    }
    const safeText = (value, fallback) => typeof value === 'string' ? value.slice(0, 120) : fallback;
    return {
        id: report.id.slice(0, 100),
        time: safeText(quake.time, '不明'), received: safeText(report.time, '不明'), issued: safeText(report.issue?.time, '不明'),
        type: safeText(report.issue?.type, 'Other'), correction: safeText(report.issue?.correct, 'Unknown'),
        epicenter: safeText(quake.hypocenter?.name, '震源情報なし'), magnitude: quake.hypocenter?.magnitude, depth: quake.hypocenter?.depth,
        maxScale: quake.maxScale, localScale: regional ? localScale : undefined, localUncertain: uncertain,
        observations: [...matching].sort((a, b) => (b.scale ?? -1) - (a.scale ?? -1)).slice(0, 4)
            .map(p => `${safeText(p.pref, '')}${safeText(p.addr, '')}: 震度${intensityLabel(p.scale)}`.slice(0, 160)),
    };
}
function isArchiveReport(value) {
    const object = (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item);
    const number = (item) => item === undefined || (typeof item === 'number' && Number.isFinite(item));
    if (!object(value) || value.code !== 551 || typeof value.id !== 'string' || !value.id || !object(value.earthquake) || typeof value.earthquake.time !== 'string')
        return false;
    if (!object(value.issue) || typeof value.issue.type !== 'string')
        return false;
    if (!number(value.earthquake.maxScale))
        return false;
    const hypocenter = value.earthquake.hypocenter;
    if (hypocenter !== undefined && (!object(hypocenter) || !number(hypocenter.magnitude) || !number(hypocenter.depth)))
        return false;
    if (value.points !== undefined && (!Array.isArray(value.points) || value.points.some(p => !object(p) || typeof p.pref !== 'string' || typeof p.addr !== 'string' || typeof p.scale !== 'number' || !Number.isFinite(p.scale))))
        return false;
    return true;
}
class HistoryService {
    fetcher;
    interval;
    now;
    sleep;
    cache = new Map();
    inflight = new Map();
    nextRequest = 0;
    queue = Promise.resolve();
    constructor(fetcher = http_1.fetchWithTimeout, interval = 6_100, now = Date.now, sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))) {
        this.fetcher = fetcher;
        this.interval = interval;
        this.now = now;
        this.sleep = sleep;
    }
    async fetchPage(query, offset) {
        const url = buildHistoryUrl(query, offset);
        const cached = this.cache.get(url);
        if (cached && cached.expires > this.now())
            return cached.records;
        const pending = this.inflight.get(url);
        if (pending)
            return pending;
        if (this.inflight.size >= 3)
            throw new Error('履歴検索が混み合っています。少し待って同じ操作をお試しください。');
        const operation = this.queue.then(async () => {
            const wait = this.nextRequest - this.now();
            if (wait > 20_000)
                throw new Error('取得元が待機を求めています。少し待って同じ操作をお試しください。');
            if (wait > 0)
                await this.sleep(wait);
            this.nextRequest = this.now() + this.interval;
            const response = await this.fetcher(url);
            if (response.status === 429 || response.status === 503) {
                const retry = response.headers.get('retry-after');
                const ms = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - this.now() : 60_000;
                this.nextRequest = Math.max(this.nextRequest, this.now() + (Number.isFinite(ms) ? Math.max(60_000, ms) : 60_000));
                throw new Error('取得元の混雑・利用制限のため検索できません。1分以上待って同じ操作をお試しください。');
            }
            if (!response.ok)
                throw new Error(`履歴の取得に失敗しました（HTTP ${response.status}）。少し待って再試行してください。`);
            const records = await response.json();
            if (!Array.isArray(records) || records.length > 100 || records.some(r => !isArchiveReport(r)))
                throw new Error('取得元の応答形式が変わったため検索を停止しました。データがないとは判定していません。');
            const size = Buffer.byteLength(JSON.stringify(records));
            if (size <= 8 * 1024 * 1024) {
                this.cache.set(url, { records, size, expires: this.now() + 5 * 60_000 });
                let total = [...this.cache.values()].reduce((sum, item) => sum + item.size, 0);
                for (const [key, item] of this.cache) {
                    if (this.cache.size <= 16 && total <= 16 * 1024 * 1024 && item.expires > this.now())
                        break;
                    this.cache.delete(key);
                    total -= item.size;
                }
            }
            return records;
        });
        this.queue = operation.catch(() => undefined);
        this.inflight.set(url, operation);
        try {
            return await operation;
        }
        finally {
            this.inflight.delete(url);
        }
    }
}
exports.HistoryService = HistoryService;
class HistorySearch {
    query;
    service;
    results = [];
    seen = new Set();
    offset = 0;
    exhausted = false;
    scanned = 0;
    lastScannedDate = '';
    capped = false;
    constructor(query, service) {
        this.query = query;
        this.service = service;
    }
    async loadMore(target) {
        // At most two API pages per click; no hidden crawl of the entire archive.
        for (let request = 0; request < 2 && this.results.length < target && !this.exhausted && !this.capped; request++) {
            const records = await this.service.fetchPage(this.query, this.offset);
            this.offset += records.length;
            this.scanned += records.length;
            this.exhausted = records.length < 100;
            for (const report of records) {
                this.lastScannedDate = report.earthquake?.time || report.time || this.lastScannedDate;
                if (this.seen.has(report.id))
                    continue;
                this.seen.add(report.id);
                const result = matchHistoryReport(report, this.query);
                if (result && this.results.length < 500)
                    this.results.push(result);
            }
            // Bound one ephemeral session, not the date range of the archive.
            this.capped = this.scanned >= 10_000 || this.results.length >= 500;
        }
    }
}
exports.HistorySearch = HistorySearch;
