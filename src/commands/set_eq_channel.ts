import {
    ChannelType,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js'
import { loadEqChannels, saveEqChannels } from '../eq_notify'

export const data = new SlashCommandBuilder()
    .setName('set_eq_channel')
    .setDescription('緊急地震速報と地震情報の通知チャンネルを設定します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
        option
            .setName('channel')
            .setDescription('通知を送信するテキストチャンネル')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
    )

export async function execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId
    const channel = interaction.options.getChannel('channel', true)

    if (!guildId) {
        await interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true })
        return
    }

    const channels = loadEqChannels()
    channels[guildId] = channel.id
    saveEqChannels(channels)

    await interaction.reply({
        content: `緊急地震速報と地震情報の通知先を <#${channel.id}> に設定しました。`,
        ephemeral: true,
    })
}
