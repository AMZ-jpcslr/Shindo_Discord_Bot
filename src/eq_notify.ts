import { intensityEmbedColor } from './intensity_colors'
import { BASEMAP_CREDIT } from './basemap'
import { readJson, writeJson } from './storage'
import { fetchWithTimeout as fetch } from './http'
import { createCachedJsonFeed, scheduleJmaPoll } from './jma_polling'
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

export type JmaQuakeListItem = {
    ctt?: string
    eid?: string
    rdt?: string
    at?: string
    anm?: string
    mag?: string
    maxi?: string
    ttl?: string
    json?: string
}

export type JmaQuakeDetail = {
    Head?: {
        EventID?: string
        InfoType?: string
        TargetDateTime?: string
        Headline?: { Text?: string }
        ReportDateTime?: string
        Title?: string
        Text?: string
    }
    Body?: {
        Comments?: { ForecastComment?: { Text?: string, Code?: string } }
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
                    Name?: string
                    MaxInt?: string
                    Area?: {
                        Name?: string
                        MaxInt?: string
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

export type DiscordPayload = {
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
    onDelivered?: (guildId: string, channelId: string, messageId: string) => void,
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
            const message = await channel.send(payload) as { id?: string }
            sent[key] = Date.now()
            const current = { ...readJson<Record<string, number>>('eq-deliveries.json', {}), [key]: sent[key] }
            const entries = Object.entries(current).sort((a,b) => b[1]-a[1]).slice(0,2000)
            writeJson('eq-deliveries.json', Object.fromEntries(entries))
            if (message?.id) onDelivered?.(guildId, channelId, message.id)
        } catch (error) {
            console.error(`通知送信失敗: ${guildId}/${channelId}`, error)
            failures.push(guildId)
        }
    }
    if (failures.length) throw new Error(`通知未達: ${failures.join(',')}`)
}



function scaleToString(scale: number | string | undefined): string {
    if (typeof scale === 'number' && scale <= 0) return '不明'
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
        case undefined: return '不明'
        default: return scale ? String(scale).replace('+', '強').replace('-', '弱') : '不明'
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
    if (typeof depth === 'number') return depth < 0 ? '不明' : depth === 0 ? 'ごく浅い' : `${depth}km`
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
    if (magnitude === undefined || magnitude === null || magnitude === '' || Number(magnitude) < 0) return '不明'
    return `M${magnitude}`
}

function formatCoordinate(latitude?: number, longitude?: number): string | null {
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || latitude === -200 || longitude === -200 || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
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

const quakeFeed = createCachedJsonFeed<JmaQuakeListItem[]>(JMA_QUAKE_LIST_URL)
const tsunamiFeed = createCachedJsonFeed<JmaTsunamiListItem[]>(JMA_TSUNAMI_LIST_URL)
let quakeDetailsHealthy = true

async function fetchJmaDetail(jsonPath: string): Promise<JmaQuakeDetail> {
    const detailUrl = `https://www.jma.go.jp/bosai/quake/data/${jsonPath}`
    const detailResponse = await fetch(detailUrl)
    if (!detailResponse.ok) throw new Error(`JMA detail fetch failed: ${detailResponse.status}`)
    const detail = await detailResponse.json() as JmaQuakeDetail
    if (!detail || typeof detail !== 'object' || !detail.Head) throw new Error('Invalid JMA earthquake detail')
    return detail
}

async function fetchJmaTsunamiDetail(jsonPath: string): Promise<JmaTsunamiDetail> {
    const detailUrl = `https://www.jma.go.jp/bosai/tsunami/data/${jsonPath}`
    const detailResponse = await fetch(detailUrl)
    if (!detailResponse.ok) throw new Error(`JMA tsunami detail fetch failed: ${detailResponse.status}`)
    return detailResponse.json() as Promise<JmaTsunamiDetail>
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
        .setColor(message.cancelled ? 0x808080 : intensityEmbedColor(maxScale))
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
    const observedPoints = [...(message.points ?? [])]
        .sort((a, b) => (b.scale ?? 0) - (a.scale ?? 0))
        .slice(0, 8)
        .map(point => `${point.pref ?? ''}${point.addr ?? ''}: ${scaleToString(point.scale)}`)
        .join('\n')
    const preliminary = !hypocenter?.name
    const content = `地震情報（P2P代替速報）: 最大震度 ${scaleToString(quake?.maxScale)} / ${hypocenter?.name || '震源は解析中'}`

    const embed = new EmbedBuilder()
        .setTitle('地震情報（P2P代替速報）')
        .setDescription(`${preliminary ? '震源・規模・深さは解析中です。\n' : ''}気象庁の取得が不調のため代替配信しています。共通イベントIDがないため、復旧後の気象庁情報とは別投稿になります。`)
        .setColor(intensityEmbedColor(quake?.maxScale))
        .addFields(

            { name: '最大震度', value: scaleToString(quake?.maxScale), inline: true },
            { name: '発生時刻', value: formatJstTime(quake?.time), inline: true },
            { name: '津波', value: ({ None: '心配なし', Unknown: '調査中', Checking: '調査中', NonEffective: '若干の海面変動の可能性', Watch: '津波注意報あり', Warning: '津波警報あり' } as Record<string, string>)[quake?.domesticTsunami ?? ''] ?? '調査中', inline: true },
        )
        .setFooter({ text: `Source: ${message.issue?.source ?? 'P2P地震情報 / 気象庁'}` })
        .setTimestamp(new Date())

    if (!preliminary) embed.addFields(
        { name: '震源', value: hypocenter!.name!, inline: true },
        { name: '規模', value: formatMagnitude(hypocenter?.magnitude), inline: true },
        { name: '深さ', value: formatDepth(hypocenter?.depth), inline: true },
    )

    if (coordinateLink) {
        embed.addFields({ name: '地図', value: coordinateLink, inline: true })
    }

    if (observedPoints) {
        embed.addFields({ name: '主な観測点', value: observedPoints.slice(0, 1024), inline: false })
    }

    if (scaleImage) {
        embed.setThumbnail(`attachment://${scaleImage.name}`)
    }

    const files = [scaleImage].filter((file): file is AttachmentBuilder => Boolean(file))
    return files.length ? { content, embeds: [embed], files } : { content, embeds: [embed] }
}

function isValidJmaJsonPath(jsonPath: unknown): jsonPath is string {
    return (
        typeof jsonPath === 'string' && /^[A-Za-z0-9_-]+\.json$/.test(jsonPath)
    )
}

export async function buildJmaQuakeEmbed(detail: JmaQuakeDetail, includeMap = false): Promise<DiscordPayload> {
    const earthquake = detail.Body?.Earthquake
    const hypocenter = earthquake?.Hypocenter?.Area
    const maxScale = detail.Body?.Intensity?.Observation?.MaxInt
    const coordinate = parseJmaCoordinate(hypocenter?.Coordinate)
    const coordinateLink = formatCoordinate(coordinate?.latitude, coordinate?.longitude)
    const intensityMap = includeMap ? await createIntensityMapAttachment(detail, 'intensity-map.png').catch(() => null) : null
    const scaleImage = localScaleImage(scaleRank(maxScale))
    const preliminary = !hypocenter?.Name
    const cancelled = detail.Head?.InfoType === '取消'
    const text = detail.Body?.Comments?.ForecastComment?.Text || detail.Head?.Text || detail.Head?.Headline?.Text
    const observedAreas = (detail.Body?.Intensity?.Observation?.Pref ?? []).flatMap(pref =>
        (pref.Area ?? []).map(area => ({ name: area.Name || pref.Name, scale: area.MaxInt || pref.MaxInt })))
        .filter(area => area.name).sort((a, b) => scaleRank(b.scale) - scaleRank(a.scale))
        .slice(0, 12).map(area => `${area.name}: 震度${scaleToString(area.scale)}`).join('、')
    const content = cancelled ? '地震情報 取消: この地震情報は取り消されました。'
        : `地震情報: 最大震度 ${scaleToString(maxScale)} / ${hypocenter?.Name || '震源は解析中'}`

    const embed = new EmbedBuilder()
        .setTitle(cancelled ? '地震情報 取消' : preliminary ? '地震情報（初報）' : '地震情報（更新）')
        .setColor(cancelled ? 0x808080 : intensityEmbedColor(maxScale))
        .setDescription(cancelled ? 'この地震情報は取り消されました。' : preliminary ? '震源・規模・深さは解析中です。続報でこの投稿を更新します。' : (text || '気象庁の続報で更新しました。').slice(0, 4096))
        .addFields(
            { name: '最大震度', value: scaleToString(maxScale), inline: true },
            { name: preliminary ? '揺れを観測した時刻' : '発生時刻', value: formatJstTime(earthquake?.OriginTime ?? earthquake?.ArrivalTime ?? detail.Head?.TargetDateTime), inline: true },
            { name: '発表時刻', value: formatJstTime(detail.Head?.ReportDateTime), inline: true },
        )
        .setFooter({ text: 'Source: 気象庁' })
        .setTimestamp(new Date())

    if (!preliminary) embed.addFields(
        { name: '震源', value: hypocenter?.Name || '解析中', inline: true },
        { name: '規模', value: formatMagnitude(earthquake?.Magnitude), inline: true },
        { name: '深さ', value: formatJmaDepth(hypocenter?.Depth, hypocenter?.Coordinate), inline: true },
    )
    if (observedAreas) embed.addFields({ name: '主な観測地域', value: observedAreas.slice(0, 1024) })

    if (intensityMap) {
        embed.setImage('attachment://intensity-map.png')
        embed.addFields(BASEMAP_CREDIT)
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

async function buildJmaTsunamiEmbed(detail: JmaTsunamiDetail, includeMap = false): Promise<DiscordPayload> {
    const items = detail.Body?.Tsunami?.Forecast?.Item ?? []
    const earthquake = detail.Body?.Earthquake?.[0]
    const lines = includeMap ? await collectTsunamiLines(detail).catch(() => []) : []
    const disasterMap = includeMap ? await createDisasterMapAttachment([], 'tsunami-map.png', lines).catch(() => null) : null
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
        embed.addFields(BASEMAP_CREDIT)
    }

    return disasterMap ? { content, embeds: [embed], files: [disasterMap] } : { content, embeds: [embed] }
}

type QuakeDelivery = {
    messageId: string
    revision: string
    pendingAlerts: { revision: string, from: string, to: string }[]
    mapRevision?: string
}
type QuakeEvent = {
    revision: string
    detail: JmaQuakeDetail
    updatedAt: number
    deliveries: Record<string, QuakeDelivery>
    targets: ChannelMap
}
type QuakeJournal = { initialized: boolean, seen: Record<string, number>, events: Record<string, QuakeEvent> }
const journalFile = 'eq-events.json'
const loadJournal = (): QuakeJournal => readJson(journalFile, { initialized: false, seen: {}, events: {} })
const eventQueues = new Map<string, Promise<unknown>>()

function serializeEvent<T>(key: string, task: () => Promise<T>): Promise<T> {
    const next = (eventQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task)
    eventQueues.set(key, next)
    void next.finally(() => { if (eventQueues.get(key) === next) eventQueues.delete(key) }).catch(() => undefined)
    return next
}

function saveEvent(key: string, event: QuakeEvent) {
    const journal = loadJournal()
    journal.events[key] = event
    writeJson(journalFile, journal)
}

function markSeen(jsonPath: string) {
    const journal = loadJournal()
    journal.seen[jsonPath] = Date.now()
    // Never expire unacknowledged deliveries. Successful old events can be pruned.
    for (const [key, event] of Object.entries(journal.events)) {
        if (Date.now() - event.updatedAt > 7 * 86400_000 && Object.entries(event.targets).every(([guildId, channelId]) => {
                if (loadEqChannels()[guildId] !== channelId) return true
                const delivery = event.deliveries[`${guildId}:${channelId}`]
                return delivery && delivery.revision === event.revision && !delivery.pendingAlerts.length
            })) delete journal.events[key]
    }
    journal.seen = Object.fromEntries(Object.entries(journal.seen).sort((a, b) => b[1] - a[1]).slice(0, 5000))
    writeJson(journalFile, journal)
}

export function jmaEventKey(item: JmaQuakeListItem, detail: JmaQuakeDetail): string {
    const validId = (id?: string) => typeof id === 'string' && /^\d{12,20}$/.test(id)
    const detailId = detail.Head?.EventID
    if (validId(item.eid) && validId(detailId) && item.eid !== detailId) throw new Error('JMA event ID mismatch')
    const id = validId(detailId) ? detailId : validId(item.eid) ? item.eid : undefined
    // Missing identity is not permission to infer a match from time or location.
    return id ? `jma:${id}` : `jma-report:${item.json}`
}

export function mergeJmaDetail(previous: JmaQuakeDetail | undefined, next: JmaQuakeDetail): JmaQuakeDetail {
    return {
        Head: { ...previous?.Head, ...next.Head },
        Body: {
            ...previous?.Body, ...next.Body,
            Earthquake: next.Body?.Earthquake ? {
                ...previous?.Body?.Earthquake, ...next.Body.Earthquake,
                Hypocenter: next.Body.Earthquake.Hypocenter ? {
                    ...previous?.Body?.Earthquake?.Hypocenter, ...next.Body.Earthquake.Hypocenter,
                    Area: { ...previous?.Body?.Earthquake?.Hypocenter?.Area, ...next.Body.Earthquake.Hypocenter.Area },
                } : previous?.Body?.Earthquake?.Hypocenter,
            } : previous?.Body?.Earthquake,
            Intensity: next.Body?.Intensity ?? previous?.Body?.Intensity,
            Comments: next.Body?.Comments ?? previous?.Body?.Comments,
        },
    }
}

type EditableChannel = SendableGuildChannel & {
    messages: { edit: (id: string, payload: DiscordPayload & { attachments: [] }) => Promise<unknown> }
}
async function getQuakeChannel(client: Client, guildId: string, channelId: string): Promise<EditableChannel> {
    const guild = client.guilds.cache.get(guildId)
    if (!guild) throw new Error('サーバーに未接続')
    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId)
    if (!isSendableChannel(channel) || !('messages' in channel)) throw new Error('送信・編集できないチャンネル')
    return channel as EditableChannel
}
function unknownMessage(error: unknown): boolean {
    // 403, timeouts, and unknown channels must not cause duplicate replacement sends.
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 10008)
}

async function deliverQuakeEvent(client: Client, key: string, event: QuakeEvent, preparedPayload?: DiscordPayload) {
    const payload = preparedPayload ?? await buildJmaQuakeEmbed(event.detail)
    const thresholds = loadEqThresholds()
    const cancelled = event.detail.Head?.InfoType === '取消'
    const rank = scaleRank(event.detail.Body?.Intensity?.Observation?.MaxInt)
    const failures: string[] = []
    const configured = loadEqChannels()
    await Promise.all(Object.entries(event.targets).map(async ([guildId, channelId]) => {
        if (configured[guildId] !== channelId) return
        const destination = `${guildId}:${channelId}`
        let delivery = event.deliveries[destination]
        if (!delivery && (cancelled || rank === 0 || (thresholds[guildId] ?? 0) > rank)) return
        if (delivery?.revision === event.revision && !delivery.pendingAlerts.length) return
        try {
            const channel = await getQuakeChannel(client, guildId, channelId)
            if (!delivery) {
                const message = await channel.send(payload) as { id: string }
                if (!message?.id) throw new Error('Discord message ID missing')
                delivery = { messageId: message.id, revision: event.revision, pendingAlerts: [],
                    ...(payload.embeds[0]?.data.image ? { mapRevision: event.revision } : {}) }
                event.deliveries[destination] = delivery
                saveEvent(key, event)
            } else if (delivery.revision !== event.revision) {
                try {
                    await channel.messages.edit(delivery.messageId, { ...payload, attachments: [] })
                } catch (error) {
                    if (!unknownMessage(error)) throw error
                    const replacement = await channel.send(payload) as { id: string }
                    if (!replacement?.id) throw new Error('Discord message ID missing')
                    delivery.messageId = replacement.id
                }
                delivery.revision = event.revision
                if (payload.embeds[0]?.data.image) delivery.mapRevision = event.revision
                saveEvent(key, event)
            }
            for (const alert of [...delivery.pendingAlerts]) {
                await channel.send({
                    content: `【最大震度の引き上げ】震度${alert.from} → 震度${alert.to}\nhttps://discord.com/channels/${guildId}/${channelId}/${delivery.messageId}`,
                    embeds: [],
                })
                delivery.pendingAlerts = delivery.pendingAlerts.filter(item => item.revision !== alert.revision)
                saveEvent(key, event)
            }
        } catch (error) {
            console.error(`地震情報の送信・更新失敗: ${destination}`, error)
            failures.push(destination)
        }
    }))
    if (failures.length) throw new Error(`地震情報未達: ${failures.join(',')}`)
}

// Normal earthquake bulletins may wait up to three seconds for the map.
// EEW, tsunami alerts, and separate intensity escalation alerts never wait here.
export const QUAKE_MAP_WAIT_MS = 3000
const quakeMapJobs = new Map<string, { promise: Promise<DiscordPayload>, settled: boolean }>()
const scheduledMaps = new Set<string>()

function canMapQuake(event: QuakeEvent): boolean {
    return event.detail.Head?.InfoType !== '取消' && Boolean(
        event.detail.Body?.Earthquake?.Hypocenter?.Area?.Coordinate ||
        event.detail.Body?.Intensity?.Observation?.Pref?.some(pref => pref.Area?.some(area =>
            area.City?.some(city => city.IntensityStation?.some(station => station.latlon)))))
}

function quakeMapJob(key: string, event: QuakeEvent): Promise<DiscordPayload> | undefined {
    if (!canMapQuake(event)) return undefined
    const jobKey = `${key}:${event.revision}`
    let entry = quakeMapJobs.get(jobKey)
    if (!entry) {
        entry = { promise: buildJmaQuakeEmbed(event.detail, true), settled: false }
        quakeMapJobs.set(jobKey, entry)
        const created = entry
        const settle = () => {
            created.settled = true
            // Keep in-flight promises shared even during a large restart catch-up.
            // Only completed image buffers count against the small result cache.
            const completed = [...quakeMapJobs].filter(([, value]) => value.settled)
            for (const [oldKey] of completed.slice(0, Math.max(0, completed.length - 20))) quakeMapJobs.delete(oldKey)
        }
        void entry.promise.then(settle, settle)
    }
    return entry.promise
}

async function readyMapPayload(key: string, event: QuakeEvent): Promise<DiscordPayload | undefined> {
    const pending = Object.values(event.deliveries).some(delivery => delivery.pendingAlerts.length)
    if (pending) return undefined
    const job = quakeMapJob(key, event)
    if (!job) return undefined
    let timer: NodeJS.Timeout | undefined
    try {
        return await Promise.race([
            job,
            new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), QUAKE_MAP_WAIT_MS) }),
        ])
    } finally { if (timer) clearTimeout(timer) }
}

