const { test, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const intensity = require('../build/intensity_map')
const disaster = require('../build/disaster_map')
const { readJson, writeJson } = require('../build/storage')
const originalFetch = global.fetch
const originalIntensity = intensity.createIntensityMapAttachment
const originalDisaster = disaster.createDisasterMapAttachment
let eq, tmp, mapCalls
const flush = () => new Promise(resolve => setImmediate(resolve))
const id = '20261108010441'
const item = (version = 1, eid = id) => ({eid, ctt:`20261108010${version}00`, json:`report_${eid || 'missing'}_${version}.json`})
function detail(version = 1, scale = '3', eid = id) {
    return {
        Head:{ EventID:eid, ReportDateTime:`2026-11-08T01:0${version}:00+09:00`, TargetDateTime:'2026-11-08T01:00:00+09:00', Title: version === 1 ? '震度速報' : '震源・震度情報', InfoType:'発表' },
        Body:{
            ...(version > 1 ? {Earthquake:{OriginTime:'2026-11-08T01:00:00+09:00', Magnitude:'4.2', Hypocenter:{Area:{Name:'テスト沖',Coordinate:'+35.0+139.0-10000/'}}}} : {}),
            Intensity:{Observation:{MaxInt:scale, Pref:[{Name:'テスト県',Area:[{Name:'テスト地域',MaxInt:scale}]}]}},
        },
    }
}
const text = payload => JSON.stringify({content:payload.content, embeds:payload.embeds?.map(e => e.toJSON ? e.toJSON() : e)})
function discord(names = ['a']) {
    const destinations = {}
    const guilds = new Map()
    for (const name of names) {
        const state = {sent:[], edits:[], attempts:0, sendError:null, editError:null}
        const channel = {
            send: async payload => {state.attempts++; if (state.sendError) throw state.sendError; const message = {id:`${name}-${state.sent.length+1}`}; state.sent.push({payload,id:message.id}); return message},
            messages:{edit:async (messageId,payload) => {if (state.editError) throw state.editError; state.edits.push({id:messageId,payload}); return {id:messageId}}},
        }
        destinations[name] = state
        guilds.set(name,{channels:{cache:new Map([[name,channel]])}})
    }
    eq.saveEqChannels(Object.fromEntries(names.map(n => [n,n])))
    return {client:{guilds:{cache:guilds}}, ...destinations}
}
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(),'eq-updates-'))
    process.env.DATA_DIR = tmp
    mapCalls = 0
    intensity.createIntensityMapAttachment = async () => {mapCalls++; return null}
    disaster.createDisasterMapAttachment = async () => null
    global.fetch = async url => {throw Error(`Unexpected network: ${url}`)}
    delete require.cache[require.resolve('../build/eq_notify')]
    eq = require('../build/eq_notify')
})
afterEach(async () => {
    await flush()
    global.fetch = originalFetch
    intensity.createIntensityMapAttachment = originalIntensity
    disaster.createDisasterMapAttachment = originalDisaster
    fs.rmSync(tmp,{recursive:true,force:true})
})

test('minimal initial quake sends without map/network and detailed report edits original message', async () => {
    const {client,a} = discord()
    await eq.applyJmaQuakeReport(client,item(),detail())
    assert.equal(a.sent.length,1)
    assert.equal(mapCalls,0)
    assert.match(text(a.sent[0].payload),/解析中/)
    assert.match(text(a.sent[0].payload),/テスト地域/)
    await eq.applyJmaQuakeReport(client,item(2),detail(2))
    assert.equal(a.sent.length,1)
    assert.equal(a.edits.length,1)
    assert.equal(a.edits[0].id,a.sent[0].id)
    assert.match(text(a.edits[0].payload),/テスト沖/)
    assert.match(text(a.edits[0].payload),/4\.2/)
    assert.deepEqual(a.edits[0].payload.attachments,[])
})

test('maximum intensity escalation posts one separate alert, stale and repeated reports do not regress', async () => {
    const {client,a} = discord()
    await eq.applyJmaQuakeReport(client,item(),detail())
    await eq.applyJmaQuakeReport(client,item(2),detail(2,'5-'))
    await eq.applyJmaQuakeReport(client,item(2),detail(2,'5-'))
    await eq.applyJmaQuakeReport(client,item(),detail())
    assert.equal(a.sent.length,2)
    assert.match(a.sent[1].payload.content,/最大震度の引き上げ/)
    assert.match(a.sent[1].payload.content,/3 → 震度5弱/)
    assert.equal(a.edits.length,1)
    assert.equal(readJson('eq-events.json',{}).events[`jma:${id}`].detail.Body.Intensity.Observation.MaxInt,'5-')
})

