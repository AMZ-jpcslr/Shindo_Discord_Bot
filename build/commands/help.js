"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
exports.data = new discord_js_1.SlashCommandBuilder().setName('help').setDescription('通知設定とコマンドの使い方');
async function execute(interaction) {
    await interaction.reply({ ephemeral: true, embeds: [new discord_js_1.EmbedBuilder().setTitle('地震・津波・気象情報 Bot').setColor(0x3498db).setDescription('**管理者の初期設定**\n/set_eq_channel：地震・津波の通知先\n/set_eq_threshold：地震の最低震度（津波は対象外）\n/weather set：市区町村と気象通知先を登録。地域名を入力して候補を選択\n\n**みんなが使えるコマンド**\n/weather radar：気象庁の雨雲レーダー\n/weather now：現在の警報・注意報\n/weather status：登録地域と監視状態\n/get_eq：直近の地震\n/ping：接続確認\n\n**通知の調整**\n/weather set の rain・warnings で種類別にON/OFF、advisories で注意報も追加、threshold で1時間降水量の基準を変更\n/weather remove：地域の通知を停止\n\n気象警報は約1分、降水予報は約15分ごとに確認。降水は地域中央付近の予報です。地震情報は複数の情報源から届く場合があります。')] });
}
