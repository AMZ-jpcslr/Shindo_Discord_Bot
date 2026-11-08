const { test } = require('node:test')
const assert = require('node:assert/strict')
const { HistoryService, HistorySearch, buildHistoryUrl, matchHistoryReport, validateHistoryQuery, todayJst, intensityLabel } = require('../build/quake_history')
const { renderHistory, historyEmbed, data, execute, handleButton, advanceHistoryPage } = require('../build/commands/eq_history')
const { intensityEmbedColor } = require('../build/intensity_colors')
const query = overrides => ({start:'2015-01-10',end:'2024-01-01',regionType:'observed',order:-1,...overrides})
const report = (id='1', overrides={}) => ({id,code:551,time:'2024/01/01 16:24:50',issue:{time:'2024/01/01 16:24:00',type:'DetailScale',correct:'None'},earthquake:{time:'2024/01/01 16:10:00',maxScale:70,hypocenter:{name:'石川県能登地方',depth:10,magnitude:7.6}},points:[{pref:'石川県',addr:'輪島市',scale:70},{pref:'東京都',addr:'千代田区',scale:30}],...overrides})
const response = (body,status=200,headers={}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}})
const strings = payload => JSON.stringify({...payload,embeds:payload.embeds.map(e=>e.toJSON()),components:payload.components.map(c=>c.toJSON())})

