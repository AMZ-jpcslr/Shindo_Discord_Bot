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
const intensity_map_1 = require("../intensity_map");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('get_eq')
    .setDescription('直近の地震情報を確認します');
function isValidJmaJsonPath(jsonPath) {
    return (typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..'));
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
        default: return scale ? String(scale).replace('+', '強').replace('-', '弱') : '不明';
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
function jmaScaleToP2PScale(scale) {
    switch (scale) {
        case '1': return 10;
        case '2': return 20;
        case '3': return 30;
        case '4': return 40;
        case '5-': return 45;
        case '5+': return 50;
        case '6-': return 55;
        case '6+': return 60;
        case '7': return 70;
        default: return undefined;
    }
}
function reportTimeValue(item) {
    var _a, _b;
    const source = (_b = (_a = item.ctt) !== null && _a !== void 0 ? _a : item.at) !== null && _b !== void 0 ? _b : '';
    if (/^\d{14}$/.test(source)) {
        return Number(source);
    }
    const dateValue = Date.parse(source);
    return Number.isFinite(dateValue) ? dateValue : 0;
}
function pickLatestEventItem(list) {
    return list
        .filter(item => isValidJmaJsonPath(item.json))
        .sort((a, b) => reportTimeValue(b) - reportTimeValue(a))[0];
}
function pickBestDetailItemForEvent(list, eventId) {
    const candidates = list.filter(item => isValidJmaJsonPath(item.json) &&
        (!eventId || item.eid === eventId));
    return candidates.sort((a, b) => {
        var _a, _b;
        const aHasIntensityDetail = ((_a = a.json) === null || _a === void 0 ? void 0 : _a.includes('VXSE5k')) ? 1 : 0;
        const bHasIntensityDetail = ((_b = b.json) === null || _b === void 0 ? void 0 : _b.includes('VXSE5k')) ? 1 : 0;
        if (aHasIntensityDetail !== bHasIntensityDetail)
            return bHasIntensityDetail - aHasIntensityDetail;
        if (a.maxi && !b.maxi)
            return -1;
        if (!a.maxi && b.maxi)
            return 1;
        return reportTimeValue(b) - reportTimeValue(a);
    })[0];
}
function fetchJmaDetail(jsonPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(`https://www.jma.go.jp/bosai/quake/data/${jsonPath}`);
        if (!response.ok)
            throw new Error(`JMA detail fetch failed: ${response.status}`);
        return response.json();
    });
}
function buildJmaEmbed(detail) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const earthquake = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Earthquake;
        const hypocenter = (_b = earthquake === null || earthquake === void 0 ? void 0 : earthquake.Hypocenter) === null || _b === void 0 ? void 0 : _b.Area;
        const maxScale = (_e = (_d = (_c = detail.Body) === null || _c === void 0 ? void 0 : _c.Intensity) === null || _d === void 0 ? void 0 : _d.Observation) === null || _e === void 0 ? void 0 : _e.MaxInt;
        const scaleImage = localScaleImage(jmaScaleToP2PScale(maxScale));
        const coordinate = parseJmaCoordinate(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Coordinate);
        const intensityMap = yield (0, intensity_map_1.createIntensityMapAttachment)(detail, 'intensity-map.png');
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle((_g = (_f = detail.Head) === null || _f === void 0 ? void 0 : _f.Title) !== null && _g !== void 0 ? _g : '直近の地震情報')
            .setColor(0x2d6cdf)
            .setDescription(((_h = detail.Head) === null || _h === void 0 ? void 0 : _h.Text) || '気象庁から発表された直近の地震情報です。')
            .addFields({ name: '震源', value: (_j = hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Name) !== null && _j !== void 0 ? _j : '不明', inline: true }, { name: '規模', value: (earthquake === null || earthquake === void 0 ? void 0 : earthquake.Magnitude) ? `M${earthquake.Magnitude}` : '不明', inline: true }, { name: '深さ', value: formatDepth(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Depth), inline: true }, { name: '最大震度', value: scaleToString(maxScale), inline: true }, { name: '発生時刻', value: (_l = (_k = earthquake === null || earthquake === void 0 ? void 0 : earthquake.OriginTime) !== null && _k !== void 0 ? _k : earthquake === null || earthquake === void 0 ? void 0 : earthquake.ArrivalTime) !== null && _l !== void 0 ? _l : '不明', inline: true }, { name: '発表時刻', value: (_o = (_m = detail.Head) === null || _m === void 0 ? void 0 : _m.ReportDateTime) !== null && _o !== void 0 ? _o : '不明', inline: true })
            .setFooter({ text: 'Source: 気象庁' });
        if (intensityMap) {
            embed.setImage('attachment://intensity-map.png');
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
        const files = [scaleImage, intensityMap].filter((file) => Boolean(file));
        return files.length ? { embeds: [embed], files } : { embeds: [embed] };
    });
}
function execute(interaction) {
    return __awaiter(this, void 0, void 0, function* () {
        yield interaction.deferReply({ ephemeral: true });
        try {
            const listResponse = yield fetch('https://www.jma.go.jp/bosai/quake/data/list.json');
            if (!listResponse.ok)
                throw new Error(`JMA list fetch failed: ${listResponse.status}`);
            const list = yield listResponse.json();
            const latestEvent = pickLatestEventItem(list);
            const bestDetail = pickBestDetailItemForEvent(list, latestEvent === null || latestEvent === void 0 ? void 0 : latestEvent.eid);
            if (!(bestDetail === null || bestDetail === void 0 ? void 0 : bestDetail.json)) {
                yield interaction.editReply('直近の地震情報が見つかりませんでした。');
                return;
            }
            const detail = yield fetchJmaDetail(bestDetail.json);
            yield interaction.editReply(yield buildJmaEmbed(detail));
        }
        catch (error) {
            console.error(error);
            yield interaction.editReply('地震情報の取得中にエラーが発生しました。');
        }
    });
}
