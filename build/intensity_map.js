"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIntensityMapAttachment = createIntensityMapAttachment;
const discord_js_1 = require("discord.js");
const sharp_1 = __importDefault(require("sharp"));
const TILE_SIZE = 256;
const MAP_WIDTH = 600;
const MAP_HEIGHT = 400;
function parseJmaCoordinate(coordinate) {
    if (!coordinate)
        return null;
    const match = coordinate.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
    if (!match)
        return null;
    return {
        latitude: Number(match[1]),
        longitude: Number(match[2]),
    };
}
function project(coordinate, zoom) {
    const sinLat = Math.sin(coordinate.latitude * Math.PI / 180);
    const worldSize = TILE_SIZE * 2 ** zoom;
    return {
        x: (coordinate.longitude + 180) / 360 * worldSize,
        y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
    };
}
function intensityRank(intensity) {
    switch (intensity) {
        case '7': return 9;
        case '6+': return 8;
        case '6-': return 7;
        case '5+': return 6;
        case '5-': return 5;
        case '4': return 4;
        case '3': return 3;
        case '2': return 2;
        case '1': return 1;
        default: return 0;
    }
}
function intensityColor(intensity) {
    switch (intensity) {
        case '7': return '#b40068';
        case '6+': return '#a50021';
        case '6-': return '#ff2800';
        case '5+': return '#ff9900';
        case '5-': return '#ffe600';
        case '4': return '#ffff00';
        case '3': return '#0041ff';
        case '2': return '#1e88ff';
        case '1': return '#75c8ff';
        default: return '#808080';
    }
}
function digitSegments(digit) {
    switch (digit) {
        case '1': return ['b', 'c'];
        case '2': return ['a', 'b', 'g', 'e', 'd'];
        case '3': return ['a', 'b', 'g', 'c', 'd'];
        case '4': return ['f', 'g', 'b', 'c'];
        case '5': return ['a', 'f', 'g', 'c', 'd'];
        case '6': return ['a', 'f', 'g', 'e', 'c', 'd'];
        case '7': return ['a', 'b', 'c'];
        default: return [];
    }
}
function segmentLine(segment) {
    switch (segment) {
        case 'a': return [-2.2, -4, 2.2, -4];
        case 'b': return [2.8, -3.4, 2.8, -0.4];
        case 'c': return [2.8, 0.8, 2.8, 3.8];
        case 'd': return [-2.2, 4.4, 2.2, 4.4];
        case 'e': return [-2.8, 0.8, -2.8, 3.8];
        case 'f': return [-2.8, -3.4, -2.8, -0.4];
        case 'g': return [-2.2, 0.2, 2.2, 0.2];
        default: return [0, 0, 0, 0];
    }
}
function digitSvg(digit, x, y, color) {
    return digitSegments(digit).map(segment => {
        const [x1, y1, x2, y2] = segmentLine(segment);
        return `<line x1="${x + x1}" y1="${y + y1}" x2="${x + x2}" y2="${y + y2}" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/>`;
    }).join('');
}
function signSvg(sign, x, y, color) {
    if (sign === '+') {
        return `
            <line x1="${x - 1.8}" y1="${y}" x2="${x + 1.8}" y2="${y}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="${x}" y1="${y - 1.8}" x2="${x}" y2="${y + 1.8}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        `;
    }
    if (sign === '-') {
        return `<line x1="${x - 1.8}" y1="${y}" x2="${x + 1.8}" y2="${y}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`;
    }
    return '';
}
function intensityLabelSvg(label, x, y, color) {
    if (!label)
        return '';
    if (label.length === 1)
        return digitSvg(label, x, y, color);
    return `
        ${digitSvg(label[0], x - 2.2, y, color)}
        ${signSvg(label[1], x + 4.3, y - 0.2, color)}
    `;
}
function buildLegendSvg() {
    const entries = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'];
    const rowHeight = 18;
    const legendX = 12;
    const legendY = 12;
    const legendWidth = 82;
    const legendHeight = 18 + entries.length * rowHeight;
    const rows = entries.map((label, index) => {
        const y = legendY + 22 + index * rowHeight;
        return `
            <rect x="${legendX + 10}" y="${y - 8}" width="16" height="12" rx="2" fill="${intensityColor(label)}" stroke="#101418" stroke-width="1.5"/>
            ${intensityLabelSvg(label, legendX + 46, y - 2, '#ffffff')}
        `;
    }).join('');
    return `
        <g>
            <rect x="${legendX}" y="${legendY}" width="${legendWidth}" height="${legendHeight}" rx="4" fill="rgba(12, 16, 18, 0.84)" stroke="#ffffff" stroke-opacity="0.5"/>
            ${rows}
        </g>
    `;
}
function zoomFromMagnitude(magnitude) {
    const value = Number(magnitude);
    if (!Number.isFinite(value))
        return 7;
    if (value >= 8)
        return 4;
    if (value >= 7)
        return 5;
    if (value >= 6)
        return 6;
    if (value >= 5)
        return 7;
    if (value >= 4)
        return 8;
    return 9;
}
function zoomFromSpread(epicenter, points) {
    const maxDelta = points.reduce((currentMax, point) => {
        const latDelta = Math.abs(point.latitude - epicenter.latitude);
        const lonDelta = Math.abs(point.longitude - epicenter.longitude);
        return Math.max(currentMax, latDelta, lonDelta);
    }, 0);
    if (maxDelta > 8)
        return 4;
    if (maxDelta > 4)
        return 5;
    if (maxDelta > 2)
        return 6;
    if (maxDelta > 1)
        return 7;
    if (maxDelta > 0.5)
        return 8;
    return 9;
}
function calculateZoom(detail, epicenter, points) {
    var _a, _b;
    const magnitudeZoom = zoomFromMagnitude((_b = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Earthquake) === null || _b === void 0 ? void 0 : _b.Magnitude);
    const spreadZoom = zoomFromSpread(epicenter, points);
    return Math.max(4, Math.min(10, Math.min(magnitudeZoom, spreadZoom)));
}
function collectStations(detail) {
    var _a, _b, _c, _d, _e;
    return (_e = (_d = (_c = (_b = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Intensity) === null || _b === void 0 ? void 0 : _b.Observation) === null || _c === void 0 ? void 0 : _c.Pref) === null || _d === void 0 ? void 0 : _d.flatMap(pref => { var _a; return (_a = pref.Area) !== null && _a !== void 0 ? _a : []; }).flatMap(area => { var _a; return (_a = area.City) !== null && _a !== void 0 ? _a : []; }).flatMap(city => { var _a; return (_a = city.IntensityStation) !== null && _a !== void 0 ? _a : []; }).filter((station) => {
        var _a, _b;
        return typeof ((_a = station.latlon) === null || _a === void 0 ? void 0 : _a.lat) === 'number' &&
            typeof ((_b = station.latlon) === null || _b === void 0 ? void 0 : _b.lon) === 'number';
    }).map(station => (Object.assign(Object.assign({}, station), { coordinate: {
            latitude: station.latlon.lat,
            longitude: station.latlon.lon,
        } }))).sort((a, b) => intensityRank(b.Int) - intensityRank(a.Int)).slice(0, 120)) !== null && _e !== void 0 ? _e : [];
}
function fetchTile(zoom, x, y) {
    return __awaiter(this, void 0, void 0, function* () {
        const maxTile = 2 ** zoom;
        if (x < 0 || y < 0 || x >= maxTile || y >= maxTile)
            return null;
        const response = yield fetch(`https://a.basemaps.cartocdn.com/dark_nolabels/${zoom}/${x}/${y}.png`);
        if (!response.ok)
            return null;
        const source = Buffer.from(yield response.arrayBuffer());
        return (0, sharp_1.default)(source)
            .removeAlpha()
            .modulate({ brightness: 0.85, saturation: 0.35 })
            .png()
            .toBuffer();
    });
}
function buildOverlaySvg(detail, epicenter, stations, zoom) {
    const center = project(epicenter, zoom);
    const left = center.x - MAP_WIDTH / 2;
    const top = center.y - MAP_HEIGHT / 2;
    const visibleStations = stations.map(station => {
        const point = project(station.coordinate, zoom);
        const x = point.x - left;
        const y = point.y - top;
        return { station, x, y };
    }).filter(({ x, y }) => x >= -20 && y >= -20 && x <= MAP_WIDTH + 20 && y <= MAP_HEIGHT + 20);
    const stationByCell = new Map();
    for (const item of visibleStations) {
        const cell = `${Math.round(item.x / 12)}:${Math.round(item.y / 12)}`;
        const current = stationByCell.get(cell);
        if (!current || intensityRank(item.station.Int) > intensityRank(current.station.Int)) {
            stationByCell.set(cell, item);
        }
    }
    const stationSvg = [...stationByCell.values()].map(({ station, x, y }) => {
        const radius = intensityRank(station.Int) >= 5 ? 8 : 6;
        return `
            <circle cx="${x}" cy="${y}" r="${radius}" fill="${intensityColor(station.Int)}" stroke="#101418" stroke-width="2"/>
        `;
    }).join('');
    const epicenterPoint = project(epicenter, zoom);
    const epicenterX = epicenterPoint.x - left;
    const epicenterY = epicenterPoint.y - top;
    const svg = `
        <svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="rgba(16, 22, 18, 0.12)"/>
            ${stationSvg}
            <g transform="translate(${epicenterX}, ${epicenterY})">
                <line x1="-8" y1="-8" x2="8" y2="8" stroke="#ff493d" stroke-width="3" stroke-linecap="round"/>
                <line x1="8" y1="-8" x2="-8" y2="8" stroke="#ff493d" stroke-width="3" stroke-linecap="round"/>
                <line x1="-8" y1="-8" x2="8" y2="8" stroke="#ffffff" stroke-width="1" stroke-linecap="round"/>
                <line x1="8" y1="-8" x2="-8" y2="8" stroke="#ffffff" stroke-width="1" stroke-linecap="round"/>
            </g>
            ${buildLegendSvg()}
        </svg>
    `;
    return Buffer.from(svg);
}
function createIntensityMapAttachment(detail_1) {
    return __awaiter(this, arguments, void 0, function* (detail, name = 'intensity-map.png') {
        var _a, _b, _c, _d;
        const epicenter = parseJmaCoordinate((_d = (_c = (_b = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Earthquake) === null || _b === void 0 ? void 0 : _b.Hypocenter) === null || _c === void 0 ? void 0 : _c.Area) === null || _d === void 0 ? void 0 : _d.Coordinate);
        if (!epicenter)
            return null;
        const stations = collectStations(detail);
        const stationPoints = stations.map(station => station.coordinate);
        const zoom = calculateZoom(detail, epicenter, stationPoints);
        const center = project(epicenter, zoom);
        const left = center.x - MAP_WIDTH / 2;
        const top = center.y - MAP_HEIGHT / 2;
        const minTileX = Math.floor(left / TILE_SIZE);
        const maxTileX = Math.floor((left + MAP_WIDTH) / TILE_SIZE);
        const minTileY = Math.floor(top / TILE_SIZE);
        const maxTileY = Math.floor((top + MAP_HEIGHT) / TILE_SIZE);
        const composites = [];
        for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
            for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
                const tile = yield fetchTile(zoom, tileX, tileY);
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
            input: buildOverlaySvg(detail, epicenter, stations, zoom),
            left: 0,
            top: 0,
        });
        const image = yield (0, sharp_1.default)({
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
    });
}