function queueQuakeMap(client: Client, key: string, event: QuakeEvent) {
    if (!Object.values(event.deliveries).some(delivery => delivery.revision === event.revision && delivery.mapRevision !== event.revision)) return
    const jobKey = `${key}:${event.revision}`
    if (scheduledMaps.has(jobKey)) return
    const job = quakeMapJob(key, event)
    if (!job) return
    scheduledMaps.add(jobKey)
    void job.then(async payload => {
        if (!payload.embeds[0].data.image) return
        await serializeEvent(key, async () => {
            const current = loadJournal().events[key]
            if (!current || current.revision !== event.revision) return
            for (const [guildId, channelId] of Object.entries(loadEqChannels())) {
                const delivery = current.deliveries[`${guildId}:${channelId}`]
                if (!delivery || delivery.revision !== event.revision || delivery.mapRevision === event.revision) continue
                try {
                    const channel = await getQuakeChannel(client, guildId, channelId)
                    await channel.messages.edit(delivery.messageId, { ...payload, attachments: [] })
                    delivery.mapRevision = event.revision
                    saveEvent(key, current)
                } catch (error) { console.error('地震マップの追記失敗:', error) }
            }
        })
    }).catch(error => console.error('地震マップ生成失敗:', error))
    // Optional map failures must not cause continuous tile downloads.
    if (scheduledMaps.size > 1000) scheduledMaps.delete(scheduledMaps.values().next().value!)
}

