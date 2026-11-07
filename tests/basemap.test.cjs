const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
let fetchBaseMapTile, fetchBaseMapTiles, baseMapAttributionSvg, BASEMAP_CREDIT
let createIntensityMapAttachment, createDisasterMapAttachment
beforeEach(() => {
    for (const name of ['basemap', 'intensity_map', 'disaster_map']) delete require.cache[require.resolve('../build/' + name)]
    ;({ fetchBaseMapTile, fetchBaseMapTiles, baseMapAttributionSvg, BASEMAP_CREDIT } = require('../build/basemap'))
    ;({ createIntensityMapAttachment } = require('../build/intensity_map'))
    ;({ createDisasterMapAttachment } = require('../build/disaster_map'))
})

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

test('tile requests are limited to four across simultaneous maps', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#cccccc'}}).png().toBuffer()
    const previous=global.fetch
    let active=0,maxActive=0,requests=0
    global.fetch=async()=>{
        active++;maxActive=Math.max(maxActive,active);requests++
        await new Promise(resolve=>setTimeout(resolve,10))
        active--
        return new Response(tile)
    }
    try {
        const [a,b]=await Promise.all([
            fetchBaseMapTiles(Array.from({length:9},(_,i)=>[8,100+i,100])),
            fetchBaseMapTiles(Array.from({length:9},(_,i)=>[8,100+i,101])),
        ])
        assert.equal(a.length,9);assert.equal(b.length,9)
        assert.equal(requests,18);assert.equal(maxActive,4)
    } finally { global.fetch=previous }
})

test('simultaneous requests share a tile and successful tiles are reused', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#cccccc'}}).png().toBuffer()
    const previous=global.fetch;let requests=0
    global.fetch=async()=>{requests++;await new Promise(resolve=>setTimeout(resolve,5));return new Response(tile)}
    try {
        const result=await Promise.all(Array.from({length:20},()=>fetchBaseMapTile(8,227,100)))
        assert.equal(requests,1)
        for(const image of result) assert.deepEqual(image,result[0])
        assert.deepEqual(await fetchBaseMapTile(8,227,100),result[0]);assert.equal(requests,1)
    } finally {global.fetch=previous}
})

test('background cache expires after 15 minutes without extending on a hit', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#cccccc'}}).png().toBuffer()
    const previous=global.fetch,now=Date.now;let requests=0,time=now()
    global.fetch=async()=>{requests++;return new Response(tile)};Date.now=()=>time
    try {
        await fetchBaseMapTile(8,227,100)
        time+=14*60_000;await fetchBaseMapTile(8,227,100);assert.equal(requests,1)
        time+=60_001;await fetchBaseMapTile(8,227,100);assert.equal(requests,2)
    } finally {global.fetch=previous;Date.now=now}
})

test('cache respects no-store, no-cache, and shorter origin lifetimes', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#cccccc'}}).png().toBuffer()
    const previous=global.fetch,now=Date.now;let requests=0,time=now(),control='no-store'
    global.fetch=async()=>{requests++;return new Response(tile,{headers:{'cache-control':control,age:'2'}})};Date.now=()=>time
    try {
        for (const header of ['no-store','no-cache','max-age=0']) {
            control=header
            const before=requests
            await fetchBaseMapTile(8,227,100);await fetchBaseMapTile(8,227,100)
            assert.equal(requests-before,2)
        }
        control='public, max-age=5'
        await fetchBaseMapTile(8,227,100);const before=requests
        time+=2999;await fetchBaseMapTile(8,227,100);assert.equal(requests,before)
        time+=2;await fetchBaseMapTile(8,227,100);assert.equal(requests,before+1)
    } finally {global.fetch=previous;Date.now=now}
})

test('cache evicts least recently used entries at its 128 tile limit', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#cccccc'}}).png().toBuffer()
    const previous=global.fetch;let requests=0
    global.fetch=async()=>{requests++;return new Response(tile)}
    try {
        // Populate sequentially so LRU insertion order is deterministic.
        for(let i=0;i<128;i++) await fetchBaseMapTile(8,i,100)
        await fetchBaseMapTile(8,0,100) // most recently used
        await fetchBaseMapTile(8,128,100)
        assert.equal(requests,129)
        await fetchBaseMapTile(8,0,100);assert.equal(requests,129)
        await fetchBaseMapTile(8,1,100);assert.equal(requests,130)
    } finally {global.fetch=previous}
})

test('failed downloads and invalid images are not cached; retry is possible', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#cccccc'}}).png().toBuffer()
    const previous=global.fetch;let requests=0
    global.fetch=async()=>{
        requests++
        if(requests===1)return new Response('',{status:503})
        if(requests===2)return new Response('invalid image')
        return new Response(tile)
    }
    try {
        await assert.rejects(fetchBaseMapTile(8,227,100),/HTTP 503/)
        await assert.rejects(fetchBaseMapTile(8,227,100))
        assert.ok(await fetchBaseMapTile(8,227,100));assert.equal(requests,3)
    } finally {global.fetch=previous}
})

test('a failed batch stops queued tiles and waits for active work to finish', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#cccccc'}}).png().toBuffer()
    const previous=global.fetch;let active=0,requests=0
    global.fetch=async()=>{
        const current=++requests;active++
        await new Promise(resolve=>setTimeout(resolve,current===1?1:20));active--
        return current===1?new Response('',{status:503}):new Response(tile)
    }
    try {
        await assert.rejects(fetchBaseMapTiles(Array.from({length:12},(_,i)=>[8,i,100])),/HTTP 503/)
        assert.equal(active,0);assert.equal(requests,4)
    } finally {global.fetch=previous}
})

test('cached background does not cache earthquake observations', async () => {
    const tile=await sharp({create:{width:256,height:256,channels:3,background:'#cccccc'}}).png().toBuffer()
    const previous=global.fetch;let requests=0
    global.fetch=async()=>{requests++;return new Response(tile)}
    const detail={Body:{Earthquake:{Hypocenter:{Area:{Coordinate:'+35.68+139.75-10000/'}}},Intensity:{Observation:{Pref:[{Area:[{City:[{IntensityStation:[{Int:'1',latlon:{lat:35.681,lon:139.751}}]}]}]}]}}}}
    try {
        const first=await createIntensityMapAttachment(detail);const before=requests
        detail.Body.Intensity.Observation.Pref[0].Area[0].City[0].IntensityStation[0].Int='7'
        const second=await createIntensityMapAttachment(detail)
        assert.equal(requests,before)
        assert.notDeepEqual(first.attachment,second.attachment)
    } finally {global.fetch=previous}
})

test('map attribution is outlined and renders without SVG text or fonts', async () => {
    const credit=baseMapAttributionSvg(600,400)
    assert.doesNotMatch(credit,/<text\b|font-family/)
    assert.match(credit,/GSI Tiles \(modified\) \/ Shoreline: VMAP0/)
    assert.match(credit,/<path d="M/)
    const image=await sharp(Buffer.from(`<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">${credit}</svg>`)).png().toBuffer()
    const {data,info}=await sharp(image).extract({left:250,top:380,width:345,height:15}).raw().toBuffer({resolveWithObject:true})
    let lightPixels=0
    for(let i=0;i<data.length;i+=info.channels)if(data[i]>180)lightPixels++
    assert.ok(lightPixels>400)
})
