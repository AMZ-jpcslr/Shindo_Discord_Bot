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
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('get_eq')
    .setDescription('直近の緊急地震速報または地震情報を確認します');
function scaleToString(scale) {
    const value = typeof scale === 'string' ? Number(scale) : scale;
    switch (value) {
        case 10: return '1';
        case 20: return '2';
        case 30: return '3';
        case 40: return '4';
        case 45: return '5弱';
        case 50: return '5強';
        case 55: return '6弱';
        case 60: return '6強';
        case 70: return '7';
        default: return scale ? String(scale) : '不明';
    }
}
function formatDepth(depth) {
    if (depth === undefined || depth === null || depth === '')
        return '不明';
    if (typeof depth === 'number')
        return depth === 0 ? 'ごく浅い' : `${depth}km`;
    return depth;
}
function localScaleImage(scale) {
    const value = typeof scale === 'string' ? Number(scale) : scale;
    const fileNameByScale = {
        10: 'nc300018.jpg',
        20: 'nc300017.jpg',
        30: 'nc300015.jpg',
        40: 'nc300014.jpg',
        45: 'nc300013.jpg',
        50: 'nc300012.jpg',
        55: 'nc300011.jpg',
        60: 'nc300010.jpg',
        70: 'nc300009.jpg',
    };
    const fileName = value ? fileNameByScale[value] : undefined;
    if (!fileName)
        return null;
    const filePath = [
        path_1.default.join(process.cwd(), fileName),
        path_1.default.join(__dirname, '..', fileName),
        path_1.default.join(__dirname, '../..', fileName),
    ].find(candidate => fs_1.default.existsSync(candidate));
    if (!filePath)
        return null;
    return new discord_js_1.AttachmentBuilder(filePath, { name: fileName });
}
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
function normalizeJmaTime(time) {
    if (!time)
        return null;
    return time.replace(/\//g, '-').replace(' ', 'T').slice(0, 16);
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
function intensityMarkerStyle(intensity) {
    switch (intensity) {
        case '7': return 'pm2vvm';
        case '6+': return 'pm2rdm';
        case '6-': return 'pm2rdm';
        case '5+': return 'pm2orm';
        case '5-': return 'pm2ywm';
        case '4': return 'pm2ywm';
        case '3': return 'pm2blm';
        case '2': return 'pm2lbm';
        case '1': return 'pm2grm';
        default: return 'pm2grm';
    }
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
function calculateMapZoom(detail, epicenter, points) {
    var _a, _b;
    const magnitudeZoom = zoomFromMagnitude((_b = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Earthquake) === null || _b === void 0 ? void 0 : _b.Magnitude);
    const spreadZoom = zoomFromSpread(epicenter, points);
    return clamp(Math.min(magnitudeZoom, spreadZoom), 4, 9);
}
function buildJmaIntensityMapUrl(detail) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const coordinate = parseJmaCoordinate((_d = (_c = (_b = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Earthquake) === null || _b === void 0 ? void 0 : _b.Hypocenter) === null || _c === void 0 ? void 0 : _c.Area) === null || _d === void 0 ? void 0 : _d.Coordinate);
    if (!coordinate)
        return null;
    const stations = (_j = (_h = (_g = (_f = (_e = detail.Body) === null || _e === void 0 ? void 0 : _e.Intensity) === null || _f === void 0 ? void 0 : _f.Observation) === null || _g === void 0 ? void 0 : _g.Pref) === null || _h === void 0 ? void 0 : _h.flatMap(pref => { var _a; return (_a = pref.Area) !== null && _a !== void 0 ? _a : []; }).flatMap(area => { var _a; return (_a = area.City) !== null && _a !== void 0 ? _a : []; }).flatMap(city => { var _a; return (_a = city.IntensityStation) !== null && _a !== void 0 ? _a : []; }).filter(station => {
        var _a, _b;
        return typeof ((_a = station.latlon) === null || _a === void 0 ? void 0 : _a.lat) === 'number' &&
            typeof ((_b = station.latlon) === null || _b === void 0 ? void 0 : _b.lon) === 'number';
    }).sort((a, b) => intensityRank(b.Int) - intensityRank(a.Int)).slice(0, 80)) !== null && _j !== void 0 ? _j : [];
    const stationPoints = stations.map(station => {
        var _a, _b;
        return ({
            latitude: (_a = station.latlon) === null || _a === void 0 ? void 0 : _a.lat,
            longitude: (_b = station.latlon) === null || _b === void 0 ? void 0 : _b.lon,
        });
    });
    const zoom = calculateMapZoom(detail, coordinate, stationPoints);
    const markers = [
        `${coordinate.longitude},${coordinate.latitude},pm2rdm`,
        ...stations.map(station => { var _a, _b; return `${(_a = station.latlon) === null || _a === void 0 ? void 0 : _a.lon},${(_b = station.latlon) === null || _b === void 0 ? void 0 : _b.lat},${intensityMarkerStyle(station.Int)}`; }),
    ].join('~');
    return `https://static-maps.yandex.ru/1.x/?ll=${coordinate.longitude},${coordinate.latitude}&z=${zoom}&size=600,400&l=map&lang=en_US&pt=${encodeURIComponent(markers)}`;
}
function selectBestJmaItem(items) {
    return items
        .filter(item => isValidJmaJsonPath(item.json))
        .sort((a, b) => {
        var _a, _b, _c, _d;
        const aHasIntensityMap = ((_a = a.json) === null || _a === void 0 ? void 0 : _a.includes('VXSE5k')) ? 1 : 0;
        const bHasIntensityMap = ((_b = b.json) === null || _b === void 0 ? void 0 : _b.includes('VXSE5k')) ? 1 : 0;
        if (aHasIntensityMap !== bHasIntensityMap)
            return bHasIntensityMap - aHasIntensityMap;
        if (a.maxi && !b.maxi)
            return -1;
        if (!a.maxi && b.maxi)
            return 1;
        return String((_c = b.ctt) !== null && _c !== void 0 ? _c : '').localeCompare(String((_d = a.ctt) !== null && _d !== void 0 ? _d : ''));
    })[0];
}
function fetchJmaDetail(jsonPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const detailResponse = yield fetch(`https://www.jma.go.jp/bosai/quake/data/${jsonPath}`);
        return detailResponse.json();
    });
}
function findJmaDetailForEew(eew) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const listResponse = yield fetch('https://www.jma.go.jp/bosai/quake/data/list.json');
        const list = yield listResponse.json();
        const hypocenter = (_a = eew.earthquake) === null || _a === void 0 ? void 0 : _a.hypocenter;
        const normalizedOrigin = normalizeJmaTime((_b = eew.earthquake) === null || _b === void 0 ? void 0 : _b.originTime);
        const magnitude = typeof (hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.magnitude) === 'number' ? hypocenter.magnitude.toFixed(1) : null;
        const candidates = list.filter(item => {
            var _a;
            if (!isValidJmaJsonPath(item.json))
                return false;
            if (((_a = eew.issue) === null || _a === void 0 ? void 0 : _a.eventId) && item.eid === eew.issue.eventId)
                return true;
            const sameTime = normalizedOrigin && normalizeJmaTime(item.at) === normalizedOrigin;
            const sameName = !(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.name) || item.anm === hypocenter.name;
            const sameMagnitude = !magnitude || item.mag === magnitude;
            return Boolean(sameTime && sameName && sameMagnitude);
        });
        const best = selectBestJmaItem(candidates);
        return (best === null || best === void 0 ? void 0 : best.json) ? fetchJmaDetail(best.json) : null;
    });
}
function isValidJmaJsonPath(jsonPath) {
    return (typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..'));
}
function buildEewEmbed(eew) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const hypocenter = (_a = eew.earthquake) === null || _a === void 0 ? void 0 : _a.hypocenter;
        const maxScale = Math.max(...((_b = eew.areas) !== null && _b !== void 0 ? _b : []).map(area => area.scaleTo), 0);
        const scaleImage = localScaleImage(maxScale);
        const jmaDetail = yield findJmaDetailForEew(eew).catch(() => null);
        const intensityMapUrl = jmaDetail ? buildJmaIntensityMapUrl(jmaDetail) : null;
        const areas = [...((_c = eew.areas) !== null && _c !== void 0 ? _c : [])]
            .sort((a, b) => b.scaleTo - a.scaleTo)
            .slice(0, 8)
            .map(area => `${area.name}: ${scaleToString(area.scaleFrom)}${area.scaleFrom === area.scaleTo ? '' : `-${scaleToString(area.scaleTo)}`}`)
            .join('\n');
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(eew.cancelled ? '直近の緊急地震速報 取消' : '直近の緊急地震速報')
            .setColor(eew.cancelled ? 0x808080 : 0xff2d2d)
            .addFields({ name: '震源', value: (_d = hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.name) !== null && _d !== void 0 ? _d : '不明', inline: true }, { name: '規模', value: (hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.magnitude) ? `M${hypocenter.magnitude}` : '不明', inline: true }, { name: '深さ', value: formatDepth(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.depth), inline: true }, { name: '最大予測震度', value: maxScale > 0 ? scaleToString(maxScale) : '不明', inline: true }, { name: '発生時刻', value: (_f = (_e = eew.earthquake) === null || _e === void 0 ? void 0 : _e.originTime) !== null && _f !== void 0 ? _f : '不明', inline: true }, { name: '発表時刻', value: (_j = (_h = (_g = eew.issue) === null || _g === void 0 ? void 0 : _g.time) !== null && _h !== void 0 ? _h : eew.time) !== null && _j !== void 0 ? _j : '不明', inline: true })
            .setFooter({ text: 'Source: P2P地震情報 / 気象庁' });
        if (areas) {
            embed.addFields({ name: '主な予測地域', value: areas, inline: false });
        }
        if (typeof (hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.latitude) === 'number' && typeof hypocenter.longitude === 'number') {
            embed.addFields({
                name: '地図',
                value: `[震源付近を開く](https://www.google.com/maps?q=${hypocenter.latitude},${hypocenter.longitude})`,
                inline: false,
            });
        }
        if (scaleImage) {
            embed.setThumbnail(`attachment://${scaleImage.name}`);
        }
        if (intensityMapUrl) {
            embed.setImage(intensityMapUrl);
        }
        return scaleImage ? { embeds: [embed], files: [scaleImage] } : { embeds: [embed] };
    });
}
function buildJmaEmbed(detail) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const earthquake = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Earthquake;
    const hypocenter = (_b = earthquake === null || earthquake === void 0 ? void 0 : earthquake.Hypocenter) === null || _b === void 0 ? void 0 : _b.Area;
    const maxScale = (_e = (_d = (_c = detail.Body) === null || _c === void 0 ? void 0 : _c.Intensity) === null || _d === void 0 ? void 0 : _d.Observation) === null || _e === void 0 ? void 0 : _e.MaxInt;
    const scaleImage = localScaleImage(maxScale);
    const coordinate = parseJmaCoordinate(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Coordinate);
    const intensityMapUrl = buildJmaIntensityMapUrl(detail);
    const embed = new discord_js_1.EmbedBuilder()
        .setTitle((_g = (_f = detail.Head) === null || _f === void 0 ? void 0 : _f.Title) !== null && _g !== void 0 ? _g : '直近の地震情報')
        .setColor(0x2d6cdf)
        .setDescription(((_h = detail.Head) === null || _h === void 0 ? void 0 : _h.Text) || '気象庁から発表された直近の地震情報です。')
        .addFields({ name: '震源', value: (_j = hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Name) !== null && _j !== void 0 ? _j : '不明', inline: true }, { name: '規模', value: (earthquake === null || earthquake === void 0 ? void 0 : earthquake.Magnitude) ? `M${earthquake.Magnitude}` : '不明', inline: true }, { name: '深さ', value: formatDepth(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Depth), inline: true }, { name: '最大震度', value: scaleToString(maxScale), inline: true }, { name: '発生時刻', value: (_l = (_k = earthquake === null || earthquake === void 0 ? void 0 : earthquake.OriginTime) !== null && _k !== void 0 ? _k : earthquake === null || earthquake === void 0 ? void 0 : earthquake.ArrivalTime) !== null && _l !== void 0 ? _l : '不明', inline: true }, { name: '発表時刻', value: (_o = (_m = detail.Head) === null || _m === void 0 ? void 0 : _m.ReportDateTime) !== null && _o !== void 0 ? _o : '不明', inline: true })
        .setFooter({ text: 'Source: 気象庁' });
    if (intensityMapUrl) {
        embed.setImage(intensityMapUrl);
    }
    if (coordinate) {
        embed.addFields({
            name: '地図',
            value: `[震源付近を開く](https://www.google.com/maps?q=${coordinate.latitude},${coordinate.longitude})`,
            inline: false,
        });
    }
    if (scaleImage) {
        embed.setThumbnail(`attachment://${scaleImage.name}`);
    }
    return scaleImage ? { embeds: [embed], files: [scaleImage] } : { embeds: [embed] };
}
function execute(interaction) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield interaction.deferReply({ ephemeral: true });
        try {
            const eewResponse = yield fetch('https://api.p2pquake.net/v2/history?codes=556&limit=1');
            if (eewResponse.ok) {
                const eews = yield eewResponse.json();
                if (eews[0]) {
                    yield interaction.editReply(yield buildEewEmbed(eews[0]));
                    return;
                }
            }
            const listResponse = yield fetch('https://www.jma.go.jp/bosai/quake/data/list.json');
            const list = yield listResponse.json();
            const latestPath = (_a = list.find(item => isValidJmaJsonPath(item.json))) === null || _a === void 0 ? void 0 : _a.json;
            if (!latestPath) {
                yield interaction.editReply('直近の地震情報が見つかりませんでした。');
                return;
            }
            const detailResponse = yield fetch(`https://www.jma.go.jp/bosai/quake/data/${latestPath}`);
            const detail = yield detailResponse.json();
            yield interaction.editReply(buildJmaEmbed(detail));
        }
        catch (error) {
            console.error(error);
            yield interaction.editReply('地震情報の取得中にエラーが発生しました。');
        }
    });
}
