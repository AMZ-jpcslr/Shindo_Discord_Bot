import { AttachmentBuilder, EmbedBuilder } from 'discord.js'
import sharp from 'sharp'
import { json, fetchWithTimeout } from './http'

export type Region = { code: string; office: string; name: string; latitude: number; longitude: number }
type Area = { name: string; kana?: string; parent: string }
type Areas = { offices: Record<string, Area>; class10s: Record<string, Area>; class15s: Record<string, Area>; class20s: Record<string, Area> }
let regions: Region[] | undefined
let loading: Promise<Region[]> | undefined
export async function getRegions(): Promise<Region[]> {
    if (regions) return regions
    if (loading) return loading
    loading = (async () => {
        const [areas, bounds] = await Promise.all([
            json<Areas>('https://www.jma.go.jp/bosai/common/const/area.json'),
            json<Record<string, { ne: number[]; sw: number[] }>>('https://www.jma.go.jp/bosai/common/const/class20relm.json'),
        ])
        regions = Object.entries(areas.class20s).flatMap(([code, area]) => {
            const office = areas.class10s[areas.class15s[area.parent]?.parent]?.parent
            const box = bounds[code]
            if (!office || !box) return []
            return [{ code, office, name: `${areas.offices[office].name} ${area.name}`, latitude: (box.ne[0] + box.sw[0]) / 2, longitude: (box.ne[1] + box.sw[1]) / 2 }]
        })
        return regions
    })()
    try { return await loading } finally { loading = undefined }
}

