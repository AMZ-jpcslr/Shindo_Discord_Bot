"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const weather_1 = require("./commands/weather");
const help_1 = require("./commands/help");
const discord_js_1 = require("discord.js");
const dotenv_1 = __importDefault(require("dotenv"));
const get_eq_1 = require("./commands/get_eq");
const lottery_1 = require("./commands/lottery");
const ping_1 = require("./commands/ping");
const set_eq_channel_1 = require("./commands/set_eq_channel");
const set_eq_threshold_1 = require("./commands/set_eq_threshold");
const shift_1 = require("./commands/shift");
dotenv_1.default.config();
const commands = [
    weather_1.data.toJSON(),
    help_1.data.toJSON(),
    ping_1.data.toJSON(),
    lottery_1.data.toJSON(),
    shift_1.data.toJSON(),
    set_eq_channel_1.data.toJSON(),
    set_eq_threshold_1.data.toJSON(),
    get_eq_1.data.toJSON(),
];
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
const configuredGuildIds = [
    process.env.GUILD_ID,
    process.env.GUILD_IDS,
]
    .filter((value) => Boolean(value))
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
if (!token) {
    throw new Error('TOKEN が設定されていません');
}
if (!clientId) {
    throw new Error('CLIENT_ID が設定されていません');
}
const rest = new discord_js_1.REST({ version: '10' }).setToken(token);
const applicationId = clientId;
async function fetchBotGuilds() {
    if (configuredGuildIds.length) {
        return configuredGuildIds.map(id => ({ id }));
    }
    return rest.get(discord_js_1.Routes.userGuilds());
}
async function overwriteGlobalCommands() {
    console.log('グローバルコマンドを現在の一覧で上書きしています...');
    await rest.put(discord_js_1.Routes.applicationCommands(applicationId), { body: commands });
    console.log('グローバルコマンドの上書きが完了しました。反映にはDiscord側の時間がかかる場合があります。');
}
async function overwriteGuildCommands(guilds) {
    if (!guilds.length) {
        console.warn('参加中のサーバーを取得できなかったため、ギルドコマンド登録をスキップしました。');
        return;
    }
    console.log(`${guilds.length}件のサーバーへギルドコマンドを即時反映します...`);
    for (const guild of guilds) {
        await rest.put(discord_js_1.Routes.applicationGuildCommands(applicationId, guild.id), { body: commands });
        console.log(`ギルドコマンド更新完了: ${guild.name ?? guild.id}`);
    }
}
async function main() {
    try {
        await overwriteGlobalCommands();
        await overwriteGuildCommands(await fetchBotGuilds());
        console.log('スラッシュコマンドの一括更新が完了しました。');
    }
    catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
main();