test('simultaneous earthquakes and missing event identifiers never merge by time or location', async () => {
    const {client,a} = discord()
    const second = '20261108010442'
    await Promise.all([eq.applyJmaQuakeReport(client,item(),detail()),eq.applyJmaQuakeReport(client,item(1,second),detail(1,'3',second))])
    const missing1 = {...item(3),eid:undefined}, missing2 = {...item(4),eid:undefined}
    const missingDetail = detail(); delete missingDetail.Head.EventID
    await eq.applyJmaQuakeReport(client,missing1,missingDetail)
    await eq.applyJmaQuakeReport(client,missing2,missingDetail)
    assert.equal(a.sent.length,4)
    assert.equal(a.edits.length,0)
    assert.notEqual(eq.jmaEventKey(missing1,missingDetail),eq.jmaEventKey(missing2,missingDetail))
    assert.throws(() => eq.jmaEventKey(item(),detail(1,'3',second)),/mismatch/)
})

test('partial destination failure survives restart and retries only the failed destination', async () => {
    const {client,a,b} = discord(['a','b'])
    b.sendError = Error('temporary send failure')
    await assert.rejects(eq.applyJmaQuakeReport(client,item(),detail()),/未達/)
    assert.equal(a.sent.length,1)
    delete require.cache[require.resolve('../build/eq_notify')]
    eq = require('../build/eq_notify')
    b.sendError = null
    // Even a failed list fetch must not prevent persisted delivery retries.
    await assert.rejects(eq.pollJmaQuake(client),/Unexpected network/)
    assert.equal(a.sent.length,1)
    assert.equal(b.sent.length,1)
    assert.equal(Object.keys(readJson('eq-events.json',{}).events[`jma:${id}`].deliveries).length,2)
})

test('deleted message 10008 is replaced; permission failure 403 must not duplicate', async () => {
    const {client,a} = discord()
    await eq.applyJmaQuakeReport(client,item(),detail())
    a.editError = Object.assign(Error('Forbidden'),{code:50013,status:403})
    await assert.rejects(eq.applyJmaQuakeReport(client,item(2),detail(2)))
    assert.equal(a.sent.length,1)
    a.editError = Object.assign(Error('Unknown Message'),{code:10008})
    await eq.applyJmaQuakeReport(client,item(2),detail(2))
    assert.equal(a.sent.length,2)
    a.editError = null
    await eq.applyJmaQuakeReport(client,item(3),detail(3))
    assert.equal(a.edits[0].id,a.sent[1].id)
})

test('threshold increases do not block existing updates or cancellations; new destinations stay filtered', async () => {
    const {client,a,b} = discord(['a','b'])
    eq.saveEqThresholds({a:0,b:50})
    await eq.applyJmaQuakeReport(client,item(),detail())
    eq.saveEqThresholds({a:70,b:50})
    await eq.applyJmaQuakeReport(client,item(2),detail(2))
    const cancellation = {Head:{...detail(3).Head,InfoType:'取消'}}
    await eq.applyJmaQuakeReport(client,item(3),cancellation)
    assert.equal(a.sent.length,1)
    assert.equal(a.edits.length,2)
    assert.match(text(a.edits[1].payload),/取り消されました/)
    assert.equal(b.sent.length,0)
    assert.equal(a.sent.filter(s => /引き上げ/.test(s.payload.content)).length,0)
})

test('partial followup preserves existing intensity and coordinates', () => {
    const merged = eq.mergeJmaDetail(detail(2,'4'),{Head:{ReportDateTime:'2026-11-08T01:09:00+09:00'},Body:{Comments:{ForecastComment:{Text:'津波の心配なし'}}}})
    assert.equal(merged.Body.Intensity.Observation.MaxInt,'4')
    assert.equal(merged.Body.Earthquake.Hypocenter.Area.Name,'テスト沖')
    assert.equal(merged.Body.Comments.ForecastComment.Text,'津波の心配なし')
})

test('P2P fallback has no negative magnitude/depth placeholders and persists failed destinations', async () => {
    const {client,a,b} = discord(['a','b'])
    b.sendError = Error('offline')
    const message = {code:551,id:'fallback-1',earthquake:{maxScale:30,hypocenter:{magnitude:-1,depth:-1,latitude:-200,longitude:-200}}}
    await assert.rejects(eq.handleP2PMessage(client,Buffer.from(JSON.stringify(message))))
    assert.match(text(a.sent[0].payload),/P2P代替速報/)
    assert.doesNotMatch(text(a.sent[0].payload),/M-1|-1\s*km|-200/)
    assert.ok(readJson('eq-fallback-pending.json',{})['fallback-1'])
    b.sendError = null
    await eq.retryP2PFallbacks(client)
    assert.equal(a.sent.length,1)
    assert.equal(b.sent.length,1)
    assert.deepEqual(readJson('eq-fallback-pending.json',{}),{})
})

