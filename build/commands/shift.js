"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_PATH = path_1.default.join(__dirname, '../../data/shifts.json');
function loadShifts() {
    if (!fs_1.default.existsSync(DATA_PATH))
        return {};
    return JSON.parse(fs_1.default.readFileSync(DATA_PATH, 'utf8'));
}
function saveShifts(data) {
    fs_1.default.mkdirSync(path_1.default.dirname(DATA_PATH), { recursive: true });
    fs_1.default.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName('shift')
    .setDescription('シフト管理コマンド')
    .addSubcommand(sub => sub.setName('add')
    .setDescription('シフトを登録')
    .addStringOption(opt => opt.setName('date')
    .setDescription('日付 (YYYY-MM-DD)')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10))
    .addStringOption(opt => opt.setName('start')
    .setDescription('開始時刻 (例: 09:00)')
    .setRequired(true))
    .addStringOption(opt => opt.setName('end')
    .setDescription('終了時刻 (例: 18:00)')
    .setRequired(true)))
    .addSubcommand(sub => sub.setName('show')
    .setDescription('指定した月のシフトをカレンダー形式で表示')
    .addIntegerOption(opt => opt.setName('year')
    .setDescription('年 (例: 2025)')
    .setRequired(true)
    .setMinValue(2000)
    .setMaxValue(2100))
    .addIntegerOption(opt => opt.setName('month')
    .setDescription('月 (1-12)')
    .setRequired(true)
    .setMinValue(1)
    .setMaxValue(12)))
    .addSubcommand(sub => sub.setName('delete')
    .setDescription('指定した日付のシフトを削除')
    .addStringOption(opt => opt.setName('date')
    .setDescription('削除する日付 (YYYY-MM-DD)')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10)))
    .addSubcommand(sub => sub.setName('edit')
    .setDescription('指定した日付のシフトを編集')
    .addStringOption(opt => opt.setName('date')
    .setDescription('編集する日付 (YYYY-MM-DD)')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(10))
    .addStringOption(opt => opt.setName('start')
    .setDescription('新しい開始時刻 (例: 10:00)')
    .setRequired(true))
    .addStringOption(opt => opt.setName('end')
    .setDescription('新しい終了時刻 (例: 19:00)')
    .setRequired(true)))
    .addSubcommand(sub => sub.setName('show_detail')
    .setDescription('指定した月のシフト詳細を一覧表示')
    .addIntegerOption(opt => opt.setName('year')
    .setDescription('年 (例: 2025)')
    .setRequired(true)
    .setMinValue(2000)
    .setMaxValue(2100))
    .addIntegerOption(opt => opt.setName('month')
    .setDescription('月 (1-12)')
    .setRequired(true)
    .setMinValue(1)
    .setMaxValue(12)));
