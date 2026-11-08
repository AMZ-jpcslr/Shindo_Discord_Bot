import { RELEASE } from '../release'
import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js'
export const data = new SlashCommandBuilder().setName('help').setDescription('通知設定とコマンドの使い方')
export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setTitle(`地震・津波・気象情報 Bot v${RELEASE.version}`).setColor(0x3498db).setDescription(
        '**管理者の初期設定**\n/set_eq_channel：地震・津波の通知先\n/set_eq_threshold：地震の最低震度（津波は対象外）\n/weather set：市区町村と気象通知先を登録。地域名を入力して候補を選択\n\n**みんなが使えるコマンド**\n/weather radar：気象庁の雨雲レーダー\n/weather now：現在の警報・注意報\n/weather status：登録地域と監視状態\n/get_eq：直近の地震\n/eq_history：過去の発表を地域・震度・発生日で検索（2015/1/10〜）。region は観測地点、region_type:epicenter なら震源名。観測地域を指定した震度条件はその地域の最大震度。start/end は YYYY-MM-DD。続報・訂正は別件、古い値も含みます\n/version：稼働中の版・更新内容・起動時刻を確認\n/ping：接続確認\n\n**通知の調整**\n/weather set の rain・warnings で種類別にON/OFF、advisories で注意報も追加、threshold で1時間降水量の基準を変更\n/weather remove：地域の通知を停止\n\n気象警報は約1分、降水予報は約15分ごとに確認。降水は地域中央付近の予報です。地震情報は複数の情報源から届く場合があります。'
    )] })
}
