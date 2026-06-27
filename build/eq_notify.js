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
exports.startEqAutoNotify = startEqAutoNotify;
const discord_js_1 = require("discord.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ws_1 = __importDefault(require("ws"));
const intensity_map_1 = require("./intensity_map");
const DATA_DIR = path_1.default.join(__dirname, '../../data');
const CHANNELS_PATH = path_1.default.join(DATA_DIR, 'eq_channels.json');
const LATEST_IDS_PATH = path_1.default.join(DATA_DIR, 'latest_eq_ids.json');
const P2P_WS_URL = 'wss://api.p2pquake.net/v2/ws';
const JMA_QUAKE_LIST_URL = 'https://www.jma.go.jp/bosai/quake/data/list.json';
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
function sendToConfiguredChannels(client, payload) {
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
                console.error(`通知送信に失敗しました: guild=${guildId}, channel=${channelId}`, error);
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
function pollJmaQuake(client) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const list = yield fetchJmaList();
        const latestPath = (_a = list.find(item => isValidJmaJsonPath(item.json))) === null || _a === void 0 ? void 0 : _a.json;
        if (!latestPath)
            return;
        const latestIds = loadLatestIds();
        if (latestIds.quake === latestPath)
            return;
        const detail = yield fetchJmaDetail(latestPath);
        yield sendToConfiguredChannels(client, yield buildJmaQuakeEmbed(detail));
        saveLatestIds(Object.assign(Object.assign({}, latestIds), { quake: latestPath }));
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
        const message = JSON.parse(rawData.toString());
        if (!shouldNotifyP2PMessage(message))
            return;
        const latestIds = loadLatestIds();
        if (message.code === 556) {
            if (latestIds.eew === message.id)
                return;
            yield sendToConfiguredChannels(client, yield buildEewEmbed(message));
            saveLatestIds(Object.assign(Object.assign({}, latestIds), { eew: message.id }));
            return;
        }
        if (latestIds.quake === message.id)
            return;
        yield sendToConfiguredChannels(client, yield buildP2PQuakeEmbed(message));
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
function startEqAutoNotify(client) {
    startP2PWebSocket(client);
    pollJmaQuake(client).catch((error) => {
        console.error('気象庁地震情報の初回確認でエラーが発生しました:', error);
    });
    setInterval(() => {
        pollJmaQuake(client).catch((error) => {
            console.error('気象庁地震情報の自動確認でエラーが発生しました:', error);
        });
    }, 60 * 1000);
}
