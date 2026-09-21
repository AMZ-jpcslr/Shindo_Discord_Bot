import fs from 'fs'
import path from 'path'

// Independent of ts-node / compiled code location. Mount this directory on Railway.
export function dataDir(): string {
    return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'))
}

export function readJson<T>(name: string, fallback: T): T {
    const file = path.join(dataDir(), name)
    if (!fs.existsSync(file)) return fallback
    // Never overwrite damaged configuration with an empty default.
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

export function writeJson(name: string, value: unknown): void {
    fs.mkdirSync(dataDir(), { recursive: true })
    const file = path.join(dataDir(), name)
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(`${file}.tmp`, file)
}
