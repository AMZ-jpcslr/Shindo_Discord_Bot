import {
    AttachmentBuilder,
    Client,
    EmbedBuilder,
    GuildBasedChannel,
} from 'discord.js'
import fs from 'fs'
import path from 'path'
import WebSocket from 'ws'
import { createDisasterMapAttachment, pointForAreaName, type DisasterMapPoint } from './disaster_map'
import { createIntensityMapAttachment } from './intensity_map'

const DATA_DIR = path.join(__dirname, '../../data')
const CHANNELS_PATH = path.join(DATA_DIR, 'eq_channels.json')
const THRESHOLDS_PATH = path.join(DATA_DIR, 'eq_thresholds.json')
const LATEST_IDS_PATH = path.join(DATA_DIR, 'latest_eq_ids.json')
const P2P_WS_URL = 'wss://api.p2pquake.net/v2/ws'
const JMA_QUAKE_LIST_URL = 'https://www.jma.go.jp/bosai/quake/data/list.json'
const JMA_TSUNAMI_LIST_URL = 'https://www.jma.go.jp/bosai/tsunami/data/list.json'
const JMA_WARNING_MAP_URL = 'https://www.jma.go.jp/bosai/warning/data/warning/map.json'
const JMA_AREA_URL = 'https://www.jma.go.jp/bosai/common/const/area.json'
const FLOOD_WARNING_CODES = new Set(['04', '18'])

