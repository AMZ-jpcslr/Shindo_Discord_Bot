"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREFECTURE_POINTS = void 0;
exports.pointForAreaName = pointForAreaName;
exports.linesForTsunamiAreaName = linesForTsunamiAreaName;
exports.createDisasterMapAttachment = createDisasterMapAttachment;
const http_1 = require("./http");
const discord_js_1 = require("discord.js");
const sharp_1 = __importDefault(require("sharp"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const topojson = require('topojson-client');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const landTopology = require('world-atlas/land-10m.json');
const TILE_SIZE = 256;
const MAP_WIDTH = 600;
const MAP_HEIGHT = 400;
let cachedWorldCoastlineRings = null;
exports.PREFECTURE_POINTS = {
    '北海道': { latitude: 43.0642, longitude: 141.3469 },
    '青森県': { latitude: 40.8244, longitude: 140.74 },
    '岩手県': { latitude: 39.7036, longitude: 141.1527 },
    '宮城県': { latitude: 38.2688, longitude: 140.8721 },
    '秋田県': { latitude: 39.7186, longitude: 140.1024 },
    '山形県': { latitude: 38.2404, longitude: 140.3633 },
    '福島県': { latitude: 37.7503, longitude: 140.4676 },
    '茨城県': { latitude: 36.3418, longitude: 140.4468 },
    '栃木県': { latitude: 36.5657, longitude: 139.8836 },
    '群馬県': { latitude: 36.3911, longitude: 139.0608 },
    '埼玉県': { latitude: 35.8569, longitude: 139.6489 },
    '千葉県': { latitude: 35.6046, longitude: 140.1233 },
    '東京都': { latitude: 35.6895, longitude: 139.6917 },
    '神奈川県': { latitude: 35.4478, longitude: 139.6425 },
    '新潟県': { latitude: 37.9026, longitude: 139.0232 },
    '富山県': { latitude: 36.6953, longitude: 137.2113 },
    '石川県': { latitude: 36.5947, longitude: 136.6256 },
    '福井県': { latitude: 36.0652, longitude: 136.2216 },
    '山梨県': { latitude: 35.6642, longitude: 138.5684 },
    '長野県': { latitude: 36.6513, longitude: 138.181 },
    '岐阜県': { latitude: 35.3912, longitude: 136.7223 },
    '静岡県': { latitude: 34.9769, longitude: 138.3831 },
    '愛知県': { latitude: 35.1802, longitude: 136.9066 },
    '三重県': { latitude: 34.7303, longitude: 136.5086 },
    '滋賀県': { latitude: 35.0045, longitude: 135.8686 },
    '京都府': { latitude: 35.0212, longitude: 135.7556 },
    '大阪府': { latitude: 34.6863, longitude: 135.52 },
    '兵庫県': { latitude: 34.6913, longitude: 135.183 },
    '奈良県': { latitude: 34.6851, longitude: 135.8048 },
    '和歌山県': { latitude: 34.226, longitude: 135.1675 },
    '鳥取県': { latitude: 35.5039, longitude: 134.2383 },
    '島根県': { latitude: 35.4723, longitude: 133.0505 },
    '岡山県': { latitude: 34.6618, longitude: 133.935 },
    '広島県': { latitude: 34.3966, longitude: 132.4596 },
    '山口県': { latitude: 34.1859, longitude: 131.4714 },
    '徳島県': { latitude: 34.0658, longitude: 134.5593 },
    '香川県': { latitude: 34.3401, longitude: 134.0434 },
    '愛媛県': { latitude: 33.8417, longitude: 132.7661 },
    '高知県': { latitude: 33.5597, longitude: 133.5311 },
    '福岡県': { latitude: 33.6064, longitude: 130.4181 },
    '佐賀県': { latitude: 33.2494, longitude: 130.2988 },
    '長崎県': { latitude: 32.7448, longitude: 129.8737 },
    '熊本県': { latitude: 32.7898, longitude: 130.7417 },
    '大分県': { latitude: 33.2382, longitude: 131.6126 },
    '宮崎県': { latitude: 31.9111, longitude: 131.4239 },
    '鹿児島県': { latitude: 31.5602, longitude: 130.5581 },
    '沖縄県': { latitude: 26.2124, longitude: 127.6809 },
    '伊豆諸島': { latitude: 34.05, longitude: 139.45 },
    '小笠原諸島': { latitude: 27.1, longitude: 142.2 },
    '奄美群島': { latitude: 28.3, longitude: 129.4 },
    'トカラ列島': { latitude: 29.6, longitude: 129.7 },
};
const TSUNAMI_COAST_LINES = {
    '北海道太平洋沿岸東部': [{ latitude: 43.4, longitude: 145.6 }, { latitude: 42.9, longitude: 145.0 }, { latitude: 42.4, longitude: 144.3 }],
    '北海道太平洋沿岸中部': [{ latitude: 42.4, longitude: 144.3 }, { latitude: 42.2, longitude: 143.2 }, { latitude: 42.0, longitude: 142.3 }],
    '北海道太平洋沿岸西部': [{ latitude: 42.0, longitude: 142.3 }, { latitude: 42.3, longitude: 141.0 }, { latitude: 41.8, longitude: 140.7 }],
    '北海道日本海沿岸北部': [{ latitude: 45.4, longitude: 141.7 }, { latitude: 44.6, longitude: 141.8 }, { latitude: 43.9, longitude: 141.6 }],
    '北海道日本海沿岸南部': [{ latitude: 43.9, longitude: 141.6 }, { latitude: 43.1, longitude: 140.8 }, { latitude: 42.1, longitude: 140.2 }],
    'オホーツク海沿岸': [{ latitude: 45.4, longitude: 141.7 }, { latitude: 44.4, longitude: 143.3 }, { latitude: 43.9, longitude: 144.8 }],
    '青森県日本海沿岸': [{ latitude: 41.2, longitude: 140.1 }, { latitude: 40.8, longitude: 140.0 }, { latitude: 40.5, longitude: 140.0 }],
    '青森県太平洋沿岸': [{ latitude: 41.5, longitude: 141.4 }, { latitude: 40.9, longitude: 141.4 }, { latitude: 40.5, longitude: 141.7 }],
    '陸奥湾': [{ latitude: 41.0, longitude: 140.7 }, { latitude: 41.0, longitude: 141.1 }],
    '岩手県': [{ latitude: 40.3, longitude: 141.8 }, { latitude: 39.6, longitude: 142.0 }, { latitude: 39.0, longitude: 141.9 }],
    '宮城県': [{ latitude: 38.9, longitude: 141.7 }, { latitude: 38.4, longitude: 141.5 }, { latitude: 37.9, longitude: 141.0 }],
    '福島県': [{ latitude: 37.9, longitude: 141.0 }, { latitude: 37.4, longitude: 141.0 }, { latitude: 36.9, longitude: 140.9 }],
    '茨城県': [{ latitude: 36.9, longitude: 140.9 }, { latitude: 36.3, longitude: 140.7 }, { latitude: 35.8, longitude: 140.8 }],
    '千葉県九十九里・外房': [{ latitude: 35.8, longitude: 140.8 }, { latitude: 35.3, longitude: 140.4 }, { latitude: 34.9, longitude: 140.0 }],
    '千葉県内房': [{ latitude: 35.3, longitude: 139.8 }, { latitude: 35.0, longitude: 139.8 }, { latitude: 34.9, longitude: 139.9 }],
    '東京湾内湾': [{ latitude: 35.6, longitude: 139.8 }, { latitude: 35.4, longitude: 139.9 }, { latitude: 35.2, longitude: 139.8 }],
    '伊豆諸島': [{ latitude: 34.7, longitude: 139.4 }, { latitude: 34.0, longitude: 139.5 }, { latitude: 33.1, longitude: 139.8 }],
    '小笠原諸島': [{ latitude: 27.7, longitude: 142.1 }, { latitude: 27.1, longitude: 142.2 }, { latitude: 26.6, longitude: 142.2 }],
    '相模湾・三浦半島': [{ latitude: 35.3, longitude: 139.3 }, { latitude: 35.2, longitude: 139.6 }, { latitude: 35.1, longitude: 139.7 }],
    '静岡県': [{ latitude: 35.0, longitude: 138.9 }, { latitude: 34.7, longitude: 138.2 }, { latitude: 34.6, longitude: 137.6 }],
    '愛知県外海': [{ latitude: 34.6, longitude: 137.3 }, { latitude: 34.6, longitude: 137.0 }, { latitude: 34.7, longitude: 136.9 }],
    '伊勢・三河湾': [{ latitude: 34.8, longitude: 136.8 }, { latitude: 34.6, longitude: 136.7 }, { latitude: 34.5, longitude: 136.9 }],
    '三重県南部': [{ latitude: 34.4, longitude: 136.9 }, { latitude: 34.0, longitude: 136.3 }, { latitude: 33.8, longitude: 136.0 }],
    '和歌山県': [{ latitude: 33.8, longitude: 136.0 }, { latitude: 33.7, longitude: 135.4 }, { latitude: 34.1, longitude: 135.0 }],
    '大阪府': [{ latitude: 34.7, longitude: 135.2 }, { latitude: 34.5, longitude: 135.2 }],
    '兵庫県瀬戸内海沿岸': [{ latitude: 34.7, longitude: 135.0 }, { latitude: 34.6, longitude: 134.6 }, { latitude: 34.5, longitude: 134.2 }],
    '淡路島南部': [{ latitude: 34.4, longitude: 134.8 }, { latitude: 34.2, longitude: 134.7 }],
    '岡山県': [{ latitude: 34.5, longitude: 134.2 }, { latitude: 34.4, longitude: 133.7 }, { latitude: 34.4, longitude: 133.3 }],
    '香川県': [{ latitude: 34.4, longitude: 134.4 }, { latitude: 34.3, longitude: 134.0 }, { latitude: 34.2, longitude: 133.6 }],
    '徳島県': [{ latitude: 34.2, longitude: 134.6 }, { latitude: 33.9, longitude: 134.6 }, { latitude: 33.7, longitude: 134.3 }],
    '愛媛県瀬戸内海沿岸': [{ latitude: 34.1, longitude: 133.0 }, { latitude: 33.9, longitude: 132.5 }, { latitude: 33.9, longitude: 132.0 }],
    '愛媛県宇和海沿岸': [{ latitude: 33.5, longitude: 132.5 }, { latitude: 33.2, longitude: 132.4 }, { latitude: 32.9, longitude: 132.5 }],
    '高知県': [{ latitude: 33.5, longitude: 133.5 }, { latitude: 33.2, longitude: 133.0 }, { latitude: 32.8, longitude: 132.8 }],
    '福岡県日本海沿岸': [{ latitude: 33.9, longitude: 130.9 }, { latitude: 33.7, longitude: 130.4 }, { latitude: 33.9, longitude: 130.0 }],
    '有明・八代海': [{ latitude: 33.0, longitude: 130.25 }, { latitude: 32.6, longitude: 130.32 }, { latitude: 32.2, longitude: 130.25 }],
    '佐賀県北部': [{ latitude: 33.6, longitude: 130.4 }, { latitude: 33.5, longitude: 129.9 }],
    '長崎県西方': [{ latitude: 33.3, longitude: 129.6 }, { latitude: 32.8, longitude: 129.5 }, { latitude: 32.6, longitude: 129.7 }],
    '熊本県天草灘沿岸': [{ latitude: 32.5, longitude: 130.1 }, { latitude: 32.2, longitude: 130.0 }, { latitude: 31.9, longitude: 130.1 }],
    '大分県瀬戸内海沿岸': [{ latitude: 33.7, longitude: 131.7 }, { latitude: 33.4, longitude: 131.7 }, { latitude: 33.3, longitude: 131.9 }],
    '大分県豊後水道沿岸': [{ latitude: 33.1, longitude: 131.9 }, { latitude: 32.8, longitude: 131.9 }],
    '宮崎県': [{ latitude: 32.7, longitude: 131.9 }, { latitude: 32.0, longitude: 131.5 }, { latitude: 31.5, longitude: 131.4 }],
    '鹿児島県東部': [{ latitude: 31.5, longitude: 131.1 }, { latitude: 31.2, longitude: 130.8 }, { latitude: 30.9, longitude: 130.8 }],
    '鹿児島県西部': [{ latitude: 31.7, longitude: 130.3 }, { latitude: 31.4, longitude: 130.2 }, { latitude: 31.0, longitude: 130.2 }],
    '種子島・屋久島地方': [{ latitude: 30.8, longitude: 131.0 }, { latitude: 30.4, longitude: 130.6 }, { latitude: 30.2, longitude: 130.5 }],
    '奄美群島・トカラ列島': [{ latitude: 29.8, longitude: 129.8 }, { latitude: 28.5, longitude: 129.4 }, { latitude: 27.7, longitude: 128.9 }],
    '沖縄本島地方': [{ latitude: 26.9, longitude: 128.2 }, { latitude: 26.2, longitude: 127.7 }, { latitude: 25.8, longitude: 127.2 }],
    '大東島地方': [{ latitude: 25.9, longitude: 131.2 }, { latitude: 25.8, longitude: 131.3 }],
    '宮古島・八重山地方': [{ latitude: 24.9, longitude: 125.3 }, { latitude: 24.4, longitude: 124.2 }, { latitude: 24.3, longitude: 123.8 }],
    '新潟県': [{ latitude: 38.4, longitude: 139.5 }, { latitude: 37.8, longitude: 138.9 }, { latitude: 37.0, longitude: 138.2 }],
    '富山県': [{ latitude: 36.9, longitude: 137.4 }, { latitude: 36.8, longitude: 137.0 }],
    '石川県': [{ latitude: 37.5, longitude: 137.3 }, { latitude: 36.9, longitude: 136.8 }, { latitude: 36.4, longitude: 136.4 }],
    '福井県': [{ latitude: 36.3, longitude: 136.1 }, { latitude: 35.9, longitude: 135.9 }, { latitude: 35.6, longitude: 135.8 }],
    '京都府': [{ latitude: 35.8, longitude: 135.1 }, { latitude: 35.6, longitude: 135.2 }],
    '兵庫県日本海沿岸': [{ latitude: 35.7, longitude: 134.8 }, { latitude: 35.6, longitude: 134.4 }],
    '鳥取県': [{ latitude: 35.6, longitude: 134.4 }, { latitude: 35.5, longitude: 133.8 }, { latitude: 35.4, longitude: 133.3 }],
    '島根県': [{ latitude: 35.5, longitude: 133.2 }, { latitude: 35.3, longitude: 132.4 }, { latitude: 35.1, longitude: 131.8 }],
    '山口県日本海沿岸': [{ latitude: 34.7, longitude: 131.6 }, { latitude: 34.4, longitude: 131.1 }, { latitude: 34.3, longitude: 130.9 }],
    '山口県瀬戸内海沿岸': [{ latitude: 34.1, longitude: 132.0 }, { latitude: 34.0, longitude: 131.4 }, { latitude: 33.9, longitude: 131.0 }],
    '福岡県瀬戸内海沿岸': [{ latitude: 33.9, longitude: 131.0 }, { latitude: 33.9, longitude: 130.8 }],
    '山形県': [{ latitude: 39.1, longitude: 139.7 }, { latitude: 38.6, longitude: 139.5 }],
    '秋田県': [{ latitude: 40.4, longitude: 140.0 }, { latitude: 39.7, longitude: 139.8 }, { latitude: 39.0, longitude: 139.8 }],
};
const DETAILED_TSUNAMI_COAST_LINES = {
    '有明・八代海': [
        [
            { latitude: 33.19, longitude: 130.39 },
            { latitude: 33.12, longitude: 130.39 },
            { latitude: 33.05, longitude: 130.36 },
            { latitude: 32.95, longitude: 130.31 },
            { latitude: 32.87, longitude: 130.28 },
            { latitude: 32.78, longitude: 130.33 },
            { latitude: 32.70, longitude: 130.45 },
            { latitude: 32.62, longitude: 130.54 },
            { latitude: 32.55, longitude: 130.57 },
        ],
        [
            { latitude: 32.91, longitude: 130.19 },
            { latitude: 32.84, longitude: 130.22 },
            { latitude: 32.78, longitude: 130.28 },
            { latitude: 32.72, longitude: 130.32 },
            { latitude: 32.66, longitude: 130.33 },
        ],
        [
            { latitude: 32.56, longitude: 130.56 },
            { latitude: 32.48, longitude: 130.58 },
            { latitude: 32.39, longitude: 130.55 },
            { latitude: 32.30, longitude: 130.49 },
            { latitude: 32.22, longitude: 130.43 },
            { latitude: 32.16, longitude: 130.36 },
        ],
        [
            { latitude: 32.43, longitude: 130.42 },
            { latitude: 32.36, longitude: 130.39 },
            { latitude: 32.29, longitude: 130.34 },
            { latitude: 32.23, longitude: 130.29 },
            { latitude: 32.18, longitude: 130.25 },
        ],
    ],
    '長崎県西方': [
        [
            { latitude: 33.47, longitude: 129.98 },
            { latitude: 33.39, longitude: 129.84 },
            { latitude: 33.29, longitude: 129.73 },
            { latitude: 33.18, longitude: 129.62 },
            { latitude: 33.05, longitude: 129.59 },
            { latitude: 32.93, longitude: 129.60 },
            { latitude: 32.81, longitude: 129.66 },
            { latitude: 32.70, longitude: 129.76 },
            { latitude: 32.61, longitude: 129.86 },
        ],
        [
            { latitude: 32.94, longitude: 129.07 },
            { latitude: 32.83, longitude: 128.98 },
            { latitude: 32.72, longitude: 128.83 },
            { latitude: 32.62, longitude: 128.68 },
        ],
        [
            { latitude: 34.28, longitude: 129.26 },
            { latitude: 34.20, longitude: 129.21 },
            { latitude: 34.11, longitude: 129.19 },
            { latitude: 34.02, longitude: 129.15 },
        ],
    ],
    '熊本県天草灘沿岸': [
        [
            { latitude: 32.59, longitude: 130.44 },
            { latitude: 32.52, longitude: 130.36 },
            { latitude: 32.45, longitude: 130.27 },
            { latitude: 32.38, longitude: 130.20 },
            { latitude: 32.29, longitude: 130.15 },
            { latitude: 32.20, longitude: 130.10 },
            { latitude: 32.11, longitude: 130.04 },
        ],
        [
            { latitude: 32.52, longitude: 130.12 },
            { latitude: 32.45, longitude: 130.08 },
            { latitude: 32.37, longitude: 130.03 },
            { latitude: 32.29, longitude: 129.98 },
            { latitude: 32.20, longitude: 129.94 },
        ],
        [
            { latitude: 32.34, longitude: 130.34 },
            { latitude: 32.28, longitude: 130.29 },
            { latitude: 32.22, longitude: 130.24 },
            { latitude: 32.16, longitude: 130.18 },
        ],
    ],
};
function project(coordinate, zoom) {
    const sinLat = Math.sin(coordinate.latitude * Math.PI / 180);
    const worldSize = TILE_SIZE * 2 ** zoom;
    return {
        x: (coordinate.longitude + 180) / 360 * worldSize,
        y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
    };
}
function boundsFromCoordinates(coordinates, padding = 0.25) {
    if (!coordinates.length)
        return null;
    return {
        minLatitude: Math.min(...coordinates.map(coordinate => coordinate.latitude)) - padding,
        maxLatitude: Math.max(...coordinates.map(coordinate => coordinate.latitude)) + padding,
        minLongitude: Math.min(...coordinates.map(coordinate => coordinate.longitude)) - padding,
        maxLongitude: Math.max(...coordinates.map(coordinate => coordinate.longitude)) + padding,
    };
}
function coordinateInBounds(coordinate, bounds) {
    return (coordinate.latitude >= bounds.minLatitude &&
        coordinate.latitude <= bounds.maxLatitude &&
        coordinate.longitude >= bounds.minLongitude &&
        coordinate.longitude <= bounds.maxLongitude);
}
function segmentDistance(a, b) {
    const latDelta = a.latitude - b.latitude;
    const lonDelta = a.longitude - b.longitude;
    return Math.sqrt(latDelta * latDelta + lonDelta * lonDelta);
}
function totalLineDistance(coordinates) {
    return coordinates.reduce((sum, coordinate, index) => {
        if (index === 0)
            return 0;
        return sum + segmentDistance(coordinates[index - 1], coordinate);
    }, 0);
}
function coastlineSegmentsFromLine(coordinates, areaBounds) {
    const segments = [];
    let current = [];
    for (let index = 1; index < coordinates.length; index += 1) {
        const previous = coordinates[index - 1];
        const coordinate = coordinates[index];
        const middle = {
            latitude: (previous.latitude + coordinate.latitude) / 2,
            longitude: (previous.longitude + coordinate.longitude) / 2,
        };
        const keep = (coordinateInBounds(middle, areaBounds));
        if (keep) {
            if (!current.length)
                current.push(previous);
            current.push(coordinate);
            continue;
        }
        if (current.length >= 2 && totalLineDistance(current) > 0.01) {
            segments.push(current);
        }
        current = [];
    }
    if (current.length >= 2 && totalLineDistance(current) > 0.01) {
        segments.push(current);
    }
    return segments;
}
function padBounds(bounds, padding) {
    return {
        minLatitude: bounds.minLatitude - padding,
        maxLatitude: bounds.maxLatitude + padding,
        minLongitude: bounds.minLongitude - padding,
        maxLongitude: bounds.maxLongitude + padding,
    };
}
function boundsForTsunamiAreaName(name) {
    const detailed = Object.entries(DETAILED_TSUNAMI_COAST_LINES)
        .find(([key]) => name.includes(key) || key.includes(name));
    if (detailed) {
        return boundsFromCoordinates(detailed[1].flat(), 0.18);
    }
    const simple = Object.entries(TSUNAMI_COAST_LINES)
        .find(([key]) => name.includes(key) || key.includes(name));
    if (simple) {
        return boundsFromCoordinates(simple[1], 0.28);
    }
    const point = pointForAreaName(name);
    if (!point)
        return null;
    return {
        minLatitude: point.latitude - 0.7,
        maxLatitude: point.latitude + 0.7,
        minLongitude: point.longitude - 0.9,
        maxLongitude: point.longitude + 0.9,
    };
}
function normalizeLineCoordinates(coordinates) {
    if (!Array.isArray(coordinates))
        return [];
    const isPosition = (value) => Array.isArray(value) &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'number';
    if (coordinates.every(isPosition)) {
        return [coordinates.map(([longitude, latitude]) => ({ latitude, longitude }))];
    }
    return coordinates.flatMap(child => normalizeLineCoordinates(child));
}
function worldCoastlineRings() {
    if (cachedWorldCoastlineRings)
        return cachedWorldCoastlineRings;
    const land = topojson.feature(landTopology, landTopology.objects.land);
    cachedWorldCoastlineRings = (land.features ?? [])
        .flatMap(feature => normalizeLineCoordinates(feature.geometry?.coordinates));
    return cachedWorldCoastlineRings;
}
async function fetchGsiCoastlineLines(bounds, color) {
    const paddedBounds = padBounds(bounds, 0.08);
    const lines = [];
    for (const coordinates of worldCoastlineRings()) {
        for (const segment of coastlineSegmentsFromLine(coordinates, paddedBounds)) {
            lines.push({
                coordinates: segment,
                color,
            });
        }
    }
    return lines;
}
function collectCoordinates(points, lines) {
    return [
        ...points,
        ...lines.flatMap(line => line.coordinates),
    ];
}
function centerOf(points, lines = []) {
    const coordinates = collectCoordinates(points, lines);
    if (!coordinates.length)
        return { latitude: 36.2, longitude: 138.2 };
    return {
        latitude: coordinates.reduce((sum, point) => sum + point.latitude, 0) / coordinates.length,
        longitude: coordinates.reduce((sum, point) => sum + point.longitude, 0) / coordinates.length,
    };
}
function calculateZoom(points, lines = []) {
    const coordinates = collectCoordinates(points, lines);
    if (coordinates.length <= 1)
        return 7;
    const center = centerOf(points, lines);
    const maxDelta = coordinates.reduce((currentMax, point) => {
        const latDelta = Math.abs(point.latitude - center.latitude);
        const lonDelta = Math.abs(point.longitude - center.longitude);
        return Math.max(currentMax, latDelta, lonDelta);
    }, 0);
    if (maxDelta > 12)
        return 4;
    if (maxDelta > 6)
        return 5;
    if (maxDelta > 3)
        return 6;
    if (maxDelta > 1.5)
        return 7;
    return 8;
}
async function fetchTile(zoom, x, y) {
    const maxTile = 2 ** zoom;
    if (x < 0 || y < 0 || x >= maxTile || y >= maxTile)
        return null;
    const response = await (0, http_1.fetchWithTimeout)(`https://a.basemaps.cartocdn.com/dark_nolabels/${zoom}/${x}/${y}.png`);
    if (!response.ok)
        return null;
    const source = Buffer.from(await response.arrayBuffer());
    return (0, sharp_1.default)(source)
        .removeAlpha()
        .modulate({ brightness: 0.85, saturation: 0.35 })
        .png()
        .toBuffer();
}
function buildOverlaySvg(points, lines, center, zoom) {
    const centerPoint = project(center, zoom);
    const left = centerPoint.x - MAP_WIDTH / 2;
    const top = centerPoint.y - MAP_HEIGHT / 2;
    const linePath = (coordinates) => {
        return coordinates.map((coordinate, index) => {
            const point = project(coordinate, zoom);
            const x = point.x - left;
            const y = point.y - top;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');
    };
    const linePriority = (color) => {
        switch (color) {
            case '#ffff00': return 1;
            case '#ff1f1f': return 2;
            default: return 1;
        }
    };
    const linePaths = [...lines]
        .sort((a, b) => linePriority(a.color) - linePriority(b.color))
        .map(line => ({
        path: linePath(line.coordinates),
        color: line.color,
    }))
        .filter(line => line.path);
    const lineUnderlaySvg = linePaths.map(line => `
        <path d="${line.path}" fill="none" stroke="#101418" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>
    `).join('');
    const lineOverlaySvg = linePaths.map(line => `
        <path d="${line.path}" fill="none" stroke="${line.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    `).join('');
    const pointSvg = points.map(point => {
        const projected = project(point, zoom);
        const x = projected.x - left;
        const y = projected.y - top;
        const escapedLabel = point.label.replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;',
        }[char] ?? char));
        return `
            <g transform="translate(${x}, ${y})">
                <circle cx="0" cy="0" r="8" fill="${point.color}" stroke="#101418" stroke-width="2"/>
                <circle cx="0" cy="0" r="3" fill="#ffffff" opacity="0.9"/>
                <text x="12" y="4" fill="#ffffff" stroke="#101418" stroke-width="3" paint-order="stroke" font-size="12" font-family="sans-serif">${escapedLabel}</text>
            </g>
        `;
    }).join('');
    return Buffer.from(`
        <svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="rgba(16, 22, 18, 0.14)"/>
            ${lineUnderlaySvg}
            ${lineOverlaySvg}
            ${pointSvg}
        </svg>
    `);
}
function pointForAreaName(name) {
    const exact = exports.PREFECTURE_POINTS[name];
    if (exact)
        return exact;
    const special = Object.entries(exports.PREFECTURE_POINTS).find(([key]) => name.includes(key));
    if (special)
        return special[1];
    return null;
}
async function linesForTsunamiAreaName(name, color) {
    const bounds = boundsForTsunamiAreaName(name);
    if (!bounds)
        return [];
    return fetchGsiCoastlineLines(bounds, color);
}
async function createDisasterMapAttachment(points, name = 'disaster-map.png', lines = []) {
    if (!points.length && !lines.length)
        return null;
    const zoom = calculateZoom(points, lines);
    const center = centerOf(points, lines);
    const projectedCenter = project(center, zoom);
    const left = projectedCenter.x - MAP_WIDTH / 2;
    const top = projectedCenter.y - MAP_HEIGHT / 2;
    const minTileX = Math.floor(left / TILE_SIZE);
    const maxTileX = Math.floor((left + MAP_WIDTH) / TILE_SIZE);
    const minTileY = Math.floor(top / TILE_SIZE);
    const maxTileY = Math.floor((top + MAP_HEIGHT) / TILE_SIZE);
    const composites = [];
    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const tile = await fetchTile(zoom, tileX, tileY);
            if (!tile)
                continue;
            composites.push({
                input: tile,
                left: Math.round(tileX * TILE_SIZE - left),
                top: Math.round(tileY * TILE_SIZE - top),
            });
        }
    }
    composites.push({
        input: buildOverlaySvg(points, lines, center, zoom),
        left: 0,
        top: 0,
    });
    const image = await (0, sharp_1.default)({
        create: {
            width: MAP_WIDTH,
            height: MAP_HEIGHT,
            channels: 4,
            background: '#101612',
        },
    })
        .composite(composites)
        .png()
        .toBuffer();
    return new discord_js_1.AttachmentBuilder(image, { name });
}
