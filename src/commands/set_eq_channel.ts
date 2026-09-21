import {
    ChannelType,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js'
import { loadEqChannels, saveEqChannels } from '../eq_notify'

export const data = new SlashCommandBuilder()
    .setName('set_eq_channel')
    .setDescription('地震・津波情報の通知チャンネルを設定します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
        option
            .setName('channel')
            .setDescription('通知を送信するテキストチャンネル')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
    )

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '設定変更には「サーバー管理」権限が必要です。', ephemeral: true })
        return
    }
    const guildId = interaction.guildId
    const channel = interaction.options.getChannel('channel', true)

    if (!guildId) {
        await interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true })
        return
    }

    await interaction.deferReply({ ephemeral: true })
    const target = await interaction.guild!.channels.fetch(channel.id)
    const me = interaction.guild!.members.me || await interaction.guild!.members.fetchMe()
    if (!target?.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
        await interaction.editReply('Botに「チャンネルを見る」「メッセージを送信」「埋め込みリンク」「ファイルを添付」権限が必要です。')
        return
    }
    const channels = loadEqChannels()
    channels[guildId] = channel.id
    saveEqChannels(channels)

    await interaction.editReply({
        content: `地震・津波情報の通知先を <#${channel.id}> に設定しました。`,
    })
}