test('quake polling uses newest historical bulletin at startup and shared poll prevents duplicate fetches', async () => {
    const {client,a} = discord()
    let fetches = 0
    global.fetch = async url => {fetches++; return new Response(JSON.stringify(url.endsWith('/list.json') ? [item(2),item()] : detail(2)))}
    const first = eq.pollJmaQuake(client)
    assert.equal(eq.pollJmaQuake(client),first)
    await first
    assert.equal(fetches,2)
    assert.equal(a.sent.length,1)
    await eq.pollJmaQuake(client)
    assert.equal(fetches,2)
    assert.equal(a.sent.length,1)
    await eq.handleP2PMessage(client,Buffer.from(JSON.stringify({code:551,id:'healthy-suppressed',earthquake:{maxScale:30}})))
    assert.equal(a.sent.length,1)
})

test('tsunami warnings and cancellation send separately despite earthquake threshold', async () => {
    const {client,a} = discord()
    eq.saveEqThresholds({a:70})
    writeJson('tsunami-reports.json',{initialized:true,seen:{},pending:{}})
    const reports = [
        {Head:{Title:'津波警報',ReportDateTime:'2026-11-08T01:01:00+09:00'},Body:{Tsunami:{Forecast:{Item:[{Area:{Name:'テスト沿岸'},Category:{Kind:{Name:'津波警報'}}}]}}}},
        {Head:{Title:'津波警報解除',ReportDateTime:'2026-11-08T01:02:00+09:00'},Body:{Text:'津波警報を解除しました。'}},
    ]
    global.fetch = async url => new Response(JSON.stringify(url.endsWith('/list.json') ? [{ctt:'1',json:'tsunami_1.json'},{ctt:'2',json:'tsunami_2.json'}] : reports[url.endsWith('tsunami_1.json') ? 0 : 1]))
    await eq.pollJmaTsunami(client)
    await eq.pollJmaTsunami(client)
    assert.equal(a.sent.length,2)
    assert.match(text(a.sent[0].payload),/津波警報/)
    assert.match(text(a.sent[1].payload),/解除/)
    assert.equal(a.edits.length,0)
})

test('failed escalation alert survives restart without re-editing or re-sending original notification', async () => {
    const {client,a} = discord()
    await eq.applyJmaQuakeReport(client,item(),detail())
    a.sendError = Error('alert temporarily blocked')
    await assert.rejects(eq.applyJmaQuakeReport(client,item(2),detail(2,'5+')))
    assert.equal(a.edits.length,1)
    assert.equal(a.sent.length,1)
    const before = readJson('eq-events.json',{}).events[`jma:${id}`].deliveries['a:a']
    assert.equal(before.pendingAlerts.length,1)
    delete require.cache[require.resolve('../build/eq_notify')]
    eq = require('../build/eq_notify')
    a.sendError = null
    await eq.applyJmaQuakeReport(client,item(2),detail(2,'5+'))
    await eq.applyJmaQuakeReport(client,item(2),detail(2,'5+'))
    assert.equal(a.edits.length,1)
    assert.equal(a.sent.length,2)
    assert.match(a.sent[1].payload.content,/5強/)
    assert.deepEqual(readJson('eq-events.json',{}).events[`jma:${id}`].deliveries['a:a'].pendingAlerts,[])
})

test('normal quake waits at most three seconds, then late map edits the original once', async t => {
    t.mock.timers.enable({apis:['setTimeout']})
    const {client,a} = discord()
    let finishMap, generated = 0
    intensity.createIntensityMapAttachment = () => {generated++; return new Promise(resolve => {finishMap = resolve})}
    const pending = eq.applyJmaQuakeReport(client,item(2),detail(2))
    await flush()
    assert.equal(eq.QUAKE_MAP_WAIT_MS,3000)
    assert.equal(a.sent.length,0)
    t.mock.timers.tick(2999)
    await flush()
    assert.equal(a.sent.length,0)
    t.mock.timers.tick(1)
    await pending
    assert.equal(a.sent.length,1)
    assert.equal(a.sent[0].payload.embeds[0].data.image,undefined)
    const {AttachmentBuilder} = require('discord.js')
    finishMap(new AttachmentBuilder(Buffer.from('mock image'),{name:'intensity-map.png'}))
    await flush()
    assert.equal(a.edits.length,1)
    assert.equal(a.edits[0].id,a.sent[0].id)
    assert.equal(a.edits[0].payload.embeds[0].data.image.url,'attachment://intensity-map.png')
    await eq.applyJmaQuakeReport(client,item(2),detail(2))
    await flush()
    assert.equal(generated,1)
    assert.equal(a.edits.length,1)
    assert.equal(a.sent.length,1)
})

