import { readJson, writeJson } from './storage'
import { fetchWithTimeout as fetch } from './http'
import {
    AttachmentBuilder,
    Client,
    EmbedBuilder,
    GuildBasedChannel,
} from 'discord.js'
import fs from 'fs'
import path from 'path'
import WebSocket from 'ws'
import { createDisasterMapAttachment, linesForTsunamiAreaName, type DisasterMapLine } from './disaster_map'
import { createIntensityMapAttachment } from './intensity_map'

const P2P_WS_URL = 'wss://api.p2pquake.net/v2/ws'
const JMA_QUAKE_LIST_URL = 'https://www.jma.go.jp/bosai/quake/data/list.json'
const JMA_TSUNAMI_LIST_URL = 'https://www.jma.go.jp/bosai/tsunami/data/list.json'
type ChannelMap = Record<string, string>
type ThresholdMap = Record<string, number>
type LatestIds = {
    eew?: string
    p2pQuake?: string
    quake?: string
    tsunami?: string
    flood?: string
}

type P2PEewArea = {
    arrivalTime: string | null
    kindCode: string
    name: string
    pref: string
    scaleFrom: number
    scaleTo: number
}

type P2PEewMessage = {
    code: 556
    id: string
    time: string
    cancelled: boolean
    issue?: {
        eventId?: string
        serial?: string
        time?: string
    }
    earthquake?: {
        arrivalTime?: string
        originTime?: string
        condition?: string
        hypocenter?: {
            depth?: number
            latitude?: number
            longitude?: number
            magnitude?: number
            name?: string
            reduceName?: string
        }
    }
    areas?: P2PEewArea[]
}

type P2PQuakeMessage = {
    code: 551
    id: string
    earthquake?: {
        domesticTsunami?: string
        hypocenter?: {
            depth?: number
            latitude?: number
            longitude?: number
            magnitude?: number
            name?: string
        }
        maxScale?: number
        time?: string
    }
    issue?: {
        source?: string
        time?: string
        type?: string
    }
    points?: {
        addr?: string
        pref?: string
        scale?: number
    }[]
}

type JmaQuakeListItem = {
    ctt?: string
    eid?: string
    at?: string
    anm?: string
    mag?: string
    maxi?: string
    ttl?: string
    json?: string
}

type JmaQuakeDetail = {
    Head?: {
        ReportDateTime?: string
        Title?: string
        Text?: string
    }
    Body?: {
        Earthquake?: {
            OriginTime?: string
            ArrivalTime?: string
            Magnitude?: string
            Hypocenter?: {
                Area?: {
                    Name?: string
                    Code?: string
                    Coordinate?: string
                    Depth?: string
                }
            }
        }
        Intensity?: {
            Observation?: {
                MaxInt?: string
                Pref?: {
                    Area?: {
                        City?: {
                            IntensityStation?: {
                                Int?: string
                                latlon?: {
                                    lat?: number
                                    lon?: number
                                }
                            }[]
                        }[]
                    }[]
                }[]
            }
        }
    }
}

type DiscordPayload = {
    content?: string
    embeds: EmbedBuilder[]
    files?: AttachmentBuilder[]
}

type JmaTsunamiListItem = {
    ctt?: string
    eid?: string
    rdt?: string
    ttl?: string
    ift?: string
    at?: string
    anm?: string
    mag?: string
    kind?: {
        code?: string
        kind?: string
    }[]
    json?: string
}

type JmaTsunamiDetail = {
    Head?: {
        Title?: string
        ReportDateTime?: string
        Headline?: {
            Text?: string
        }
    }
    Body?: {
        Tsunami?: {
            Forecast?: {
                Item?: {
                    Area?: {
                        Name?: string
                        Code?: string
                    }
                    Category?: {
                        Kind?: {
                            Name?: string
                            Code?: string
                        }
                    }
                    MaxHeight?: {
                        TsunamiHeight?: string
                    }
                }[]
            }
        }
        Earthquake?: {
            OriginTime?: string
            Hypocenter?: {
                Area?: {
                    Name?: string
                    Coordinate?: string
                }
            }
            Magnitude?: string
        }[]
        Text?: string
    }
}

