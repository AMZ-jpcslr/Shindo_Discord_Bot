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
exports.loadEqChannels = loadEqChannels;
exports.saveEqChannels = saveEqChannels;
exports.loadEqThresholds = loadEqThresholds;
exports.saveEqThresholds = saveEqThresholds;
exports.scaleRank = scaleRank;
exports.startEqAutoNotify = startEqAutoNotify;
const discord_js_1 = require("discord.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ws_1 = __importDefault(require("ws"));
const disaster_map_1 = require("./disaster_map");
const intensity_map_1 = require("./intensity_map");
const DATA_DIR = path_1.default.join(__dirname, '../../data');
const CHANNELS_PATH = path_1.default.join(DATA_DIR, 'eq_channels.json');
const THRESHOLDS_PATH = path_1.default.join(DATA_DIR, 'eq_thresholds.json');
const LATEST_IDS_PATH = path_1.default.join(DATA_DIR, 'latest_eq_ids.json');
const P2P_WS_URL = 'wss://api.p2pquake.net/v2/ws';
const JMA_QUAKE_LIST_URL = 'https://www.jma.go.jp/bosai/quake/data/list.json';
const JMA_TSUNAMI_LIST_URL = 'https://www.jma.go.jp/bosai/tsunami/data/list.json';
const JMA_WARNING_MAP_URL = 'https://www.jma.go.jp/bosai/warning/data/warning/map.json';
const JMA_AREA_URL = 'https://www.jma.go.jp/bosai/common/const/area.json';
const FLOOD_WARNING_CODES = new Set(['04', '18']);
function ensureDataDir() {
    fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
}
function loadEqChannels() {
    if (!fs_1.default.existsSync(CHANNELS_PATH))
        return {};
    try {
        return JSON.parse(fs_1.default.readFileSync(CHANNELS_PATH, 'utf8'));
    }
    catch (error) {
        console.error('通知チャンネル設定の読み込みに失敗しました:', error);
        return {};
    }
}
function saveEqChannels(channels) {
    ensureDataDir();
    fs_1.default.writeFileSync(CHANNELS_PATH, JSON.stringify(channels, null, 2), 'utf8');
}
function loadEqThresholds() {
    if (!fs_1.default.existsSync(THRESHOLDS_PATH))
        return {};
    try {
        return JSON.parse(fs_1.default.readFileSync(THRESHOLDS_PATH, 'utf8'));
    }
    catch (error) {
        console.error('通知震度しきい値の読み込みに失敗しました:', error);
        return {};
    }
}
function saveEqThresholds(thresholds) {
    ensureDataDir();
    fs_1.default.writeFileSync(THRESHOLDS_PATH, JSON.stringify(thresholds, null, 2), 'utf8');
}
function loadLatestIds() {
    if (!fs_1.default.existsSync(LATEST_IDS_PATH))
        return {};
    try {
        return JSON.parse(fs_1.default.readFileSync(LATEST_IDS_PATH, 'utf8'));
    }
    catch (_a) {
        return {};
    }
}
function saveLatestIds(latestIds) {
    ensureDataDir();
    fs_1.default.writeFileSync(LATEST_IDS_PATH, JSON.stringify(latestIds, null, 2), 'utf8');
}
function isSendableChannel(channel) {
    return Boolean(channel && 'send' in channel && typeof channel.send === 'function');
}
function sendToConfiguredChannels(client, payload, maxScale) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const channels = loadEqChannels();
        const thresholds = loadEqThresholds();
        const eventScale = scaleRank(maxScale);
        for (const [guildId, channelId] of Object.entries(channels)) {
            const threshold = (_a = thresholds[guildId]) !== null && _a !== void 0 ? _a : 0;
            if (threshold > 0 && eventScale < threshold)
                continue;
            const guild = client.guilds.cache.get(guildId);
            if (!guild)
                continue;
            const channel = (_b = guild.channels.cache.get(channelId)) !== null && _b !== void 0 ? _b : yield guild.channels.fetch(channelId).catch(() => null);
            if (!isSendableChannel(channel))
                continue;
            yield channel.send(payload).catch((error) => {
                console.error(`通知送信に失敗しました: guild=${guildId}, channel=${channelId}`, error);
            });
        }
    });
}
function sendDisasterToConfiguredChannels(client, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const channels = loadEqChannels();
        for (const [guildId, channelId] of Object.entries(channels)) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild)
                continue;
            const channel = (_a = guild.channels.cache.get(channelId)) !== null && _a !== void 0 ? _a : yield guild.channels.fetch(channelId).catch(() => null);
            if (!isSendableChannel(channel))
                continue;
            yield channel.send(payload).catch((error) => {
                console.error(`災害情報の通知送信に失敗しました: guild=${guildId}, channel=${channelId}`, error);
            });
        }
    });
}
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
function scaleRank(scale) {
    if (typeof scale === 'number') {
        if (scale >= 70)
            return 70;
        if (scale >= 60)
            return 60;
        if (scale >= 55)
            return 55;
        if (scale >= 50)
            return 50;
        if (scale >= 45)
            return 45;
        if (scale >= 40)
            return 40;
        if (scale >= 30)
            return 30;
        if (scale >= 20)
            return 20;
        if (scale >= 10)
            return 10;
        return 0;
    }
    switch (scale) {
        case '7': return 70;
        case '6+': return 60;
        case '6-': return 55;
        case '5+': return 50;
        case '5-': return 45;
        case '4': return 40;
        case '3': return 30;
        case '2': return 20;
        case '1': return 10;
        default: return 0;
    }
}
function formatDepth(depth) {
    if (depth === undefined || depth === null || depth === '')
        return '不明';
    if (typeof depth === 'number')
        return depth === 0 ? 'ごく浅い' : `${depth}km`;
    return depth;
}
function formatMagnitude(magnitude) {
    if (magnitude === undefined || magnitude === null || magnitude === '')
        return '不明';
    return `M${magnitude}`;
}
function formatCoordinate(latitude, longitude) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number')
        return null;
    return `[震源付近を開く](https://www.google.com/maps?q=${latitude},${longitude})`;
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
function fetchJmaList() {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(JMA_QUAKE_LIST_URL);
        if (!response.ok)
            throw new Error(`JMA list fetch failed: ${response.status}`);
        return response.json();
    });
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
        const detailUrl = `https://www.jma.go.jp/bosai/quake/data/${jsonPath}`;
        const detailResponse = yield fetch(detailUrl);
        if (!detailResponse.ok)
            throw new Error(`JMA detail fetch failed: ${detailResponse.status}`);
        return detailResponse.json();
    });
}
function fetchJmaTsunamiList() {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(JMA_TSUNAMI_LIST_URL);
        if (!response.ok)
            throw new Error(`JMA tsunami list fetch failed: ${response.status}`);
        return response.json();
    });
}
function fetchJmaTsunamiDetail(jsonPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const detailUrl = `https://www.jma.go.jp/bosai/tsunami/data/${jsonPath}`;
        const detailResponse = yield fetch(detailUrl);
        if (!detailResponse.ok)
            throw new Error(`JMA tsunami detail fetch failed: ${detailResponse.status}`);
        return detailResponse.json();
    });
}
function fetchJmaWarningMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(JMA_WARNING_MAP_URL);
        if (!response.ok)
            throw new Error(`JMA warning map fetch failed: ${response.status}`);
        return response.json();
    });
}
function fetchJmaAreaConst() {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(JMA_AREA_URL);
        if (!response.ok)
            throw new Error(`JMA area const fetch failed: ${response.status}`);
        return response.json();
    });
}
function findJmaDetailForP2P(eventId, originTime, hypocenterName, magnitude) {
    return __awaiter(this, void 0, void 0, function* () {
        const list = yield fetchJmaList();
        const normalizedOrigin = normalizeJmaTime(originTime);
        const normalizedMagnitude = typeof magnitude === 'number' ? magnitude.toFixed(1) : null;
        const candidates = list.filter(item => {
            if (!isValidJmaJsonPath(item.json))
                return false;
            if (eventId && item.eid === eventId)
                return true;
            const sameTime = normalizedOrigin && normalizeJmaTime(item.at) === normalizedOrigin;
            const sameName = !hypocenterName || item.anm === hypocenterName;
            const sameMagnitude = !normalizedMagnitude || item.mag === normalizedMagnitude;
            return Boolean(sameTime && sameName && sameMagnitude);
        });
        const best = selectBestJmaItem(candidates);
        if (!(best === null || best === void 0 ? void 0 : best.json))
            return null;
        return fetchJmaDetail(best.json);
    });
}
function tsunamiColor(kindName) {
    if (!kindName)
        return '#2d6cdf';
    if (kindName.includes('大津波'))
        return '#d900ff';
    if (kindName.includes('津波警報'))
        return '#ff1f1f';
    if (kindName.includes('津波注意報'))
        return '#ffff00';
    return '#2d6cdf';
}
function collectTsunamiPoints(detail) {
    var _a, _b, _c, _d;
    const items = (_d = (_c = (_b = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Tsunami) === null || _b === void 0 ? void 0 : _b.Forecast) === null || _c === void 0 ? void 0 : _c.Item) !== null && _d !== void 0 ? _d : [];
    return items.flatMap((item, index) => {
        var _a, _b, _c;
        const areaName = (_a = item.Area) === null || _a === void 0 ? void 0 : _a.Name;
        if (!areaName)
            return [];
        const coordinate = (0, disaster_map_1.pointForAreaName)(areaName);
        if (!coordinate)
            return [];
        return [{
                label: String(index + 1),
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                color: tsunamiColor((_c = (_b = item.Category) === null || _b === void 0 ? void 0 : _b.Kind) === null || _c === void 0 ? void 0 : _c.Name),
            }];
    });
}
function flattenAreaEntries(areaConst) {
    var _a, _b, _c, _d, _e;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, ((_a = areaConst.centers) !== null && _a !== void 0 ? _a : {})), ((_b = areaConst.offices) !== null && _b !== void 0 ? _b : {})), ((_c = areaConst.class10s) !== null && _c !== void 0 ? _c : {})), ((_d = areaConst.class15s) !== null && _d !== void 0 ? _d : {})), ((_e = areaConst.class20s) !== null && _e !== void 0 ? _e : {}));
}
function parentMap(areaConst) {
    var _a;
    const parents = {};
    for (const [code, entry] of Object.entries(flattenAreaEntries(areaConst))) {
        for (const child of (_a = entry.children) !== null && _a !== void 0 ? _a : []) {
            parents[child] = code;
        }
    }
    return parents;
}
function areaNameChain(code, areaConst) {
    var _a;
    const entries = flattenAreaEntries(areaConst);
    const parents = parentMap(areaConst);
    const names = [];
    let current = code;
    for (let depth = 0; current && depth < 6; depth += 1) {
        const name = (_a = entries[current]) === null || _a === void 0 ? void 0 : _a.name;
        if (name)
            names.push(name);
        current = parents[current];
    }
    return names;
}
function areaPointForCode(code, areaConst) {
    const names = areaNameChain(code, areaConst);
    for (const name of names) {
        const point = (0, disaster_map_1.pointForAreaName)(name);
        if (point)
            return { name, point };
    }
    return null;
}
function collectFloodAreas(warningMap, areaConst) {
    var _a, _b, _c, _d;
    const areas = new Map();
    for (const report of warningMap) {
        for (const areaType of (_a = report.areaTypes) !== null && _a !== void 0 ? _a : []) {
            for (const area of (_b = areaType.areas) !== null && _b !== void 0 ? _b : []) {
                if (!area.code)
                    continue;
                const floodWarnings = ((_c = area.warnings) !== null && _c !== void 0 ? _c : []).filter(warning => warning.code &&
                    FLOOD_WARNING_CODES.has(warning.code) &&
                    warning.status !== '解除');
                if (!floodWarnings.length)
                    continue;
                const resolved = areaPointForCode(area.code, areaConst);
                if (!resolved)
                    continue;
                const key = `${resolved.point.latitude.toFixed(2)},${resolved.point.longitude.toFixed(2)}`;
                const current = (_d = areas.get(key)) !== null && _d !== void 0 ? _d : {
                    code: area.code,
                    name: resolved.name,
                    statuses: new Set(),
                    point: resolved.point,
                };
                for (const warning of floodWarnings) {
                    current.statuses.add(warning.code === '04' ? '洪水警報' : '洪水注意報');
                }
                areas.set(key, current);
            }
        }
    }
    return [...areas.values()].map(area => ({
        code: area.code,
        name: area.name,
        statuses: [...area.statuses].sort(),
        point: area.point,
    }));
}
function floodSignature(areas, warningMap) {
    const reportTimes = warningMap
        .map(report => { var _a; return (_a = report.reportDatetime) !== null && _a !== void 0 ? _a : ''; })
        .sort();
    const latestReportTime = reportTimes.length ? reportTimes[reportTimes.length - 1] : '';
    const areaSignature = areas
        .map(area => `${area.name}:${area.statuses.join('/')}`)
        .sort()
        .join('|');
    return `${latestReportTime}:${areaSignature}`;
}
function floodColor(statuses) {
    return statuses.includes('洪水警報') ? '#ff1f1f' : '#ffff00';
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
function buildEewEmbed(message) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const hypocenter = (_a = message.earthquake) === null || _a === void 0 ? void 0 : _a.hypocenter;
        const maxScale = Math.max(...((_b = message.areas) !== null && _b !== void 0 ? _b : []).map(area => area.scaleTo), 0);
        const strongAreas = [...((_c = message.areas) !== null && _c !== void 0 ? _c : [])]
            .sort((a, b) => b.scaleTo - a.scaleTo)
            .slice(0, 8)
            .map(area => `${area.name}: ${scaleToString(area.scaleFrom)}${area.scaleFrom === area.scaleTo ? '' : `-${scaleToString(area.scaleTo)}`}`)
            .join('\n');
        const coordinateLink = formatCoordinate(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.latitude, hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.longitude);
        const jmaDetail = yield findJmaDetailForP2P((_d = message.issue) === null || _d === void 0 ? void 0 : _d.eventId, (_e = message.earthquake) === null || _e === void 0 ? void 0 : _e.originTime, hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.name, hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.magnitude).catch(() => null);
        const intensityMap = jmaDetail ? yield (0, intensity_map_1.createIntensityMapAttachment)(jmaDetail, 'intensity-map.png') : null;
        const scaleImage = localScaleImage(maxScale);
        const title = message.cancelled ? '緊急地震速報 取消' : '緊急地震速報';
        const serial = ((_f = message.issue) === null || _f === void 0 ? void 0 : _f.serial) ? `第${message.issue.serial}報` : '速報';
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`${title} (${serial})`)
            .setColor(message.cancelled ? 0x808080 : 0xff2d2d)
            .setDescription(message.cancelled ? 'この緊急地震速報は取り消されました。' : '強い揺れに警戒してください。身の安全を確保してください。')
            .addFields({ name: '震源', value: (_g = hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.name) !== null && _g !== void 0 ? _g : '不明', inline: true }, { name: '規模', value: formatMagnitude(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.magnitude), inline: true }, { name: '深さ', value: formatDepth(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.depth), inline: true }, { name: '最大予測震度', value: maxScale > 0 ? scaleToString(maxScale) : '不明', inline: true }, { name: '発生時刻', value: (_j = (_h = message.earthquake) === null || _h === void 0 ? void 0 : _h.originTime) !== null && _j !== void 0 ? _j : '不明', inline: true }, { name: '発表時刻', value: (_m = (_l = (_k = message.issue) === null || _k === void 0 ? void 0 : _k.time) !== null && _l !== void 0 ? _l : message.time) !== null && _m !== void 0 ? _m : '不明', inline: true })
            .setFooter({ text: 'Source: P2P地震情報 / 気象庁' })
            .setTimestamp(new Date());
        if (coordinateLink) {
            embed.addFields({ name: '地図', value: coordinateLink, inline: true });
        }
        if (strongAreas) {
            embed.addFields({ name: '主な予測地域', value: strongAreas.slice(0, 1024), inline: false });
        }
        if (scaleImage) {
            embed.setThumbnail(`attachment://${scaleImage.name}`);
        }
        if (intensityMap) {
            embed.setImage('attachment://intensity-map.png');
        }
        const files = [scaleImage, intensityMap].filter((file) => Boolean(file));
        return files.length ? { embeds: [embed], files } : { embeds: [embed] };
    });
}
function buildP2PQuakeEmbed(message) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const quake = message.earthquake;
        const hypocenter = quake === null || quake === void 0 ? void 0 : quake.hypocenter;
        const scaleImage = localScaleImage(quake === null || quake === void 0 ? void 0 : quake.maxScale);
        const coordinateLink = formatCoordinate(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.latitude, hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.longitude);
        const jmaDetail = yield findJmaDetailForP2P(undefined, quake === null || quake === void 0 ? void 0 : quake.time, hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.name, hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.magnitude).catch(() => null);
        const intensityMap = jmaDetail ? yield (0, intensity_map_1.createIntensityMapAttachment)(jmaDetail, 'intensity-map.png') : null;
        const observedPoints = [...((_a = message.points) !== null && _a !== void 0 ? _a : [])]
            .sort((a, b) => { var _a, _b; return ((_a = b.scale) !== null && _a !== void 0 ? _a : 0) - ((_b = a.scale) !== null && _b !== void 0 ? _b : 0); })
            .slice(0, 8)
            .map(point => { var _a, _b; return `${(_a = point.pref) !== null && _a !== void 0 ? _a : ''}${(_b = point.addr) !== null && _b !== void 0 ? _b : ''}: ${scaleToString(point.scale)}`; })
            .join('\n');
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle('地震情報')
            .setColor(0x2d6cdf)
            .addFields({ name: '震源', value: (_b = hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.name) !== null && _b !== void 0 ? _b : '不明', inline: true }, { name: '規模', value: formatMagnitude(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.magnitude), inline: true }, { name: '深さ', value: formatDepth(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.depth), inline: true }, { name: '最大震度', value: scaleToString(quake === null || quake === void 0 ? void 0 : quake.maxScale), inline: true }, { name: '発生時刻', value: (_c = quake === null || quake === void 0 ? void 0 : quake.time) !== null && _c !== void 0 ? _c : '不明', inline: true }, { name: '津波', value: (quake === null || quake === void 0 ? void 0 : quake.domesticTsunami) === 'None' ? '心配なし' : (_d = quake === null || quake === void 0 ? void 0 : quake.domesticTsunami) !== null && _d !== void 0 ? _d : '不明', inline: true })
            .setFooter({ text: `Source: ${(_f = (_e = message.issue) === null || _e === void 0 ? void 0 : _e.source) !== null && _f !== void 0 ? _f : 'P2P地震情報 / 気象庁'}` })
            .setTimestamp(new Date());
        if (coordinateLink) {
            embed.addFields({ name: '地図', value: coordinateLink, inline: true });
        }
        if (observedPoints) {
            embed.addFields({ name: '主な観測点', value: observedPoints.slice(0, 1024), inline: false });
        }
        if (scaleImage) {
            embed.setThumbnail(`attachment://${scaleImage.name}`);
        }
        if (intensityMap) {
            embed.setImage('attachment://intensity-map.png');
        }
        const files = [scaleImage, intensityMap].filter((file) => Boolean(file));
        return files.length ? { embeds: [embed], files } : { embeds: [embed] };
    });
}
function isValidJmaJsonPath(jsonPath) {
    return (typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..'));
}
function buildJmaQuakeEmbed(detail) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const earthquake = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Earthquake;
        const hypocenter = (_b = earthquake === null || earthquake === void 0 ? void 0 : earthquake.Hypocenter) === null || _b === void 0 ? void 0 : _b.Area;
        const maxScale = (_e = (_d = (_c = detail.Body) === null || _c === void 0 ? void 0 : _c.Intensity) === null || _d === void 0 ? void 0 : _d.Observation) === null || _e === void 0 ? void 0 : _e.MaxInt;
        const coordinate = parseJmaCoordinate(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Coordinate);
        const coordinateLink = formatCoordinate(coordinate === null || coordinate === void 0 ? void 0 : coordinate.latitude, coordinate === null || coordinate === void 0 ? void 0 : coordinate.longitude);
        const intensityMap = yield (0, intensity_map_1.createIntensityMapAttachment)(detail, 'intensity-map.png');
        const scaleImage = localScaleImage(maxScale);
        const text = (_f = detail.Head) === null || _f === void 0 ? void 0 : _f.Text;
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle((_h = (_g = detail.Head) === null || _g === void 0 ? void 0 : _g.Title) !== null && _h !== void 0 ? _h : '地震情報')
            .setColor(0x2d6cdf)
            .setDescription(text || '気象庁から新しい地震情報が発表されました。')
            .addFields({ name: '震源', value: (_j = hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Name) !== null && _j !== void 0 ? _j : '不明', inline: true }, { name: '規模', value: formatMagnitude(earthquake === null || earthquake === void 0 ? void 0 : earthquake.Magnitude), inline: true }, { name: '深さ', value: formatDepth(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Depth), inline: true }, { name: '最大震度', value: scaleToString(maxScale), inline: true }, { name: '発生時刻', value: (_l = (_k = earthquake === null || earthquake === void 0 ? void 0 : earthquake.OriginTime) !== null && _k !== void 0 ? _k : earthquake === null || earthquake === void 0 ? void 0 : earthquake.ArrivalTime) !== null && _l !== void 0 ? _l : '不明', inline: true }, { name: '発表時刻', value: (_o = (_m = detail.Head) === null || _m === void 0 ? void 0 : _m.ReportDateTime) !== null && _o !== void 0 ? _o : '不明', inline: true })
            .setFooter({ text: 'Source: 気象庁' })
            .setTimestamp(new Date());
        if (intensityMap) {
            embed.setImage('attachment://intensity-map.png');
        }
        if (coordinateLink) {
            embed.addFields({ name: '地図', value: coordinateLink, inline: true });
        }
        if (scaleImage) {
            embed.setThumbnail(`attachment://${scaleImage.name}`);
        }
        const files = [scaleImage, intensityMap].filter((file) => Boolean(file));
        return files.length ? { embeds: [embed], files } : { embeds: [embed] };
    });
}
function buildJmaTsunamiEmbed(detail) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
        const items = (_d = (_c = (_b = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Tsunami) === null || _b === void 0 ? void 0 : _b.Forecast) === null || _c === void 0 ? void 0 : _c.Item) !== null && _d !== void 0 ? _d : [];
        const earthquake = (_f = (_e = detail.Body) === null || _e === void 0 ? void 0 : _e.Earthquake) === null || _f === void 0 ? void 0 : _f[0];
        const points = collectTsunamiPoints(detail);
        const disasterMap = yield (0, disaster_map_1.createDisasterMapAttachment)(points, 'tsunami-map.png');
        const affectedAreas = items
            .slice(0, 12)
            .map(item => {
            var _a, _b, _c, _d, _e, _f;
            const area = (_b = (_a = item.Area) === null || _a === void 0 ? void 0 : _a.Name) !== null && _b !== void 0 ? _b : '不明';
            const kind = (_e = (_d = (_c = item.Category) === null || _c === void 0 ? void 0 : _c.Kind) === null || _d === void 0 ? void 0 : _d.Name) !== null && _e !== void 0 ? _e : '津波情報';
            const height = ((_f = item.MaxHeight) === null || _f === void 0 ? void 0 : _f.TsunamiHeight) ? ` / 予想高さ ${item.MaxHeight.TsunamiHeight}m` : '';
            return `${area}: ${kind}${height}`;
        })
            .join('\n');
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle((_h = (_g = detail.Head) === null || _g === void 0 ? void 0 : _g.Title) !== null && _h !== void 0 ? _h : '津波情報')
            .setColor(0xff1f1f)
            .setDescription((_o = (_l = (_k = (_j = detail.Head) === null || _j === void 0 ? void 0 : _j.Headline) === null || _k === void 0 ? void 0 : _k.Text) !== null && _l !== void 0 ? _l : (_m = detail.Body) === null || _m === void 0 ? void 0 : _m.Text) !== null && _o !== void 0 ? _o : '気象庁から津波に関する情報が発表されました。')
            .addFields({ name: '震源', value: (_r = (_q = (_p = earthquake === null || earthquake === void 0 ? void 0 : earthquake.Hypocenter) === null || _p === void 0 ? void 0 : _p.Area) === null || _q === void 0 ? void 0 : _q.Name) !== null && _r !== void 0 ? _r : '不明', inline: true }, { name: '規模', value: formatMagnitude(earthquake === null || earthquake === void 0 ? void 0 : earthquake.Magnitude), inline: true }, { name: '発表時刻', value: (_t = (_s = detail.Head) === null || _s === void 0 ? void 0 : _s.ReportDateTime) !== null && _t !== void 0 ? _t : '不明', inline: true })
            .setFooter({ text: 'Source: 気象庁' })
            .setTimestamp(new Date());
        if (affectedAreas) {
            embed.addFields({ name: '対象地域', value: affectedAreas.slice(0, 1024), inline: false });
        }
        if (disasterMap) {
            embed.setImage('attachment://tsunami-map.png');
        }
        return disasterMap ? { embeds: [embed], files: [disasterMap] } : { embeds: [embed] };
    });
}
function buildJmaFloodEmbed(areas) {
    return __awaiter(this, void 0, void 0, function* () {
        const points = areas.map((area, index) => ({
            label: String(index + 1),
            latitude: area.point.latitude,
            longitude: area.point.longitude,
            color: floodColor(area.statuses),
        }));
        const disasterMap = yield (0, disaster_map_1.createDisasterMapAttachment)(points, 'flood-map.png');
        const affectedAreas = areas
            .slice(0, 16)
            .map(area => `${area.name}: ${area.statuses.join(' / ')}`)
            .join('\n');
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle('洪水警報・注意報')
            .setColor(areas.some(area => area.statuses.includes('洪水警報')) ? 0xff1f1f : 0xffff00)
            .setDescription('気象庁から洪水に関する警報・注意報が発表されています。')
            .addFields({ name: '対象地域数', value: `${areas.length}`, inline: true }, { name: '取得時刻', value: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }), inline: true })
            .setFooter({ text: 'Source: 気象庁' })
            .setTimestamp(new Date());
        if (affectedAreas) {
            embed.addFields({ name: '対象地域', value: affectedAreas.slice(0, 1024), inline: false });
        }
        if (disasterMap) {
            embed.setImage('attachment://flood-map.png');
        }
        return disasterMap ? { embeds: [embed], files: [disasterMap] } : { embeds: [embed] };
    });
}
function pollJmaQuake(client) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const list = yield fetchJmaList();
        const latestPath = (_a = list.find(item => isValidJmaJsonPath(item.json))) === null || _a === void 0 ? void 0 : _a.json;
        if (!latestPath)
            return;
        const latestIds = loadLatestIds();
        if (latestIds.quake === latestPath)
            return;
        const detail = yield fetchJmaDetail(latestPath);
        yield sendToConfiguredChannels(client, yield buildJmaQuakeEmbed(detail), (_d = (_c = (_b = detail.Body) === null || _b === void 0 ? void 0 : _b.Intensity) === null || _c === void 0 ? void 0 : _c.Observation) === null || _d === void 0 ? void 0 : _d.MaxInt);
        saveLatestIds(Object.assign(Object.assign({}, latestIds), { quake: latestPath }));
    });
}
function pollJmaTsunami(client) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const list = yield fetchJmaTsunamiList();
        const latestPath = (_a = list.find(item => isValidJmaJsonPath(item.json))) === null || _a === void 0 ? void 0 : _a.json;
        if (!latestPath)
            return;
        const latestIds = loadLatestIds();
        if (latestIds.tsunami === latestPath)
            return;
        const detail = yield fetchJmaTsunamiDetail(latestPath);
        yield sendDisasterToConfiguredChannels(client, yield buildJmaTsunamiEmbed(detail));
        saveLatestIds(Object.assign(Object.assign({}, latestIds), { tsunami: latestPath }));
    });
}
function pollJmaFlood(client) {
    return __awaiter(this, void 0, void 0, function* () {
        const [warningMap, areaConst] = yield Promise.all([
            fetchJmaWarningMap(),
            fetchJmaAreaConst(),
        ]);
        const areas = collectFloodAreas(warningMap, areaConst);
        if (!areas.length)
            return;
        const signature = floodSignature(areas, warningMap);
        const latestIds = loadLatestIds();
        if (latestIds.flood === signature)
            return;
        yield sendDisasterToConfiguredChannels(client, yield buildJmaFloodEmbed(areas));
        saveLatestIds(Object.assign(Object.assign({}, latestIds), { flood: signature }));
    });
}
function shouldNotifyP2PMessage(message) {
    if (!message || typeof message !== 'object')
        return false;
    const code = message.code;
    return code === 556 || code === 551;
}
function handleP2PMessage(client, rawData) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const message = JSON.parse(rawData.toString());
        if (!shouldNotifyP2PMessage(message))
            return;
        const latestIds = loadLatestIds();
        if (message.code === 556) {
            if (latestIds.eew === message.id)
                return;
            yield sendToConfiguredChannels(client, yield buildEewEmbed(message), Math.max(...((_a = message.areas) !== null && _a !== void 0 ? _a : []).map(area => area.scaleTo), 0));
            saveLatestIds(Object.assign(Object.assign({}, latestIds), { eew: message.id }));
            return;
        }
        if (latestIds.quake === message.id)
            return;
        yield sendToConfiguredChannels(client, yield buildP2PQuakeEmbed(message), (_b = message.earthquake) === null || _b === void 0 ? void 0 : _b.maxScale);
        saveLatestIds(Object.assign(Object.assign({}, latestIds), { quake: message.id }));
    });
}
function startP2PWebSocket(client) {
    let reconnectTimer;
    const connect = () => {
        const ws = new ws_1.default(P2P_WS_URL);
        ws.on('open', () => {
            console.log('P2P地震情報 WebSocket に接続しました');
        });
        ws.on('message', (data) => {
            handleP2PMessage(client, data).catch((error) => {
                console.error('P2P地震情報の通知処理でエラーが発生しました:', error);
            });
        });
        ws.on('close', () => {
            console.warn('P2P地震情報 WebSocket が切断されました。10秒後に再接続します。');
            if (reconnectTimer)
                clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 10 * 1000);
        });
        ws.on('error', (error) => {
            console.error('P2P地震情報 WebSocket エラー:', error);
            ws.close();
        });
    };
    connect();
}
function startJmaDisasterAutoNotify(client) {
    pollJmaTsunami(client).catch((error) => {
        console.error('気象庁津波情報の初回確認でエラーが発生しました:', error);
    });
    pollJmaFlood(client).catch((error) => {
        console.error('気象庁洪水情報の初回確認でエラーが発生しました:', error);
    });
    setInterval(() => {
        pollJmaTsunami(client).catch((error) => {
            console.error('気象庁津波情報の自動確認でエラーが発生しました:', error);
        });
        pollJmaFlood(client).catch((error) => {
            console.error('気象庁洪水情報の自動確認でエラーが発生しました:', error);
        });
    }, 60 * 1000);
}
function startEqAutoNotify(client) {
    startP2PWebSocket(client);
    startJmaDisasterAutoNotify(client);
    pollJmaQuake(client).catch((error) => {
        console.error('気象庁地震情報の初回確認でエラーが発生しました:', error);
    });
    setInterval(() => {
        pollJmaQuake(client).catch((error) => {
            console.error('気象庁地震情報の自動確認でエラーが発生しました:', error);
        });
    }, 60 * 1000);
}
