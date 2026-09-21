"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataDir = dataDir;
exports.readJson = readJson;
exports.writeJson = writeJson;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Independent of ts-node / compiled code location. Mount this directory on Railway.
function dataDir() {
    return path_1.default.resolve(process.env.DATA_DIR || path_1.default.join(process.cwd(), 'data'));
}
function readJson(name, fallback) {
    const file = path_1.default.join(dataDir(), name);
    if (!fs_1.default.existsSync(file))
        return fallback;
    // Never overwrite damaged configuration with an empty default.
    return JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
}
function writeJson(name, value) {
    fs_1.default.mkdirSync(dataDir(), { recursive: true });
    const file = path_1.default.join(dataDir(), name);
    fs_1.default.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), 'utf8');
    fs_1.default.renameSync(`${file}.tmp`, file);
}
