import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, escapeMarkdown, SlashCommandBuilder } from 'discord.js'
import { intensityEmbedColor } from '../intensity_colors'
import { HISTORY_START, HistoryQuery, HistoryResult, HistorySearch, HistoryService, INTENSITIES, intensityLabel, JMA_DATABASE, todayJst, validateHistoryQuery } from '../quake_history'

const intensityChoices = INTENSITIES.map(value => ({ name: `震度${intensityLabel(value)}`, value }))
export const data = new SlashCommandBuilder()
    .setName('eq_history').setDescription('過去の地震発表を地域・震度・発生日で検索（2015年1月10日以降）')
    .addStringOption(o => o.setName('region').setDescription('都道府県・市区町村・観測点名の一部。震源モードなら震源名').setMaxLength(80))
    .addStringOption(o => o.setName('region_type').setDescription('地域の意味（既定: 揺れを観測した場所）').addChoices({ name: '揺れを観測した場所', value: 'observed' }, { name: '震源の名前', value: 'epicenter' }))
    .addIntegerOption(o => o.setName('min_intensity').setDescription('最低震度。観測地域ありならその地域の最大、なし/震源なら全国の最大').addChoices(...intensityChoices))
    .addIntegerOption(o => o.setName('max_intensity').setDescription('最高震度。最低と同じ値ならその震度のみ。地域条件の意味は最低震度と同じ').addChoices(...intensityChoices))
    .addStringOption(o => o.setName('start').setDescription('発生期間の開始日 YYYY-MM-DD（日本時間、既定: 2015-01-10）').setMinLength(10).setMaxLength(10))
    .addStringOption(o => o.setName('end').setDescription('発生期間の終了日 YYYY-MM-DD（日本時間、既定: 今日）').setMinLength(10).setMaxLength(10))
    .addIntegerOption(o => o.setName('order').setDescription('情報の受信日時による並び順（発生時刻順ではありません）').addChoices({ name: '新しい受信情報から', value: -1 }, { name: '古い受信情報から', value: 1 }))

const service = new HistoryService()
const PAGE_SIZE = 5
const SESSION_MS = 10 * 60_000
const sessions = new Map<string, { owner: string, expires: number, search: HistorySearch, page: number, busy: boolean }>()
const types: Record<string, string> = { DetailScale: '各地の震度', ScaleAndDestination: '震源・震度', ScalePrompt: '震度速報', Destination: '震源情報', Foreign: '遠地地震', Other: 'その他' }
const clean = (value: string, max = 200) => escapeMarkdown(value.slice(0, max)).replaceAll('@', '＠').slice(0, max)

export function historyEmbed(result: HistoryResult, index: number, regional: boolean): EmbedBuilder {
    const magnitude = typeof result.magnitude === 'number' && result.magnitude >= 0 ? `M${result.magnitude}` : '規模不明'
    const depth = typeof result.depth === 'number' && result.depth >= 0 ? result.depth === 0 ? 'ごく浅い' : `${result.depth} km` : '深さ不明'
    const lines = [
        `発生: ${clean(result.time)}（日本時間）`,
        `全国の最大震度 **${intensityLabel(result.maxScale)}** ／ ${magnitude} ／ ${depth}`,
    ]
    if (regional) lines.push(`指定地域の最大震度 **${intensityLabel(result.localScale)}${result.localUncertain ? '以上（未確定）' : ''}**`)
    if (result.observations.length) lines.push(result.observations.map(p => clean(p, 160)).join('\n'))
    lines.push(`発表: ${clean(result.issued)} ／ ${types[result.type] ?? 'その他'}`)
    if (result.correction !== 'None') lines.push(result.correction === 'Unknown' ? '訂正の有無は不明' : '訂正情報（他の続報・訂正も確認してください）')
    return new EmbedBuilder().setTitle(`${index + 1}. ${clean(result.epicenter, 100)}`)
        .setColor(intensityEmbedColor(result.maxScale))
        .setDescription(lines.join('\n').slice(0, 850))
        .setFooter({ text: `過去の発表・速報値 | 受信 ${result.received} | ID ${result.id}`.slice(0, 160) })
}

