"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.versionEmbed = versionEmbed;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const bot_profile_1 = require("../bot_profile");
const release_1 = require("../release");
exports.data = new discord_js_1.SlashCommandBuilder().setName('version').setDescription('実際に応答しているBotのバージョン・更新内容・起動時刻を確認');
function versionEmbed() {
    const revision = (0, release_1.runtimeRevision)();
    const profile = (0, bot_profile_1.profileStatus)();
    const embed = new discord_js_1.EmbedBuilder().setTitle(`Shindo Bot v${release_1.RELEASE.version}`)
        .setColor(0x3498db)
        .setDescription(`**この応答を返しているBotのバージョンです。**\nリリース日: ${release_1.RELEASE.date}\n\n**この版で追加・変更した機能**\n${release_1.RELEASE.changes.map(change => `・${change}`).join('\n')}`)
        .addFields({ name: 'このプロセスの起動時刻', value: `<t:${Math.floor(release_1.runtimeStartedAt.getTime() / 1000)}:F>`, inline: false }, { name: 'プロフィールへの反映', value: profile.message, inline: false })
        .setFooter({ text: 'GitHubの最新版とは限りません。プロフィールは停止後も残り、キャッシュされる場合があります。' });
    if (revision)
        embed.addFields({ name: 'Railwayから渡された実行コミット', value: `[${revision.slice(0, 7)}](https://github.com/AMZ-jpcslr/Shindo_Discord_Bot/commit/${revision})`, inline: false });
    return embed;
}
async function execute(interaction) {
    await interaction.reply({ ephemeral: true, embeds: [versionEmbed()], allowedMentions: { parse: [] } });
}
