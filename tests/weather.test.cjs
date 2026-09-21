const { test, beforeEach, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shindo-tests-'))
process.env.DATA_DIR = tmp
const { parseWarnings, upcomingRain, floodWarningReport, warningEmbed, rainEmbed, radarImage } = require('../build/weather')
const { saveWeather, pollWeather, weatherState, loadWeather } = require('../build/weather_notify')
const { readJson, writeJson } = require('../build/storage')
const { scaleRank, saveEqChannels, loadEqChannels } = require('../build/eq_notify')
const { PermissionFlagsBits } = require('discord.js')
const region = { code: '1310100', office: '130000', name: '東京都 千代田区', latitude: 35.68, longitude: 139.75 }
const now = Date.parse('2026-09-21T12:15:00Z')
const report = (kinds, code = region.code) => [{ reportDatetime: new Date(now).toISOString(), dataTypeCode: 'VPWW55', warning: { class20Items: [{ areaCode: code, kinds }] } }]
const kind = (code, status='発表') => ({ code, status })
const forecast = (values=[0,2,0]) => ({ hourly: { time: [now+2700000,now+6300000,now+9900000].map(t => t/1000), precipitation: values } })
function configure(guild='g', overrides={}) { const config = loadWeather(); config[guild] = { [region.code]: { region, channel:'c', warnings:true, advisories:false, rain:false, threshold:1, revision:'v1', ...overrides } }; saveWeather(config) }
const provider = (kinds=[kind('03')], rain=forecast()) => ({ warnings: async () => report(kinds), rain: async () => rain })
beforeEach(() => { for (const name of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp,name)) })
after(() => fs.rmSync(tmp, { recursive:true, force:true }))

