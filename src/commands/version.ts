import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js'
import { profileStatus } from '../bot_profile'
import { RELEASE, runtimeRevision, runtimeStartedAt } from '../release'

export const data = new SlashCommandBuilder().setName('version').setDescription('実際に応答しているBotのバージョン・更新内容・起動時刻を確認')
export function versionEmbed(): EmbedBuilder {
    const revision = runtimeRevision()
    const profile = profileStatus()
    const embed = new EmbedBuilder().setTitle(`Shindo Bot v${RELEASE.version}`)
        .setColor(0x3498db)
        .setDescription(`**この応答を返しているBotのバージョンです。**\nリリース日: ${RELEASE.date}\n\n**この版で追加・変更した機能**\n${RELEASE.changes.map(change => `・${change}`).join('\n')}`)
        .addFields(
            { name: 'このプロセスの起動時刻', value: `<t:${Math.floor(runtimeStartedAt.getTime() / 1000)}:F>`, inline: false },
            { name: 'プロフィールへの反映', value: profile.message, inline: false },
        )
        .setFooter({ text: 'GitHubの最新版とは限りません。プロフィールは停止後も残り、キャッシュされる場合があります。' })
    if (revision) embed.addFields({ name: 'Railwayから渡された実行コミット', value: `[${revision.slice(0, 7)}](https://github.com/AMZ-jpcslr/Shindo_Discord_Bot/commit/${revision})`, inline: false })
    return embed
}
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({ ephemeral: true, embeds: [versionEmbed()], allowedMentions: { parse: [] } })
}