export function renderHistory(search: HistorySearch, page: number, id: string, error?: string) {
    const query = search.query
    const regional = Boolean(query.region && query.regionType === 'observed')
    const from = page * PAGE_SIZE
    const visible = search.results.slice(from, from + PAGE_SIZE)
    const canContinue = !search.exhausted && !search.capped
    const moreCached = search.results.length > from + PAGE_SIZE
    const conditions = `${query.start}〜${query.end} 発生（日本時間）\n${query.region ? `${query.regionType === 'observed' ? '観測地域' : '震源名'}: ${clean(query.region, 80)}` : '全国'} ／ ${regional ? '指定地域' : '全国'}の最大震度: ${query.min === undefined ? '下限なし' : intensityLabel(query.min)}〜${query.max === undefined ? '上限なし' : intensityLabel(query.max)} ／ 受信日時の${query.order === 1 ? '古い順' : '新しい順'}`
    const status = search.capped
        ? 'この検索の上限（取得1万発表または抽出500発表）に達しました。日付で範囲を分けて検索してください。'
        : search.exhausted ? '指定した範囲の配信データの末尾まで確認しました。' : 'まだ未検索の履歴があります。「続きを検索」で進めます。'
    const count = visible.length ? `${page + 1}ページ目・${from + 1}〜${from + visible.length}件目（抽出済み${search.results.length}発表）` : 'ここまでに条件に合う発表は見つかっていません。'
    const content = [
        '**過去の地震発表履歴（詳細な震度情報のみ・現在の速報ではありません）**', conditions,
        `${count}\n取得済み ${search.scanned}発表。${status}`,
        search.lastScannedDate ? `直近に確認した発表の発生時刻: ${clean(search.lastScannedDate, 40)}` : '',
        error ? `⚠ ${clean(error, 250)}（未検索分は「次の5件」/「続きを検索」で再試行できます）` : '',
        '**速報値です。同じ地震の続報・訂正は別件で、古い値も含みます。確定した地震数や被害の判断には使わないでください。**',
        `出典: [P2P地震情報](https://www.p2pquake.net/secondary_use/)・[気象庁](https://www.jma.go.jp/jma/kishou/info/coment.html)（検索・表示を加工）。2015年以前・精査された観測値は[気象庁の震度データベース](${JMA_DATABASE})へ。`,
        '操作は実行者本人のみ・開始から10分間。検索中の追加・修正によりページ境界が変わる場合があります。',
    ].filter(Boolean).join('\n\n')
    const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`eqh:${id}:prev`).setLabel('前の5件').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`eqh:${id}:next`).setLabel(moreCached ? '次の5件' : '続きを検索').setStyle(ButtonStyle.Primary).setDisabled(!moreCached && !canContinue),
    )]
    return { content, embeds: visible.map((result, i) => historyEmbed(result, from + i, regional)), components, allowedMentions: { parse: [] as never[] } }
}

export async function advanceHistoryPage(search: HistorySearch, page: number): Promise<number> {
    // A partially filled page must first show newly discovered items, rather
    // than jumping past them when the next API batch arrives.
    const nextPage = search.results.length >= (page + 1) * PAGE_SIZE ? page + 1 : page
    await search.loadMore((nextPage + 1) * PAGE_SIZE)
    return search.results.length > nextPage * PAGE_SIZE ? nextPage : page
}

function pruneSessions() {
    for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id)
}
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const query: HistoryQuery = {
        start: interaction.options.getString('start') ?? HISTORY_START,
        end: interaction.options.getString('end') ?? todayJst(),
        region: interaction.options.getString('region') ?? undefined,
        regionType: (interaction.options.getString('region_type') ?? 'observed') as HistoryQuery['regionType'],
        min: interaction.options.getInteger('min_intensity') ?? undefined,
        max: interaction.options.getInteger('max_intensity') ?? undefined,
        order: (interaction.options.getInteger('order') ?? -1) as HistoryQuery['order'],
    }
    try { validateHistoryQuery(query) } catch (error) {
        await interaction.reply({ content: (error as Error).message, ephemeral: true, allowedMentions: { parse: [] } }); return
    }
    pruneSessions()
    for (const session of sessions.values()) if (session.owner === interaction.user.id && session.busy) {
        await interaction.reply({ content: '前の履歴検索を取得中です。完了してから再実行してください。', ephemeral: true }); return
    }
    for (const [id, session] of sessions) if (session.owner === interaction.user.id) sessions.delete(id)
    if (sessions.size >= 25) {
        await interaction.reply({ content: '履歴検索が混み合っています。数分待って再実行してください。', ephemeral: true }); return
    }
    await interaction.deferReply({ ephemeral: true })
    const session = { owner: interaction.user.id, expires: Date.now() + SESSION_MS, search: new HistorySearch(query, service), page: 0, busy: true }
    sessions.set(interaction.id, session)
    let error: string | undefined
    try { await session.search.loadMore(PAGE_SIZE) } catch (cause) { console.error('地震履歴取得エラー:', cause); error = cause instanceof Error ? cause.message : '履歴の取得に失敗しました。' }
    finally { session.busy = false }
    await interaction.editReply(renderHistory(session.search, 0, interaction.id, error))
}

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
    const [, id, action] = interaction.customId.split(':')
    pruneSessions()
    const session = sessions.get(id)
    if (!session || !['prev', 'next'].includes(action)) {
        await interaction.reply({ content: 'この検索は終了しました。/eq_history で同じ条件を指定して再検索してください。', ephemeral: true }); return
    }
    if (session.owner !== interaction.user.id) {
        await interaction.reply({ content: 'この操作は検索した本人だけが使えます。/eq_history で検索してください。', ephemeral: true }); return
    }
    if (session.busy) {
        await interaction.reply({ content: '履歴を取得中です。少しお待ちください。', ephemeral: true }); return
    }
    session.busy = true
    try {
        await interaction.deferUpdate()
        let error: string | undefined
        if (action === 'prev') session.page = Math.max(0, session.page - 1)
        else {
            try { session.page = await advanceHistoryPage(session.search, session.page) } catch (cause) { console.error('地震履歴追加取得エラー:', cause); error = cause instanceof Error ? cause.message : '履歴の取得に失敗しました。' }
        }
        await interaction.editReply(renderHistory(session.search, session.page, id, error))
    } finally { session.busy = false }
}