export function loadEqChannels(): ChannelMap { return readJson('eq_channels.json', {}) }
export function saveEqChannels(channels: ChannelMap) { writeJson('eq_channels.json', channels) }
export function loadEqThresholds(): ThresholdMap { return readJson('eq_thresholds.json', {}) }
export function saveEqThresholds(thresholds: ThresholdMap) { writeJson('eq_thresholds.json', thresholds) }
function loadLatestIds(): LatestIds { return readJson('latest_eq_ids.json', {}) }
function saveLatestIds(ids: Partial<LatestIds>) { writeJson('latest_eq_ids.json', { ...loadLatestIds(), ...ids }) }

type SendableGuildChannel = GuildBasedChannel & {
    send: (payload: DiscordPayload) => Promise<unknown>
}

function isSendableChannel(channel: GuildBasedChannel | null | undefined): channel is SendableGuildChannel {
    return Boolean(channel && 'send' in channel && typeof channel.send === 'function')
}

export async function sendToConfiguredChannels(
    client: Client, payload: DiscordPayload, maxScale: number | string | undefined,
    deliveryKey: string, bypassThreshold = false,
) {
    const channels = loadEqChannels()
    const thresholds = loadEqThresholds()
    const sent = readJson<Record<string, number>>('eq-deliveries.json', {})
    const failures: string[] = []
    for (const [guildId, channelId] of Object.entries(channels)) {
        if (!bypassThreshold && (thresholds[guildId] ?? 0) > scaleRank(maxScale)) continue
        const key = `${deliveryKey}:${guildId}:${channelId}`
        if (sent[key]) continue
        try {
            const guild = client.guilds.cache.get(guildId)
            if (!guild) throw new Error('サーバーに未接続')
            const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId)
            if (!isSendableChannel(channel)) throw new Error('送信できないチャンネル')
            await channel.send(payload)
            sent[key] = Date.now()
            const current = { ...readJson<Record<string, number>>('eq-deliveries.json', {}), [key]: sent[key] }
            const entries = Object.entries(current).sort((a,b) => b[1]-a[1]).slice(0,2000)
            writeJson('eq-deliveries.json', Object.fromEntries(entries))
        } catch (error) {
            console.error(`通知送信失敗: ${guildId}/${channelId}`, error)
            failures.push(guildId)
        }
    }
    if (failures.length) throw new Error(`通知未達: ${failures.join(',')}`)
}

async function sendDisasterToConfiguredChannels(client: Client, payload: DiscordPayload, deliveryKey: string) {
    return sendToConfiguredChannels(client, payload, undefined, deliveryKey, true)
}

function scaleToString(scale: number | string | undefined): string {
    const value = typeof scale === 'string' ? Number(scale) : scale

    switch (value) {
        case 10: return '1'
        case 20: return '2'
        case 30: return '3'
        case 40: return '4'
        case 45: return '5弱'
        case 50: return '5強'
        case 55: return '6弱'
        case 60: return '6強'
        case 70: return '7'
        default: return scale ? String(scale) : '不明'
    }
}

export function scaleRank(scale: number | string | undefined): number {
    if (typeof scale === 'number') {
        if (scale >= 70) return 70
        if (scale >= 60) return 60
        if (scale >= 55) return 55
        if (scale >= 50) return 50
        if (scale >= 45) return 45
        if (scale >= 40) return 40
        if (scale >= 30) return 30
        if (scale >= 20) return 20
        if (scale >= 10) return 10
        return 0
    }

    switch (scale) {
        case '7': return 70
        case '6+': return 60
        case '6-': return 55
        case '5+': return 50
        case '5-': return 45
        case '4': return 40
        case '3': return 30
        case '2': return 20
        case '1': return 10
        default: return 0
    }
}

function formatDepth(depth: number | string | undefined): string {
    if (depth === undefined || depth === null || depth === '') return '不明'
    if (typeof depth === 'number') return depth === 0 ? 'ごく浅い' : `${depth}km`
    return depth
}

function depthFromJmaCoordinate(coordinate?: string): number | null {
    if (!coordinate) return null

    const match = coordinate.match(/[+-]\d+(?:\.\d+)?[+-]\d+(?:\.\d+)?([+-]\d+)\/?/)
    if (!match) return null

    const meters = Math.abs(Number(match[1]))
    if (!Number.isFinite(meters)) return null

    return Math.round(meters / 1000)
}

