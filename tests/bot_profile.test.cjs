const { test } = require('node:test')
const assert = require('node:assert/strict')
const { RELEASE, runtimeRevision, runtimeStartedAt, releasePresence } = require('../build/release')
const { buildProfileDescription, updateBotProfile, publishBotProfile, profileStatus } = require('../build/bot_profile')
const { data, versionEmbed, execute } = require('../build/commands/version')

function application(description='',error=null) {
    const edits=[]
    const app={description,fetch:async()=>{if(error)throw error;return app},edit:async options=>{edits.push(options);app.description=options.description;return app}}
    return {app,edits}
}

test('release manifest, package and lock versions agree and activity fits Discord', () => {
    assert.equal(RELEASE.version,'1.1.0')
    assert.equal(require('../package.json').version,RELEASE.version)
    assert.equal(require('../package-lock.json').version,RELEASE.version)
    assert.equal(require('../package-lock.json').packages[''].version,RELEASE.version)
    assert.ok(releasePresence().length<128)
    assert.match(releasePresence(),/v1\.1\.0.*\/version/)
    assert.ok(runtimeStartedAt instanceof Date)
})
test('profile description preserves existing user text and includes bundled version and changes', () => {
    const text=buildProfileDescription('元のBotの説明')
    assert.ok(text.startsWith('元のBotの説明\n\n'))
    assert.match(text,/最終起動版 v1\.1\.0/)
    assert.match(text,/2015年以降/)
    assert.match(text,/数字／±/)
    assert.match(text,/\/version/)
    assert.ok(text.length<=400)
    assert.equal(buildProfileDescription(text),text)
})
test('managed section changes without accumulating notes or losing text after it', () => {
    const text='前の説明\n【Botの更新情報】\n最終起動版 v1.0.0\n【更新情報ここまで】\n追記した説明'
    const updated=buildProfileDescription(text)
    assert.ok(updated.startsWith('前の説明\n'))
    assert.ok(updated.endsWith('\n追記した説明'))
    assert.ok(!updated.includes('v1.0.0'))
    assert.equal(updated.split('【Botの更新情報】').length,2)
})
test('oversized or malformed profile is preserved rather than silently truncated', async () => {
    for (const text of ['a'.repeat(400),'【Botの更新情報】途中','【更新情報ここまで】','【Botの更新情報】x【Botの更新情報】y【更新情報ここまで】']) {
        assert.throws(()=>buildProfileDescription(text))
        const {app,edits}=application(text)
        const result=await updateBotProfile(app)
        assert.equal(result.state,'failed')
        assert.equal(edits.length,0)
        assert.equal(app.description,text)
    }
})
test('only description is patched; no-op restarts do not modify the profile again', async () => {
    const {app,edits}=application('以前の説明')
    assert.equal((await updateBotProfile(app)).state,'synced')
    assert.equal(edits.length,1)
    assert.deepEqual(Object.keys(edits[0]),['description'])
    assert.equal((await updateBotProfile(app)).state,'synced')
    assert.equal(edits.length,1)
})
test('disabled profile writer does not even fetch and failed operations stay nonfatal', async () => {
    const {app,edits}=application('',Object.assign(Error('SECRET should never appear'),{status:403}))
    assert.equal((await updateBotProfile(app,false)).state,'disabled')
    const denied=await updateBotProfile(app)
    assert.equal(denied.state,'failed');assert.match(denied.message,/拒否/);assert.ok(!denied.message.includes('SECRET'))
    assert.equal(edits.length,0)
    assert.equal((await updateBotProfile(null)).state,'failed')
    const broken=application('').app;broken.edit=async()=>{throw Error('TOKEN=secret, raw response data')}
    const failure=await updateBotProfile(broken)
    assert.equal(failure.state,'failed');assert.ok(!failure.message.includes('secret'))
})
test('update success is not claimed unless response contains requested description', async () => {
    const {app}=application('original')
    app.edit=async()=>({description:'unexpected'})
    const result=await updateBotProfile(app)
    assert.equal(result.state,'failed');assert.match(result.message,/確認できません/)
})
test('concurrent startup publishers share a single update and expose status to /version', async () => {
    let resolveFetch,reads=0,edits=0
    const app={description:'',fetch:()=>{reads++;return new Promise(resolve=>{resolveFetch=resolve})},edit:async o=>{edits++;app.description=o.description;return app}}
    const one=publishBotProfile(app),two=publishBotProfile(app)
    assert.equal(one,two)
    assert.equal(profileStatus().state,'pending')
    resolveFetch(app)
    await Promise.all([one,two])
    assert.equal(reads,1);assert.equal(edits,1);assert.equal(profileStatus().state,'synced')
    assert.match(versionEmbed().toJSON().fields.find(f=>f.name==='プロフィールへの反映').value,/APIで.*確認済み/)
})
test('only valid Railway commit IDs are rendered, never arbitrary environment contents', () => {
    assert.equal(runtimeRevision({RAILWAY_GIT_COMMIT_SHA:'a'.repeat(40)}),'a'.repeat(40))
    assert.equal(runtimeRevision({RAILWAY_GIT_COMMIT_SHA:'A'.repeat(40)}),'a'.repeat(40))
    for(const value of ['short', 'TOKEN=hidden', '@everyone', 'a'.repeat(41),'z'.repeat(40)]) assert.equal(runtimeRevision({RAILWAY_GIT_COMMIT_SHA:value}),undefined)
    assert.equal(runtimeRevision({}),undefined)
})
test('/version shows running artifact and release date, replies privately, and stays within limits', async () => {
    const replies=[]
    await execute({reply:async p=>replies.push(p)})
    const payload=replies[0],embed=payload.embeds[0].toJSON()
    assert.equal(payload.ephemeral,true)
    assert.deepEqual(payload.allowedMentions,{parse:[]})
    assert.equal(data.toJSON().name,'version')
    assert.match(embed.title,/1\.1\.0/)
    assert.match(embed.description,/この応答を返しているBot/)
    assert.match(embed.description,/2026-11-08/)
    assert.ok(embed.description.length<4096)
    assert.match(embed.footer.text,/GitHubの最新版とは限りません/)
    assert.match(embed.fields.find(f=>f.name==='このプロセスの起動時刻').value,/^<t:\d+:F>$/)
})
