"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.autocomplete = autocomplete;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const weather_1 = require("../weather");
const weather_notify_1 = require("../weather_notify");
exports.data = new discord_js_1.SlashCommandBuilder().setName('weather').setDescription('地域別の気象警報・雨の通知・雨雲レーダー')
    .setDMPermission(false)
    .addSubcommand(s => s.setName('set').setDescription('地域の通知を登録・変更（サーバー管理権限が必要）')
    .addStringOption(o => o.setName('area').setDescription('市区町村名を入力して候補を選択').setRequired(true).setAutocomplete(true))
    .addChannelOption(o => o.setName('channel').setDescription('通知先').setRequired(true).addChannelTypes(discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement))
    .addBooleanOption(o => o.setName('warnings').setDescription('警報通知（既定: ON）'))
    .addBooleanOption(o => o.setName('advisories').setDescription('注意報も通知（既定: OFF）'))
    .addBooleanOption(o => o.setName('rain').setDescription('今後3時間の降水予報を通知（既定: ON）'))
    .addNumberOption(o => o.setName('threshold').setDescription('1時間降水量の通知基準 mm（既定: 1）').setMinValue(0.1).setMaxValue(100)))
    .addSubcommand(s => s.setName('status').setDescription('登録地域・通知先・監視状態を確認'))
    .addSubcommand(s => s.setName('remove').setDescription('指定地域の通知を停止（サーバー管理権限が必要）')
    .addStringOption(o => o.setName('area').setDescription('停止する登録地域').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('radar').setDescription('指定地域の最新の雨雲レーダーを表示')
    .addStringOption(o => o.setName('area').setDescription('市区町村名を入力して候補を選択').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('now').setDescription('指定地域の発表中の警報・注意報を確認')
    .addStringOption(o => o.setName('area').setDescription('市区町村名を入力して候補を選択').setRequired(true).setAutocomplete(true)));
async function autocomplete(interaction) {
    try {
        const query = interaction.options.getFocused().normalize('NFKC').toLowerCase();
        const candidates = interaction.options.getSubcommand() === 'remove'
            ? Object.values((0, weather_notify_1.loadWeather)()[interaction.guildId || ''] || {}).map(s => s.region)
            : await (0, weather_1.getRegions)();
        await interaction.respond(candidates.filter(r => r.name.normalize('NFKC').toLowerCase().includes(query) || r.code.includes(query)).slice(0, 25).map(r => ({ name: r.name, value: r.code })));
    }
    catch {
        await interaction.respond([]).catch(() => undefined);
    }
}
async function execute(interaction) {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'サーバー内で使用してください。', ephemeral: true });
        return;
    }
    const sub = interaction.options.getSubcommand();
    if (['set', 'remove'].includes(sub) && !interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: '通知設定の変更には「サーバー管理」権限が必要です。閲覧には /weather radar・now・status を使えます。', ephemeral: true });
        return;
    }
    await interaction.deferReply({ ephemeral: true });
    if (sub === 'status') {
        const subscriptions = (0, weather_notify_1.loadWeather)()[interaction.guildId] || {};
        const states = (0, weather_notify_1.weatherState)();
        const lines = Object.values(subscriptions).map(s => {
            const stored = states[`${interaction.guildId}:${s.region.code}`];
            const state = stored?.revision === s.revision ? stored : undefined;
            return `**${s.region.name}** → <#${s.channel}>\n警報 ${s.warnings ? 'ON' : 'OFF'} / 注意報 ${s.advisories ? 'ON' : 'OFF'} / 降水 ${s.rain ? `${s.threshold} mm以上` : 'OFF'}\n${state?.error ? '⚠ 取得・送信エラー。チャンネル権限を確認してください。再試行中です。' : state?.warningChecked || state?.rainChecked ? `最終成功 <t:${Math.floor(Math.max(state.warningChecked || 0, state.rainChecked || 0) / 1000)}:R>` : '初回確認待ち'}`;
        });
        await interaction.editReply({ embeds: [new discord_js_1.EmbedBuilder().setTitle('気象通知の設定').setDescription(lines.join('\n\n') || '/weather set で地域と通知先を登録してください。').setFooter({ text: '警報: 約1分ごと / 降水予報: 約15分ごと・再通知は3時間以上間隔' })] });
        return;
    }
    const code = interaction.options.getString('area', true);
    if (sub === 'remove') {
        const config = (0, weather_notify_1.loadWeather)();
        const region = config[interaction.guildId]?.[code];
        if (!region) {
            await interaction.editReply('登録されていません。候補から登録地域を選んでください。');
            return;
        }
        delete config[interaction.guildId][code];
        (0, weather_notify_1.saveWeather)(config);
        await interaction.editReply(`${region.region.name} の気象・降水通知を停止しました。`);
        return;
    }
    const region = (await (0, weather_1.getRegions)()).find(r => r.code === code);
    if (!region) {
        await interaction.editReply('市区町村名を入力し、表示される候補から選んでください。');
        return;
    }
    if (sub === 'set') {
        const channel = await interaction.guild.channels.fetch(interaction.options.getChannel('channel', true).id);
        const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
        if (!channel || ![discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement].includes(channel.type) || !channel.permissionsFor(me)?.has([discord_js_1.PermissionFlagsBits.ViewChannel, discord_js_1.PermissionFlagsBits.SendMessages, discord_js_1.PermissionFlagsBits.EmbedLinks])) {
            await interaction.editReply('Botに通知先の「チャンネルを見る」「メッセージを送信」「埋め込みリンク」権限を付与してください。');
            return;
        }
        const config = (0, weather_notify_1.loadWeather)();
        config[interaction.guildId] ||= {};
        if (!config[interaction.guildId][code] && Object.keys(config[interaction.guildId]).length >= 10) {
            await interaction.editReply('1サーバーにつき10地域まで登録できます。/weather remove で整理してください。');
            return;
        }
        config[interaction.guildId][code] = { region, channel: channel.id, warnings: interaction.options.getBoolean('warnings') ?? true, advisories: interaction.options.getBoolean('advisories') ?? false, rain: interaction.options.getBoolean('rain') ?? true, threshold: interaction.options.getNumber('threshold') ?? 1, revision: crypto.randomUUID() };
        (0, weather_notify_1.saveWeather)(config);
        await interaction.editReply(`${region.name} → <#${channel.id}> に登録しました。約1分以内に初回確認します。\n/weather status で設定確認、/weather radar で雨雲、/weather remove で停止できます。\n再設定時、省略した項目は既定値に戻ります。`);
        return;
    }
    if (sub === 'now') {
        await interaction.editReply({ embeds: [(0, weather_1.warningEmbed)(region, (0, weather_1.parseWarnings)(await (0, weather_1.getWarningReports)(region.office), code, true))] });
        return;
    }
    const embed = new discord_js_1.EmbedBuilder().setTitle(`${region.name}｜雨雲レーダー`).setURL((0, weather_1.radarUrl)(region)).setDescription('白丸は地域の中央付近です。色の凡例・アニメーションはタイトルのリンクから確認できます。').setFooter({ text: '雨雲: 気象庁 / 背景: 地理院タイル' });
    try {
        const radar = await (0, weather_1.radarImage)(region);
        embed.setImage('attachment://radar.png').setTimestamp(radar.time);
        await interaction.editReply({ embeds: [embed], files: [radar.attachment] });
    }
    catch (error) {
        console.error('レーダー取得失敗:', error);
        embed.setImage(null).setDescription('現在画像を取得できません。タイトルから気象庁の雨雲レーダーを開いてください。');
        await interaction.editReply({ embeds: [embed] });
    }
}
