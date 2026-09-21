"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const eq_notify_1 = require("../eq_notify");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('set_eq_channel')
    .setDescription('地震・津波情報の通知チャンネルを設定します')
    .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
    .addChannelOption(option => option
    .setName('channel')
    .setDescription('通知を送信するテキストチャンネル')
    .addChannelTypes(discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement)
    .setRequired(true));
async function execute(interaction) {
    if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '設定変更には「サーバー管理」権限が必要です。', ephemeral: true });
        return;
    }
    const guildId = interaction.guildId;
    const channel = interaction.options.getChannel('channel', true);
    if (!guildId) {
        await interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
        return;
    }
    await interaction.deferReply({ ephemeral: true });
    const target = await interaction.guild.channels.fetch(channel.id);
    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    if (!target?.permissionsFor(me)?.has([discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.EmbedLinks, discord_js_1.PermissionFlagsBits.AttachFiles])) {
        await interaction.editReply('Botに「チャンネルを見る」「メッセージを送信」「埋め込みリンク」「ファイルを添付」権限が必要です。');
        return;
    }
    const channels = (0, eq_notify_1.loadEqChannels)();
    channels[guildId] = channel.id;
    (0, eq_notify_1.saveEqChannels)(channels);
    await interaction.editReply({
        content: `地震・津波情報の通知先を <#${channel.id}> に設定しました。`,
    });
}
