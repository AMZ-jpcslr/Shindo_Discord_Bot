import { AttachmentBuilder } from 'discord.js'
import sharp, { type OverlayOptions } from 'sharp'

export type DisasterMapPoint = {
    label: string
    latitude: number
    longitude: number
    color: string
}

type Coordinate = {
    latitude: number
    longitude: number
}

const TILE_SIZE = 256
const MAP_WIDTH = 600
const MAP_HEIGHT = 400

export const PREFECTURE_POINTS: Record<string, Coordinate> = {
    '北海道': { latitude: 43.0642, longitude: 141.3469 },
    '青森県': { latitude: 40.8244, longitude: 140.74 },
    '岩手県': { latitude: 39.7036, longitude: 141.1527 },
    '宮城県': { latitude: 38.2688, longitude: 140.8721 },
    '秋田県': { latitude: 39.7186, longitude: 140.1024 },
    '山形県': { latitude: 38.2404, longitude: 140.3633 },
    '福島県': { latitude: 37.7503, longitude: 140.4676 },
    '茨城県': { latitude: 36.3418, longitude: 140.4468 },
    '栃木県': { latitude: 36.5657, longitude: 139.8836 },
    '群馬県': { latitude: 36.3911, longitude: 139.0608 },
    '埼玉県': { latitude: 35.8569, longitude: 139.6489 },
    '千葉県': { latitude: 35.6046, longitude: 140.1233 },
    '東京都': { latitude: 35.6895, longitude: 139.6917 },
    '神奈川県': { latitude: 35.4478, longitude: 139.6425 },
    '新潟県': { latitude: 37.9026, longitude: 139.0232 },
    '富山県': { latitude: 36.6953, longitude: 137.2113 },
    '石川県': { latitude: 36.5947, longitude: 136.6256 },
    '福井県': { latitude: 36.0652, longitude: 136.2216 },
    '山梨県': { latitude: 35.6642, longitude: 138.5684 },
    '長野県': { latitude: 36.6513, longitude: 138.181 },
    '岐阜県': { latitude: 35.3912, longitude: 136.7223 },
    '静岡県': { latitude: 34.9769, longitude: 138.3831 },
    '愛知県': { latitude: 35.1802, longitude: 136.9066 },
    '三重県': { latitude: 34.7303, longitude: 136.5086 },
    '滋賀県': { latitude: 35.0045, longitude: 135.8686 },
    '京都府': { latitude: 35.0212, longitude: 135.7556 },
    '大阪府': { latitude: 34.6863, longitude: 135.52 },
    '兵庫県': { latitude: 34.6913, longitude: 135.183 },
    '奈良県': { latitude: 34.6851, longitude: 135.8048 },
    '和歌山県': { latitude: 34.226, longitude: 135.1675 },
    '鳥取県': { latitude: 35.5039, longitude: 134.2383 },
    '島根県': { latitude: 35.4723, longitude: 133.0505 },
    '岡山県': { latitude: 34.6618, longitude: 133.935 },
    '広島県': { latitude: 34.3966, longitude: 132.4596 },
    '山口県': { latitude: 34.1859, longitude: 131.4714 },
    '徳島県': { latitude: 34.0658, longitude: 134.5593 },
    '香川県': { latitude: 34.3401, longitude: 134.0434 },
    '愛媛県': { latitude: 33.8417, longitude: 132.7661 },
    '高知県': { latitude: 33.5597, longitude: 133.5311 },
    '福岡県': { latitude: 33.6064, longitude: 130.4181 },
    '佐賀県': { latitude: 33.2494, longitude: 130.2988 },
    '長崎県': { latitude: 32.7448, longitude: 129.8737 },
    '熊本県': { latitude: 32.7898, longitude: 130.7417 },
    '大分県': { latitude: 33.2382, longitude: 131.6126 },
    '宮崎県': { latitude: 31.9111, longitude: 131.4239 },
    '鹿児島県': { latitude: 31.5602, longitude: 130.5581 },
    '沖縄県': { latitude: 26.2124, longitude: 127.6809 },
    '伊豆諸島': { latitude: 34.05, longitude: 139.45 },
    '小笠原諸島': { latitude: 27.1, longitude: 142.2 },
    '奄美群島': { latitude: 28.3, longitude: 129.4 },
    'トカラ列島': { latitude: 29.6, longitude: 129.7 },
}

