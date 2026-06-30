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
const eq_notify_1 = require("../eq_notify");
const choices = [
    { name: '全て通知', value: 'all' },
    { name: '震度1以上', value: '1' },
    { name: '震度2以上', value: '2' },
    { name: '震度3以上', value: '3' },
    { name: '震度4以上', value: '4' },
    { name: '震度5弱以上', value: '5-' },
    { name: '震度5強以上', value: '5+' },
    { name: '震度6弱以上', value: '6-' },
    { name: '震度6強以上', value: '6+' },
    { name: '震度7のみ', value: '7' },
];
function thresholdLabel(value) {
    switch (value) {
        case 70: return '震度7のみ';
        case 60: return '震度6強以上';
        case 55: return '震度6弱以上';
        case 50: return '震度5強以上';
        case 45: return '震度5弱以上';
        case 40: return '震度4以上';
        case 30: return '震度3以上';
        case 20: return '震度2以上';
        case 10: return '震度1以上';
        default: return '全て通知';
    }
}
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('set_eq_threshold')
    .setDescription('通知する最低震度を設定します')
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addStringOption(option => option
    .setName('threshold')
    .setDescription('この震度以上の地震だけ通知します')
    .setRequired(true)
    .addChoices(...choices));
function execute(interaction) {
    return __awaiter(this, void 0, void 0, function* () {
        const guildId = interaction.guildId;
        if (!guildId) {
            yield interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
            return;
        }
        const value = interaction.options.getString('threshold', true);
        const thresholds = (0, eq_notify_1.loadEqThresholds)();
        if (value === 'all') {
            delete thresholds[guildId];
            (0, eq_notify_1.saveEqThresholds)(thresholds);
            yield interaction.reply({ content: '地震通知の震度フィルターを解除しました。全て通知します。', ephemeral: true });
            return;
        }
        const threshold = (0, eq_notify_1.scaleRank)(value);
        thresholds[guildId] = threshold;
        (0, eq_notify_1.saveEqThresholds)(thresholds);
        yield interaction.reply({
            content: `地震通知を「${thresholdLabel(threshold)}」に設定しました。`,
            ephemeral: true,
        });
    });
}
