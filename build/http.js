"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWithTimeout = fetchWithTimeout;
exports.json = json;
function fetchWithTimeout(url) {
    return globalThis.fetch(url, { signal: AbortSignal.timeout(12_000) });
}
async function json(url) {
    const response = await fetchWithTimeout(url);
    if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
}
