"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('ping')
    .setDescription('BotのPing値を返します');
async function execute(interaction) {
    const ping = interaction.client.ws.ping;
    await interaction.reply(`現在のPing値: ${ping}ms`);
}