test('map ready before deadline is included in initial announcement without a second edit', async t => {
    t.mock.timers.enable({apis:['setTimeout']})
    const {client,a} = discord()
    let finishMap
    intensity.createIntensityMapAttachment = () => new Promise(resolve => {finishMap = resolve})
    const pending = eq.applyJmaQuakeReport(client,item(2),detail(2))
    await flush()
    t.mock.timers.tick(2500)
    await flush()
    assert.equal(a.sent.length,0)
    const {AttachmentBuilder} = require('discord.js')
    finishMap(new AttachmentBuilder(Buffer.from('mock image'),{name:'intensity-map.png'}))
    await pending
    assert.equal(a.sent.length,1)
    assert.equal(a.sent[0].payload.embeds[0].data.image.url,'attachment://intensity-map.png')
    assert.ok(a.sent[0].payload.files.some(file => file.name === 'intensity-map.png'))
    t.mock.timers.tick(500)
    await flush()
    assert.equal(a.edits.length,0)
    const saved = readJson('eq-events.json',{}).events[`jma:${id}`]
    assert.equal(saved.deliveries['a:a'].mapRevision,saved.revision)
})

test('a late old map cannot overwrite a newer event revision', async t => {
    t.mock.timers.enable({apis:['setTimeout']})
    const {client,a} = discord()
    const {AttachmentBuilder} = require('discord.js')
    let finishOldMap, calls = 0
    intensity.createIntensityMapAttachment = () => {
        if (++calls === 1) return new Promise(resolve => {finishOldMap = resolve})
        return Promise.resolve(new AttachmentBuilder(Buffer.from('new map'),{name:'intensity-map.png'}))
    }
    const first = eq.applyJmaQuakeReport(client,item(2),detail(2))
    await flush()
    t.mock.timers.tick(3000)
    await first
    const newer = detail(3)
    newer.Body.Earthquake.Hypocenter.Area.Name = '新しい震源'
    await eq.applyJmaQuakeReport(client,item(3),newer)
    assert.equal(a.edits.length,1)
    assert.match(text(a.edits[0].payload),/新しい震源/)
    finishOldMap(new AttachmentBuilder(Buffer.from('old map'),{name:'intensity-map.png'}))
    await flush()
    assert.equal(a.edits.length,1)
    assert.equal(a.sent.length,1)
    const saved = readJson('eq-events.json',{}).events[`jma:${id}`]
    assert.equal(saved.deliveries['a:a'].mapRevision,saved.revision)
})

test('pending intensity escalation bypasses the map deadline', async t => {
    t.mock.timers.enable({apis:['setTimeout']})
    const {client,a} = discord()
    await eq.applyJmaQuakeReport(client,item(),detail())
    let finishMap
    intensity.createIntensityMapAttachment = () => new Promise(resolve => {finishMap = resolve})
    await eq.applyJmaQuakeReport(client,item(2),detail(2,'5+'))
    assert.equal(a.edits.length,1)
    assert.equal(a.sent.length,2)
    assert.match(a.sent[1].payload.content,/最大震度の引き上げ/)
    assert.equal(typeof finishMap,'function')
    finishMap(null)
    await flush()
})

test('retention preserves old events with an initially unsent target', async () => {
    const {client,a,b} = discord(['a','b'])
    b.sendError = Error('offline before first delivery')
    await assert.rejects(eq.applyJmaQuakeReport(client,item(),detail()))
    const journal = readJson('eq-events.json',{})
    journal.events[`jma:${id}`].updatedAt = Date.now() - 8 * 86400000
    writeJson('eq-events.json',journal)
    // A still-failing retry must retain the journal, not just restore it after a successful send.
    await assert.rejects(eq.applyJmaQuakeReport(client,item(),detail()))
    assert.ok(readJson('eq-events.json',{}).events[`jma:${id}`])
    b.sendError = null
    await eq.applyJmaQuakeReport(client,item(),detail())
    assert.ok(readJson('eq-events.json',{}).events[`jma:${id}`])
    assert.equal(a.sent.length,1)
    assert.equal(b.sent.length,1)
})

