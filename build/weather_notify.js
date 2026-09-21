"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadWeather = loadWeather;
exports.saveWeather = saveWeather;
exports.weatherState = weatherState;
exports.pollWeather = pollWeather;
exports.startWeatherNotify = startWeatherNotify;
const storage_1 = require("./storage");
const weather_1 = require("./weather");
function loadWeather() { return (0, storage_1.readJson)('weather.json', {}); }
function saveWeather(config) { (0, storage_1.writeJson)('weather.json', config); }
function weatherState() { return (0, storage_1.readJson)('weather-state.json', {}); }
async function pollWeather(send, providers = { warnings: weather_1.getWarningReports, rain: weather_1.getRain }, now = Date.now()) {
    const config = loadWeather();
    const states = weatherState();
    const warningCache = new Map();
    const rainCache = new Map();
    for (const [guild, subscriptions] of Object.entries(config)) {
        for (const [code, sub] of Object.entries(subscriptions)) {
            const key = `${guild}:${code}`;
            const state = states[key]?.revision === sub.revision ? states[key] : { revision: sub.revision };
            states[key] = state;
            const errors = [];
            // Re-check after network awaits so deleted/replaced subscriptions do not send.
            const current = () => loadWeather()[guild]?.[code]?.revision === sub.revision;
            if (sub.warnings) {
                try {
                    if (!warningCache.has(sub.region.office))
                        warningCache.set(sub.region.office, providers.warnings(sub.region.office));
                    const snapshot = (0, weather_1.parseWarnings)(await warningCache.get(sub.region.office), code, sub.advisories);
                    if (!current())
                        continue;
                    if (JSON.stringify(state.codes) !== JSON.stringify(snapshot.codes) && (state.codes !== undefined || snapshot.codes.length)) {
                        await send(guild, sub.channel, (0, weather_1.warningEmbed)(sub.region, snapshot, state.codes));
                    }
                    state.codes = snapshot.codes;
                    state.warningChecked = now;
                }
                catch (error) {
                    errors.push(`警報: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (sub.rain && (!state.rainChecked || now - state.rainChecked >= 15 * 60_000)) {
                try {
                    if (!rainCache.has(code))
                        rainCache.set(code, providers.rain(sub.region));
                    const event = (0, weather_1.upcomingRain)(await rainCache.get(code), sub.threshold, now);
                    if (!current())
                        continue;
                    if (event && event.time !== state.rainTime && (!state.lastRainSent || now - state.lastRainSent >= 3 * 3600_000)) {
                        await send(guild, sub.channel, (0, weather_1.rainEmbed)(sub.region, event));
                        state.rainTime = event.time;
                        state.lastRainSent = now;
                    }
                    state.rainChecked = now;
                }
                catch (error) {
                    errors.push(`降水: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            state.error = errors.length ? errors.join(' / ').slice(0, 300) : undefined;
            if (state.error)
                console.error(`気象通知 ${key}: ${state.error}`);
            (0, storage_1.writeJson)('weather-state.json', states);
        }
    }
    const current = loadWeather();
    for (const key of Object.keys(states)) {
        const [guild, code] = key.split(':');
        if (!current[guild]?.[code])
            delete states[key];
    }
    (0, storage_1.writeJson)('weather-state.json', states);
}
function startWeatherNotify(client) {
    const send = async (guildId, channelId, embed) => {
        const guild = client.guilds.cache.get(guildId);
        if (!guild)
            throw new Error('サーバーに接続できません');
        const channel = await guild.channels.fetch(channelId);
        if (!channel?.isTextBased() || !('send' in channel))
            throw new Error('通知先を確認してください');
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    };
    const tick = async () => {
        try {
            await pollWeather(send);
        }
        catch (error) {
            console.error('気象監視エラー:', error);
        }
        setTimeout(tick, 60_000).unref();
    };
    void tick();
}