test('2026 warning codes, region filter, advisory filter, cancellation and switching', () => {
    const data = [...report([kind('03'),kind('10'),kind('43','特別警報から危険警報'),kind('33','解除')]), ...report([kind('49','継続')],'9999999')]
    assert.deepEqual(parseWarnings(data, region.code, false).codes,['03','43'])
    assert.deepEqual(parseWarnings(data, region.code, true).codes,['03','10','43'])
})
test('unknown warning is visible, malformed or missing area does not mean clear', () => {
    assert.deepEqual(parseWarnings(report([kind('99')]), region.code,false).codes,['99'])
    for (const data of [[],{},report([],'invalid'),[{ reportDatetime:'bad',warning:{} }]]) assert.throws(() => parseWarnings(data,region.code,false))
})
test('multiple phenomenon bulletins merge and normalize order', () => {
    assert.deepEqual(parseWarnings([...report([kind('49')]),...report([kind('03'),kind('49')])],region.code,false).codes,['03','49'])
})
test('river warnings support current feed, cancellation and training exclusion', () => {
    const base = { status:'通常',infoType:'発表',reportDatetime:new Date(now).toISOString(),riverCode:'123',riverName:'川',class20Codes:[region.code],officeCodes:[region.office],item:{name:'レベル３氾濫警報',code:'30'} }
    const merged = [...report([]),floodWarningReport([base,{...base,status:'訓練'},{...base,item:{name:'解除',code:'10'}}],region.office)]
    const snapshot = parseWarnings(merged,region.code,false)
    assert.equal(snapshot.codes.length,1)
    assert.match(warningEmbed(region,snapshot).toJSON().description,/川：レベル３氾濫警報/)
})
test('hourly rain uses future interval end and explicit threshold', () => {
    assert.equal(upcomingRain(forecast(),1,now).mm,2)
    assert.equal(upcomingRain(forecast(),3,now),undefined)
    assert.equal(upcomingRain(forecast([1,0,0]),1,now).time,(now+2700000)/1000)
})
test('null, stale and incomplete forecast rejected instead of treated as dry', () => {
    assert.throws(() => upcomingRain(forecast([null,0,0]),1,now))
    assert.throws(() => upcomingRain(forecast(),1,now+86400000))
    assert.throws(() => upcomingRain({hourly:{time:[1],precipitation:[]}},1,now))
})
test('first active warning sends once, continuation does not resend', async () => {
    configure(); const sent=[]; const send=async (...v)=>sent.push(v)
    await pollWeather(send,provider(),now); await pollWeather(send,provider([kind('03','継続')]),now+60000)
    assert.equal(sent.length,1)
})
test('empty initial state is quiet; all-clear transition notifies once', async () => {
    configure(); const sent=[]; const send=async (...v)=>sent.push(v)
    await pollWeather(send,provider([]),now); assert.equal(sent.length,0)
    await pollWeather(send,provider(),now+60000)
    await pollWeather(send,provider([]),now+120000)
    await pollWeather(send,provider([]),now+180000)
    assert.equal(sent.length,2); assert.match(sent[1][2].toJSON().description,/解除・切替/)
})
test('failed delivery retries, successful guild does not receive duplicates', async () => {
    configure('good'); configure('bad'); const counts={good:0,bad:0}; let fail=true
    const send=async guild=>{counts[guild]++;if(guild==='bad'&&fail) throw Error('permission')}
    await pollWeather(send,provider(),now); fail=false; await pollWeather(send,provider(),now+60000)
    assert.deepEqual(counts,{good:1,bad:2}); assert.equal(weatherState()['bad:1310100'].error,undefined)
})
test('upstream failure retains prior warning and records error', async () => {
    configure(); await pollWeather(async()=>{},provider(),now)
    await pollWeather(async()=>assert.fail('must not send'),{...provider(),warnings:async()=>{throw Error('offline')}},now+60000)
    assert.deepEqual(weatherState()['g:1310100'].codes,['03']); assert.match(weatherState()['g:1310100'].error,/offline/)
})
test('shared office request is fetched only once per poll', async () => {
    configure('a'); configure('b'); let calls=0
    await pollWeather(async()=>{},{...provider(),warnings:async()=>{calls++;return report([])}},now)
    assert.equal(calls,1)
})
test('disabled notifications never fetch or send', async () => {
    configure('g',{warnings:false,rain:false}); const fail=async()=>assert.fail('disabled')
    await pollWeather(fail,{warnings:fail,rain:fail},now)
})
test('rain throttles API checks and repeated forecasts across polls', async () => {
    configure('g',{warnings:false,rain:true}); let sends=0,fetches=0
    const p={...provider(),rain:async()=>{fetches++;return forecast()}}
    await pollWeather(async()=>sends++,p,now)
    await pollWeather(async()=>sends++,p,now+60000)
    await pollWeather(async()=>sends++,p,now+900000)
    assert.equal(sends,1); assert.equal(fetches,2)
})
test('rain delivery failure is retried without advancing dedupe state', async () => {
    configure('g',{warnings:false,rain:true}); await pollWeather(async()=>{throw Error('offline')},provider(),now)
    assert.equal(weatherState()['g:1310100'].rainTime,undefined)
    let sent=0; await pollWeather(async()=>sent++,provider(),now+60000); assert.equal(sent,1)
})
test('removing subscription during fetch prevents notification', async () => {
    configure(); await pollWeather(async()=>assert.fail('removed'),{...provider(),warnings:async()=>{saveWeather({});return report([kind('03')])}},now)
    assert.deepEqual(weatherState(),{})
})
test('changed channel/revision receives initial active warning', async () => {
    configure(); let sent=0; await pollWeather(async()=>sent++,provider(),now)
    configure('g',{channel:'new',revision:'v2'}); await pollWeather(async()=>sent++,provider(),now+60000)
    assert.equal(sent,2)
})
test('storage is atomic and corrupted config is not silently discarded', () => {
    writeJson('example.json',{a:1}); assert.deepEqual(readJson('example.json',{}),{a:1}); assert.equal(fs.existsSync(path.join(tmp,'example.json.tmp')),false)
    fs.writeFileSync(path.join(tmp,'weather.json'),'{'); assert.throws(loadWeather)
})
test('legacy earthquake settings honor DATA_DIR and intensity scales', () => {
    saveEqChannels({g:'c'}); assert.deepEqual(loadEqChannels(),{g:'c'})
    assert.equal(scaleRank('5-'),45); assert.equal(scaleRank('6+'),60); assert.equal(scaleRank(55),55); assert.equal(scaleRank(undefined),0)
})
test('non-admin cannot mutate weather or legacy settings', async () => {
    for (const command of ['weather','set_eq_channel','set_eq_threshold']) {
        let reply
        await require(`../build/commands/${command}`).execute({guildId:'g',memberPermissions:{has:()=>false},options:{getSubcommand:()=> 'set'},reply:async v=>{reply=v}})
        assert.match(reply.content,/サーバー管理/)
    }
    assert.deepEqual(loadWeather(),{})
})
test('weather set rejects destination without bot permissions', async () => {
    let reply
    // Permission checking happens after area lookup, mocked through fetch.
    const previous=global.fetch
    global.fetch=async url=>new Response(JSON.stringify(url.includes('class20relm')?{[region.code]:{ne:[36,140],sw:[35,139]}}:{offices:{'130000':{name:'東京都'}},class10s:{a:{parent:'130000'}},class15s:{b:{parent:'a'}},class20s:{[region.code]:{name:'千代田区',parent:'b'}}}))
    try {
        await require('../build/commands/weather').execute({guildId:'g',memberPermissions:{has:p=>p===PermissionFlagsBits.ManageGuild},options:{getSubcommand:()=> 'set',getString:()=>region.code,getChannel:()=>({id:'c'})},guild:{channels:{fetch:async()=>({type:0,permissionsFor:()=>({has:()=>false})})},members:{me:{}}},deferReply:async()=>{},editReply:async v=>{reply=v}})
        assert.match(reply,/権限/); assert.deepEqual(loadWeather(),{})
    } finally { global.fetch=previous }
})
test('Discord command schemas and embeds serialize within limits', () => {
    for (const name of ['weather','help','set_eq_channel','set_eq_threshold','get_eq','ping','lottery','shift']) {
        const data=require(`../build/commands/${name}`).data.toJSON(); assert.ok(data.name)
    }
    assert.ok(warningEmbed(region,parseWarnings(report([kind('43')]),region.code,false)).toJSON())
    assert.match(rainEmbed(region,upcomingRain(forecast(),1,now)).toJSON().footer.text,/予報/)
})
test('rain radar rejects stale timestamps instead of showing old image as current', async () => {
    const prev=global.fetch; global.fetch=async()=>new Response(JSON.stringify([{basetime:'20000101000000',validtime:'20000101000000',elements:['hrpns']}]))
    try { await assert.rejects(radarImage(region),/古い/) } finally { global.fetch=prev }
})
test('existing intensity map can composite cropped edge tiles', async () => {
    const sharp=require('sharp'); const tile=await sharp({create:{width:256,height:256,channels:4,background:'#dddddd'}}).png().toBuffer()
    const prev=global.fetch; global.fetch=async()=>new Response(tile)
    try {
        const image=await require('../build/intensity_map').createIntensityMapAttachment({Body:{Earthquake:{Hypocenter:{Area:{Coordinate:'+35.68+139.75-10000/'}}}}})
        assert.equal((await sharp(image.attachment).metadata()).width,600)
    } finally {global.fetch=prev}
})

