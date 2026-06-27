import { REST, Routes } from 'discord.js'
import dotenv from 'dotenv'
import { data as pingData } from './commands/ping'
import { data as lotteryData } from './commands/lottery'
import { data as shiftData } from './commands/shift'
import { data as setEqChannelData } from './commands/set_eq_channel'
import { data as getEqData } from './commands/get_eq'

dotenv.config()

const commands = [
    pingData.toJSON(),
    lotteryData.toJSON(),
    shiftData.toJSON(),
    setEqChannelData.toJSON(),
    getEqData.toJSON(),
]

const token = process.env.TOKEN
const clientId = process.env.CLIENT_ID

if (!token) {
    throw new Error('TOKEN が .env に設定されていません')
}

if (!clientId) {
    throw new Error('CLIENT_ID が .env に設定されていません')
}

const rest = new REST({ version: '10' }).setToken(token)
const applicationId: string = clientId

async function main() {
    try {
        console.log('スラッシュコマンドを登録中...')
        await rest.put(
            Routes.applicationCommands(applicationId),
            { body: commands }
        )
        console.log('登録完了')
    } catch (error) {
        console.error(error)
    }
}

main()
