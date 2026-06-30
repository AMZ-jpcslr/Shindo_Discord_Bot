import { REST, Routes } from 'discord.js'
import dotenv from 'dotenv'
import { data as getEqData } from './commands/get_eq'
import { data as lotteryData } from './commands/lottery'
import { data as pingData } from './commands/ping'
import { data as setEqChannelData } from './commands/set_eq_channel'
import { data as setEqThresholdData } from './commands/set_eq_threshold'
import { data as shiftData } from './commands/shift'

dotenv.config()

const commands = [
    pingData.toJSON(),
    lotteryData.toJSON(),
    shiftData.toJSON(),
    setEqChannelData.toJSON(),
    setEqThresholdData.toJSON(),
    getEqData.toJSON(),
]

const token = process.env.TOKEN
const clientId = process.env.CLIENT_ID
const guildId = process.env.GUILD_ID

if (!token) {
    throw new Error('TOKEN が設定されていません')
}

if (!clientId) {
    throw new Error('CLIENT_ID が設定されていません')
}

const rest = new REST({ version: '10' }).setToken(token)
const applicationId: string = clientId

async function main() {
    try {
        if (guildId) {
            const targetGuildId: string = guildId
            console.log(`スラッシュコマンドをギルド ${targetGuildId} に登録中...`)
            await rest.put(
                Routes.applicationGuildCommands(applicationId, targetGuildId),
                { body: commands },
            )
            console.log('ギルドコマンド登録完了。通常はすぐ反映されます。')
            return
        }

        console.log('スラッシュコマンドをグローバル登録中...')
        await rest.put(
            Routes.applicationCommands(applicationId),
            { body: commands },
        )
        console.log('グローバルコマンド登録完了。反映には時間がかかる場合があります。')
    } catch (error) {
        console.error(error)
        process.exitCode = 1
    }
}

main()
