import * as weatherCommand from './commands/weather'
import * as helpCommand from './commands/help'
import { startWeatherNotify } from './weather_notify'
import { getRegions } from './weather'
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
        activities: [{ name: '地震・津波・気象情報 | /help', type: 3 }],
        status: 'online',
    })
}

client.once('ready', () => {
    console.log('Ready!')
    console.log(client.user?.tag)
    setBotPresence()
    startEqAutoNotify(client)
    startWeatherNotify(client)
    getRegions().catch(error => console.error('地域候補の準備に失敗:', error))

    setInterval(() => {
        console.log(`Bot稼働中: ping=${client.ws.ping}ms / guilds=${client.guilds.cache.size}`)
    }, 5 * 60 * 1000)
})

client.on('shardResume', () => {
    setBotPresence()
})

client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete() && interaction.commandName === 'weather') {
        await weatherCommand.autocomplete(interaction)
        return
    }
    if (!interaction.isChatInputCommand()) return

    try {
        switch (interaction.commandName) {
            case 'weather':
                await weatherCommand.execute(interaction)
                break
            case 'help':
                await helpCommand.execute(interaction)
                break
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
        const message = '情報の取得・設定に失敗しました。少し待って再実行してください。通知設定は /weather status、使い方は /help で確認できます。'

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(message).catch(() => undefined)
        } else {
            await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined)
        }
    }
})

client.on('error', error => console.error('Discord接続エラー:', error))
client.login(token).catch(error => { console.error('Discord接続失敗:', error); process.exitCode = 1 })
