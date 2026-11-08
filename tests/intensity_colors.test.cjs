const { test } = require('node:test')
const assert = require('node:assert/strict')
const { intensityEmbedColor } = require('../build/intensity_colors')

const cases = [
    [10, '1', 0x54c0ff], [20, '2', 0x9ef371], [30, '3', 0xe9dd89],
    [40, '4', 0xfb7327], [45, '5-', 0xb40d21], [50, '5+', 0x8f0a1a],
    [55, '6-', 0xfdcddd], [60, '6+', 0xee9abd], [70, '7', 0xb40d22],
]

test('each intensity has the same distinct color for P2P and JMA reports', () => {
    for (const [code, label, color] of cases) {
        assert.equal(intensityEmbedColor(code), color)
        assert.equal(intensityEmbedColor(label), color)
    }
    assert.equal(new Set(cases.map(([code]) => intensityEmbedColor(code))).size, 9)
    for (const [label, code] of [['5弱',45],['5強',50],['6弱',55],['6強',60]]) {
        assert.equal(intensityEmbedColor(label), intensityEmbedColor(code))
    }
})

test('unknown, missing and invalid intensities use neutral gray', () => {
    for (const scale of [undefined, null, 0, -1, 99, NaN, Infinity, '', '-1', '不明', '8', 'toString', '__proto__']) {
        assert.equal(intensityEmbedColor(scale), 0x808080)
    }
})
