import { Client, GatewayIntentBits } from 'discord.js'
import dotenv from 'dotenv'
import * as getEqCommand from './commands/get_eq'
import * as lotteryCommand from './commands/lottery'
import * as pingCommand from './commands/ping'
import * as setEqChannelCommand from './commands/set_eq_channel'
import * as setEqThresholdCommand from './commands/set_eq_threshold'
import * as shiftCommand from './commands/shift'
import { startEqAutoNotify } from './eq_notify'

dotenv.config()

const token = process.env.TOKEN

if (!token) {
    throw new Error('TOKEN が .env に設定されていません')
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
})

function setBotPresence() {
    client.user?.setPresence({
        activities: [{ name: '緊急地震速報を監視中', type: 3 }],
        status: 'online',
    })
}

client.once('ready', () => {
    console.log('Ready!')
    console.log(client.user?.tag)
    setBotPresence()
    startEqAutoNotify(client)

    setInterval(() => {
        console.log(`Bot稼働中: ping=${client.ws.ping}ms / guilds=${client.guilds.cache.size}`)
    }, 5 * 60 * 1000)
})

client.on('shardResume', () => {
    setBotPresence()
})

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return

    try {
        switch (interaction.commandName) {
            case 'ping':
                await pingCommand.execute(interaction)
                break
            case 'lottery':
                await lotteryCommand.execute(interaction)
                break
            case 'shift':
                await shiftCommand.execute(interaction)
                break
            case 'set_eq_channel':
                await setEqChannelCommand.execute(interaction)
                break
            case 'set_eq_threshold':
                await setEqThresholdCommand.execute(interaction)
                break
            case 'get_eq':
                await getEqCommand.execute(interaction)
                break
        }
    } catch (error) {
        console.error('コマンド実行エラー:', error)
        const message = 'コマンドの実行中にエラーが発生しました。'

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(message).catch(() => undefined)
        } else {
            await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined)
        }
    }
})

client.login(token)
