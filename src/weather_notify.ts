import { Client, EmbedBuilder } from 'discord.js'
import { readJson, writeJson } from './storage'
import { getRain, getWarningReports, parseWarnings, rainEmbed, upcomingRain, warningEmbed, Region, WarningReport } from './weather'

export type Subscription = { region: Region; channel: string; warnings: boolean; advisories: boolean; rain: boolean; threshold: number; revision: string }
export type WeatherConfig = Record<string, Record<string, Subscription>>
type Delivery = { revision: string; codes?: string[]; rainTime?: number; lastRainSent?: number; rainChecked?: number; warningChecked?: number; error?: string }
type State = Record<string, Delivery>
export function loadWeather(): WeatherConfig { return readJson('weather.json', {}) }
export function saveWeather(config: WeatherConfig): void { writeJson('weather.json', config) }
export function weatherState(): State { return readJson('weather-state.json', {}) }
export type Sender = (guild: string, channel: string, embed: EmbedBuilder) => Promise<unknown>
export type Providers = { warnings: typeof getWarningReports; rain: typeof getRain }

export async function pollWeather(send: Sender, providers: Providers = { warnings: getWarningReports, rain: getRain }, now = Date.now()): Promise<void> {
    const config = loadWeather()
    const states = weatherState()
    const warningCache = new Map<string, Promise<WarningReport[]>>()
    const rainCache = new Map<string, ReturnType<typeof getRain>>()
    for (const [guild, subscriptions] of Object.entries(config)) {
        for (const [code, sub] of Object.entries(subscriptions)) {
            const key = `${guild}:${code}`
            const state: Delivery = states[key]?.revision === sub.revision ? states[key] : { revision: sub.revision }
            states[key] = state
            const errors: string[] = []
            // Re-check after network awaits so deleted/replaced subscriptions do not send.
            const current = () => loadWeather()[guild]?.[code]?.revision === sub.revision
            if (sub.warnings) {
                try {
                    if (!warningCache.has(sub.region.office)) warningCache.set(sub.region.office, providers.warnings(sub.region.office))
                    const snapshot = parseWarnings(await warningCache.get(sub.region.office)!, code, sub.advisories)
                    if (!current()) continue
                    if (JSON.stringify(state.codes) !== JSON.stringify(snapshot.codes) && (state.codes !== undefined || snapshot.codes.length)) {
                        await send(guild, sub.channel, warningEmbed(sub.region, snapshot, state.codes))
                    }
                    state.codes = snapshot.codes
                    state.warningChecked = now
                } catch (error) { errors.push(`警報: ${error instanceof Error ? error.message : String(error)}`) }
            }
            if (sub.rain && (!state.rainChecked || now - state.rainChecked >= 15 * 60_000)) {
                try {
                    if (!rainCache.has(code)) rainCache.set(code, providers.rain(sub.region))
                    const event = upcomingRain(await rainCache.get(code)!, sub.threshold, now)
                    if (!current()) continue
                    if (event && event.time !== state.rainTime && (!state.lastRainSent || now - state.lastRainSent >= 3 * 3600_000)) {
                        await send(guild, sub.channel, rainEmbed(sub.region, event))
                        state.rainTime = event.time
                        state.lastRainSent = now
                    }
                    state.rainChecked = now
                } catch (error) { errors.push(`降水: ${error instanceof Error ? error.message : String(error)}`) }
            }
            state.error = errors.length ? errors.join(' / ').slice(0, 300) : undefined
            if (state.error) console.error(`気象通知 ${key}: ${state.error}`)
            writeJson('weather-state.json', states)
        }
    }
    const current = loadWeather()
    for (const key of Object.keys(states)) {
        const [guild, code] = key.split(':')
        if (!current[guild]?.[code]) delete states[key]
    }
    writeJson('weather-state.json', states)
}

export function startWeatherNotify(client: Client): void {
    const send: Sender = async (guildId, channelId, embed) => {
        const guild = client.guilds.cache.get(guildId)
        if (!guild) throw new Error('サーバーに接続できません')
        const channel = await guild.channels.fetch(channelId)
        if (!channel?.isTextBased() || !('send' in channel)) throw new Error('通知先を確認してください')
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } })
    }
    const tick = async () => {
        try { await pollWeather(send) } catch (error) { console.error('気象監視エラー:', error) }
        setTimeout(tick, 60_000).unref()
    }
    void tick()
}
