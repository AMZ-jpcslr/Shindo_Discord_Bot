import { fetchWithTimeout as fetch } from '../http'
import { AttachmentBuilder, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js'
import fs from 'fs'
import path from 'path'
import { createIntensityMapAttachment } from '../intensity_map'

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
    .setDescription('直近の地震情報を確認します')

function isValidJmaJsonPath(jsonPath: unknown): jsonPath is string {
    return (
        typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..')
    )
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
        default: return scale ? String(scale).replace('+', '強').replace('-', '弱') : '不明'
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

function jmaScaleToP2PScale(scale?: string): number | undefined {
    switch (scale) {
        case '1': return 10
        case '2': return 20
        case '3': return 30
        case '4': return 40
        case '5-': return 45
        case '5+': return 50
        case '6-': return 55
        case '6+': return 60
        case '7': return 70
        default: return undefined
    }
}

function reportTimeValue(item: JmaQuakeListItem): number {
    const source = item.ctt ?? item.at ?? ''
    if (/^\d{14}$/.test(source)) {
        return Number(source)
    }
    const dateValue = Date.parse(source)
    return Number.isFinite(dateValue) ? dateValue : 0
}

function pickLatestEventItem(list: JmaQuakeListItem[]): JmaQuakeListItem | undefined {
    return list
        .filter(item => isValidJmaJsonPath(item.json))
        .sort((a, b) => reportTimeValue(b) - reportTimeValue(a))[0]
}

function pickBestDetailItemForEvent(list: JmaQuakeListItem[], eventId?: string): JmaQuakeListItem | undefined {
    const candidates = list.filter(item =>
        isValidJmaJsonPath(item.json) &&
        (!eventId || item.eid === eventId)
    )

    return candidates.sort((a, b) => {
        const aHasIntensityDetail = a.json?.includes('VXSE5k') ? 1 : 0
        const bHasIntensityDetail = b.json?.includes('VXSE5k') ? 1 : 0
        if (aHasIntensityDetail !== bHasIntensityDetail) return bHasIntensityDetail - aHasIntensityDetail
        if (a.maxi && !b.maxi) return -1
        if (!a.maxi && b.maxi) return 1
        return reportTimeValue(b) - reportTimeValue(a)
    })[0]
}

async function fetchJmaDetail(jsonPath: string): Promise<JmaQuakeDetail> {
    const response = await fetch(`https://www.jma.go.jp/bosai/quake/data/${jsonPath}`)
    if (!response.ok) throw new Error(`JMA detail fetch failed: ${response.status}`)
    return response.json() as Promise<JmaQuakeDetail>
}

async function buildJmaEmbed(detail: JmaQuakeDetail): Promise<{ embeds: EmbedBuilder[], files?: AttachmentBuilder[] }> {
    const earthquake = detail.Body?.Earthquake
    const hypocenter = earthquake?.Hypocenter?.Area
    const maxScale = detail.Body?.Intensity?.Observation?.MaxInt
    const scaleImage = localScaleImage(jmaScaleToP2PScale(maxScale))
    const coordinate = parseJmaCoordinate(hypocenter?.Coordinate)
    const intensityMap = await createIntensityMapAttachment(detail, 'intensity-map.png').catch(() => null)

    const embed = new EmbedBuilder()
        .setTitle(detail.Head?.Title ?? '直近の地震情報')
        .setColor(0x2d6cdf)
        .setDescription(detail.Head?.Text || '気象庁から発表された直近の地震情報です。')
        .addFields(
            { name: '震源', value: hypocenter?.Name ?? '不明', inline: true },
            { name: '規模', value: earthquake?.Magnitude ? `M${earthquake.Magnitude}` : '不明', inline: true },
            { name: '深さ', value: formatJmaDepth(hypocenter?.Depth, hypocenter?.Coordinate), inline: true },
            { name: '最大震度', value: scaleToString(maxScale), inline: true },
            { name: '発生時刻', value: formatJstTime(earthquake?.OriginTime ?? earthquake?.ArrivalTime), inline: true },
            { name: '発表時刻', value: formatJstTime(detail.Head?.ReportDateTime), inline: true },
        )
        .setFooter({ text: 'Source: 気象庁' })

    if (intensityMap) {
        embed.setImage('attachment://intensity-map.png')
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

    const files = [scaleImage, intensityMap].filter((file): file is AttachmentBuilder => Boolean(file))
    return files.length ? { embeds: [embed], files } : { embeds: [embed] }
}

export async function execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true })

    try {
        const listResponse = await fetch('https://www.jma.go.jp/bosai/quake/data/list.json')
        if (!listResponse.ok) throw new Error(`JMA list fetch failed: ${listResponse.status}`)

        const list = await listResponse.json() as JmaQuakeListItem[]
        const latestEvent = pickLatestEventItem(list)
        const bestDetail = pickBestDetailItemForEvent(list, latestEvent?.eid)

        if (!bestDetail?.json) {
            await interaction.editReply('直近の地震情報が見つかりませんでした。')
            return
        }

        const detail = await fetchJmaDetail(bestDetail.json)
        await interaction.editReply(await buildJmaEmbed(detail))
    } catch (error) {
        console.error(error)
        await interaction.editReply('地震情報の取得中にエラーが発生しました。')
    }
}
