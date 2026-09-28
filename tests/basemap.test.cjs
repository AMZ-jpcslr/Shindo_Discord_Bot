const { test } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { fetchBaseMapTile, baseMapAttributionSvg, BASEMAP_CREDIT } = require('../build/basemap')
const { createIntensityMapAttachment } = require('../build/intensity_map')
const { createDisasterMapAttachment } = require('../build/disaster_map')

test('earthquake and tsunami backgrounds request only key-free GSI tiles', async () => {
    const tile = await sharp({create:{width:256,height:256,channels:4,background:'#e0e0e0'}}).png().toBuffer()
    const previous=global.fetch
    const urls=[]
    global.fetch=async url => { urls.push(url); return new Response(tile) }
    try {
        const quake=await createIntensityMapAttachment({Body:{Earthquake:{Hypocenter:{Area:{Coordinate:'+35.68+139.75-10000/'}}}}})
        const quakeRequests=urls.length
        const tsunami=await createDisasterMapAttachment([{latitude:35.68,longitude:139.75,color:'#ffff00',label:'sample'}])
        assert.ok(quakeRequests>0 && urls.length>quakeRequests)
        for (const url of urls) assert.match(url,/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/pale\/\d+\/\d+\/\d+\.png$/)
        for (const map of [quake,tsunami]) {
            const meta=await sharp(map.attachment).metadata()
            assert.equal(meta.width,600); assert.equal(meta.height,400)
        }
    } finally { global.fetch=previous }
})
test('background is darkened while preserving visible map contrast', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#ffffff'}})
        .composite([{input:await sharp({create:{width:128,height:256,channels:3,background:'#777777'}}).png().toBuffer(),left:0,top:0}]).png().toBuffer()
    const previous=global.fetch; global.fetch=async()=>new Response(tile)
    try {
        const {data,info}=await sharp(await fetchBaseMapTile(8,227,100)).raw().toBuffer({resolveWithObject:true})
        assert.ok(data[0]>data[200*info.channels])
        assert.ok(data[200*info.channels]>=20 && data[200*info.channels]<40)
    } finally { global.fetch=previous }
})
test('HTTP failures and invalid images reject instead of yielding blank maps', async () => {
    const previous=global.fetch
    try {
        global.fetch=async()=>new Response('',{status:403})
        await assert.rejects(fetchBaseMapTile(8,227,100),/HTTP 403/)
        await assert.rejects(createIntensityMapAttachment({Body:{Earthquake:{Hypocenter:{Area:{Coordinate:'+35.68+139.75-10000/'}}}}}),/HTTP 403/)
        await assert.rejects(createDisasterMapAttachment([{latitude:35.68,longitude:139.75,color:'#ffff00',label:'sample'}]),/HTTP 403/)
        global.fetch=async()=>new Response('<html>Error</html>')
        await assert.rejects(fetchBaseMapTile(8,227,100))
    } finally {global.fetch=previous}
})
test('out-of-range tiles never issue a request', async () => {
    const previous=global.fetch;global.fetch=async()=>assert.fail('invalid tile was requested')
    try {
        for (const args of [[4,-1,0],[4,0,16],[1,0,0],[8,NaN,0],[4.5,1,1]]) assert.equal(await fetchBaseMapTile(...args),null)
    } finally {global.fetch=previous}
})
test('attribution includes source link and shoreline credit', () => {
    assert.match(BASEMAP_CREDIT.value,/https:\/\/maps.gsi.go.jp\/development\/ichiran.html/)
    assert.match(BASEMAP_CREDIT.value,/Vector Map Level 0/)
    assert.match(baseMapAttributionSvg(600,400),/GSI Tiles \(modified\)/)
})