function formatJmaDepth(depth: number | string | undefined, coordinate?: string): string {
    const coordinateDepth = depthFromJmaCoordinate(coordinate)
    if (coordinateDepth !== null) return coordinateDepth === 0 ? 'ごく浅い' : `${coordinateDepth}km`

    return formatDepth(depth)
}

function formatJstTime(time?: string): string {
    if (!time) return '不明'

    const normalized = time.includes('T')
        ? time
        : time.replace(/\//g, '-').replace(' ', 'T')
    const dateSource = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
        ? normalized
        : `${normalized}+09:00`
    const date = new Date(dateSource)
    if (Number.isNaN(date.getTime())) return time

    const parts = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date)
    const value = (type: string) => parts.find(part => part.type === type)?.value ?? ''

    return `${value('year')}年${value('month')}月${value('day')}日 ${value('hour')}:${value('minute')}`
}

function formatMagnitude(magnitude: number | string | undefined): string {
    if (magnitude === undefined || magnitude === null || magnitude === '') return '不明'
    return `M${magnitude}`
}

function formatCoordinate(latitude?: number, longitude?: number): string | null {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
    return `[震源付近を開く](https://www.google.com/maps?q=${latitude},${longitude})`
}

function parseJmaCoordinate(coordinate?: string): { latitude: number, longitude: number } | null {
    if (!coordinate) return null

    const match = coordinate.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/)
    if (!match) return null

    return {
        latitude: Number(match[1]),
        longitude: Number(match[2]),
    }
}