for (const change of ['cancellation','downward correction']) {
    test(`${change} clears an unsent escalation alert before delivery resumes`, async () => {
        const {client,a} = discord()
        await eq.applyJmaQuakeReport(client,item(),detail())
        a.sendError = Error('cannot send escalation')
        await assert.rejects(eq.applyJmaQuakeReport(client,item(2),detail(2,'5+')))
        assert.equal(readJson('eq-events.json',{}).events[`jma:${id}`].deliveries['a:a'].pendingAlerts.length,1)
        a.sendError = null
        const corrected = change === 'cancellation' ? {Head:{...detail(3).Head,InfoType:'取消'}} : detail(3,'4')
        await eq.applyJmaQuakeReport(client,item(3),corrected)
        assert.equal(a.sent.length,1)
        assert.equal(a.edits.length,2)
        assert.deepEqual(readJson('eq-events.json',{}).events[`jma:${id}`].deliveries['a:a'].pendingAlerts,[])
    })
}

test('completed deliveries require no Discord lookup on later polling', async () => {
    const {client,a} = discord()
    await eq.applyJmaQuakeReport(client,item(),detail())
    let lookups = 0
    client.guilds.cache.get = () => {lookups++; throw Error('Discord must not be contacted')}
    global.fetch = async () => new Response('[]')
    await eq.pollJmaQuake(client)
    assert.equal(lookups,0)
    assert.equal(a.sent.length,1)
})

test('Discord delivery failure does not fail source polling or activate P2P fallback', async () => {
    const {client,a} = discord()
    a.sendError = Error('Discord unavailable')
    let listRequests = 0
    global.fetch = async url => {
        if (url.endsWith('/list.json')) listRequests++
        return new Response(JSON.stringify(url.endsWith('/list.json') ? [item()] : detail()))
    }
    await eq.pollJmaQuake(client)
    assert.equal(a.sent.length,0)
    assert.equal(a.attempts,1)
    await eq.pollJmaQuake(client)
    assert.equal(a.attempts,2)
    assert.equal(listRequests,1)
    a.sendError = null
    await eq.handleP2PMessage(client,Buffer.from(JSON.stringify({code:551,id:'delivery-only-failure',earthquake:{maxScale:30}})))
    assert.equal(a.sent.length,0)
})

test('slow retry work does not postpone fetching the newest JMA list', async () => {
    const {client,a} = discord()
    a.sendError = Error('first send failed')
    await assert.rejects(eq.applyJmaQuakeReport(client,item(),detail()))
    let release, fetched = false
    client.guilds.cache.get('a').channels.cache.get('a').send = () => new Promise(resolve => {release = () => resolve({id:'retried'})})
    global.fetch = async () => {fetched = true; return new Response('[]')}
    const polling = eq.pollJmaQuake(client)
    await flush()
    assert.equal(fetched,true)
    assert.equal(typeof release,'function')
    release()
    await polling
})

test('changing destination does not replay a historical earthquake', async () => {
    const {client,a,b} = discord(['a','b'])
    eq.saveEqChannels({a:'a'})
    await eq.applyJmaQuakeReport(client,item(),detail())
    eq.saveEqChannels({a:'b',b:'b'})
    global.fetch = async () => new Response('[]')
    await eq.pollJmaQuake(client)
    assert.equal(a.sent.length,1)
    assert.equal(b.sent.length,0)
    assert.equal(a.edits.length,0)
    assert.equal(b.edits.length,0)
})

test('JMA detail fetch failure enables P2P fallback despite a successful list request', async () => {
    const {client,a} = discord()
    global.fetch = async url => url.endsWith('/list.json')
        ? new Response(JSON.stringify([item()])) : new Response(null,{status:503})
    await assert.rejects(eq.pollJmaQuake(client),/503/)
    await eq.handleP2PMessage(client,Buffer.from(JSON.stringify({code:551,id:'detail-failure',earthquake:{maxScale:30}})))
    assert.equal(a.sent.length,1)
    assert.match(text(a.sent[0].payload),/P2P代替速報/)
})

test('more than twenty in-flight maps stay shared through the announcement deadline', async t => {
    t.mock.timers.enable({apis:['setTimeout']})
    const {client,a} = discord()
    const finish = []
    intensity.createIntensityMapAttachment = () => new Promise(resolve => finish.push(resolve))
    const work = Array.from({length:24},(_, index) => {
        const eventId = String(20261108010000 + index)
        return eq.applyJmaQuakeReport(client,item(2,eventId),detail(2,'3',eventId))
    })
    await flush()
    assert.equal(finish.length,24)
    t.mock.timers.tick(3000)
    await Promise.all(work)
    assert.equal(a.sent.length,24)
    assert.equal(finish.length,24,'unsettled map promises must not be evicted and rebuilt')
    for (const resolve of finish) resolve(null)
    await flush()
})