test('earthquake delivery retries only failed channels', async () => {
    const { sendToConfiguredChannels } = require('../build/eq_notify')
    saveEqChannels({a:'a',b:'b'}); let fail=true; const sent={a:0,b:0}
    const client={guilds:{cache:new Map(['a','b'].map(id=>[id,{channels:{cache:new Map([[id,{send:async()=>{sent[id]++;if(id==='b'&&fail)throw Error('offline')}}]])}}]))}}
    await assert.rejects(sendToConfiguredChannels(client,{embeds:[]},40,'event'))
    fail=false; await sendToConfiguredChannels(client,{embeds:[]},40,'event')
    assert.deepEqual(sent,{a:1,b:2})
})
test('concurrent earthquake/tsunami delivery records do not overwrite each other', async () => {
    const { sendToConfiguredChannels } = require('../build/eq_notify')
    saveEqChannels({g:'c'})
    const client={guilds:{cache:new Map([['g',{channels:{cache:new Map([['c',{send:async()=>new Promise(r=>setImmediate(r))}]])}}]])}}
    await Promise.all(['quake','tsunami'].map(key=>sendToConfiguredChannels(client,{embeds:[]},70,key)))
    assert.equal(Object.keys(readJson('eq-deliveries.json',{})).length,2)
})
test('EEW cancellation bypasses intensity threshold and performs no map/API fetch', async () => {
    const { handleP2PMessage, saveEqThresholds } = require('../build/eq_notify')
    saveEqChannels({g:'c'}); saveEqThresholds({g:70}); const messages=[]
    const client={guilds:{cache:new Map([['g',{channels:{cache:new Map([['c',{send:async p=>messages.push(p)}]])}}]])}}
    const prev=global.fetch; global.fetch=async()=>assert.fail('EEW must not await map API')
    try { await handleP2PMessage(client,Buffer.from(JSON.stringify({code:556,id:'cancel',cancelled:true,time:'2026-09-21T12:00:00Z'}))) } finally {global.fetch=prev}
    assert.equal(messages.length,1); assert.match(messages[0].content,/取消/)
})
test('failed radar tile is not silently rendered as clear weather', async () => {
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','').slice(0,14)
    const prev=global.fetch
    global.fetch=async url=> url.includes('targetTimes') ? new Response(JSON.stringify([{basetime:stamp,validtime:stamp,elements:['hrpns']}])) : new Response('',{status:503})
    try { await assert.rejects(radarImage(region),/タイル取得失敗/) } finally {global.fetch=prev}
})

test('admin can configure, inspect and remove a regional subscription without posting', async () => {
    const weather=require('../build/weather')
    const original=weather.getRegions
    weather.getRegions=async()=>[region]
    let reply
    let subcommand='set'
    const interaction={guildId:'g',memberPermissions:{has:()=>true},options:{getSubcommand:()=>subcommand,getString:()=>region.code,getChannel:()=>({id:'c'}),getBoolean:()=>null,getNumber:()=>0.5},guild:{channels:{fetch:async()=>({id:'c',type:0,permissionsFor:()=>({has:()=>true})})},members:{me:{}}},deferReply:async()=>{},editReply:async v=>{reply=v}}
    try {
        const command=require('../build/commands/weather')
        await command.execute(interaction)
        assert.equal(loadWeather().g[region.code].threshold,0.5)
        assert.equal(loadWeather().g[region.code].warnings,true)
        assert.match(reply,/登録しました/)
        subcommand='status'; await command.execute(interaction)
        assert.match(reply.embeds[0].toJSON().description,/初回確認待ち/)
        subcommand='remove'; await command.execute(interaction)
        assert.equal(loadWeather().g[region.code],undefined)
        assert.match(reply,/停止しました/)
    } finally {weather.getRegions=original}
})