test('validates JST date bounds, leap dates, exact range and whitespace region', () => {
    assert.equal(todayJst(new Date('2024-01-01T15:00:00Z')),'2024-01-02')
    validateHistoryQuery(query({start:'2024-02-29',end:'2024-02-29',min:45,max:45}),'2024-03-01')
    for(const change of [{start:'2023-02-29'},{start:'2024-04-31'},{start:'20240101'},{start:'1919-01-01'},{start:'2024-01-02'},{end:'2099-01-01'},{min:50,max:45},{min:46},{region:' 　'}]) assert.throws(()=>validateHistoryQuery(query(change),'2024-03-01'))
})
test('API URL uses archive, detail-only, dates and national intensity range', () => {
    const url = new URL(buildHistoryUrl(query({min:45,max:55,region:'能登',regionType:'epicenter'}),200))
    assert.equal(url.pathname,'/v2/jma/quake')
    assert.equal(url.searchParams.get('quake_type'),'DetailScale')
    assert.equal(url.searchParams.get('since_date'),'20150110')
    assert.equal(url.searchParams.get('until_date'),'20240102')
    assert.equal(url.searchParams.get('limit'),'100')
    assert.equal(url.searchParams.get('offset'),'200')
    assert.equal(url.searchParams.get('max_scale'),'55')
    assert.throws(()=>buildHistoryUrl(query(),-1))
})
test('regional upper bound never excludes nationally stronger earthquakes upstream', () => {
    const url = new URL(buildHistoryUrl(query({region:'東京都 千代田区',min:30,max:30}),0))
    assert.equal(url.searchParams.get('prefectures[]'),'東京都,30')
    assert.equal(url.searchParams.get('max_scale'),null)
    assert.equal(url.searchParams.get('min_scale'),'30')
    const matched = matchHistoryReport(report(),query({region:'東京都 千代田区',min:30,max:30}))
    assert.equal(matched.maxScale,70)
    assert.equal(matched.localScale,30)
    assert.equal(matched.observations.length,1)
    assert.equal(matchHistoryReport(report(),query({region:'東京都',min:40})),undefined)
    assert.equal(matchHistoryReport(report(),query({region:'石川県',max:60})),undefined)
})
test('epicenter and observed-region semantics are different; name tokens and national ranges work', () => {
    assert.equal(matchHistoryReport(report(),query({region:'能登'})),undefined)
    assert.ok(matchHistoryReport(report(),query({region:'能登',regionType:'epicenter',min:70})))
    assert.equal(matchHistoryReport(report(),query({region:'東京都',regionType:'epicenter'})),undefined)
    assert.ok(matchHistoryReport(report(),query({region:'東京　千代田',min:30,max:30})))
    assert.equal(matchHistoryReport(report(),query({max:60})),undefined)
})
test('unavailable estimated 5- or greater is not falsely treated as a measured 5-', () => {
    const raw = report('uncertain',{points:[{pref:'東京都',addr:'千代田区',scale:46}]})
    assert.equal(intensityLabel(46),'5弱以上（未確定）')
    assert.equal(matchHistoryReport(raw,query({region:'東京都',min:45,max:45})),undefined)
    assert.equal(matchHistoryReport(raw,query({region:'東京都',min:50})),undefined)
    assert.equal(matchHistoryReport(raw,query({region:'東京都',min:45})).localUncertain,true)
    assert.equal(matchHistoryReport(raw,query({region:'東京都',max:70})).localScale,45)
    raw.points.push({pref:'東京都',addr:'別地点',scale:70})
    assert.equal(matchHistoryReport(raw,query({region:'東京都',min:70,max:70})).localUncertain,false)
})
test('unknown intensities, different codes and prompt-only bulletins are not asserted as measured matches', () => {
    const missing = report('unknown',{earthquake:{time:'2024/01/01 1:00:00',maxScale:-1}})
    assert.ok(matchHistoryReport(missing,query()))
    assert.equal(matchHistoryReport(missing,query({min:10})),undefined)
    assert.equal(matchHistoryReport(report('other',{code:556}),query()),undefined)
    assert.equal(matchHistoryReport(report('prompt',{issue:{type:'ScalePrompt'}}),query()),undefined)
    assert.equal(matchHistoryReport(report(),query({region:'大阪'})),undefined)
})
test('sparse matching advances raw offset, preserves partial state, and can continue beyond 200', async () => {
    const calls=[]
    const search = new HistorySearch(query({region:'大阪'}),{fetchPage:async(q,offset)=>{calls.push(offset);return offset<200?Array.from({length:100},(_,i)=>report(String(offset+i))):[report('wanted',{points:[{pref:'大阪府',addr:'大阪市',scale:20}]})]}})
    await search.loadMore(5)
    assert.deepEqual(calls,[0,100]); assert.equal(search.results.length,0);assert.equal(search.exhausted,false)
    assert.match(strings(renderHistory(search,0,'session')),/まだ未検索/)
    await search.loadMore(5)
    assert.deepEqual(calls,[0,100,200]);assert.equal(search.results.length,1);assert.equal(search.exhausted,true)
})
test('deduplicates only report IDs, retains separately identified later corrections', async () => {
    const search = new HistorySearch(query(),{fetchPage:async()=>[report('one'),report('one'),report('two')]})
    await search.loadMore(5)
    assert.deepEqual(search.results.map(r=>r.id),['one','two'])
    assert.equal(search.scanned,3)
    assert.match(strings(renderHistory(search,0,'session')),/続報・訂正は別件/)
})
test('request failure does not advance offset or claim exhaustion; repeat succeeds', async () => {
    let fails=true
    const search=new HistorySearch(query(),{fetchPage:async()=>{if(fails)throw Error('offline');return[report()]}})
    await assert.rejects(search.loadMore(5),/offline/)
    assert.equal(search.offset,0);assert.equal(search.exhausted,false)
    fails=false;await search.loadMore(5);assert.equal(search.offset,1)
})
test('service caches identical queries, deduplicates concurrent requests and spaces requests', async () => {
    let time=0,calls=0;const sleeps=[]
    const service=new HistoryService(async()=>{calls++;return response([report()])},6100,()=>time,async ms=>{sleeps.push(ms);time+=ms})
    await Promise.all([service.fetchPage(query(),0),service.fetchPage(query(),0)])
    assert.equal(calls,1)
    await service.fetchPage(query(),0);assert.equal(calls,1)
    await service.fetchPage(query(),100);assert.equal(calls,2);assert.deepEqual(sleeps,[6100])
    time+=301000;await service.fetchPage(query(),0);assert.equal(calls,3)
})
test('rate-limit backoff honors Retry-After and errors never cache empty success', async () => {
    let time=0,calls=0
    const service=new HistoryService(async()=>{calls++;return calls===1?response({},429,{'retry-after':'120'}):response([])},6100,()=>time,async ms=>{time+=ms})
    await assert.rejects(service.fetchPage(query(),0),/利用制限/)
    await assert.rejects(service.fetchPage(query(),0),/待機/)
    assert.equal(calls,1)
    time=120000;assert.deepEqual(await service.fetchPage(query(),0),[])
    assert.equal(calls,2)
})
test('service refuses malformed payload and invalid IDs rather than reporting no earthquakes', async () => {
    for(const bad of [{},[{}],[{id:1,code:551,earthquake:{}}],[report('x',{points:[null]})],[report('bad-time',{earthquake:{time:123,maxScale:20}})],[report('bad-points',{points:[{pref:'東京',addr:'千代田',scale:'20'}]})],Array.from({length:101},()=>report())]) {
        const service=new HistoryService(async()=>response(bad),0)
        await assert.rejects(service.fetchPage(query(),0),/応答形式/)
    }
})
test('session budget stops automatically, but results and range-splitting guidance remain', async () => {
    const search=new HistorySearch(query(),{fetchPage:async(q,offset)=>Array.from({length:100},(_,i)=>report(String(offset+i)))})
    await search.loadMore(500);await search.loadMore(500);await search.loadMore(500)
    assert.equal(search.capped,true);assert.equal(search.results.length,500)
    assert.match(strings(renderHistory(search,99,'session')),/日付で範囲を分けて/)
})
test('embeds use intensity colors, historical labels, units, and fit Discord payload limits', () => {
    const search=new HistorySearch(query({region:'東京'}),{fetchPage:async()=>[]})
    const raw=report('x',{earthquake:{time:'2024/01/01 16:10:00',maxScale:30,hypocenter:{name:'@everyone '+ '*'.repeat(100),magnitude:-1,depth:-1}},points:Array.from({length:100},()=>({pref:'東京都',addr:'*'.repeat(120),scale:30}))})
    search.results.push(...Array.from({length:5},(_,i)=>({...matchHistoryReport(raw,search.query),id:String(i)})))
    const payload=renderHistory(search,0,'s')
    assert.equal(payload.embeds.length,5)
    assert.ok(payload.content.length<=2000)
    const embeds=payload.embeds.map(e=>e.toJSON())
    assert.ok(embeds.reduce((n,e)=>n+(e.title?.length||0)+(e.description?.length||0)+(e.footer?.text.length||0),0)<=6000)
    assert.equal(embeds[0].color,intensityEmbedColor(30))
    assert.match(embeds[0].description,/規模不明/)
    assert.match(embeds[0].description,/深さ不明/)
    assert.ok(!embeds[0].title.includes('@everyone'))
    assert.match(payload.content,/2015年以前/)
    assert.deepEqual(payload.allowedMentions,{parse:[]})
    assert.equal(historyEmbed({...search.results[0],maxScale:undefined},0,false).toJSON().color,0x808080)
})
test('slash command schema includes scope, range and dates without altering get_eq', () => {
    const json=data.toJSON();assert.equal(json.name,'eq_history')
    assert.deepEqual(json.options.map(o=>o.name),['region','region_type','min_intensity','max_intensity','start','end','order'])
    assert.equal(json.options[2].choices.length,9)
    assert.equal(require('../build/commands/get_eq').data.toJSON().name,'get_eq')
})
test('invalid command input and expired button respond privately without API', async () => {
    const replies=[]
    await execute({options:{getString:n=>n==='start'?'1919-01-01':null,getInteger:()=>null},reply:async p=>replies.push(p)})
    await handleButton({customId:'eqh:missing:next',reply:async p=>replies.push(p)})
    assert.equal(replies.length,2);assert.equal(replies.every(p=>p.ephemeral),true)
    assert.match(replies[0].content,/2015-01-10/)
    assert.match(replies[1].content,/終了しました/)
})

