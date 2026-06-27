"use strict";
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
const ping_1 = require("./commands/ping");
const lottery_1 = require("./commands/lottery");
const shift_1 = require("./commands/shift");
const set_eq_channel_1 = require("./commands/set_eq_channel");
const get_eq_1 = require("./commands/get_eq");
dotenv_1.default.config();
const commands = [
    ping_1.data.toJSON(),
    lottery_1.data.toJSON(),
    shift_1.data.toJSON(),
    set_eq_channel_1.data.toJSON(),
    get_eq_1.data.toJSON(),
];
const token = process.env.TOKEN;
const clientId = process.env.CLIENT_ID;
if (!token) {
    throw new Error('TOKEN が .env に設定されていません');
}
if (!clientId) {
    throw new Error('CLIENT_ID が .env に設定されていません');
}
const rest = new discord_js_1.REST({ version: '10' }).setToken(token);
const applicationId = clientId;
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.log('スラッシュコマンドを登録中...');
            yield rest.put(discord_js_1.Routes.applicationCommands(applicationId), { body: commands });
            console.log('登録完了');
        }
        catch (error) {
            console.error(error);
        }
    });
}
main();