export const warningNames: Record<string, string> = {
    '02': '暴風雪警報', '03': 'レベル3大雨警報', '05': '暴風警報', '06': '大雪警報', '07': '波浪警報', '08': 'レベル3高潮警報', '09': 'レベル3土砂災害警報',
    '10': 'レベル2大雨注意報', '12': '大雪注意報', '13': '風雪注意報', '14': '雷注意報', '15': '強風注意報', '16': '波浪注意報', '17': '融雪注意報', '19': 'レベル2高潮注意報',
    '20': '濃霧注意報', '21': '乾燥注意報', '22': 'なだれ注意報', '23': '低温注意報', '24': '霜注意報', '25': '着氷注意報', '26': '着雪注意報', '29': 'レベル2土砂災害注意報',
    '32': '暴風雪特別警報', '33': 'レベル5大雨特別警報', '35': '暴風特別警報', '36': '大雪特別警報', '37': '波浪特別警報', '38': 'レベル5高潮特別警報', '39': 'レベル5土砂災害特別警報',
    '43': 'レベル4大雨危険警報', '48': 'レベル4高潮危険警報', '49': 'レベル4土砂災害危険警報',
}
export type WarningReport = { reportDatetime: string; dataTypeCode: string; warning: { class20Items: { areaCode: string; kinds: { code?: string; status: string }[] }[] } }
export type WarningSnapshot = { codes: string[]; time: string }
export function parseWarnings(data: WarningReport[], region: string, advisories: boolean): WarningSnapshot {
    if (!Array.isArray(data) || !data.length) throw new Error('警報データの形式が不正です')
    const codes = new Set<string>()
    let found = false
    // Multiple reports cover different phenomena, not historical revisions.
    for (const report of data) {
        if (!report.warning || !Array.isArray(report.warning.class20Items) || !Number.isFinite(Date.parse(report.reportDatetime))) throw new Error('警報データの形式が不正です')
        const area = report.warning.class20Items.find(a => a.areaCode === region)
        if (!area) continue
        found = true
        for (const kind of area.kinds) {
            if (!kind.code || kind.status === '解除' || kind.status === '発表警報・注意報はなし') continue
            const name = warningLabel(kind.code)
            // Unknown future codes are surfaced, never silently treated as safe.
            if (advisories || !name || !name.includes('注意報')) codes.add(kind.code)
        }
    }
    if (!found) throw new Error('指定地域が警報データにありません')
    return { codes: [...codes].sort(), time: data.map(r => r.reportDatetime).sort((a, b) => Date.parse(b) - Date.parse(a))[0] }
}
export type FloodReport = { status: string; infoType: string; reportDatetime: string; riverCode: string; riverName: string; class20Codes: string[]; officeCodes: string[]; item: { name: string; code: string } }
export function floodWarningReport(data: FloodReport[], office: string): WarningReport {
    if (!Array.isArray(data)) throw new Error('河川氾濫情報の形式が不正です')
    const areas = new Map<string, { code: string; status: string }[]>()
    let time = '1970-01-01T00:00:00Z'
    for (const report of data) {
        if (report.status !== '通常' || report.infoType === '取消') continue
        if (!Array.isArray(report.officeCodes) || !Array.isArray(report.class20Codes) || !report.item) throw new Error('河川氾濫情報の形式が不正です')
        if (!report.officeCodes.includes(office)) continue
        if (Date.parse(report.reportDatetime) > Date.parse(time)) time = report.reportDatetime
        // Codes 10/11 are cancellations. 20/21/22 are advisories; 30+ warnings.
        if (Number(report.item.code) < 20) continue
        for (const code of report.class20Codes) {
            const kinds = areas.get(code) || []
            kinds.push({ code: `flood|${report.riverCode}|${report.item.code}|${report.riverName}|${report.item.name}`, status: '継続' })
            areas.set(code, kinds)
        }
    }
    return { reportDatetime: time, dataTypeCode: 'flood', warning: { class20Items: [...areas].map(([areaCode,kinds]) => ({ areaCode,kinds })) } }
}
export function warningLabel(code: string): string {
    if (code.startsWith('flood|')) { const parts = code.split('|'); return `${parts[3]}：${parts[4]}` }
    return warningNames[code] || `未対応の警報コード ${code}（気象庁で確認）`
}
let floodCache: { time: number; promise: Promise<FloodReport[]> } | undefined
export async function getWarningReports(office: string): Promise<WarningReport[]> {
    if (!/^\d{6}$/.test(office)) throw new Error('地域コードが不正です')
    if (!floodCache || Date.now() - floodCache.time >= 60_000) {
        floodCache = { time: Date.now(), promise: json<FloodReport[]>('https://www.jma.go.jp/bosai/flood/data/r8/flood_xml.json') }
    }
    const [reports, floods] = await Promise.all([
        json<WarningReport[]>(`https://www.jma.go.jp/bosai/warning/data/r8/${office}.json`), floodCache.promise,
    ])
    if (!Array.isArray(reports) || !reports.length) throw new Error('警報データの形式が不正です')
    return [...reports, floodWarningReport(floods, office)]
}
export function radarUrl(region: Region): string {
    return `https://www.jma.go.jp/bosai/nowc/#zoom:10/lat:${region.latitude}/lon:${region.longitude}/colordepth:normal/elements:hrpns&slmcs`
}
export function warningEmbed(region: Region, snapshot: WarningSnapshot, previous?: string[]): EmbedBuilder {
    const active = snapshot.codes.map(warningLabel)
    const cleared = (previous || []).filter(c => !snapshot.codes.includes(c)).map(warningLabel)
    return new EmbedBuilder().setTitle(`${region.name}｜気象警報・注意報`).setColor(active.length ? 0xe67e22 : 0x2ecc71)
        .setDescription([active.length ? active.join('\n').slice(0, 2600) : '設定対象の警報・注意報はありません。', cleared.length ? `\n解除・切替：${cleared.join('、').slice(0, 1000)}` : '', '\n自治体の避難情報と気象庁の最新情報を確認してください。'].join(''))
        .setURL(`https://www.jma.go.jp/bosai/warning/#area_type=class20s&area_code=${region.code}&lang=ja`)
        .setTimestamp(new Date(snapshot.time)).setFooter({ text: '気象庁｜発表時刻（変更時に通知）' })
}

