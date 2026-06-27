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
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
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
function isValidJmaJsonPath(jsonPath) {
    return (typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..'));
}
function buildEewEmbed(eew) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const hypocenter = (_a = eew.earthquake) === null || _a === void 0 ? void 0 : _a.hypocenter;
    const maxScale = Math.max(...((_b = eew.areas) !== null && _b !== void 0 ? _b : []).map(area => area.scaleTo), 0);
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
    return embed;
}
function buildJmaEmbed(detail, jsonPath) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const earthquake = (_a = detail.Body) === null || _a === void 0 ? void 0 : _a.Earthquake;
    const hypocenter = (_b = earthquake === null || earthquake === void 0 ? void 0 : earthquake.Hypocenter) === null || _b === void 0 ? void 0 : _b.Area;
    const imagePath = jsonPath.replace(/\.json$/, '.png');
    return new discord_js_1.EmbedBuilder()
        .setTitle((_d = (_c = detail.Head) === null || _c === void 0 ? void 0 : _c.Title) !== null && _d !== void 0 ? _d : '直近の地震情報')
        .setColor(0x2d6cdf)
        .setDescription(((_e = detail.Head) === null || _e === void 0 ? void 0 : _e.Text) || '気象庁から発表された直近の地震情報です。')
        .addFields({ name: '震源', value: (_f = hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Name) !== null && _f !== void 0 ? _f : '不明', inline: true }, { name: '規模', value: (earthquake === null || earthquake === void 0 ? void 0 : earthquake.Magnitude) ? `M${earthquake.Magnitude}` : '不明', inline: true }, { name: '深さ', value: formatDepth(hypocenter === null || hypocenter === void 0 ? void 0 : hypocenter.Depth), inline: true }, { name: '最大震度', value: scaleToString((_j = (_h = (_g = detail.Body) === null || _g === void 0 ? void 0 : _g.Intensity) === null || _h === void 0 ? void 0 : _h.Observation) === null || _j === void 0 ? void 0 : _j.MaxInt), inline: true }, { name: '発生時刻', value: (_l = (_k = earthquake === null || earthquake === void 0 ? void 0 : earthquake.OriginTime) !== null && _k !== void 0 ? _k : earthquake === null || earthquake === void 0 ? void 0 : earthquake.ArrivalTime) !== null && _l !== void 0 ? _l : '不明', inline: true }, { name: '発表時刻', value: (_o = (_m = detail.Head) === null || _m === void 0 ? void 0 : _m.ReportDateTime) !== null && _o !== void 0 ? _o : '不明', inline: true })
        .setImage(`https://www.jma.go.jp/bosai/quake/data/${imagePath}`)
        .setFooter({ text: 'Source: 気象庁' });
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
                    yield interaction.editReply({ embeds: [buildEewEmbed(eews[0])] });
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
            yield interaction.editReply({ embeds: [buildJmaEmbed(detail, latestPath)] });
        }
        catch (error) {
            console.error(error);
            yield interaction.editReply('地震情報の取得中にエラーが発生しました。');
        }
    });
}
