"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.intensityEmbedColor = intensityEmbedColor;
/** Hues follow the bundled nc300*.jpg intensity thumbnails, not an NHK standard.
 * Strong variants are darker; markers also carry numbers and +/- signs.
 */
const COLORS = {
    10: 0x54c0ff,
    20: 0x9ef371,
    30: 0xe9dd89,
    40: 0xfb7327,
    45: 0xb40d21,
    50: 0x8f0a1a,
    55: 0xfdcddd,
    60: 0xee9abd,
    70: 0xb40d22,
};
const JMA_SCALES = {
    '1': 10, '2': 20, '3': 30, '4': 40,
    '5-': 45, '5+': 50, '6-': 55, '6+': 60, '7': 70,
    '5弱': 45, '5強': 50, '6弱': 55, '6強': 60,
};
/** Accepts a P2P intensity code or JMA label; unknown/invalid values stay gray. */
function intensityEmbedColor(scale) {
    const rank = typeof scale === 'string' ? JMA_SCALES[scale] : scale;
    return (rank !== undefined && Object.hasOwn(COLORS, rank)) ? COLORS[rank] : 0x808080;
}