export type RainForecast = { hourly: { time: number[]; precipitation: (number | null)[] } }
export type RainEvent = { time: number; mm: number }
export function upcomingRain(data: RainForecast, threshold: number, now = Date.now()): RainEvent | undefined {
    const hourly = data?.hourly
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.precipitation) || hourly.time.length !== hourly.precipitation.length) throw new Error('降水予報の形式が不正です')
    const candidates = hourly.time.map((time, i) => ({ time, mm: hourly.precipitation[i] }))
        .filter(v => Number.isFinite(v.time) && v.time * 1000 > now && v.time * 1000 <= now + 3 * 3600_000)
    if (candidates.length < 2 || candidates.some(v => v.mm === null || !Number.isFinite(v.mm))) throw new Error('新しい降水予報を取得できません')
    return candidates.find(v => v.mm! >= threshold) as RainEvent | undefined
}
export function getRain(region: Region): Promise<RainForecast> {
    return json(`https://api.open-meteo.com/v1/forecast?latitude=${region.latitude}&longitude=${region.longitude}&hourly=precipitation&forecast_days=2&timeformat=unixtime&timezone=Asia%2FTokyo`)
}
export function rainEmbed(region: Region, event?: RainEvent): EmbedBuilder {
    return new EmbedBuilder().setTitle(`${region.name}｜降水予報`).setColor(0x3498db).setURL(radarUrl(region))
        .setDescription(event ? `<t:${event.time}:f> までの1時間に **${event.mm} mm** の降水予報があります。\n雨雲レーダーも確認してください。` : '今後3時間の予報に、設定量以上の降水は見つかりませんでした。')
        .setFooter({ text: 'Open-Meteo｜地域中央付近の予報（雨・雪を含む）。実況・降り始めの確定情報ではありません。' })
}

export async function radarImage(region: Region): Promise<{ attachment: AttachmentBuilder; time: Date }> {
    const times = await json<{ basetime: string; validtime: string; elements: string[] }[]>('https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json')
    const latest = times.filter(t => /^\d{14}$/.test(t.basetime) && t.basetime === t.validtime && t.elements.includes('hrpns')).sort((a,b) => b.validtime.localeCompare(a.validtime))[0]
    if (!latest) throw new Error('雨雲レーダー時刻がありません')
    const s = latest.validtime
    const time = new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`)
    if (Math.abs(Date.now() - time.getTime()) > 30 * 60_000) throw new Error('雨雲レーダー画像が古いため表示できません')
    const z = 8, n = 2 ** z
    const x = Math.floor((region.longitude + 180) / 360 * n)
    const lat = region.latitude * Math.PI / 180
    const y = Math.floor((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n)
    const tiles = await Promise.all([-1,0,1].flatMap(dy => [-1,0,1].map(async dx => {
        const urls = [`https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x+dx}/${y+dy}.png`, `https://www.jma.go.jp/bosai/jmatile/data/nowc/${latest.basetime}/none/${latest.validtime}/surf/hrpns/${z}/${x+dx}/${y+dy}.png`]
        const inputs = await Promise.all(urls.map(async url => {
            const r = await fetchWithTimeout(url)
            if (!r.ok) throw new Error(`レーダータイル取得失敗: ${r.status}`)
            return Buffer.from(await r.arrayBuffer())
        }))
        return { input: await sharp(inputs[0]).composite([{ input: inputs[1] }]).png().toBuffer(), left: (dx+1)*256, top: (dy+1)*256 }
    })))
    const px = ((region.longitude+180)/360*n - x + 1)*256
    const py = ((1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*n-y+1)*256
    tiles.push({ input: Buffer.from(`<svg width="768" height="768"><circle cx="${px}" cy="${py}" r="7" fill="none" stroke="black" stroke-width="5"/><circle cx="${px}" cy="${py}" r="7" fill="none" stroke="white" stroke-width="2"/></svg>`), left: 0, top: 0 })
    const image = await sharp({ create: { width: 768, height: 768, channels: 4, background: '#ffffff' } }).composite(tiles).png().toBuffer()
    return { attachment: new AttachmentBuilder(image, { name: 'radar.png' }), time }
}
