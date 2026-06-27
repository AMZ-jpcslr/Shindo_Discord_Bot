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

function staticMapImageUrl(latitude?: number, longitude?: number): string | null {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null

    const marker = `${latitude},${longitude},red-pushpin`
    return `https://staticmap.openstreetmap.de/staticmap.php?center=${latitude},${longitude}&zoom=6&size=600x400&markers=${encodeURIComponent(marker)}`
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

function isValidJmaJsonPath(jsonPath: unknown): jsonPath is string {
    return (
        typeof jsonPath === 'string' &&
        jsonPath.endsWith('.json') &&
        !jsonPath.startsWith('/') &&
        !jsonPath.includes('..')
    )
}

function buildEewEmbed(eew: P2PEewMessage): { embeds: EmbedBuilder[], files?: AttachmentBuilder[] } {
    const hypocenter = eew.earthquake?.hypocenter
    const maxScale = Math.max(...(eew.areas ?? []).map(area => area.scaleTo), 0)
    const scaleImage = localScaleImage(maxScale)
    const mapImageUrl = staticMapImageUrl(hypocenter?.latitude, hypocenter?.longitude)
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

    if (mapImageUrl) {
        embed.setImage(mapImageUrl)
    }

    return scaleImage ? { embeds: [embed], files: [scaleImage] } : { embeds: [embed] }
}

function buildJmaEmbed(detail: JmaQuakeDetail, jsonPath: string): { embeds: EmbedBuilder[], files?: AttachmentBuilder[] } {
    const earthquake = detail.Body?.Earthquake
    const hypocenter = earthquake?.Hypocenter?.Area
    const imagePath = jsonPath.replace(/\.json$/, '.png')
    const maxScale = detail.Body?.Intensity?.Observation?.MaxInt
    const scaleImage = localScaleImage(maxScale)
    const coordinate = parseJmaCoordinate(hypocenter?.Coordinate)

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
        .setImage(`https://www.jma.go.jp/bosai/quake/data/${imagePath}`)
        .setFooter({ text: 'Source: 気象庁' })

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
                await interaction.editReply(buildEewEmbed(eews[0]))
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

        await interaction.editReply(buildJmaEmbed(detail, latestPath))
    } catch (error) {
        console.error(error)
        await interaction.editReply('地震情報の取得中にエラーが発生しました。')
    }
}
