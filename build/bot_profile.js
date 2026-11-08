"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProfileDescription = buildProfileDescription;
exports.profileStatus = profileStatus;
exports.updateBotProfile = updateBotProfile;
exports.publishBotProfile = publishBotProfile;
const release_1 = require("./release");
const BEGIN = '【Botの更新情報】';
const END = '【更新情報ここまで】';
const MAX_DESCRIPTION = 400;
let status = { state: 'pending', message: '起動時のプロフィール更新を確認中です。' };
let inflight;
class ProfileFormatError extends Error {
}
function buildProfileDescription(current) {
    const block = [
        BEGIN,
        `最終起動版 v${release_1.RELEASE.version}（${release_1.RELEASE.date}リリース）`,
        ...release_1.RELEASE.changes.map(change => `・${change}`),
        '稼働中の版と起動時刻は /version で確認',
        END,
    ].join('\n');
    const first = current.indexOf(BEGIN);
    const last = current.indexOf(END);
    if ((first === -1) !== (last === -1) || (first !== -1 && (last < first || current.indexOf(BEGIN, first + BEGIN.length) !== -1 || current.indexOf(END, last + END.length) !== -1))) {
        throw new ProfileFormatError('既存プロフィールの更新欄が途中で編集されています。Developer Portalの説明欄を確認してください。');
    }
    const description = first === -1
        ? [current.trim() || '地震・津波・地域の気象情報をお知らせします。', block].join('\n\n')
        : `${current.slice(0, first)}${block}${current.slice(last + END.length)}`;
    // Use UTF-16 length conservatively (astral symbols count as two).
    // Do not delete a user's existing description to fit the API limit.
    if (description.length > MAX_DESCRIPTION)
        throw new ProfileFormatError('既存の説明と更新内容を合わせると400文字を超えます。Developer Portalの説明欄を短くして再起動してください。');
    return description;
}
function profileStatus() { return { ...status }; }
async function updateBotProfile(application, enabled = true) {
    if (!enabled)
        return { state: 'disabled', message: 'BOT_PROFILE_UPDATE=false のためプロフィール自動更新はOFFです。', checkedAt: new Date() };
    try {
        if (!application)
            throw new ProfileFormatError('Discordのアプリ情報を取得できません。次の起動時に再試行します。');
        const current = await application.fetch();
        const description = buildProfileDescription(current.description || '');
        if (current.description !== description) {
            // Only the public description changes. discord.js handles Discord's
            // route limits/Retry-After; never refresh this on a periodic timer.
            const updated = await application.edit({ description });
            if (updated.description !== description)
                throw new ProfileFormatError('Discordの更新応答で内容を確認できませんでした。プロフィールを直接確認してください。');
        }
        return { state: 'synced', message: 'Discord APIでプロフィール内容を確認済みです。アプリの表示反映には時間がかかる場合があります。', checkedAt: new Date() };
    }
    catch (error) {
        const httpStatus = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
        const message = error instanceof ProfileFormatError ? error.message
            : httpStatus === 401 || httpStatus === 403 ? 'Discordがプロフィール更新を拒否しました。Botの認証・アプリ権限を確認してください。'
                : 'プロフィールを更新・確認できませんでした。次の起動時に再試行します。稼働版はこの /version の表示を確認してください。';
        // Do not include arbitrary API error bodies, headers, or environment values.
        return { state: 'failed', message, checkedAt: new Date() };
    }
}
function publishBotProfile(application, enabled = true) {
    if (inflight)
        return inflight;
    status = { state: 'pending', message: '起動時のプロフィール更新を確認中です。' };
    inflight = updateBotProfile(application, enabled).then(result => { status = result; return result; }).finally(() => { inflight = undefined; });
    return inflight;
}
