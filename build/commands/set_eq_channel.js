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
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('set_eq_channel')
    .setDescription('緊急地震速報と地震情報の通知チャンネルを設定します')
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addChannelOption(option => option
    .setName('channel')
    .setDescription('通知を送信するテキストチャンネル')
    .addChannelTypes(discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement)
    .setRequired(true));
function execute(interaction) {
    return __awaiter(this, void 0, void 0, function* () {
        const guildId = interaction.guildId;
        const channel = interaction.options.getChannel('channel', true);
        if (!guildId) {
            yield interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
            return;
        }
        const channels = (0, eq_notify_1.loadEqChannels)();
        channels[guildId] = channel.id;
        (0, eq_notify_1.saveEqChannels)(channels);
        yield interaction.reply({
            content: `緊急地震速報と地震情報の通知先を <#${channel.id}> に設定しました。`,
            ephemeral: true,
        });
    });
}