test('end date includes old unpadded morning hours and excludes widened next day', () => {
    const q=query({start:'2015-01-10',end:'2015-01-10'})
    assert.ok(matchHistoryReport(report('early',{earthquake:{time:'2015/01/10 4:09:00',maxScale:20}}),q))
    assert.equal(matchHistoryReport(report('next',{earthquake:{time:'2015/01/11 00:01:00',maxScale:20}}),q),undefined)
    assert.equal(matchHistoryReport(report('before',{earthquake:{time:'2015/01/09 23:59:59',maxScale:20}}),q),undefined)
    assert.equal(new URL(buildHistoryUrl(query({end:'2024-12-31'}),0)).searchParams.get('until_date'),'20250101')
})
test('continuation first fills partially displayed page without skipping new matches', async () => {
    const search=new HistorySearch(query(),{fetchPage:async()=>[report('4'),report('5'),report('6'),report('7')]})
    search.results.push(...[1,2,3].map(i=>matchHistoryReport(report(String(i)),search.query)))
    assert.equal(await advanceHistoryPage(search,0),0)
    assert.deepEqual(renderHistory(search,0,'s').embeds.map(e=>e.toJSON().title.slice(0,1)),['1','2','3','4','5'])
    assert.equal(await advanceHistoryPage(search,0),1)
    assert.equal(renderHistory(search,1,'s').embeds.length,2)
})

test('private session authorizes owner, rejects repeated clicks, then permits retry and previous page', async () => {
    const original=HistoryService.prototype.fetchPage
    let resolvePage
    let calls=0
    HistoryService.prototype.fetchPage=async()=>{calls++; if(calls===1)return Array.from({length:100},(_,i)=>report(String(i)));return new Promise(resolve=>{resolvePage=resolve})}
    const replies=[],edits=[]
    try {
        const interaction={id:'command-session',user:{id:'owner'},options:{getString:n=>n==='end'?'2024-01-01':null,getInteger:()=>null},deferReply:async p=>assert.equal(p.ephemeral,true),editReply:async p=>edits.push(p),reply:async p=>replies.push(p)}
        await execute(interaction)
        assert.equal(edits[0].embeds.length,5)
        const button=(user,action='next')=>({customId:`eqh:command-session:${action}`,user:{id:user},deferUpdate:async()=>{},editReply:async p=>edits.push(p),reply:async p=>replies.push(p)})
        await handleButton(button('other'));assert.match(replies.at(-1).content,/本人/)
        for(let i=0;i<19;i++) await handleButton(button('owner'))
        const pending=handleButton(button('owner'))
        await new Promise(resolve=>setImmediate(resolve))
        await handleButton(button('owner'));assert.match(replies.at(-1).content,/取得中/)
        resolvePage([]);await pending
        await handleButton(button('owner','prev'))
        assert.match(edits.at(-1).embeds[0].toJSON().title,/^91\./)
        assert.equal(calls,2)
    } finally {HistoryService.prototype.fetchPage=original}
})
