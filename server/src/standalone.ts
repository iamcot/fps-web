// Server "một file" cho bản đóng gói (Node SEA): một cổng phục vụ cả trang game lẫn WebSocket (/ws).
// Dev vẫn dùng main.ts + Vite. Chạy thử: npm run build -w client && npx tsx server/src/standalone.ts
import { createServer, type Server } from 'http'
import { existsSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import type { AddressInfo } from 'net'
import { WebSocketServer } from 'ws'
import type { MapFile } from '@fps/shared'
import deathmatch from '../../assets/maps/deathmatch.json'
import { createGameServer } from './gameServer'
import { createStaticHandler } from './staticServer'
import { lanAddresses } from './lan'
import { APP_VERSION } from './version'

interface Config { port: number; openBrowser: boolean; maxRooms: number }
const DEFAULT_CONFIG: Config = { port: 8080, openBrowser: true, maxRooms: 20 }
const PORT_TRIES = 11   // port .. port+10

// `node:sea` có trong Node 20.12+; process.getBuiltinModule chạy được cả ESM (tsx) lẫn CJS (esbuild)
function isSea(): boolean {
  try {
    const sea = process.getBuiltinModule?.('node:sea') as { isSea(): boolean } | undefined
    return sea?.isSea() === true
  } catch { return false }
}

// Chờ Enter rồi mới thoát, để cửa sổ console không biến mất trước khi người dùng đọc kịp lỗi
async function fatal(message: string): Promise<never> {
  console.error('\n==============================================')
  console.error(' LỖI: ' + message)
  console.error('==============================================')
  if (process.stdin.isTTY) {
    console.error('\nNhấn Enter để thoát…')
    await new Promise<void>(r => { const rl = createInterface({ input: process.stdin }); rl.once('line', () => { rl.close(); r() }) })
  }
  process.exit(1)
}

function parseArgs(argv: string[]): { port?: number; noOpen: boolean } {
  const out: { port?: number; noOpen: boolean } = { noOpen: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-open') out.noOpen = true
    else if (argv[i] === '--port') {
      const n = Number(argv[++i])
      if (Number.isInteger(n) && n > 0 && n < 65536) out.port = n
      else throw new Error('--port cần một số từ 1 đến 65535')
    }
  }
  return out
}

function readConfig(dir: string): Config {
  const file = join(dir, 'config.json')
  if (!existsSync(file)) return { ...DEFAULT_CONFIG }
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>
    const port = Number(j.port), maxRooms = Number(j.maxRooms)
    return {
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_CONFIG.port,
      openBrowser: typeof j.openBrowser === 'boolean' ? j.openBrowser : DEFAULT_CONFIG.openBrowser,
      maxRooms: Number.isInteger(maxRooms) && maxRooms > 0 ? maxRooms : DEFAULT_CONFIG.maxRooms,
    }
  } catch {
    console.warn(`Cảnh báo: ${file} sai định dạng JSON, dùng cấu hình mặc định.`)
    return { ...DEFAULT_CONFIG }
  }
}

// SEA: game/ và config.json nằm cạnh file chạy. Dev (tsx / node build/server.cjs): FPS_GAME_DIR, game/ hoặc client/dist.
function locate(): { baseDir: string; gameDir: string | null } {
  if (isSea()) {
    const baseDir = dirname(process.execPath)
    return { baseDir, gameDir: join(baseDir, 'game') }
  }
  const script = process.argv[1] ? dirname(process.argv[1]) : process.cwd()
  const candidates = [process.env.FPS_GAME_DIR, join(process.cwd(), 'game'), join(process.cwd(), 'client', 'dist'), join(script, '..', '..', 'client', 'dist')]
  const gameDir = candidates.find((c): c is string => !!c && existsSync(join(c, 'index.html'))) ?? null
  return { baseDir: process.cwd(), gameDir }
}

function listenFrom(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (p: number, left: number): void => {
      const onError = (e: NodeJS.ErrnoException): void => {
        if (e.code === 'EADDRINUSE' && left > 1 && p < 65535) attempt(p + 1, left - 1)
        else reject(e)
      }
      server.once('error', onError)
      // Callback của listen() còn đăng ký lại sau lần thử thất bại → lấy cổng thật từ address(), không dùng p
      server.listen(p, '0.0.0.0', () => { server.off('error', onError); resolve((server.address() as AddressInfo).port) })
    }
    attempt(port, PORT_TRIES)
  })
}

function openBrowser(url: string): void {
  try {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true, windowsHide: true })
    child.on('error', () => { /* không mở được thì thôi, người dùng tự gõ địa chỉ */ })
    child.unref()
  } catch { /* bỏ qua */ }
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseArgs>
  try { args = parseArgs(process.argv.slice(2)) } catch (e) { return fatal((e as Error).message) }
  const { baseDir, gameDir } = locate()
  if (!gameDir || !existsSync(join(gameDir, 'index.html'))) {
    return fatal(`Không tìm thấy thư mục "game" (cần có game/index.html${gameDir ? ` tại ${gameDir}` : ''}).\nHãy giải nén đủ file zip và để thư mục "game" nằm cạnh file chạy.`)
  }
  const config = readConfig(baseDir)
  if (args.port) config.port = args.port
  if (args.noOpen) config.openBrowser = false

  const game = createGameServer({ maps: { deathmatch: deathmatch as unknown as MapFile }, allowDebugCmds: false, maxRooms: config.maxRooms, version: APP_VERSION })
  const server = createServer(createStaticHandler(gameDir))
  const wss = new WebSocketServer({ noServer: true })
  game.attach(wss)
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/ws' && !path?.startsWith('/ws/')) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  try { await game.ready } catch (e) { return fatal('Không khởi động được bộ máy vật lý: ' + (e as Error).message) }
  let port: number
  try { port = await listenFrom(server, config.port) } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return fatal(code === 'EADDRINUSE'
      ? `Các cổng ${config.port}–${config.port + PORT_TRIES - 1} đều đang bị chương trình khác dùng.\nThử đóng bản FPS Web khác đang chạy, hoặc đổi "port" trong config.json.`
      : `Không mở được cổng mạng: ${(e as Error).message}`)
  }

  const url = `http://localhost:${port}`
  const lan = lanAddresses()
  const line = '=============================================='
  console.log(line)
  console.log(` FPS Web v${APP_VERSION} đang chạy`)
  console.log(` Bạn chơi:        ${url}`)
  if (lan.length === 0) console.log(' Bạn bè cùng mạng: (không thấy địa chỉ mạng nào)')
  lan.forEach((a, i) => {
    const label = i === 0 ? ' Bạn bè cùng mạng: ' : '                     '
    console.log(`${label}http://${a.address}:${port}${lan.length > 1 ? `   (${a.iface})` : ''}`)
  })
  console.log(' Đóng cửa sổ này để tắt server.')
  console.log(line)
  if (port !== config.port) console.log(` (Cổng ${config.port} đang bận nên dùng cổng ${port})`)

  if (config.openBrowser) openBrowser(url)

  let closing = false
  const shutdown = (): void => {
    if (closing) return
    closing = true
    game.close()
    for (const ws of wss.clients) ws.terminate()
    wss.close()
    server.close(() => process.exit(0))
    server.closeAllConnections?.()
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGHUP', shutdown)
}

main().catch(e => fatal(String((e as Error)?.stack ?? e)))
