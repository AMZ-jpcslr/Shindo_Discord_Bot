"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASEMAP_CREDIT = void 0;
exports.fetchBaseMapTile = fetchBaseMapTile;
exports.fetchBaseMapTiles = fetchBaseMapTiles;
exports.baseMapAttributionSvg = baseMapAttributionSvg;
const sharp_1 = __importDefault(require("sharp"));
const http_1 = require("./http");
exports.BASEMAP_CREDIT = {
    name: '背景地図',
    value: '[地理院タイル（色調加工）](https://maps.gsi.go.jp/development/ichiran.html)\n' +
        'Shoreline data is derived from: United States. National Imagery and Mapping Agency. ' +
        '"Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.',
};
// Shared across earthquake and tsunami rendering, including simultaneous maps.
const TILE_CONCURRENCY = 4;
const TILE_CACHE_TTL_MS = 15 * 60_000;
const TILE_CACHE_MAX_ENTRIES = 128;
const TILE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const tileCache = new Map();
const inFlightTiles = new Map();
let cachedBytes = 0;
let activeTiles = 0;
const tileWaiters = [];
async function withTileSlot(work) {
    if (activeTiles >= TILE_CONCURRENCY)
        await new Promise(resolve => tileWaiters.push(resolve));
    else
        activeTiles++;
    try {
        return await work();
    }
    finally {
        const next = tileWaiters.shift();
        if (next)
            next();
        else
            activeTiles--;
    }
}
function removeCachedTile(key) {
    const cached = tileCache.get(key);
    if (cached)
        cachedBytes -= cached.tile.length;
    tileCache.delete(key);
}
function cacheLifetime(response) {
    const control = response.headers.get('cache-control') ?? '';
    if (/\b(?:no-store|no-cache)\b/i.test(control))
        return 0;
    const maxAge = control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)/i);
    if (!maxAge)
        return TILE_CACHE_TTL_MS;
    const age = Math.max(0, Number(response.headers.get('age')) || 0);
    return Math.max(0, Math.min(TILE_CACHE_TTL_MS, (Number(maxAge[1]) - age) * 1000));
}
// Cache only the static background. Earthquake observations are always redrawn.
async function fetchBaseMapTile(zoom, x, y) {
    const maxTile = 2 ** zoom;
    if (![zoom, x, y].every(Number.isInteger) || zoom < 2 || zoom > 18 || x < 0 || y < 0 || x >= maxTile || y >= maxTile)
        return null;
    const key = `${zoom}/${x}/${y}`;
    const cached = tileCache.get(key);
    if (cached && cached.expires > Date.now()) {
        // Refresh LRU order without extending the lifetime.
        tileCache.delete(key);
        tileCache.set(key, cached);
        return cached.tile;
    }
    removeCachedTile(key);
    const existing = inFlightTiles.get(key);
    if (existing)
        return existing;
    const pending = withTileSlot(async () => {
        const response = await (0, http_1.fetchWithTimeout)(`https://cyberjapandata.gsi.go.jp/xyz/pale/${key}.png`);
        // Do not cache failures or send a misleading blank background.
        if (!response.ok)
            throw new Error(`地理院タイル取得失敗: HTTP ${response.status}`);
        const source = Buffer.from(await response.arrayBuffer());
        const tile = await (0, sharp_1.default)(source)
            .flatten({ background: '#ffffff' })
            .greyscale()
            .linear(-0.55, 164.25)
            .png()
            .toBuffer();
        const lifetime = cacheLifetime(response);
        if (lifetime > 0 && tile.length <= TILE_CACHE_MAX_BYTES) {
            removeCachedTile(key);
            tileCache.set(key, { tile, expires: Date.now() + lifetime });
            cachedBytes += tile.length;
            while (tileCache.size > TILE_CACHE_MAX_ENTRIES || cachedBytes > TILE_CACHE_MAX_BYTES) {
                removeCachedTile(tileCache.keys().next().value);
            }
        }
        return tile;
    });
    inFlightTiles.set(key, pending);
    try {
        return await pending;
    }
    finally {
        inFlightTiles.delete(key);
    }
}
async function fetchBaseMapTiles(coordinates) {
    const tiles = new Array(coordinates.length);
    let index = 0;
    const errors = [];
    // Preserve compositing order, stop scheduling on failure, and drain active
    // work before rejecting. No unbounded request fan-out during quake bursts.
    await Promise.all(Array.from({ length: Math.min(TILE_CONCURRENCY, coordinates.length) }, async () => {
        while (index < coordinates.length && !errors.length) {
            const current = index++;
            try {
                tiles[current] = await fetchBaseMapTile(...coordinates[current]);
            }
            catch (error) {
                errors.push(error);
            }
        }
    }));
    if (errors.length)
        throw errors[0];
    return tiles;
}
// Original 5x7 vector lettering for this fixed credit, independent of fonts in
// node:slim. The full source name, URL and shoreline notice remain in the embed.
const CREDIT_GLYPHS = {
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
    ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
    '/': ['00001', '00001', '00010', '00100', '01000', '10000', '10000'],
    ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
};
const CREDIT_TEXT = 'GSI TILES (MODIFIED) / SHORELINE: VMAP0';
const CREDIT_PATH = [...CREDIT_TEXT].flatMap((letter, index) => CREDIT_GLYPHS[letter].flatMap((row, y) => [...row].flatMap((pixel, x) => pixel === '1' ? [`M${index * 6 + x} ${y}h1v1h-1z`] : []))).join('');
function baseMapAttributionSvg(width, height) {
    const scale = 1.5;
    const textWidth = (CREDIT_TEXT.length * 6 - 1) * scale;
    const left = width - textWidth - 8;
    return `<g aria-label="GSI Tiles (modified) / Shoreline: VMAP0">
        <rect x="${left - 6}" y="${height - 22}" width="${textWidth + 14}" height="22" fill="#101418" opacity="0.94"/>
        <path d="${CREDIT_PATH}" transform="translate(${left} ${height - 16}) scale(${scale})" fill="#eeeeee"/>
    </g>`;
}
