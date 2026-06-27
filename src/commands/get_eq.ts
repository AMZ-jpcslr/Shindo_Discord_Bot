import { AttachmentBuilder, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js'
import fs from 'fs'
import path from 'path'

type P2PEewArea = {
    name: string
    scaleFrom: number
    scaleTo: number
    arrivalTime: string | null
}

type P2PEewMessage = {
    id: string
    cancelled: boolean
    time: string
    issue?: {
        eventId?: string
        serial?: string
        time?: string
    }
    earthquake?: {
        originTime?: string
        hypocenter?: {
            name?: string
            depth?: number
            magnitude?: number
            latitude?: number
            longitude?: number
        }
    }
    areas?: P2PEewArea[]
}

type JmaQuakeListItem = {
    ctt?: string
    eid?: string
    at?: string
    anm?: string
    mag?: string
    maxi?: string
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
                    Depth?: string
                    Coordinate?: string
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

export const data = new SlashCommandBuilder()
    .setName('get_eq')
    .setDescription('直近の緊急地震速報または地震情報を確認します')

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

function formatDepth(depth: number | string | undefined): string {
    if (depth === undefined || depth === null || depth === '') return '不明'
    if (typeof depth === 'number') return depth === 0 ? 'ごく浅い' : `${depth}km`
    return depth
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

function intensityRank(intensity?: string): number {
    switch (intensity) {
        case '7': return 9
        case '6+': return 8
        case '6-': return 7
        case '5+': return 6
        case '5-': return 5
        case '4': return 4
        case '3': return 3
        case '2': return 2
        case '1': return 1
        default: return 0
    }
}

function intensityMarkerStyle(intensity?: string): string {
    switch (intensity) {
        case '7': return 'pm2vvm'
        case '6+': return 'pm2rdm'
        case '6-': return 'pm2rdm'
        case '5+': return 'pm2orm'
        case '5-': return 'pm2ywm'
        case '4': return 'pm2ywm'
        case '3': return 'pm2blm'
        case '2': return 'pm2lbm'
        case '1': return 'pm2grm'
        default: return 'pm2grm'
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

function zoomFromMagnitude(magnitude?: string): number {
    const value = Number(magnitude)
    if (!Number.isFinite(value)) return 7
    if (value >= 8) return 4
    if (value >= 7) return 5
    if (value >= 6) return 6
    if (value >= 5) return 7
    if (value >= 4) return 8
    return 9
}

function zoomFromSpread(
    epicenter: { latitude: number, longitude: number },
    points: { latitude: number, longitude: number }[],
): number {
    const maxDelta = points.reduce((currentMax, point) => {
        const latDelta = Math.abs(point.latitude - epicenter.latitude)
        const lonDelta = Math.abs(point.longitude - epicenter.longitude)
        return Math.max(currentMax, latDelta, lonDelta)
    }, 0)

    if (maxDelta > 8) return 4
    if (maxDelta > 4) return 5
    if (maxDelta > 2) return 6
    if (maxDelta > 1) return 7
    if (maxDelta > 0.5) return 8
    return 9
}

function calculateMapZoom(
    detail: JmaQuakeDetail,
    epicenter: { latitude: number, longitude: number },
    points: { latitude: number, longitude: number }[],
): number {
    const magnitudeZoom = zoomFromMagnitude(detail.Body?.Earthquake?.Magnitude)
    const spreadZoom = zoomFromSpread(epicenter, points)
    return clamp(Math.min(magnitudeZoom, spreadZoom), 4, 9)
}

function buildJmaIntensityMapUrl(detail: JmaQuakeDetail): string | null {
    const coordinate = parseJmaCoordinate(detail.Body?.Earthquake?.Hypocenter?.Area?.Coordinate)
    if (!coordinate) return null

    const stations = detail.Body?.Intensity?.Observation?.Pref
        ?.flatMap(pref => pref.Area ?? [])
        .flatMap(area => area.City ?? [])
        .flatMap(city => city.IntensityStation ?? [])
        .filter(station =>
            typeof station.latlon?.lat === 'number' &&
            typeof station.latlon?.lon === 'number'
        )
        .sort((a, b) => intensityRank(b.Int) - intensityRank(a.Int))
        .slice(0, 80) ?? []
    const stationPoints = stations.map(station => ({
        latitude: station.latlon?.lat as number,
        longitude: station.latlon?.lon as number,
    }))
    const zoom = calculateMapZoom(detail, coordinate, stationPoints)

    const markers = [
        `${coordinate.longitude},${coordinate.latitude},pm2rdm`,
        ...stations.map(station =>
            `${station.latlon?.lon},${station.latlon?.lat},${intensityMarkerStyle(station.Int)}`
        ),
    ].join('~')

    return `https://static-maps.yandex.ru/1.x/?ll=${coordinate.longitude},${coordinate.latitude}&z=${zoom}&size=600,400&l=map&lang=en_US&pt=${encodeURIComponent(markers)}`
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
    const detailResponse = await fetch(`https://www.jma.go.jp/bosai/quake/data/${jsonPath}`)
    return detailResponse.json() as Promise<JmaQuakeDetail>
}

async function findJmaDetailForEew(eew: P2PEewMessage): Promise<JmaQuakeDetail | null> {
    const listResponse = await fetch('https://www.jma.go.jp/bosai/quake/data/list.json')
    const list = await listResponse.json() as JmaQuakeListItem[]
    const hypocenter = eew.earthquake?.hypocenter
    const normalizedOrigin = normalizeJmaTime(eew.earthquake?.originTime)
    const magnitude = typeof hypocenter?.magnitude === 'number' ? hypocenter.magnitude.toFixed(1) : null

    const candidates = list.filter(item => {
        if (!isValidJmaJsonPath(item.json)) return false
        if (eew.issue?.eventId && item.eid === eew.issue.eventId) return true

        const sameTime = normalizedOrigin && normalizeJmaTime(item.at) === normalizedOrigin
        const sameName = !hypocenter?.name || item.anm === hypocenter.name
        const sameMagnitude = !magnitude || item.mag === magnitude
        return Boolean(sameTime && sameName && sameMagnitude)
    })

    const best = selectBestJmaItem(candidates)
    return best?.json ? fetchJmaDetail(best.json) : null
}

function isValidJmaJsonPath(jsonPath: unknown): jsonPath is string {
    return (
        typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..')
    )
}

async function buildEewEmbed(eew: P2PEewMessage): Promise<{ embeds: EmbedBuilder[], files?: AttachmentBuilder[] }> {
    const hypocenter = eew.earthquake?.hypocenter
    const maxScale = Math.max(...(eew.areas ?? []).map(area => area.scaleTo), 0)
    const scaleImage = localScaleImage(maxScale)
    const jmaDetail = await findJmaDetailForEew(eew).catch(() => null)
    const intensityMapUrl = jmaDetail ? buildJmaIntensityMapUrl(jmaDetail) : null
    const areas = [...(eew.areas ?? [])]
        .sort((a, b) => b.scaleTo - a.scaleTo)
        .slice(0, 8)
        .map(area => `${area.name}: ${scaleToString(area.scaleFrom)}${area.scaleFrom === area.scaleTo ? '' : `-${scaleToString(area.scaleTo)}`}`)
        .join('\n')

    const embed = new EmbedBuilder()
        .setTitle(eew.cancelled ? '直近の緊急地震速報 取消' : '直近の緊急地震速報')
        .setColor(eew.cancelled ? 0x808080 : 0xff2d2d)
        .addFields(
            { name: '震源', value: hypocenter?.name ?? '不明', inline: true },
            { name: '規模', value: hypocenter?.magnitude ? `M${hypocenter.magnitude}` : '不明', inline: true },
            { name: '深さ', value: formatDepth(hypocenter?.depth), inline: true },
            { name: '最大予測震度', value: maxScale > 0 ? scaleToString(maxScale) : '不明', inline: true },
            { name: '発生時刻', value: eew.earthquake?.originTime ?? '不明', inline: true },
            { name: '発表時刻', value: eew.issue?.time ?? eew.time ?? '不明', inline: true },
        )
        .setFooter({ text: 'Source: P2P地震情報 / 気象庁' })

    if (areas) {
        embed.addFields({ name: '主な予測地域', value: areas, inline: false })
    }

    if (typeof hypocenter?.latitude === 'number' && typeof hypocenter.longitude === 'number') {
        embed.addFields({
            name: '地図',
            value: `[震源付近を開く](https://www.google.com/maps?q=${hypocenter.latitude},${hypocenter.longitude})`,
            inline: false,
        })
    }

    if (scaleImage) {
        embed.setThumbnail(`attachment://${scaleImage.name}`)
    }

    if (intensityMapUrl) {
        embed.setImage(intensityMapUrl)
    }

    return scaleImage ? { embeds: [embed], files: [scaleImage] } : { embeds: [embed] }
}

function buildJmaEmbed(detail: JmaQuakeDetail): { embeds: EmbedBuilder[], files?: AttachmentBuilder[] } {
    const earthquake = detail.Body?.Earthquake
    const hypocenter = earthquake?.Hypocenter?.Area
    const maxScale = detail.Body?.Intensity?.Observation?.MaxInt
    const scaleImage = localScaleImage(maxScale)
    const coordinate = parseJmaCoordinate(hypocenter?.Coordinate)
    const intensityMapUrl = buildJmaIntensityMapUrl(detail)

    const embed = new EmbedBuilder()
        .setTitle(detail.Head?.Title ?? '直近の地震情報')
        .setColor(0x2d6cdf)
        .setDescription(detail.Head?.Text || '気象庁から発表された直近の地震情報です。')
        .addFields(
            { name: '震源', value: hypocenter?.Name ?? '不明', inline: true },
            { name: '規模', value: earthquake?.Magnitude ? `M${earthquake.Magnitude}` : '不明', inline: true },
            { name: '深さ', value: formatDepth(hypocenter?.Depth), inline: true },
            { name: '最大震度', value: scaleToString(maxScale), inline: true },
            { name: '発生時刻', value: earthquake?.OriginTime ?? earthquake?.ArrivalTime ?? '不明', inline: true },
            { name: '発表時刻', value: detail.Head?.ReportDateTime ?? '不明', inline: true },
        )
        .setFooter({ text: 'Source: 気象庁' })

    if (intensityMapUrl) {
        embed.setImage(intensityMapUrl)
    }

    if (coordinate) {
        embed.addFields({
            name: '地図',
            value: `[震源付近を開く](https://www.google.com/maps?q=${coordinate.latitude},${coordinate.longitude})`,
            inline: false,
        })
    }

    if (scaleImage) {
        embed.setThumbnail(`attachment://${scaleImage.name}`)
    }

    return scaleImage ? { embeds: [embed], files: [scaleImage] } : { embeds: [embed] }
}

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true })

    try {
        const eewResponse = await fetch('https://api.p2pquake.net/v2/history?codes=556&limit=1')
        if (eewResponse.ok) {
            const eews = await eewResponse.json() as P2PEewMessage[]
            if (eews[0]) {
                await interaction.editReply(await buildEewEmbed(eews[0]))
                return
            }
        }

        const listResponse = await fetch('https://www.jma.go.jp/bosai/quake/data/list.json')
        const list = await listResponse.json() as JmaQuakeListItem[]
        const latestPath = list.find(item => isValidJmaJsonPath(item.json))?.json

        if (!latestPath) {
            await interaction.editReply('直近の地震情報が見つかりませんでした。')
            return
        }

        const detailResponse = await fetch(`https://www.jma.go.jp/bosai/quake/data/${latestPath}`)
        const detail = await detailResponse.json() as JmaQuakeDetail

        await interaction.editReply(buildJmaEmbed(detail))
    } catch (error) {
        console.error(error)
        await interaction.editReply('地震情報の取得中にエラーが発生しました。')
    }
}
