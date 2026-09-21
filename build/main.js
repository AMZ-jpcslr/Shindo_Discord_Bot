"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const weatherCommand = __importStar(require("./commands/weather"));
const helpCommand = __importStar(require("./commands/help"));
const weather_notify_1 = require("./weather_notify");
const weather_1 = require("./weather");
const discord_js_1 = require("discord.js");
const dotenv_1 = __importDefault(require("dotenv"));
const getEqCommand = __importStar(require("./commands/get_eq"));
const lotteryCommand = __importStar(require("./commands/lottery"));
const pingCommand = __importStar(require("./commands/ping"));
const setEqChannelCommand = __importStar(require("./commands/set_eq_channel"));
const setEqThresholdCommand = __importStar(require("./commands/set_eq_threshold"));
const shiftCommand = __importStar(require("./commands/shift"));
const eq_notify_1 = require("./eq_notify");
dotenv_1.default.config();
const token = process.env.TOKEN;
if (!token) {
    throw new Error('TOKEN が .env に設定されていません');
}
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
    ],
});
function setBotPresence() {
    client.user?.setPresence({
        activities: [{ name: '地震・津波・気象情報 | /help', type: 3 }],
        status: 'online',
    });
}
client.once('ready', () => {
    console.log('Ready!');
    console.log(client.user?.tag);
    setBotPresence();
    (0, eq_notify_1.startEqAutoNotify)(client);
    (0, weather_notify_1.startWeatherNotify)(client);
    (0, weather_1.getRegions)().catch(error => console.error('地域候補の準備に失敗:', error));
    setInterval(() => {
        console.log(`Bot稼働中: ping=${client.ws.ping}ms / guilds=${client.guilds.cache.size}`);
    }, 5 * 60 * 1000);
});
client.on('shardResume', () => {
    setBotPresence();
});
client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete() && interaction.commandName === 'weather') {
        await weatherCommand.autocomplete(interaction);
        return;
    }
    if (!interaction.isChatInputCommand())
        return;
    try {
        switch (interaction.commandName) {
            case 'weather':
                await weatherCommand.execute(interaction);
                break;
            case 'help':
                await helpCommand.execute(interaction);
                break;
            case 'ping':
                await pingCommand.execute(interaction);
                break;
            case 'lottery':
                await lotteryCommand.execute(interaction);
                break;
            case 'shift':
                await shiftCommand.execute(interaction);
                break;
            case 'set_eq_channel':
                await setEqChannelCommand.execute(interaction);
                break;
            case 'set_eq_threshold':
                await setEqThresholdCommand.execute(interaction);
                break;
            case 'get_eq':
                await getEqCommand.execute(interaction);
                break;
        }
    }
    catch (error) {
        console.error('コマンド実行エラー:', error);
        const message = '情報の取得・設定に失敗しました。少し待って再実行してください。通知設定は /weather status、使い方は /help で確認できます。';
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(message).catch(() => undefined);
        }
        else {
            await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
        }
    }
});
client.on('error', error => console.error('Discord接続エラー:', error));
client.login(token).catch(error => { console.error('Discord接続失敗:', error); process.exitCode = 1; });