function getMonthCalendar(year, month) {
    // 1日から月末までの日付を週ごとに2次元配列で返す
    const weeks = [];
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let week = [];
    // 1日目の曜日まで空欄
    for (let i = 0; i < firstDay.getDay(); i++)
        week.push('');
    for (let d = 1; d <= lastDay.getDate(); d++) {
        week.push(String(d));
        if (week.length === 7) {
            weeks.push(week);
            week = [];
        }
    }
    // 最終週の残りを空欄で埋める
    if (week.length > 0) {
        while (week.length < 7)
            week.push('');
        weeks.push(week);
    }
    return weeks;
}
async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const shifts = loadShifts();
    if (sub === 'add') {
        const date = interaction.options.getString('date', true);
        const start = interaction.options.getString('start', true);
        const end = interaction.options.getString('end', true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            await interaction.reply('日付はYYYY-MM-DD形式で入力してください。');
            return;
        }
        if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
            await interaction.reply('開始時刻・終了時刻はHH:MM形式で入力してください。');
            return;
        }
        if (!shifts[userId])
            shifts[userId] = {};
        shifts[userId][date] = `${start} - ${end}`;
        saveShifts(shifts);
        await interaction.reply(`✅ ${date} のシフト「${start} - ${end}」を登録しました。`);
    }
    else if (sub === 'show') {
        const year = interaction.options.getInteger('year', true);
        const month = interaction.options.getInteger('month', true);
        const userShifts = shifts[userId];
        if (!userShifts || Object.keys(userShifts).length === 0) {
            await interaction.reply('登録されたシフトがありません。');
            return;
        }
        // 英語表記の曜日に変更
        const weekLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const cellWidth = 4; // [07] で3文字
        const padCell = (s) => s.padEnd(cellWidth, ' ');
        const weeks = getMonthCalendar(year, month);
        // ヘッダー
        let calendar = '|' + weekLabels.map(w => padCell(w)).join('|') + '|\n';
        calendar += '|' + weekLabels.map(() => '-'.repeat(cellWidth)).join('|') + '|\n';
        // 各週
        for (const week of weeks) {
            calendar += '|';
            for (let i = 0; i < 7; i++) {
                const day = week[i];
                let cell = '';
                if (day) {
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    // シフトがある日は角括弧で囲む
                    cell = userShifts[dateStr]
                        ? `[${day.toString().padStart(2, '0')}]`
                        : `${day.toString().padStart(2, '0')}`;
                }
                else {
                    cell = ' '.repeat(cellWidth);
                }
                calendar += padCell(cell) + '|';
            }
            calendar += '\n';
        }
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Shift for ${year}/${month}`)
            .setDescription('```' + calendar + '```\n[date]: シフトが登録されています\n`/shift show_detail` コマンドで詳細を表示できます。')
            .setColor(0x00bfff);
        await interaction.reply({ embeds: [embed] });
    }
    else if (sub === 'show_detail') {
        // シフト詳細表示
        const year = interaction.options.getInteger('year', true);
        const month = interaction.options.getInteger('month', true);
        const userShifts = shifts[userId];
        if (!userShifts || Object.keys(userShifts).length === 0) {
            await interaction.reply('登録されたシフトがありません。');
            return;
        }
        let details = '';
        for (let d = 1; d <= 31; d++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (userShifts[dateStr]) {
                details += `${dateStr}: ${userShifts[dateStr]}\n`;
            }
        }
        if (!details)
            details = 'この月に登録されたシフトはありません。';
        const embed = new discord_js_1.EmbedBuilder()
            .setTitle(`${interaction.user.username}の ${year}/${month} のシフト詳細`)
            .setDescription('```' + details + '```')
            .setColor(0x00bfff);
        await interaction.reply({ embeds: [embed] });
    }
    else if (sub === 'delete') {
        const date = interaction.options.getString('date', true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            await interaction.reply('日付はYYYY-MM-DD形式で入力してください。');
            return;
        }
        if (!shifts[userId] || !shifts[userId][date]) {
            await interaction.reply(`指定した日付（${date}）のシフトは登録されていません。`);
            return;
        }
        delete shifts[userId][date];
        saveShifts(shifts);
        await interaction.reply(`🗑️ ${date} のシフトを削除しました。`);
    }
    else if (sub === 'edit') {
        const date = interaction.options.getString('date', true);
        const start = interaction.options.getString('start', true);
        const end = interaction.options.getString('end', true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            await interaction.reply('日付はYYYY-MM-DD形式で入力してください。');
            return;
        }
        if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
            await interaction.reply('開始時刻・終了時刻はHH:MM形式で入力してください。');
            return;
        }
        if (!shifts[userId] || !shifts[userId][date]) {
            await interaction.reply(`指定した日付（${date}）のシフトは登録されていません。`);
            return;
        }
        shifts[userId][date] = `${start} - ${end}`;
        saveShifts(shifts);
        await interaction.reply(`✏️ ${date} のシフトを「${start} - ${end}」に編集しました。`);
    }
}
