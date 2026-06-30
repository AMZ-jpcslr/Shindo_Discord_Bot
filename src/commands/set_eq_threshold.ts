import {
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js'
import { loadEqThresholds, saveEqThresholds, scaleRank } from '../eq_notify'

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
] as const

function thresholdLabel(value: number): string {
    switch (value) {
        case 70: return '震度7のみ'
        case 60: return '震度6強以上'
        case 55: return '震度6弱以上'
        case 50: return '震度5強以上'
        case 45: return '震度5弱以上'
        case 40: return '震度4以上'
        case 30: return '震度3以上'
        case 20: return '震度2以上'
        case 10: return '震度1以上'
        default: return '全て通知'
    }
}

export const data = new SlashCommandBuilder()
    .setName('set_eq_threshold')
    .setDescription('通知する最低震度を設定します')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
        option
            .setName('threshold')
            .setDescription('この震度以上の地震だけ通知します')
            .setRequired(true)
            .addChoices(...choices)
    )

export async function execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId
    if (!guildId) {
        await interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true })
        return
    }

    const value = interaction.options.getString('threshold', true)
    const thresholds = loadEqThresholds()

    if (value === 'all') {
        delete thresholds[guildId]
        saveEqThresholds(thresholds)
        await interaction.reply({ content: '地震通知の震度フィルターを解除しました。全て通知します。', ephemeral: true })
        return
    }

    const threshold = scaleRank(value)
    thresholds[guildId] = threshold
    saveEqThresholds(thresholds)

    await interaction.reply({
        content: `地震通知を「${thresholdLabel(threshold)}」に設定しました。`,
        ephemeral: true,
    })
}
