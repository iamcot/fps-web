// K.6: đối chiếu asset trong client/public với assets/CREDITS.json và sinh CREDITS.txt
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const UNVERIFIED = 'CHƯA XÁC MINH'

// File chỉ phục vụ dev, không phải asset của bên thứ ba cần ghi công
const IGNORE = new Set(['viewer.html'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export function listPublicAssets(root) {
  const pub = join(root, 'client', 'public')
  return walk(pub).map(p => relative(pub, p).split(sep).join('/')).filter(f => !IGNORE.has(f)).sort()
}

/** @returns {{ entries: any[], missing: string[], stale: string[], unverified: string[] }} */
export function checkCredits(root) {
  const entries = JSON.parse(readFileSync(join(root, 'assets', 'CREDITS.json'), 'utf8'))
  const declared = new Set(entries.map(e => e.file))
  const files = listPublicAssets(root)
  const present = new Set(files)
  return {
    entries,
    missing: files.filter(f => !declared.has(f)),
    stale: [...declared].filter(f => !present.has(f)),
    unverified: entries.filter(e => !e.license || e.license.includes(UNVERIFIED) || !e.author || e.author.includes(UNVERIFIED)).map(e => e.file),
  }
}

export function creditsText(entries, version) {
  const lines = [`FPS WEB ${version} – GHI CÔNG TÁC GIẢ`, '', 'Các tài nguyên (model, âm thanh, hình ảnh) bên thứ ba dùng trong game:', '']
  for (const e of entries) {
    lines.push(`- ${e.file}`)
    lines.push(`    Tác giả:   ${e.author}`)
    lines.push(`    Nguồn:     ${e.source}${e.url ? ` (${e.url})` : ''}`)
    lines.push(`    Giấy phép: ${e.license}`)
  }
  return lines.join('\n') + '\n'
}