type ChannelMap = Record<string, string>
type ThresholdMap = Record<string, number>
type LatestIds = {
    eew?: string
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

type JmaWarningMapItem = {
    reportDatetime?: string
    areaTypes?: {
        areas?: {
            code?: string
            warnings?: {
                code?: string
                status?: string
            }[]
        }[]
    }[]
}

type JmaAreaEntry = {
    name?: string
    children?: string[]
}

type JmaAreaConst = {
    centers?: Record<string, JmaAreaEntry>
    offices?: Record<string, JmaAreaEntry>
    class10s?: Record<string, JmaAreaEntry>
    class15s?: Record<string, JmaAreaEntry>
    class20s?: Record<string, JmaAreaEntry>
}

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadEqChannels(): ChannelMap {
    if (!fs.existsSync(CHANNELS_PATH)) return {}

    try {
        return JSON.parse(fs.readFileSync(CHANNELS_PATH, 'utf8')) as ChannelMap
    } catch (error) {
        console.error('通知チャンネル設定の読み込みに失敗しました:', error)
        return {}
    }
}

export function saveEqChannels(channels: ChannelMap) {
    ensureDataDir()
    fs.writeFileSync(CHANNELS_PATH, JSON.stringify(channels, null, 2), 'utf8')
}

export function loadEqThresholds(): ThresholdMap {
    if (!fs.existsSync(THRESHOLDS_PATH)) return {}

    try {
        return JSON.parse(fs.readFileSync(THRESHOLDS_PATH, 'utf8')) as ThresholdMap
    } catch (error) {
        console.error('通知震度しきい値の読み込みに失敗しました:', error)
        return {}
    }
}

export function saveEqThresholds(thresholds: ThresholdMap) {
    ensureDataDir()
    fs.writeFileSync(THRESHOLDS_PATH, JSON.stringify(thresholds, null, 2), 'utf8')
}

function loadLatestIds(): LatestIds {
    if (!fs.existsSync(LATEST_IDS_PATH)) return {}

    try {
        return JSON.parse(fs.readFileSync(LATEST_IDS_PATH, 'utf8')) as LatestIds
    } catch {
        return {}
    }
}

function saveLatestIds(latestIds: LatestIds) {
    ensureDataDir()
    fs.writeFileSync(LATEST_IDS_PATH, JSON.stringify(latestIds, null, 2), 'utf8')
}

type SendableGuildChannel = GuildBasedChannel & {
    send: (payload: { embeds: EmbedBuilder[], files?: AttachmentBuilder[] }) => Promise<unknown>
}

function isSendableChannel(channel: GuildBasedChannel | null | undefined): channel is SendableGuildChannel {
    return Boolean(channel && 'send' in channel && typeof channel.send === 'function')
}

async function sendToConfiguredChannels(
    client: Client,
    payload: { embeds: EmbedBuilder[], files?: AttachmentBuilder[] },
    maxScale: number | string | undefined,
) {
    const channels = loadEqChannels()
    const thresholds = loadEqThresholds()
    const eventScale = scaleRank(maxScale)

    for (const [guildId, channelId] of Object.entries(channels)) {
        const threshold = thresholds[guildId] ?? 0
        if (threshold > 0 && eventScale < threshold) continue

        const guild = client.guilds.cache.get(guildId)
        if (!guild) continue

        const channel =
            guild.channels.cache.get(channelId) ??
            await guild.channels.fetch(channelId).catch(() => null)

        if (!isSendableChannel(channel)) continue

        await channel.send(payload).catch((error: unknown) => {
            console.error(`通知送信に失敗しました: guild=${guildId}, channel=${channelId}`, error)
        })
    }
}

async function sendDisasterToConfiguredChannels(
    client: Client,
    payload: { embeds: EmbedBuilder[], files?: AttachmentBuilder[] },
) {
    const channels = loadEqChannels()

    for (const [guildId, channelId] of Object.entries(channels)) {
        const guild = client.guilds.cache.get(guildId)
        if (!guild) continue

        const channel =
            guild.channels.cache.get(channelId) ??
            await guild.channels.fetch(channelId).catch(() => null)

        if (!isSendableChannel(channel)) continue

        await channel.send(payload).catch((error: unknown) => {
            console.error(`災害情報の通知送信に失敗しました: guild=${guildId}, channel=${channelId}`, error)
        })
    }
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

async function fetchJmaWarningMap(): Promise<JmaWarningMapItem[]> {
    const response = await fetch(JMA_WARNING_MAP_URL)
    if (!response.ok) throw new Error(`JMA warning map fetch failed: ${response.status}`)
    return response.json() as Promise<JmaWarningMapItem[]>
}

async function fetchJmaAreaConst(): Promise<JmaAreaConst> {
    const response = await fetch(JMA_AREA_URL)
    if (!response.ok) throw new Error(`JMA area const fetch failed: ${response.status}`)
    return response.json() as Promise<JmaAreaConst>
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
    if (!kindName) return '#2d6cdf'
    if (kindName.includes('大津波')) return '#d900ff'
    if (kindName.includes('津波警報')) return '#ff1f1f'
    if (kindName.includes('津波注意報')) return '#ffff00'
    return '#2d6cdf'
}

function collectTsunamiPoints(detail: JmaTsunamiDetail): DisasterMapPoint[] {
    const items = detail.Body?.Tsunami?.Forecast?.Item ?? []

    return items.flatMap((item, index) => {
        const areaName = item.Area?.Name
        if (!areaName) return []

        const coordinate = pointForAreaName(areaName)
        if (!coordinate) return []

        return [{
            label: String(index + 1),
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            color: tsunamiColor(item.Category?.Kind?.Name),
        }]
    })
}

function flattenAreaEntries(areaConst: JmaAreaConst): Record<string, JmaAreaEntry> {
    return {
        ...(areaConst.centers ?? {}),
        ...(areaConst.offices ?? {}),
        ...(areaConst.class10s ?? {}),
        ...(areaConst.class15s ?? {}),
        ...(areaConst.class20s ?? {}),
    }
}

function parentMap(areaConst: JmaAreaConst): Record<string, string> {
    const parents: Record<string, string> = {}
    for (const [code, entry] of Object.entries(flattenAreaEntries(areaConst))) {
        for (const child of entry.children ?? []) {
            parents[child] = code
        }
    }
    return parents
}

function areaNameChain(code: string, areaConst: JmaAreaConst): string[] {
    const entries = flattenAreaEntries(areaConst)
    const parents = parentMap(areaConst)
    const names: string[] = []
    let current: string | undefined = code

    for (let depth = 0; current && depth < 6; depth += 1) {
        const name = entries[current]?.name
        if (name) names.push(name)
        current = parents[current]
    }

    return names
}

function areaPointForCode(code: string, areaConst: JmaAreaConst): { name: string, point: { latitude: number, longitude: number } } | null {
    const names = areaNameChain(code, areaConst)
    for (const name of names) {
        const point = pointForAreaName(name)
        if (point) return { name, point }
    }

    return null
}

function collectFloodAreas(warningMap: JmaWarningMapItem[], areaConst: JmaAreaConst): {
    code: string
    name: string
    statuses: string[]
    point: { latitude: number, longitude: number }
}[] {
    const areas = new Map<string, {
        code: string
        name: string
        statuses: Set<string>
        point: { latitude: number, longitude: number }
    }>()

    for (const report of warningMap) {
        for (const areaType of report.areaTypes ?? []) {
            for (const area of areaType.areas ?? []) {
                if (!area.code) continue

                const floodWarnings = (area.warnings ?? []).filter(warning =>
                    warning.code &&
                    FLOOD_WARNING_CODES.has(warning.code) &&
                    warning.status !== '解除'
                )
                if (!floodWarnings.length) continue

                const resolved = areaPointForCode(area.code, areaConst)
                if (!resolved) continue

                const key = `${resolved.point.latitude.toFixed(2)},${resolved.point.longitude.toFixed(2)}`
                const current = areas.get(key) ?? {
                    code: area.code,
                    name: resolved.name,
                    statuses: new Set<string>(),
                    point: resolved.point,
                }

                for (const warning of floodWarnings) {
                    current.statuses.add(warning.code === '04' ? '洪水警報' : '洪水注意報')
                }
                areas.set(key, current)
            }
        }
    }

    return [...areas.values()].map(area => ({
        code: area.code,
        name: area.name,
        statuses: [...area.statuses].sort(),
        point: area.point,
    }))
}

function floodSignature(areas: { name: string, statuses: string[] }[], warningMap: JmaWarningMapItem[]): string {
    const reportTimes = warningMap
        .map(report => report.reportDatetime ?? '')
        .sort()
    const latestReportTime = reportTimes.length ? reportTimes[reportTimes.length - 1] : ''
    const areaSignature = areas
        .map(area => `${area.name}:${area.statuses.join('/')}`)
        .sort()
        .join('|')

    return `${latestReportTime}:${areaSignature}`
}

function floodColor(statuses: string[]): string {
    return statuses.includes('洪水警報') ? '#ff1f1f' : '#ffff00'
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

async function buildEewEmbed(message: P2PEewMessage): Promise<{ embeds: EmbedBuilder[], files?: AttachmentBuilder[] }> {
    const hypocenter = message.earthquake?.hypocenter
    const maxScale = Math.max(...(message.areas ?? []).map(area => area.scaleTo), 0)
    const strongAreas = [...(message.areas ?? [])]
        .sort((a, b) => b.scaleTo - a.scaleTo)
        .slice(0, 8)
        .map(area => `${area.name}: ${scaleToString(area.scaleFrom)}${area.scaleFrom === area.scaleTo ? '' : `-${scaleToString(area.scaleTo)}`}`)
        .join('\n')

    const coordinateLink = formatCoordinate(hypocenter?.latitude, hypocenter?.longitude)
    const jmaDetail = await findJmaDetailForP2P(
        message.issue?.eventId,
        message.earthquake?.originTime,
        hypocenter?.name,
        hypocenter?.magnitude,
    ).catch(() => null)
    const intensityMap = jmaDetail ? await createIntensityMapAttachment(jmaDetail, 'intensity-map.png') : null
    const scaleImage = localScaleImage(maxScale)
    const title = message.cancelled ? '緊急地震速報 取消' : '緊急地震速報'
    const serial = message.issue?.serial ? `第${message.issue.serial}報` : '速報'

    const embed = new EmbedBuilder()
        .setTitle(`${title} (${serial})`)
        .setColor(message.cancelled ? 0x808080 : 0xff2d2d)
        .setDescription(message.cancelled ? 'この緊急地震速報は取り消されました。' : '強い揺れに警戒してください。身の安全を確保してください。')
        .addFields(
            { name: '震源', value: hypocenter?.name ?? '不明', inline: true },
            { name: '規模', value: formatMagnitude(hypocenter?.magnitude), inline: true },
            { name: '深さ', value: formatDepth(hypocenter?.depth), inline: true },
            { name: '最大予測震度', value: maxScale > 0 ? scaleToString(maxScale) : '不明', inline: true },
            { name: '発生時刻', value: message.earthquake?.originTime ?? '不明', inline: true },
            { name: '発表時刻', value: message.issue?.time ?? message.time ?? '不明', inline: true },
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

    if (intensityMap) {
        embed.setImage('attachment://intensity-map.png')
    }

    const files = [scaleImage, intensityMap].filter((file): file is AttachmentBuilder => Boolean(file))
    return files.length ? { embeds: [embed], files } : { embeds: [embed] }
}

async function buildP2PQuakeEmbed(message: P2PQuakeMessage): Promise<{ embeds: EmbedBuilder[], files?: AttachmentBuilder[] }> {
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
    const intensityMap = jmaDetail ? await createIntensityMapAttachment(jmaDetail, 'intensity-map.png') : null
    const observedPoints = [...(message.points ?? [])]
        .sort((a, b) => (b.scale ?? 0) - (a.scale ?? 0))
        .slice(0, 8)
        .map(point => `${point.pref ?? ''}${point.addr ?? ''}: ${scaleToString(point.scale)}`)
        .join('\n')

    const embed = new EmbedBuilder()
        .setTitle('地震情報')
        .setColor(0x2d6cdf)
        .addFields(
            { name: '震源', value: hypocenter?.name ?? '不明', inline: true },
            { name: '規模', value: formatMagnitude(hypocenter?.magnitude), inline: true },
            { name: '深さ', value: formatDepth(hypocenter?.depth), inline: true },
            { name: '最大震度', value: scaleToString(quake?.maxScale), inline: true },
            { name: '発生時刻', value: quake?.time ?? '不明', inline: true },
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
    return files.length ? { embeds: [embed], files } : { embeds: [embed] }
}

function isValidJmaJsonPath(jsonPath: unknown): jsonPath is string {
    return (
        typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..')
    )
}

async function buildJmaQuakeEmbed(detail: JmaQuakeDetail): Promise<{ embeds: EmbedBuilder[], files?: AttachmentBuilder[] }> {
    const earthquake = detail.Body?.Earthquake
    const hypocenter = earthquake?.Hypocenter?.Area
    const maxScale = detail.Body?.Intensity?.Observation?.MaxInt
    const coordinate = parseJmaCoordinate(hypocenter?.Coordinate)
    const coordinateLink = formatCoordinate(coordinate?.latitude, coordinate?.longitude)
    const intensityMap = await createIntensityMapAttachment(detail, 'intensity-map.png')
    const scaleImage = localScaleImage(maxScale)
    const text = detail.Head?.Text

    const embed = new EmbedBuilder()
        .setTitle(detail.Head?.Title ?? '地震情報')
        .setColor(0x2d6cdf)
        .setDescription(text || '気象庁から新しい地震情報が発表されました。')
        .addFields(
            { name: '震源', value: hypocenter?.Name ?? '不明', inline: true },
            { name: '規模', value: formatMagnitude(earthquake?.Magnitude), inline: true },
            { name: '深さ', value: formatDepth(hypocenter?.Depth), inline: true },
            { name: '最大震度', value: scaleToString(maxScale), inline: true },
            { name: '発生時刻', value: earthquake?.OriginTime ?? earthquake?.ArrivalTime ?? '不明', inline: true },
            { name: '発表時刻', value: detail.Head?.ReportDateTime ?? '不明', inline: true },
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
    return files.length ? { embeds: [embed], files } : { embeds: [embed] }
}

async function buildJmaTsunamiEmbed(detail: JmaTsunamiDetail): Promise<{ embeds: EmbedBuilder[], files?: AttachmentBuilder[] }> {
    const items = detail.Body?.Tsunami?.Forecast?.Item ?? []
    const earthquake = detail.Body?.Earthquake?.[0]
    const points = collectTsunamiPoints(detail)
    const disasterMap = await createDisasterMapAttachment(points, 'tsunami-map.png')
    const affectedAreas = items
        .slice(0, 12)
        .map(item => {
            const area = item.Area?.Name ?? '不明'
            const kind = item.Category?.Kind?.Name ?? '津波情報'
            const height = item.MaxHeight?.TsunamiHeight ? ` / 予想高さ ${item.MaxHeight.TsunamiHeight}m` : ''
            return `${area}: ${kind}${height}`
        })
        .join('\n')

    const embed = new EmbedBuilder()
        .setTitle(detail.Head?.Title ?? '津波情報')
        .setColor(0xff1f1f)
        .setDescription(detail.Head?.Headline?.Text ?? detail.Body?.Text ?? '気象庁から津波に関する情報が発表されました。')
        .addFields(
            { name: '震源', value: earthquake?.Hypocenter?.Area?.Name ?? '不明', inline: true },
            { name: '規模', value: formatMagnitude(earthquake?.Magnitude), inline: true },
            { name: '発表時刻', value: detail.Head?.ReportDateTime ?? '不明', inline: true },
        )
        .setFooter({ text: 'Source: 気象庁' })
        .setTimestamp(new Date())

    if (affectedAreas) {
        embed.addFields({ name: '対象地域', value: affectedAreas.slice(0, 1024), inline: false })
    }

    if (disasterMap) {
        embed.setImage('attachment://tsunami-map.png')
    }

    return disasterMap ? { embeds: [embed], files: [disasterMap] } : { embeds: [embed] }
}

async function buildJmaFloodEmbed(
    areas: ReturnType<typeof collectFloodAreas>,
): Promise<{ embeds: EmbedBuilder[], files?: AttachmentBuilder[] }> {
    const points = areas.map((area, index) => ({
        label: String(index + 1),
        latitude: area.point.latitude,
        longitude: area.point.longitude,
        color: floodColor(area.statuses),
    }))
    const disasterMap = await createDisasterMapAttachment(points, 'flood-map.png')
    const affectedAreas = areas
        .slice(0, 16)
        .map(area => `${area.name}: ${area.statuses.join(' / ')}`)
        .join('\n')

    const embed = new EmbedBuilder()
        .setTitle('洪水警報・注意報')
        .setColor(areas.some(area => area.statuses.includes('洪水警報')) ? 0xff1f1f : 0xffff00)
        .setDescription('気象庁から洪水に関する警報・注意報が発表されています。')
        .addFields(
            { name: '対象地域数', value: `${areas.length}`, inline: true },
            { name: '取得時刻', value: new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }), inline: true },
        )
        .setFooter({ text: 'Source: 気象庁' })
        .setTimestamp(new Date())

    if (affectedAreas) {
        embed.addFields({ name: '対象地域', value: affectedAreas.slice(0, 1024), inline: false })
    }

    if (disasterMap) {
        embed.setImage('attachment://flood-map.png')
    }

    return disasterMap ? { embeds: [embed], files: [disasterMap] } : { embeds: [embed] }
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
    )

    saveLatestIds({ ...latestIds, quake: latestPath })
}

async function pollJmaTsunami(client: Client) {
    const list = await fetchJmaTsunamiList()
    const latestPath = list.find(item => isValidJmaJsonPath(item.json))?.json
    if (!latestPath) return

    const latestIds = loadLatestIds()
    if (latestIds.tsunami === latestPath) return

    const detail = await fetchJmaTsunamiDetail(latestPath)
    await sendDisasterToConfiguredChannels(client, await buildJmaTsunamiEmbed(detail))

    saveLatestIds({ ...latestIds, tsunami: latestPath })
}

async function pollJmaFlood(client: Client) {
    const [warningMap, areaConst] = await Promise.all([
        fetchJmaWarningMap(),
        fetchJmaAreaConst(),
    ])
    const areas = collectFloodAreas(warningMap, areaConst)
    if (!areas.length) return

    const signature = floodSignature(areas, warningMap)
    const latestIds = loadLatestIds()
    if (latestIds.flood === signature) return

    await sendDisasterToConfiguredChannels(client, await buildJmaFloodEmbed(areas))
    saveLatestIds({ ...latestIds, flood: signature })
}

function shouldNotifyP2PMessage(message: unknown): message is P2PEewMessage | P2PQuakeMessage {
    if (!message || typeof message !== 'object') return false
    const code = (message as { code?: unknown }).code
    return code === 556 || code === 551
}

async function handleP2PMessage(client: Client, rawData: WebSocket.RawData) {
    const message = JSON.parse(rawData.toString()) as unknown
    if (!shouldNotifyP2PMessage(message)) return

    const latestIds = loadLatestIds()
    if (message.code === 556) {
        if (latestIds.eew === message.id) return
        await sendToConfiguredChannels(
            client,
            await buildEewEmbed(message),
            Math.max(...(message.areas ?? []).map(area => area.scaleTo), 0),
        )
        saveLatestIds({ ...latestIds, eew: message.id })
        return
    }

    if (latestIds.quake === message.id) return
    await sendToConfiguredChannels(client, await buildP2PQuakeEmbed(message), message.earthquake?.maxScale)
    saveLatestIds({ ...latestIds, quake: message.id })
}

function startP2PWebSocket(client: Client) {
    let reconnectTimer: NodeJS.Timeout | undefined

    const connect = () => {
        const ws = new WebSocket(P2P_WS_URL)

        ws.on('open', () => {
            console.log('P2P地震情報 WebSocket に接続しました')
        })

        ws.on('message', (data) => {
            handleP2PMessage(client, data).catch((error: unknown) => {
                console.error('P2P地震情報の通知処理でエラーが発生しました:', error)
            })
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

function startJmaDisasterAutoNotify(client: Client) {
    pollJmaTsunami(client).catch((error: unknown) => {
        console.error('気象庁津波情報の初回確認でエラーが発生しました:', error)
    })
    pollJmaFlood(client).catch((error: unknown) => {
        console.error('気象庁洪水情報の初回確認でエラーが発生しました:', error)
    })

    setInterval(() => {
        pollJmaTsunami(client).catch((error: unknown) => {
            console.error('気象庁津波情報の自動確認でエラーが発生しました:', error)
        })
        pollJmaFlood(client).catch((error: unknown) => {
            console.error('気象庁洪水情報の自動確認でエラーが発生しました:', error)
        })
    }, 60 * 1000)
}

export function startEqAutoNotify(client: Client) {
    startP2PWebSocket(client)
    startJmaDisasterAutoNotify(client)

    pollJmaQuake(client).catch((error: unknown) => {
        console.error('気象庁地震情報の初回確認でエラーが発生しました:', error)
    })

    setInterval(() => {
        pollJmaQuake(client).catch((error: unknown) => {
            console.error('気象庁地震情報の自動確認でエラーが発生しました:', error)
        })
    }, 60 * 1000)
}
