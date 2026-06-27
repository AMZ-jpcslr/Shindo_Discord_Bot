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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const dotenv_1 = __importDefault(require("dotenv"));
const getEqCommand = __importStar(require("./commands/get_eq"));
const lotteryCommand = __importStar(require("./commands/lottery"));
const pingCommand = __importStar(require("./commands/ping"));
const setEqChannelCommand = __importStar(require("./commands/set_eq_channel"));
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
    var _a;
    (_a = client.user) === null || _a === void 0 ? void 0 : _a.setPresence({
        activities: [{ name: '緊急地震速報を監視中', type: 3 }],
        status: 'online',
    });
}
client.once('ready', () => {
    var _a;
    console.log('Ready!');
    console.log((_a = client.user) === null || _a === void 0 ? void 0 : _a.tag);
    setBotPresence();
    (0, eq_notify_1.startEqAutoNotify)(client);
    setInterval(() => {
        console.log(`Bot稼働中: ping=${client.ws.ping}ms / guilds=${client.guilds.cache.size}`);
    }, 5 * 60 * 1000);
});
client.on('shardResume', () => {
    setBotPresence();
});
client.on('interactionCreate', (interaction) => __awaiter(void 0, void 0, void 0, function* () {
    if (!interaction.isChatInputCommand())
        return;
    try {
        switch (interaction.commandName) {
            case 'ping':
                yield pingCommand.execute(interaction);
                break;
            case 'lottery':
                yield lotteryCommand.execute(interaction);
                break;
            case 'shift':
                yield shiftCommand.execute(interaction);
                break;
            case 'set_eq_channel':
                yield setEqChannelCommand.execute(interaction);
                break;
            case 'get_eq':
                yield getEqCommand.execute(interaction);
                break;
        }
    }
    catch (error) {
        console.error('コマンド実行エラー:', error);
        const message = 'コマンドの実行中にエラーが発生しました。';
        if (interaction.deferred || interaction.replied) {
            yield interaction.editReply(message).catch(() => undefined);
        }
        else {
            yield interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
        }
    }
}));
client.login(token);
