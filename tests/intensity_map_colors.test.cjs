const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { intensityEmbedColor } = require('../build/intensity_colors')
const basemap = require('../build/basemap')

function fixture() {
    const latitude = 35, longitude = 139, zoom = 8
    const size = 256 * 2 ** zoom
    const centerX = (longitude + 180) / 360 * size
    const sin = Math.sin(latitude * Math.PI / 180)
    const centerY = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size
    const labels = ['1','2','3','4','5-','5+','6-','6+','7',undefined]
    const stations = labels.map((Int, i) => {
        const x = -180 + (i % 5) * 90, y = i < 5 ? -80 : 80
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (centerY+y)/size))) * 180 / Math.PI
        const lon = (centerX+x)/size*360-180
        return {Int, latlon:{lat,lon}}
    })
    return {labels,detail:{Body:{Earthquake:{Hypocenter:{Area:{Coordinate:'+35+139-10000/'}}},Intensity:{Observation:{Pref:[{Area:[{City:[{IntensityStation:stations}]}]}]}}}}}
}

test('rendered station fills match thumbnails palette and contain contrasting intensity labels', async () => {
    const original = basemap.fetchBaseMapTiles
    // Offline rendering: omit basemap tiles, so this tests the real overlay only.
    basemap.fetchBaseMapTiles = async () => []
    delete require.cache[require.resolve('../build/intensity_map')]
    try {
        const {createIntensityMapAttachment} = require('../build/intensity_map')
        const {detail, labels} = fixture()
        const map = await createIntensityMapAttachment(detail)
        const {data,info} = await sharp(map.attachment).removeAlpha().raw().toBuffer({resolveWithObject:true})
        const pixel = (x,y) => [...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)]
        for (let i=0;i<labels.length;i++) {
            const x=120+(i%5)*90, y=i<5?120:280
            const color=intensityEmbedColor(labels[i])
            const rgb=[color>>16,(color>>8)&255,color&255]
            assert.deepEqual(i>=4 && i<=8 ? pixel(x,y+6) : pixel(x-5,y),rgb,`fill ${labels[i] ?? 'unknown'}`)
            const isLightText=['5-','5+','7'].includes(labels[i])
            let contrastingPixels=0
            for(let dx=-4;dx<=4;dx++) for(let dy=-5;dy<=5;dy++) {
                const p=pixel(x+dx,y+dy)
                if(isLightText?p.every(v=>v>240):p.every(v=>v<40)) contrastingPixels++
            }
            assert.ok(contrastingPixels>=5,`visible number/sign or ? for ${labels[i] ?? 'unknown'}`)
        }
        assert.ok(pixel(390,270)[0]>240 && pixel(390,270)[1]>200 && pixel(390,270)[2]<100, 'intensity 7 gold border')
        if(process.env.INTENSITY_COLOR_PREVIEW) await sharp(map.attachment).toFile(process.env.INTENSITY_COLOR_PREVIEW)
    } finally {basemap.fetchBaseMapTiles=original}
})