export async function applyJmaQuakeReport(client: Client, item: JmaQuakeListItem, detail: JmaQuakeDetail) {
    if (!isValidJmaJsonPath(item.json)) throw new Error('Invalid JMA detail path')
    const key = jmaEventKey(item, detail)
    const revision = `${item.ctt || detail.Head?.ReportDateTime || ''}:${item.json}`
    return serializeEvent(key, async () => {
        let event = loadJournal().events[key]
        if (!event || revision > event.revision) {
            const oldScale = event?.detail.Body?.Intensity?.Observation?.MaxInt
            const merged = mergeJmaDetail(event?.detail, detail)
            const newScale = merged.Body?.Intensity?.Observation?.MaxInt
            const deliveries = event?.deliveries ?? {}
            for (const delivery of Object.values(deliveries)) {
                delivery.pendingAlerts = detail.Head?.InfoType === '取消' ? [] : delivery.pendingAlerts.filter(alert =>
                    scaleRank(alert.to.replace('弱', '-').replace('強', '+')) <= scaleRank(newScale))
            }
            if (scaleRank(oldScale) > 0 && scaleRank(newScale) > scaleRank(oldScale) && detail.Head?.InfoType !== '取消') {
                for (const delivery of Object.values(deliveries)) delivery.pendingAlerts.push({
                    revision, from: scaleToString(oldScale), to: scaleToString(newScale),
                })
            }
            const thresholds = loadEqThresholds()
            const targets = Object.fromEntries(Object.entries(loadEqChannels()).filter(([guildId, channelId]) =>
                deliveries[`${guildId}:${channelId}`] || (scaleRank(newScale) > 0 && (thresholds[guildId] ?? 0) <= scaleRank(newScale))))
            event = { revision, detail: merged, deliveries, targets, updatedAt: Date.now() }
            saveEvent(key, event)
        }
        markSeen(item.json!)
        const needsDelivery = Object.entries(event.targets).some(([guildId, channelId]) =>
            event.deliveries[`${guildId}:${channelId}`]?.revision !== event.revision)
        const mapPayload = needsDelivery ? await readyMapPayload(key, event) : undefined
        await deliverQuakeEvent(client, key, event, mapPayload)
        queueQuakeMap(client, key, event)
    })
}

