"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeStartedAt = exports.RELEASE = void 0;
exports.runtimeRevision = runtimeRevision;
exports.releasePresence = releasePresence;
/** Metadata bundled with this build. Do not read GitHub's latest branch at runtime. */
exports.RELEASE = {
    version: '1.1.0',
    date: '2026-11-08',
    changes: [
        '地震履歴検索（2015年以降・地域／震度／発生日で絞り込み）',
        '震度別の埋め込み色・地図配色と数字／±マーカー',
        'プロフィールの更新内容表示と /version',
    ],
};
exports.runtimeStartedAt = new Date();
/** Only a validated Git object ID may be shown, never arbitrary environment text. */
function runtimeRevision(env = process.env) {
    const revision = env.RAILWAY_GIT_COMMIT_SHA;
    return revision && /^[a-f\d]{40}$/i.test(revision) ? revision.toLowerCase() : undefined;
}
function releasePresence() {
    return `v${exports.RELEASE.version} | 地震・津波・気象情報 | /version`;
}
