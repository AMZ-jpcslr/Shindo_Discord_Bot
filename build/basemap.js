"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BASEMAP_CREDIT = void 0;
exports.fetchBaseMapTile = fetchBaseMapTile;
exports.baseMapAttributionSvg = baseMapAttributionSvg;
const sharp_1 = __importDefault(require("sharp"));
const http_1 = require("./http");
exports.BASEMAP_CREDIT = {
    name: '背景地図',
    value: '[地理院タイル（色調加工）](https://maps.gsi.go.jp/development/ichiran.html)\n' +
        'Shoreline data is derived from: United States. National Imagery and Mapping Agency. ' +
        '"Vector Map Level 0 (VMAP0)." Bethesda, MD: Denver, CO: The Agency; USGS Information Services, 1997.',
};
// Both earthquake and tsunami maps use the same key-free background provider.
async function fetchBaseMapTile(zoom, x, y) {
    const maxTile = 2 ** zoom;
    if (![zoom, x, y].every(Number.isInteger) || zoom < 2 || zoom > 18 || x < 0 || y < 0 || x >= maxTile || y >= maxTile)
        return null;
    const response = await (0, http_1.fetchWithTimeout)(`https://cyberjapandata.gsi.go.jp/xyz/pale/${zoom}/${x}/${y}.png`);
    // Reject instead of sending a misleading blank background when tiles fail.
    if (!response.ok)
        throw new Error(`地理院タイル取得失敗: HTTP ${response.status}`);
    const source = Buffer.from(await response.arrayBuffer());
    return (0, sharp_1.default)(source)
        .flatten({ background: '#ffffff' })
        .greyscale()
        .linear(-0.55, 164.25)
        .png()
        .toBuffer();
}
function baseMapAttributionSvg(width, height) {
    return `<g>
        <rect x="${width - 226}" y="${height - 21}" width="226" height="21" fill="#101418" opacity="0.9"/>
        <text x="${width - 8}" y="${height - 7}" text-anchor="end" fill="#eeeeee" font-size="11" font-family="sans-serif">GSI Tiles (modified) / Shoreline: VMAP0</text>
    </g>`;
}