async function retryQuakeEvents(client: Client) {
    const failures: unknown[] = []
    await Promise.all(Object.keys(loadJournal().events).map(key => serializeEvent(key, async () => {
        const event = loadJournal().events[key]
        if (!event) return
        try {
            const needsDelivery = Object.entries(event.targets).some(([guildId, channelId]) =>
                loadEqChannels()[guildId] === channelId && event.deliveries[`${guildId}:${channelId}`]?.revision !== event.revision)
            await deliverQuakeEvent(client, key, event, needsDelivery ? await readyMapPayload(key, event) : undefined)
            queueQuakeMap(client, key, event)
        }
        catch (error) { failures.push(error) }
    })))
    if (failures.length) throw new Error(`${failures.length}件の地震配信が未完了`)
}

async function processP2PFallbacks(client: Client) {
    const pending = readJson<Record<string, P2PQuakeMessage>>('eq-fallback-pending.json', {})
    const failures: unknown[] = []
    for (const message of Object.values(pending)) {
        try {
            await sendToConfiguredChannels(client, await buildP2PQuakeEmbed(message), message.earthquake?.maxScale, `p2p:${message.id}`)
            const current = readJson<Record<string, P2PQuakeMessage>>('eq-fallback-pending.json', {})
            delete current[message.id]
            writeJson('eq-fallback-pending.json', current)
            saveLatestIds({ p2pQuake: message.id })
        } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new Error('P2P代替速報に未達があります')
}

let fallbackRetry: Promise<void> | undefined
export function retryP2PFallbacks(client: Client): Promise<void> {
    if (!fallbackRetry) fallbackRetry = processP2PFallbacks(client).finally(() => { fallbackRetry = undefined })
    return fallbackRetry
}

let quakePoll: Promise<void> | undefined
export function pollJmaQuake(client: Client): Promise<void> {
    if (quakePoll) return quakePoll
    quakePoll = (async () => {
        const failures: unknown[] = []
        // Retry persisted deliveries even if the list is unavailable or has rolled over.
        const retries = Promise.all([
            retryQuakeEvents(client).catch(error => console.error('地震更新の再試行失敗:', error)),
            retryP2PFallbacks(client).catch(error => console.error('代替速報の再試行失敗:', error)),
        ])
        try {
            const list = await quakeFeed.get()
            if (!Array.isArray(list)) { quakeDetailsHealthy = false; throw new Error('Invalid JMA quake list') }
            quakeDetailsHealthy = true
            const items = list.filter(item => isValidJmaJsonPath(item.json)).sort((a, b) => String(a.ctt).localeCompare(String(b.ctt)))
            const journal = loadJournal()
            if (!journal.initialized && items.length) {
                const oldPath = loadLatestIds().quake
                const old = items.find(item => item.json === oldPath)
                const newest = items[items.length - 1]
                // On first install, avoid replaying the entire historical list. On an
                // upgrade use the previous cursor, when still present, for catch-up.
                for (const item of items) {
                    if (old ? String(item.ctt) <= String(old.ctt) : item.json !== newest.json) journal.seen[item.json!] = Date.now()
                }
                journal.initialized = true
                writeJson(journalFile, journal)
            }
            const unseen = items.filter(item => !loadJournal().seen[item.json!])
            const groups = new Map<string, JmaQuakeListItem[]>()
            for (const item of unseen) {
                const key = item.eid || item.json!
                groups.set(key, [...(groups.get(key) ?? []), item])
            }
            // Serialize bulletins for one event; separate earthquakes progress independently.
            // At most four simultaneous detail requests, regardless of feed size.
            const work = [...groups.values()]
            await Promise.all(Array.from({ length: Math.min(4, work.length) }, async () => {
                for (let group = work.shift(); group; group = work.shift()) {
                    for (const item of group) {
                        let detail: JmaQuakeDetail
                        try { detail = await fetchJmaDetail(item.json!); jmaEventKey(item, detail) }
                        catch (error) { quakeDetailsHealthy = false; failures.push(error); continue }
                        try { await applyJmaQuakeReport(client, item, detail) }
                        catch (error) { console.error('地震情報処理失敗（保存済み情報は再試行）:', error) }
                    }
                }
            }))
        } catch (error) { failures.push(error) }
        await retries
        if (failures.length) throw failures[0]
    })().finally(() => { quakePoll = undefined })
    return quakePoll
}

async function processJmaTsunami(client: Client) {
    const stateFile = 'tsunami-reports.json'
    const state = readJson<{ initialized: boolean, seen: Record<string, number>, pending: Record<string, JmaTsunamiDetail> }>(stateFile, { initialized: false, seen: {}, pending: {} })
    const failures: unknown[] = []
    const deliverPending = async () => {
        for (const [jsonPath, detail] of Object.entries(state.pending)) {
            try {
                // Tsunami alerts are independent of earthquake thresholds and maps.
                let mapPayload: Promise<DiscordPayload> | undefined
                await sendToConfiguredChannels(client, await buildJmaTsunamiEmbed(detail), undefined, `tsunami:${jsonPath}`, true,
                    (guildId, channelId, messageId) => {
                        mapPayload ??= buildJmaTsunamiEmbed(detail, true)
                        queueTsunamiMap(client, mapPayload, guildId, channelId, messageId)
                    })
                state.seen[jsonPath] = Date.now()
                delete state.pending[jsonPath]
                state.seen = Object.fromEntries(Object.entries(state.seen).sort((a, b) => b[1] - a[1]).slice(0, 2000))
                writeJson(stateFile, state)
            } catch (error) { console.error('津波の未達情報は次回再試行:', error) }
        }
    }
    await deliverPending()
    try {
        const list = (await tsunamiFeed.get()).filter(item => isValidJmaJsonPath(item.json))
            .sort((a, b) => String(a.ctt).localeCompare(String(b.ctt)))
        if (!state.initialized && list.length) {
            const old = list.find(item => item.json === loadLatestIds().tsunami)
            for (const item of list) {
                if (old ? String(item.ctt) <= String(old.ctt) : item.json !== list[list.length - 1].json) state.seen[item.json!] = Date.now()
            }
            state.initialized = true
            writeJson(stateFile, state)
        }
        for (const item of list) {
            if (state.seen[item.json!] || state.pending[item.json!]) continue
            try {
                state.pending[item.json!] = await fetchJmaTsunamiDetail(item.json!)
                writeJson(stateFile, state)
                await deliverPending()
            } catch (error) { failures.push(error) }
        }
    } catch (error) { failures.push(error) }
    if (failures.length) throw failures[0]
}


let tsunamiPoll: Promise<void> | undefined
export function pollJmaTsunami(client: Client): Promise<void> {
    if (!tsunamiPoll) tsunamiPoll = processJmaTsunami(client).finally(() => { tsunamiPoll = undefined })
    return tsunamiPoll
}

function queueTsunamiMap(client: Client, mapPayload: Promise<DiscordPayload>, guildId: string, channelId: string, messageId: string) {
    // Maps are optional follow-up edits; a missing/forbidden message never generates
    // another alert. Text delivery has already been committed before this runs.
    void mapPayload.then(async payload => {
        if (!payload.files?.length || loadEqChannels()[guildId] !== channelId) return
        const channel = await getQuakeChannel(client, guildId, channelId)
        await channel.messages.edit(messageId, { ...payload, attachments: [] })
    }).catch(error => console.error('津波マップ追記失敗:', error))
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
    // 551 IDs are bulletin IDs, not JMA event IDs. Do not guess from rounded times.
    // JMA is the canonical normal-quake stream; keep a labelled fallback during outages.
    if (quakeFeed.healthy() && quakeDetailsHealthy) return
    writeJson('eq-fallback-pending.json', { ...readJson<Record<string, P2PQuakeMessage>>('eq-fallback-pending.json', {}), [message.id]: message })
    await retryP2PFallbacks(client)
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

export function startEqAutoNotify(client: Client) {
    startP2PWebSocket(client)
    scheduleJmaPoll(() => pollJmaTsunami(client))
    scheduleJmaPoll(() => pollJmaQuake(client))
}
