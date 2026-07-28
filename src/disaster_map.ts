import { AttachmentBuilder } from 'discord.js'
import sharp, { type OverlayOptions } from 'sharp'

export type DisasterMapPoint = {
    label: string
    latitude: number
    longitude: number
    color: string
}

export type DisasterMapLine = {
    coordinates: Coordinate[]
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

const TSUNAMI_COAST_LINES: Record<string, Coordinate[]> = {
    '北海道太平洋沿岸東部': [{ latitude: 43.4, longitude: 145.6 }, { latitude: 42.9, longitude: 145.0 }, { latitude: 42.4, longitude: 144.3 }],
    '北海道太平洋沿岸中部': [{ latitude: 42.4, longitude: 144.3 }, { latitude: 42.2, longitude: 143.2 }, { latitude: 42.0, longitude: 142.3 }],
    '北海道太平洋沿岸西部': [{ latitude: 42.0, longitude: 142.3 }, { latitude: 42.3, longitude: 141.0 }, { latitude: 41.8, longitude: 140.7 }],
    '北海道日本海沿岸北部': [{ latitude: 45.4, longitude: 141.7 }, { latitude: 44.6, longitude: 141.8 }, { latitude: 43.9, longitude: 141.6 }],
    '北海道日本海沿岸南部': [{ latitude: 43.9, longitude: 141.6 }, { latitude: 43.1, longitude: 140.8 }, { latitude: 42.1, longitude: 140.2 }],
    'オホーツク海沿岸': [{ latitude: 45.4, longitude: 141.7 }, { latitude: 44.4, longitude: 143.3 }, { latitude: 43.9, longitude: 144.8 }],
    '青森県日本海沿岸': [{ latitude: 41.2, longitude: 140.1 }, { latitude: 40.8, longitude: 140.0 }, { latitude: 40.5, longitude: 140.0 }],
    '青森県太平洋沿岸': [{ latitude: 41.5, longitude: 141.4 }, { latitude: 40.9, longitude: 141.4 }, { latitude: 40.5, longitude: 141.7 }],
    '陸奥湾': [{ latitude: 41.0, longitude: 140.7 }, { latitude: 41.0, longitude: 141.1 }],
    '岩手県': [{ latitude: 40.3, longitude: 141.8 }, { latitude: 39.6, longitude: 142.0 }, { latitude: 39.0, longitude: 141.9 }],
    '宮城県': [{ latitude: 38.9, longitude: 141.7 }, { latitude: 38.4, longitude: 141.5 }, { latitude: 37.9, longitude: 141.0 }],
    '福島県': [{ latitude: 37.9, longitude: 141.0 }, { latitude: 37.4, longitude: 141.0 }, { latitude: 36.9, longitude: 140.9 }],
    '茨城県': [{ latitude: 36.9, longitude: 140.9 }, { latitude: 36.3, longitude: 140.7 }, { latitude: 35.8, longitude: 140.8 }],
    '千葉県九十九里・外房': [{ latitude: 35.8, longitude: 140.8 }, { latitude: 35.3, longitude: 140.4 }, { latitude: 34.9, longitude: 140.0 }],
    '千葉県内房': [{ latitude: 35.3, longitude: 139.8 }, { latitude: 35.0, longitude: 139.8 }, { latitude: 34.9, longitude: 139.9 }],
    '東京湾内湾': [{ latitude: 35.6, longitude: 139.8 }, { latitude: 35.4, longitude: 139.9 }, { latitude: 35.2, longitude: 139.8 }],
    '伊豆諸島': [{ latitude: 34.7, longitude: 139.4 }, { latitude: 34.0, longitude: 139.5 }, { latitude: 33.1, longitude: 139.8 }],
    '小笠原諸島': [{ latitude: 27.7, longitude: 142.1 }, { latitude: 27.1, longitude: 142.2 }, { latitude: 26.6, longitude: 142.2 }],
    '相模湾・三浦半島': [{ latitude: 35.3, longitude: 139.3 }, { latitude: 35.2, longitude: 139.6 }, { latitude: 35.1, longitude: 139.7 }],
    '静岡県': [{ latitude: 35.0, longitude: 138.9 }, { latitude: 34.7, longitude: 138.2 }, { latitude: 34.6, longitude: 137.6 }],
    '愛知県外海': [{ latitude: 34.6, longitude: 137.3 }, { latitude: 34.6, longitude: 137.0 }, { latitude: 34.7, longitude: 136.9 }],
    '伊勢・三河湾': [{ latitude: 34.8, longitude: 136.8 }, { latitude: 34.6, longitude: 136.7 }, { latitude: 34.5, longitude: 136.9 }],
    '三重県南部': [{ latitude: 34.4, longitude: 136.9 }, { latitude: 34.0, longitude: 136.3 }, { latitude: 33.8, longitude: 136.0 }],
    '和歌山県': [{ latitude: 33.8, longitude: 136.0 }, { latitude: 33.7, longitude: 135.4 }, { latitude: 34.1, longitude: 135.0 }],
    '大阪府': [{ latitude: 34.7, longitude: 135.2 }, { latitude: 34.5, longitude: 135.2 }],
    '兵庫県瀬戸内海沿岸': [{ latitude: 34.7, longitude: 135.0 }, { latitude: 34.6, longitude: 134.6 }, { latitude: 34.5, longitude: 134.2 }],
    '淡路島南部': [{ latitude: 34.4, longitude: 134.8 }, { latitude: 34.2, longitude: 134.7 }],
    '岡山県': [{ latitude: 34.5, longitude: 134.2 }, { latitude: 34.4, longitude: 133.7 }, { latitude: 34.4, longitude: 133.3 }],
    '香川県': [{ latitude: 34.4, longitude: 134.4 }, { latitude: 34.3, longitude: 134.0 }, { latitude: 34.2, longitude: 133.6 }],
    '徳島県': [{ latitude: 34.2, longitude: 134.6 }, { latitude: 33.9, longitude: 134.6 }, { latitude: 33.7, longitude: 134.3 }],
    '愛媛県瀬戸内海沿岸': [{ latitude: 34.1, longitude: 133.0 }, { latitude: 33.9, longitude: 132.5 }, { latitude: 33.9, longitude: 132.0 }],
    '愛媛県宇和海沿岸': [{ latitude: 33.5, longitude: 132.5 }, { latitude: 33.2, longitude: 132.4 }, { latitude: 32.9, longitude: 132.5 }],
    '高知県': [{ latitude: 33.5, longitude: 133.5 }, { latitude: 33.2, longitude: 133.0 }, { latitude: 32.8, longitude: 132.8 }],
    '福岡県日本海沿岸': [{ latitude: 33.9, longitude: 130.9 }, { latitude: 33.7, longitude: 130.4 }, { latitude: 33.9, longitude: 130.0 }],
    '有明・八代海': [{ latitude: 33.0, longitude: 130.25 }, { latitude: 32.6, longitude: 130.32 }, { latitude: 32.2, longitude: 130.25 }],
    '佐賀県北部': [{ latitude: 33.6, longitude: 130.4 }, { latitude: 33.5, longitude: 129.9 }],
    '長崎県西方': [{ latitude: 33.3, longitude: 129.6 }, { latitude: 32.8, longitude: 129.5 }, { latitude: 32.6, longitude: 129.7 }],
    '熊本県天草灘沿岸': [{ latitude: 32.5, longitude: 130.1 }, { latitude: 32.2, longitude: 130.0 }, { latitude: 31.9, longitude: 130.1 }],
    '大分県瀬戸内海沿岸': [{ latitude: 33.7, longitude: 131.7 }, { latitude: 33.4, longitude: 131.7 }, { latitude: 33.3, longitude: 131.9 }],
    '大分県豊後水道沿岸': [{ latitude: 33.1, longitude: 131.9 }, { latitude: 32.8, longitude: 131.9 }],
    '宮崎県': [{ latitude: 32.7, longitude: 131.9 }, { latitude: 32.0, longitude: 131.5 }, { latitude: 31.5, longitude: 131.4 }],
    '鹿児島県東部': [{ latitude: 31.5, longitude: 131.1 }, { latitude: 31.2, longitude: 130.8 }, { latitude: 30.9, longitude: 130.8 }],
    '鹿児島県西部': [{ latitude: 31.7, longitude: 130.3 }, { latitude: 31.4, longitude: 130.2 }, { latitude: 31.0, longitude: 130.2 }],
    '種子島・屋久島地方': [{ latitude: 30.8, longitude: 131.0 }, { latitude: 30.4, longitude: 130.6 }, { latitude: 30.2, longitude: 130.5 }],
    '奄美群島・トカラ列島': [{ latitude: 29.8, longitude: 129.8 }, { latitude: 28.5, longitude: 129.4 }, { latitude: 27.7, longitude: 128.9 }],
    '沖縄本島地方': [{ latitude: 26.9, longitude: 128.2 }, { latitude: 26.2, longitude: 127.7 }, { latitude: 25.8, longitude: 127.2 }],
    '大東島地方': [{ latitude: 25.9, longitude: 131.2 }, { latitude: 25.8, longitude: 131.3 }],
    '宮古島・八重山地方': [{ latitude: 24.9, longitude: 125.3 }, { latitude: 24.4, longitude: 124.2 }, { latitude: 24.3, longitude: 123.8 }],
    '新潟県': [{ latitude: 38.4, longitude: 139.5 }, { latitude: 37.8, longitude: 138.9 }, { latitude: 37.0, longitude: 138.2 }],
    '富山県': [{ latitude: 36.9, longitude: 137.4 }, { latitude: 36.8, longitude: 137.0 }],
    '石川県': [{ latitude: 37.5, longitude: 137.3 }, { latitude: 36.9, longitude: 136.8 }, { latitude: 36.4, longitude: 136.4 }],
    '福井県': [{ latitude: 36.3, longitude: 136.1 }, { latitude: 35.9, longitude: 135.9 }, { latitude: 35.6, longitude: 135.8 }],
    '京都府': [{ latitude: 35.8, longitude: 135.1 }, { latitude: 35.6, longitude: 135.2 }],
    '兵庫県日本海沿岸': [{ latitude: 35.7, longitude: 134.8 }, { latitude: 35.6, longitude: 134.4 }],
    '鳥取県': [{ latitude: 35.6, longitude: 134.4 }, { latitude: 35.5, longitude: 133.8 }, { latitude: 35.4, longitude: 133.3 }],
    '島根県': [{ latitude: 35.5, longitude: 133.2 }, { latitude: 35.3, longitude: 132.4 }, { latitude: 35.1, longitude: 131.8 }],
    '山口県日本海沿岸': [{ latitude: 34.7, longitude: 131.6 }, { latitude: 34.4, longitude: 131.1 }, { latitude: 34.3, longitude: 130.9 }],
    '山口県瀬戸内海沿岸': [{ latitude: 34.1, longitude: 132.0 }, { latitude: 34.0, longitude: 131.4 }, { latitude: 33.9, longitude: 131.0 }],
    '福岡県瀬戸内海沿岸': [{ latitude: 33.9, longitude: 131.0 }, { latitude: 33.9, longitude: 130.8 }],
    '山形県': [{ latitude: 39.1, longitude: 139.7 }, { latitude: 38.6, longitude: 139.5 }],
    '秋田県': [{ latitude: 40.4, longitude: 140.0 }, { latitude: 39.7, longitude: 139.8 }, { latitude: 39.0, longitude: 139.8 }],
}

function project(coordinate: Coordinate, zoom: number): { x: number, y: number } {
    const sinLat = Math.sin(coordinate.latitude * Math.PI / 180)
    const worldSize = TILE_SIZE * 2 ** zoom

    return {
        x: (coordinate.longitude + 180) / 360 * worldSize,
        y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
    }
}

function collectCoordinates(points: DisasterMapPoint[], lines: DisasterMapLine[]): Coordinate[] {
    return [
        ...points,
        ...lines.flatMap(line => line.coordinates),
    ]
}

function centerOf(points: DisasterMapPoint[], lines: DisasterMapLine[] = []): Coordinate {
    const coordinates = collectCoordinates(points, lines)
    if (!coordinates.length) return { latitude: 36.2, longitude: 138.2 }

    return {
        latitude: coordinates.reduce((sum, point) => sum + point.latitude, 0) / coordinates.length,
        longitude: coordinates.reduce((sum, point) => sum + point.longitude, 0) / coordinates.length,
    }
}

function calculateZoom(points: DisasterMapPoint[], lines: DisasterMapLine[] = []): number {
    const coordinates = collectCoordinates(points, lines)
    if (coordinates.length <= 1) return 7

    const center = centerOf(points, lines)
    const maxDelta = coordinates.reduce((currentMax, point) => {
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

function buildOverlaySvg(points: DisasterMapPoint[], lines: DisasterMapLine[], center: Coordinate, zoom: number): Buffer {
    const centerPoint = project(center, zoom)
    const left = centerPoint.x - MAP_WIDTH / 2
    const top = centerPoint.y - MAP_HEIGHT / 2

    const lineSvg = lines.map(line => {
        const path = line.coordinates.map((coordinate, index) => {
            const projected = project(coordinate, zoom)
            const x = projected.x - left
            const y = projected.y - top
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
        }).join(' ')

        return `
            <path d="${path}" fill="none" stroke="#101418" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
            <path d="${path}" fill="none" stroke="${line.color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        `
    }).join('')

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
            ${lineSvg}
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

export function lineForTsunamiAreaName(name: string, color: string): DisasterMapLine | null {
    const matched = Object.entries(TSUNAMI_COAST_LINES)
        .find(([key]) => name.includes(key) || key.includes(name))

    if (matched) {
        return {
            coordinates: matched[1],
            color,
        }
    }

    const point = pointForAreaName(name)
    if (!point) return null

    return {
        coordinates: [
            { latitude: point.latitude - 0.2, longitude: point.longitude - 0.25 },
            { latitude: point.latitude + 0.2, longitude: point.longitude + 0.25 },
        ],
        color,
    }
}

export async function createDisasterMapAttachment(
    points: DisasterMapPoint[],
    name = 'disaster-map.png',
    lines: DisasterMapLine[] = [],
): Promise<AttachmentBuilder | null> {
    if (!points.length && !lines.length) return null

    const zoom = calculateZoom(points, lines)
    const center = centerOf(points, lines)
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
        input: buildOverlaySvg(points, lines, center, zoom),
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
