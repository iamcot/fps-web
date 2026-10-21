import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

// Bản đóng gói: esbuild thay process.env.APP_VERSION bằng version trong package.json gốc (scripts/bundle-server.mjs).
// Chạy dev: tìm package.json gốc (có "workspaces") từ thư mục hiện tại đi lên — `npm -w server` chạy với cwd = server/.
function devVersion(): string {
  try {
    for (let dir = process.cwd(); ; dir = dirname(dir)) {
      const file = join(dir, 'package.json')
      if (existsSync(file)) {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: string; workspaces?: unknown }
        if (pkg.workspaces) return String(pkg.version ?? '0.0.0')
      }
      if (dirname(dir) === dir) break
    }
  } catch { /* rơi xuống mặc định */ }
  return '0.0.0'
}

export const APP_VERSION: string = process.env.APP_VERSION ?? devVersion()
