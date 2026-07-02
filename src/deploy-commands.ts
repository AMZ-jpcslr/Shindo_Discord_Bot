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
const configuredGuildIds = [
    process.env.GUILD_ID,
    process.env.GUILD_IDS,
]
    .filter((value): value is string => Boolean(value))
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)

if (!token) {
    throw new Error('TOKEN が設定されていません')
}

if (!clientId) {
    throw new Error('CLIENT_ID が設定されていません')
}

type DiscordGuild = {
    id: string
    name?: string
}

const rest = new REST({ version: '10' }).setToken(token)
const applicationId: string = clientId

async function fetchBotGuilds(): Promise<DiscordGuild[]> {
    if (configuredGuildIds.length) {
        return configuredGuildIds.map(id => ({ id }))
    }

    return rest.get(Routes.userGuilds()) as Promise<DiscordGuild[]>
}

async function overwriteGlobalCommands() {
    console.log('グローバルコマンドを現在の一覧で上書きしています...')
    await rest.put(
        Routes.applicationCommands(applicationId),
        { body: commands },
    )
    console.log('グローバルコマンドの上書きが完了しました。反映にはDiscord側の時間がかかる場合があります。')
}

async function overwriteGuildCommands(guilds: DiscordGuild[]) {
    if (!guilds.length) {
        console.warn('参加中のサーバーを取得できなかったため、ギルドコマンド登録をスキップしました。')
        return
    }

    console.log(`${guilds.length}件のサーバーへギルドコマンドを即時反映します...`)

    for (const guild of guilds) {
        await rest.put(
            Routes.applicationGuildCommands(applicationId, guild.id),
            { body: commands },
        )
        console.log(`ギルドコマンド更新完了: ${guild.name ?? guild.id}`)
    }
}

async function main() {
    try {
        await overwriteGlobalCommands()
        await overwriteGuildCommands(await fetchBotGuilds())
        console.log('スラッシュコマンドの一括更新が完了しました。')
    } catch (error) {
        console.error(error)
        process.exitCode = 1
    }
}

main()
