import { loadMap, MATCH, defaultMovement, type MapFile, type MatchRules } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { WebSocketServer } from 'ws'
import { buildNav } from './bots/nav'
import { wrapWebSocket } from './transport'
import { startHeartbeat } from './heartbeat'
import { TickLoop } from './tickLoop'
import { stepRoom, sendSnapshots } from './simulation'
import { RoomManager } from './room'
import { handleConnection, type ServerContext } from './connection'

const stamp = () => new Date().toTimeString().slice(0, 8)

export interface GameServerOptions {
  /** Map đầu tiên (id `deathmatch`) là mặc định; các map còn lại chọn được khi tạo phòng */
  maps: Record<string, MapFile>
  rules?: MatchRules
  allowDebugCmds: boolean
  maxRooms?: number
  /** Bắt buộc client cùng phiên bản (xem ServerContext.version) */
  version?: string
  /** Log tick/giây mỗi 10 giây khi có người chơi (server dev) */
  logTicks?: boolean
}

export interface GameServer {
  rooms: RoomManager
  /** Gắn WebSocketServer (noServer hoặc gắn thẳng vào HTTP server) */
  attach(wss: WebSocketServer): void
  /** Rapier khởi tạo wasm + dựng nav xong thì resolve; chỉ nhận kết nối sau đó */
  ready: Promise<void>
  close(): void
}

// Lõi server game dùng chung cho main.ts (dev) và standalone.ts (đóng gói): phòng, vòng lặp 60Hz, xử lý kết nối.
export function createGameServer(opts: GameServerOptions): GameServer {
  const cfg = defaultMovement
  const entries = Object.entries(opts.maps)
  const [defId, defFile] = entries.find(([id]) => id === 'deathmatch') ?? entries[0]!
  const rooms = new RoomManager(loadMap(defFile), undefined, opts.rules ?? { ...MATCH }, defId)
  if (opts.maxRooms) rooms.maxRooms = opts.maxRooms
  for (const [id, mf] of entries) if (id !== defId) rooms.registerMap(id, mf.name, loadMap(mf))
  const sweep = setInterval(() => rooms.sweep(), 5000)

  // Vòng lặp 60Hz: mô phỏng rồi gửi snapshot (mỗi SNAPSHOT_EVERY_TICKS tick)
  let ticksThisWindow = 0
  const loop = new TickLoop(() => performance.now(), (tick, serverTime) => {
    for (const room of rooms.rooms.values()) {
      stepRoom(room, cfg, serverTime, tick)
      sendSnapshots(room, tick, serverTime)
    }
    ticksThisWindow++
  })
  const pump = setInterval(() => loop.pump(), 1)

  let windowStart = performance.now()
  const tickLog = opts.logTicks ? setInterval(() => {
    const now = performance.now()
    let players = 0
    for (const r of rooms.rooms.values()) players += r.players.size
    if (players > 0) {
      console.log(`[tick] ${(ticksThisWindow * 1000 / (now - windowStart)).toFixed(1)}/s, bỏ ${loop.skipped}, ${players} người`)
    }
    ticksThisWindow = 0
    windowStart = now
  }, 10_000) : null

  const ctx: ServerContext = {
    rooms, cfg,
    tick: () => loop.tick,
    now: () => performance.now(),   // serverTime = ms kể từ lúc server khởi động
    allowDebugCmds: opts.allowDebugCmds,
    version: opts.version,
    log: text => console.log(`${stamp()} ${text}`),
  }
  let stopHeartbeat: (() => void) | null = null
  const attach = (wss: WebSocketServer): void => {
    stopHeartbeat = startHeartbeat(wss)
    wss.on('connection', ws => handleConnection(ctx, wrapWebSocket(ws)))
  }

  // Rapier khởi tạo wasm ở lần createWorld đầu; nhiều createWorld đồng thời lúc nguội làm hỏng bộ nhớ
  // ("recursive use of an object"). Khởi tạo xong rồi mới nhận kết nối.
  // NavGrid giữ world này để truy vấn đường đi (findPath → smooth → castRay) suốt đời server: KHÔNG dispose sớm, chỉ dispose ở close()
  let navWorld: CollisionWorld | null = null
  const ready = createWorld(rooms.maps.get(defId)!.map, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(w => {
    navWorld = w
    rooms.navs.set(defId, buildNav(w, rooms.maps.get(defId)!.map, cfg))   // zombie Thủ Thành + bot đi theo lưới này
  })

  return {
    rooms, attach, ready,
    close() {
      clearInterval(sweep); clearInterval(pump); if (tickLog) clearInterval(tickLog)
      stopHeartbeat?.()
      navWorld?.dispose(); navWorld = null
    },
  }
}