function project(coordinate: Coordinate, zoom: number): { x: number, y: number } {
    const sinLat = Math.sin(coordinate.latitude * Math.PI / 180)
    const worldSize = TILE_SIZE * 2 ** zoom

    return {
        x: (coordinate.longitude + 180) / 360 * worldSize,
        y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
    }
}

function centerOf(points: DisasterMapPoint[]): Coordinate {
    if (!points.length) return { latitude: 36.2, longitude: 138.2 }

    return {
        latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
        longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
    }
}

function calculateZoom(points: DisasterMapPoint[]): number {
    if (points.length <= 1) return 7

    const center = centerOf(points)
    const maxDelta = points.reduce((currentMax, point) => {
        const latDelta = Math.abs(point.latitude - center.latitude)
        const lonDelta = Math.abs(point.longitude - center.longitude)
        return Math.max(currentMax, latDelta, lonDelta)
    }, 0)

    if (maxDelta > 12) return 4
    if (maxDelta > 6) return 5
    if (maxDelta > 3) return 6
    if (maxDelta > 1.5) return 7
    return 8
}

async function fetchTile(zoom: number, x: number, y: number): Promise<Buffer | null> {
    const maxTile = 2 ** zoom
    if (x < 0 || y < 0 || x >= maxTile || y >= maxTile) return null

    const response = await fetch(`https://a.basemaps.cartocdn.com/dark_nolabels/${zoom}/${x}/${y}.png`)
    if (!response.ok) return null

    const source = Buffer.from(await response.arrayBuffer())
    return sharp(source)
        .removeAlpha()
        .modulate({ brightness: 0.85, saturation: 0.35 })
        .png()
        .toBuffer()
}

function buildOverlaySvg(points: DisasterMapPoint[], center: Coordinate, zoom: number): Buffer {
    const centerPoint = project(center, zoom)
    const left = centerPoint.x - MAP_WIDTH / 2
    const top = centerPoint.y - MAP_HEIGHT / 2

    const pointSvg = points.map(point => {
        const projected = project(point, zoom)
        const x = projected.x - left
        const y = projected.y - top
        const escapedLabel = point.label.replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;',
        }[char] ?? char))

        return `
            <g transform="translate(${x}, ${y})">
                <circle cx="0" cy="0" r="8" fill="${point.color}" stroke="#101418" stroke-width="2"/>
                <circle cx="0" cy="0" r="3" fill="#ffffff" opacity="0.9"/>
                <text x="12" y="4" fill="#ffffff" stroke="#101418" stroke-width="3" paint-order="stroke" font-size="12" font-family="sans-serif">${escapedLabel}</text>
            </g>
        `
    }).join('')

    return Buffer.from(`
        <svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="rgba(16, 22, 18, 0.14)"/>
            ${pointSvg}
        </svg>
    `)
}

export function pointForAreaName(name: string): Coordinate | null {
    const exact = PREFECTURE_POINTS[name]
    if (exact) return exact

    const special = Object.entries(PREFECTURE_POINTS).find(([key]) => name.includes(key))
    if (special) return special[1]

    return null
}

export async function createDisasterMapAttachment(
    points: DisasterMapPoint[],
    name = 'disaster-map.png',
): Promise<AttachmentBuilder | null> {
    if (!points.length) return null

    const zoom = calculateZoom(points)
    const center = centerOf(points)
    const projectedCenter = project(center, zoom)
    const left = projectedCenter.x - MAP_WIDTH / 2
    const top = projectedCenter.y - MAP_HEIGHT / 2
    const minTileX = Math.floor(left / TILE_SIZE)
    const maxTileX = Math.floor((left + MAP_WIDTH) / TILE_SIZE)
    const minTileY = Math.floor(top / TILE_SIZE)
    const maxTileY = Math.floor((top + MAP_HEIGHT) / TILE_SIZE)
    const composites: OverlayOptions[] = []

    for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
            const tile = await fetchTile(zoom, tileX, tileY)
            if (!tile) continue

            composites.push({
                input: tile,
                left: Math.round(tileX * TILE_SIZE - left),
                top: Math.round(tileY * TILE_SIZE - top),
            })
        }
    }

    composites.push({
        input: buildOverlaySvg(points, center, zoom),
        left: 0,
        top: 0,
    })

    const image = await sharp({
        create: {
            width: MAP_WIDTH,
            height: MAP_HEIGHT,
            channels: 4,
            background: '#101612',
        },
    })
        .composite(composites)
        .png()
        .toBuffer()

    return new AttachmentBuilder(image, { name })
}