function normalizeJmaTime(time?: string): string | null {
    if (!time) return null
    return time.replace(/\//g, '-').replace(' ', 'T').slice(0, 16)
}

async function fetchJmaList(): Promise<JmaQuakeListItem[]> {
    const response = await fetch(JMA_QUAKE_LIST_URL)
    if (!response.ok) throw new Error(`JMA list fetch failed: ${response.status}`)
    return response.json() as Promise<JmaQuakeListItem[]>
}

function selectBestJmaItem(items: JmaQuakeListItem[]): JmaQuakeListItem | undefined {
    return items
        .filter(item => isValidJmaJsonPath(item.json))
        .sort((a, b) => {
            const aHasIntensityMap = a.json?.includes('VXSE5k') ? 1 : 0
            const bHasIntensityMap = b.json?.includes('VXSE5k') ? 1 : 0
            if (aHasIntensityMap !== bHasIntensityMap) return bHasIntensityMap - aHasIntensityMap
            if (a.maxi && !b.maxi) return -1
            if (!a.maxi && b.maxi) return 1
            return String(b.ctt ?? '').localeCompare(String(a.ctt ?? ''))
        })[0]
}

async function fetchJmaDetail(jsonPath: string): Promise<JmaQuakeDetail> {
    const detailUrl = `https://www.jma.go.jp/bosai/quake/data/${jsonPath}`
    const detailResponse = await fetch(detailUrl)
    if (!detailResponse.ok) throw new Error(`JMA detail fetch failed: ${detailResponse.status}`)
    return detailResponse.json() as Promise<JmaQuakeDetail>
}

async function fetchJmaTsunamiList(): Promise<JmaTsunamiListItem[]> {
    const response = await fetch(JMA_TSUNAMI_LIST_URL)
    if (!response.ok) throw new Error(`JMA tsunami list fetch failed: ${response.status}`)
    return response.json() as Promise<JmaTsunamiListItem[]>
}

async function fetchJmaTsunamiDetail(jsonPath: string): Promise<JmaTsunamiDetail> {
    const detailUrl = `https://www.jma.go.jp/bosai/tsunami/data/${jsonPath}`
    const detailResponse = await fetch(detailUrl)
    if (!detailResponse.ok) throw new Error(`JMA tsunami detail fetch failed: ${detailResponse.status}`)
    return detailResponse.json() as Promise<JmaTsunamiDetail>
}

async function findJmaDetailForP2P(
    eventId?: string,
    originTime?: string,
    hypocenterName?: string,
    magnitude?: number,
): Promise<JmaQuakeDetail | null> {
    const list = await fetchJmaList()
    const normalizedOrigin = normalizeJmaTime(originTime)
    const normalizedMagnitude = typeof magnitude === 'number' ? magnitude.toFixed(1) : null

    const candidates = list.filter(item => {
        if (!isValidJmaJsonPath(item.json)) return false
        if (eventId && item.eid === eventId) return true

        const sameTime = normalizedOrigin && normalizeJmaTime(item.at) === normalizedOrigin
        const sameName = !hypocenterName || item.anm === hypocenterName
        const sameMagnitude = !normalizedMagnitude || item.mag === normalizedMagnitude
        return Boolean(sameTime && sameName && sameMagnitude)
    })

    const best = selectBestJmaItem(candidates)
    if (!best?.json) return null

    return fetchJmaDetail(best.json)
}

function tsunamiColor(kindName?: string): string {
    if (kindName?.includes('警報')) return '#ff1f1f'
    return '#ffff00'
}

async function collectTsunamiLines(detail: JmaTsunamiDetail): Promise<DisasterMapLine[]> {
    const items = detail.Body?.Tsunami?.Forecast?.Item ?? []
    const linesByArea = await Promise.all(items.map(item => {
        const areaName = item.Area?.Name
        if (!areaName) return Promise.resolve([])

        return linesForTsunamiAreaName(areaName, tsunamiColor(item.Category?.Kind?.Name))
    }))

    return linesByArea.flat()
}

function localScaleImage(scale: number | string | undefined): AttachmentBuilder | null {
    const value = typeof scale === 'string' ? Number(scale) : scale
    const fileNameByScale: Record<number, string> = {
        10: 'nc300018.jpg',
        20: 'nc300017.jpg',
        30: 'nc300015.jpg',
        40: 'nc300014.jpg',
        45: 'nc300013.jpg',
        50: 'nc300012.jpg',
        55: 'nc300011.jpg',
        60: 'nc300010.jpg',
        70: 'nc300009.jpg',
    }

    const fileName = value ? fileNameByScale[value] : undefined
    if (!fileName) return null

    const filePath = [
        path.join(process.cwd(), fileName),
        path.join(__dirname, '..', fileName),
        path.join(__dirname, '../..', fileName),
    ].find(candidate => fs.existsSync(candidate))

    if (!filePath) return null

    return new AttachmentBuilder(filePath, { name: fileName })
}

async function buildEewEmbed(message: P2PEewMessage): Promise<DiscordPayload> {
    const hypocenter = message.earthquake?.hypocenter
    const maxScale = Math.max(...(message.areas ?? []).map(area => area.scaleTo), 0)
    const strongAreas = [...(message.areas ?? [])]
        .sort((a, b) => b.scaleTo - a.scaleTo)
        .slice(0, 8)
        .map(area => `${area.name}: ${scaleToString(area.scaleFrom)}${area.scaleFrom === area.scaleTo ? '' : `-${scaleToString(area.scaleTo)}`}`)
        .join('\n')

    const coordinateLink = formatCoordinate(hypocenter?.latitude, hypocenter?.longitude)
    // EEW must not wait for historical earthquake data or map downloads.
    const scaleImage = localScaleImage(scaleRank(maxScale))
    const title = message.cancelled ? '緊急地震速報 取消' : '緊急地震速報'
    const serial = message.issue?.serial ? `第${message.issue.serial}報` : '速報'
    const content = message.cancelled
        ? `緊急地震速報 取消: ${hypocenter?.name ?? '震源不明'}`
        : `緊急地震速報: ${hypocenter?.name ?? '震源不明'} 最大予測震度 ${maxScale > 0 ? scaleToString(maxScale) : '不明'}`

    const embed = new EmbedBuilder()
        .setTitle(`${title} (${serial})`)
        .setColor(message.cancelled ? 0x808080 : 0xff2d2d)
        .setDescription(message.cancelled ? 'この緊急地震速報は取り消されました。' : '強い揺れに警戒してください。身の安全を確保してください。')
        .addFields(
            { name: '震源', value: hypocenter?.name ?? '不明', inline: true },
            { name: '規模', value: formatMagnitude(hypocenter?.magnitude), inline: true },
            { name: '深さ', value: formatJmaDepth(hypocenter?.depth ?? undefined, undefined), inline: true },
            { name: '最大予測震度', value: maxScale > 0 ? scaleToString(maxScale) : '不明', inline: true },
            { name: '発生時刻', value: formatJstTime(message.earthquake?.originTime), inline: true },
            { name: '発表時刻', value: formatJstTime(message.issue?.time ?? message.time), inline: true },
        )
        .setFooter({ text: 'Source: P2P地震情報 / 気象庁' })
        .setTimestamp(new Date())

    if (coordinateLink) {
        embed.addFields({ name: '地図', value: coordinateLink, inline: true })
    }

    if (strongAreas) {
        embed.addFields({ name: '主な予測地域', value: strongAreas.slice(0, 1024), inline: false })
    }

    if (scaleImage) {
        embed.setThumbnail(`attachment://${scaleImage.name}`)
    }

    const files = [scaleImage].filter((file): file is AttachmentBuilder => Boolean(file))
    return files.length ? { content, embeds: [embed], files } : { content, embeds: [embed] }
}

async function buildP2PQuakeEmbed(message: P2PQuakeMessage): Promise<DiscordPayload> {
    const quake = message.earthquake
    const hypocenter = quake?.hypocenter
    const scaleImage = localScaleImage(quake?.maxScale)
    const coordinateLink = formatCoordinate(hypocenter?.latitude, hypocenter?.longitude)
    const jmaDetail = await findJmaDetailForP2P(
        undefined,
        quake?.time,
        hypocenter?.name,
        hypocenter?.magnitude,
    ).catch(() => null)
    const intensityMap = jmaDetail ? await createIntensityMapAttachment(jmaDetail, 'intensity-map.png').catch(() => null) : null
    const jmaHypocenter = jmaDetail?.Body?.Earthquake?.Hypocenter?.Area
    const observedPoints = [...(message.points ?? [])]
        .sort((a, b) => (b.scale ?? 0) - (a.scale ?? 0))
        .slice(0, 8)
        .map(point => `${point.pref ?? ''}${point.addr ?? ''}: ${scaleToString(point.scale)}`)
        .join('\n')
    const content = `地震情報: ${hypocenter?.name ?? '震源不明'} 最大震度 ${scaleToString(quake?.maxScale)}`

    const embed = new EmbedBuilder()
        .setTitle('地震情報')
        .setColor(0x2d6cdf)
        .addFields(
            { name: '震源', value: hypocenter?.name ?? '不明', inline: true },
            { name: '規模', value: formatMagnitude(hypocenter?.magnitude), inline: true },
            { name: '深さ', value: formatJmaDepth(hypocenter?.depth ?? jmaHypocenter?.Depth, jmaHypocenter?.Coordinate), inline: true },
            { name: '最大震度', value: scaleToString(quake?.maxScale), inline: true },
            { name: '発生時刻', value: formatJstTime(quake?.time), inline: true },
            { name: '津波', value: quake?.domesticTsunami === 'None' ? '心配なし' : quake?.domesticTsunami ?? '不明', inline: true },
        )
        .setFooter({ text: `Source: ${message.issue?.source ?? 'P2P地震情報 / 気象庁'}` })
        .setTimestamp(new Date())

    if (coordinateLink) {
        embed.addFields({ name: '地図', value: coordinateLink, inline: true })
    }

    if (observedPoints) {
        embed.addFields({ name: '主な観測点', value: observedPoints.slice(0, 1024), inline: false })
    }

    if (scaleImage) {
        embed.setThumbnail(`attachment://${scaleImage.name}`)
    }

    if (intensityMap) {
        embed.setImage('attachment://intensity-map.png')
    }

    const files = [scaleImage, intensityMap].filter((file): file is AttachmentBuilder => Boolean(file))
    return files.length ? { content, embeds: [embed], files } : { content, embeds: [embed] }
}

function isValidJmaJsonPath(jsonPath: unknown): jsonPath is string {
    return (
        typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..')
    )
}

async function buildJmaQuakeEmbed(detail: JmaQuakeDetail): Promise<DiscordPayload> {
    const earthquake = detail.Body?.Earthquake
    const hypocenter = earthquake?.Hypocenter?.Area
    const maxScale = detail.Body?.Intensity?.Observation?.MaxInt
    const coordinate = parseJmaCoordinate(hypocenter?.Coordinate)
    const coordinateLink = formatCoordinate(coordinate?.latitude, coordinate?.longitude)
    const intensityMap = await createIntensityMapAttachment(detail, 'intensity-map.png').catch(() => null)
    const scaleImage = localScaleImage(scaleRank(maxScale))
    const text = detail.Head?.Text
    const content = `地震情報: ${hypocenter?.Name ?? '震源不明'} 最大震度 ${scaleToString(maxScale)}`

    const embed = new EmbedBuilder()
        .setTitle(detail.Head?.Title ?? '地震情報')
        .setColor(0x2d6cdf)
        .setDescription(text || '気象庁から新しい地震情報が発表されました。')
        .addFields(
            { name: '震源', value: hypocenter?.Name ?? '不明', inline: true },
            { name: '規模', value: formatMagnitude(earthquake?.Magnitude), inline: true },
            { name: '深さ', value: formatJmaDepth(hypocenter?.Depth, hypocenter?.Coordinate), inline: true },
            { name: '最大震度', value: scaleToString(maxScale), inline: true },
            { name: '発生時刻', value: formatJstTime(earthquake?.OriginTime ?? earthquake?.ArrivalTime), inline: true },
            { name: '発表時刻', value: formatJstTime(detail.Head?.ReportDateTime), inline: true },
        )
        .setFooter({ text: 'Source: 気象庁' })
        .setTimestamp(new Date())

    if (intensityMap) {
        embed.setImage('attachment://intensity-map.png')
    }

    if (coordinateLink) {
        embed.addFields({ name: '地図', value: coordinateLink, inline: true })
    }

    if (scaleImage) {
        embed.setThumbnail(`attachment://${scaleImage.name}`)
    }

    const files = [scaleImage, intensityMap].filter((file): file is AttachmentBuilder => Boolean(file))
    return files.length ? { content, embeds: [embed], files } : { content, embeds: [embed] }
}

async function buildJmaTsunamiEmbed(detail: JmaTsunamiDetail): Promise<DiscordPayload> {
    const items = detail.Body?.Tsunami?.Forecast?.Item ?? []
    const earthquake = detail.Body?.Earthquake?.[0]
    const lines = await collectTsunamiLines(detail).catch(() => [])
    const disasterMap = await createDisasterMapAttachment([], 'tsunami-map.png', lines).catch(() => null)
    const affectedAreas = items
        .slice(0, 12)
        .map(item => {
            const area = item.Area?.Name ?? '不明'
            const kind = item.Category?.Kind?.Name ?? '津波情報'
            const height = item.MaxHeight?.TsunamiHeight ? ` / 予想高さ ${item.MaxHeight.TsunamiHeight}m` : ''
            return `${area}: ${kind}${height}`
        })
        .join('\n')
    const content = `${detail.Head?.Title ?? '津波情報'}: ${items.slice(0, 3).map(item => item.Area?.Name).filter(Boolean).join('、') || '対象地域不明'}`

    const embed = new EmbedBuilder()
        .setTitle(detail.Head?.Title ?? '津波情報')
        .setColor(0xff1f1f)
        .setDescription(detail.Head?.Headline?.Text ?? detail.Body?.Text ?? '気象庁から津波に関する情報が発表されました。')
        .addFields(
            { name: '震源', value: earthquake?.Hypocenter?.Area?.Name ?? '不明', inline: true },
            { name: '規模', value: formatMagnitude(earthquake?.Magnitude), inline: true },
            { name: '発表時刻', value: formatJstTime(detail.Head?.ReportDateTime), inline: true },
        )
        .setFooter({ text: 'Source: 気象庁' })
        .setTimestamp(new Date())

    if (affectedAreas) {
        embed.addFields({ name: '対象地域', value: affectedAreas.slice(0, 1024), inline: false })
    }

    if (disasterMap) {
        embed.setImage('attachment://tsunami-map.png')
    }

    return disasterMap ? { content, embeds: [embed], files: [disasterMap] } : { content, embeds: [embed] }
}

async function pollJmaQuake(client: Client) {
    const list = await fetchJmaList()
    const latestPath = list.find(item => isValidJmaJsonPath(item.json))?.json
    if (!latestPath) return

    const latestIds = loadLatestIds()
    if (latestIds.quake === latestPath) return

    const detail = await fetchJmaDetail(latestPath)
    await sendToConfiguredChannels(
        client,
        await buildJmaQuakeEmbed(detail),
        detail.Body?.Intensity?.Observation?.MaxInt,
        `jma:${latestPath}`,
    )

    saveLatestIds({ quake: latestPath })
}

async function pollJmaTsunami(client: Client) {
    const list = await fetchJmaTsunamiList()
    const latestPath = list.find(item => isValidJmaJsonPath(item.json))?.json
    if (!latestPath) return

    const latestIds = loadLatestIds()
    if (latestIds.tsunami === latestPath) return

    const detail = await fetchJmaTsunamiDetail(latestPath)
    await sendDisasterToConfiguredChannels(client, await buildJmaTsunamiEmbed(detail), `tsunami:${latestPath}`)

    saveLatestIds({ tsunami: latestPath })
}

function shouldNotifyP2PMessage(message: unknown): message is P2PEewMessage | P2PQuakeMessage {
    if (!message || typeof message !== 'object') return false
    const code = (message as { code?: unknown }).code
    return (code === 556 || code === 551) && typeof (message as { id?: unknown }).id === 'string' && Boolean((message as { id: string }).id)
}

export async function handleP2PMessage(client: Client, rawData: WebSocket.RawData) {
    const message = JSON.parse(rawData.toString()) as unknown
    if (!shouldNotifyP2PMessage(message)) return

    const latestIds = loadLatestIds()
    if (message.code === 556) {
        if (latestIds.eew === message.id) return
        await sendToConfiguredChannels(
            client,
            await buildEewEmbed(message),
            Math.max(...(message.areas ?? []).map(area => area.scaleTo), 0),
            `eew:${message.id}`, message.cancelled,
        )
        saveLatestIds({ eew: message.id })
        return
    }

    if (latestIds.p2pQuake === message.id) return
    await sendToConfiguredChannels(client, await buildP2PQuakeEmbed(message), message.earthquake?.maxScale, `p2p:${message.id}`)
    saveLatestIds({ p2pQuake: message.id })
}

function startP2PWebSocket(client: Client) {
    let reconnectTimer: NodeJS.Timeout | undefined
    let eewQueue = Promise.resolve()
    let quakeQueue = Promise.resolve()

    const connect = () => {
        const ws = new WebSocket(P2P_WS_URL)

        ws.on('open', () => {
            console.log('P2P地震情報 WebSocket に接続しました')
        })

        ws.on('message', (data) => {
            // Maps for ordinary earthquakes must never delay an EEW.
            let code: unknown
            try { code = (JSON.parse(data.toString()) as { code?: unknown }).code } catch { return }
            const handle = () => handleP2PMessage(client, data).catch((error: unknown) => {
                console.error('P2P地震情報の通知処理でエラーが発生しました:', error)
            })
            if (code === 556) eewQueue = eewQueue.then(handle)
            else if (code === 551) quakeQueue = quakeQueue.then(handle)
        })

        ws.on('close', () => {
            console.warn('P2P地震情報 WebSocket が切断されました。10秒後に再接続します。')
            if (reconnectTimer) clearTimeout(reconnectTimer)
            reconnectTimer = setTimeout(connect, 10 * 1000)
        })

        ws.on('error', (error) => {
            console.error('P2P地震情報 WebSocket エラー:', error)
            ws.close()
        })
    }

    connect()
}

function schedulePoll(task: () => Promise<void>) {
    const tick = async () => {
        try { await task() } catch (error) { console.error('気象庁監視エラー:', error) }
        setTimeout(tick, 60_000).unref()
    }
    void tick()
}

export function startEqAutoNotify(client: Client) {
    startP2PWebSocket(client)
    schedulePoll(() => pollJmaTsunami(client))
    schedulePoll(() => pollJmaQuake(client))
}
