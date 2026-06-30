import { AttachmentBuilder } from 'discord.js'
import sharp, { type OverlayOptions } from 'sharp'

type Coordinate = {
    latitude: number
    longitude: number
}

type IntensityStation = {
    Int?: string
    Name?: string
    latlon?: {
        lat?: number
        lon?: number
    }
}

export type IntensityMapDetail = {
    Head?: {
        EventID?: string
        ReportDateTime?: string
        Title?: string
        Text?: string
    }
    Body?: {
        Earthquake?: {
            Magnitude?: string
            Hypocenter?: {
                Area?: {
                    Coordinate?: string
                }
            }
        }
        Intensity?: {
            Observation?: {
                Pref?: {
                    Area?: {
                        City?: {
                            IntensityStation?: IntensityStation[]
                        }[]
                    }[]
                }[]
            }
        }
    }
}

const TILE_SIZE = 256
const MAP_WIDTH = 600
const MAP_HEIGHT = 400

function parseJmaCoordinate(coordinate?: string): Coordinate | null {
    if (!coordinate) return null

    const match = coordinate.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/)
    if (!match) return null

    return {
        latitude: Number(match[1]),
        longitude: Number(match[2]),
    }
}

function project(coordinate: Coordinate, zoom: number): { x: number, y: number } {
    const sinLat = Math.sin(coordinate.latitude * Math.PI / 180)
    const worldSize = TILE_SIZE * 2 ** zoom

    return {
        x: (coordinate.longitude + 180) / 360 * worldSize,
        y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
    }
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

function intensityColor(intensity?: string): string {
    switch (intensity) {
        case '7': return '#b40068'
        case '6+': return '#a50021'
        case '6-': return '#ff2800'
        case '5+': return '#ff9900'
        case '5-': return '#ffe600'
        case '4': return '#ffff00'
        case '3': return '#0041ff'
        case '2': return '#1e88ff'
        case '1': return '#75c8ff'
        default: return '#808080'
    }
}

function intensityLabel(intensity?: string): string {
    switch (intensity) {
        case '7': return '7'
        case '6+': return '6+'
        case '6-': return '6-'
        case '5+': return '5+'
        case '5-': return '5-'
        case '4': return '4'
        case '3': return '3'
        case '2': return '2'
        case '1': return '1'
        default: return ''
    }
}

function intensityTextColor(intensity?: string): string {
    switch (intensity) {
        case '5-':
        case '4':
        case '1':
            return '#101418'
        default:
            return '#ffffff'
    }
}

function digitSegments(digit: string): string[] {
    switch (digit) {
        case '1': return ['b', 'c']
        case '2': return ['a', 'b', 'g', 'e', 'd']
        case '3': return ['a', 'b', 'g', 'c', 'd']
        case '4': return ['f', 'g', 'b', 'c']
        case '5': return ['a', 'f', 'g', 'c', 'd']
        case '6': return ['a', 'f', 'g', 'e', 'c', 'd']
        case '7': return ['a', 'b', 'c']
        default: return []
    }
}

function segmentLine(segment: string): [number, number, number, number] {
    switch (segment) {
        case 'a': return [-2.2, -4, 2.2, -4]
        case 'b': return [2.8, -3.4, 2.8, -0.4]
        case 'c': return [2.8, 0.8, 2.8, 3.8]
        case 'd': return [-2.2, 4.4, 2.2, 4.4]
        case 'e': return [-2.8, 0.8, -2.8, 3.8]
        case 'f': return [-2.8, -3.4, -2.8, -0.4]
        case 'g': return [-2.2, 0.2, 2.2, 0.2]
        default: return [0, 0, 0, 0]
    }
}

function digitSvg(digit: string, x: number, y: number, color: string): string {
    return digitSegments(digit).map(segment => {
        const [x1, y1, x2, y2] = segmentLine(segment)
        return `<line x1="${x + x1}" y1="${y + y1}" x2="${x + x2}" y2="${y + y2}" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/>`
    }).join('')
}

function signSvg(sign: string, x: number, y: number, color: string): string {
    if (sign === '+') {
        return `
            <line x1="${x - 1.8}" y1="${y}" x2="${x + 1.8}" y2="${y}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="${x}" y1="${y - 1.8}" x2="${x}" y2="${y + 1.8}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
        `
    }

    if (sign === '-') {
        return `<line x1="${x - 1.8}" y1="${y}" x2="${x + 1.8}" y2="${y}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`
    }

    return ''
}

function intensityLabelSvg(label: string, x: number, y: number, color: string): string {
    if (!label) return ''
    if (label.length === 1) return digitSvg(label, x, y, color)

    return `
        ${digitSvg(label[0], x - 2.2, y, color)}
        ${signSvg(label[1], x + 4.3, y - 0.2, color)}
    `
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

function zoomFromSpread(epicenter: Coordinate, points: Coordinate[]): number {
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

function calculateZoom(detail: IntensityMapDetail, epicenter: Coordinate, points: Coordinate[]): number {
    const magnitudeZoom = zoomFromMagnitude(detail.Body?.Earthquake?.Magnitude)
    const spreadZoom = zoomFromSpread(epicenter, points)
    return Math.max(4, Math.min(10, Math.min(magnitudeZoom, spreadZoom)))
}

function collectStations(detail: IntensityMapDetail): (IntensityStation & { coordinate: Coordinate })[] {
    return detail.Body?.Intensity?.Observation?.Pref
        ?.flatMap(pref => pref.Area ?? [])
        .flatMap(area => area.City ?? [])
        .flatMap(city => city.IntensityStation ?? [])
        .filter((station): station is IntensityStation & { latlon: { lat: number, lon: number } } =>
            typeof station.latlon?.lat === 'number' &&
            typeof station.latlon?.lon === 'number'
        )
        .map(station => ({
            ...station,
            coordinate: {
                latitude: station.latlon.lat,
                longitude: station.latlon.lon,
            },
        }))
        .sort((a, b) => intensityRank(b.Int) - intensityRank(a.Int))
        .slice(0, 120) ?? []
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

function buildOverlaySvg(
    detail: IntensityMapDetail,
    epicenter: Coordinate,
    stations: (IntensityStation & { coordinate: Coordinate })[],
    zoom: number,
): Buffer {
    const center = project(epicenter, zoom)
    const left = center.x - MAP_WIDTH / 2
    const top = center.y - MAP_HEIGHT / 2

    const visibleStations = stations.map(station => {
        const point = project(station.coordinate, zoom)
        const x = point.x - left
        const y = point.y - top
        return { station, x, y }
    }).filter(({ x, y }) => x >= -20 && y >= -20 && x <= MAP_WIDTH + 20 && y <= MAP_HEIGHT + 20)

    const stationByCell = new Map<string, { station: IntensityStation, x: number, y: number }>()
    for (const item of visibleStations) {
        const cell = `${Math.round(item.x / 12)}:${Math.round(item.y / 12)}`
        const current = stationByCell.get(cell)
        if (!current || intensityRank(item.station.Int) > intensityRank(current.station.Int)) {
            stationByCell.set(cell, item)
        }
    }

    const stationSvg = [...stationByCell.values()].map(({ station, x, y }) => {
        const radius = intensityRank(station.Int) >= 5 ? 8 : 6
        const label = intensityLabel(station.Int)
        const textColor = intensityTextColor(station.Int)

        return `
            <circle cx="${x}" cy="${y}" r="${radius}" fill="${intensityColor(station.Int)}" stroke="#101418" stroke-width="2"/>
            ${intensityLabelSvg(label, x, y, textColor)}
        `
    }).join('')

    const epicenterPoint = project(epicenter, zoom)
    const epicenterX = epicenterPoint.x - left
    const epicenterY = epicenterPoint.y - top
    const svg = `
        <svg width="${MAP_WIDTH}" height="${MAP_HEIGHT}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="rgba(16, 22, 18, 0.12)"/>
            ${stationSvg}
            <g transform="translate(${epicenterX}, ${epicenterY})">
                <line x1="-8" y1="-8" x2="8" y2="8" stroke="#ff493d" stroke-width="3" stroke-linecap="round"/>
                <line x1="8" y1="-8" x2="-8" y2="8" stroke="#ff493d" stroke-width="3" stroke-linecap="round"/>
                <line x1="-8" y1="-8" x2="8" y2="8" stroke="#ffffff" stroke-width="1" stroke-linecap="round"/>
                <line x1="8" y1="-8" x2="-8" y2="8" stroke="#ffffff" stroke-width="1" stroke-linecap="round"/>
            </g>
        </svg>
    `

    return Buffer.from(svg)
}

export async function createIntensityMapAttachment(
    detail: IntensityMapDetail,
    name = 'intensity-map.png',
): Promise<AttachmentBuilder | null> {
    const epicenter = parseJmaCoordinate(detail.Body?.Earthquake?.Hypocenter?.Area?.Coordinate)
    if (!epicenter) return null

    const stations = collectStations(detail)
    const stationPoints = stations.map(station => station.coordinate)
    const zoom = calculateZoom(detail, epicenter, stationPoints)
    const center = project(epicenter, zoom)
    const left = center.x - MAP_WIDTH / 2
    const top = center.y - MAP_HEIGHT / 2

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
        input: buildOverlaySvg(detail, epicenter, stations, zoom),
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
