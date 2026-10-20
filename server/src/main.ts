import { createServer } from 'http'
import { readFileSync, readdirSync } from 'fs'
import { WebSocketServer } from 'ws'
import { TICK_RATE, MATCH, loadMap, defaultMovement, type MapFile } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { wrapWebSocket } from './transport'
import { startHeartbeat } from './heartbeat'
import { TickLoop } from './tickLoop'
import { stepRoom, sendSnapshots } from './simulation'
import { lanAddresses } from './lan'
import { RoomManager } from './room'
import { handleConnection, type ServerContext } from './connection'

const PORT = 8081
const stamp = () => new Date().toTimeString().slice(0, 8)

const mapFile = JSON.parse(
  readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8'),
) as MapFile
const map = loadMap(mapFile)
const cfg = defaultMovement
// Biến môi trường để thử nhanh: FPS_MATCH_MS (thời lượng trận), FPS_KILL_LIMIT
const rules = { ...MATCH }
if (Number(process.env.FPS_MATCH_MS) > 0) rules.durationMs = Number(process.env.FPS_MATCH_MS)
if (Number(process.env.FPS_KILL_LIMIT) > 0) rules.killLimit = Number(process.env.FPS_KILL_LIMIT)
if (Number(process.env.FPS_END_MS) > 0) rules.endScreenMs = Number(process.env.FPS_END_MS)
const rooms = new RoomManager(map, undefined, rules, 'deathmatch')
// Mọi map trong assets/maps/*.json chọn được khi tạo phòng (client hiện chỉ dựng được map deathmatch — xem plan/PROGRESS)
for (const f of readdirSync(new URL('../../assets/maps/', import.meta.url))) {
  if (!f.endsWith('.json') || f === 'deathmatch.json') continue
  const mf = JSON.parse(readFileSync(new URL(`../../assets/maps/${f}`, import.meta.url), 'utf8')) as MapFile
  rooms.registerMap(f.slice(0, -5), mf.name, loadMap(mf))
}
setInterval(() => rooms.sweep(), 5000)

// Vòng lặp 60Hz: mô phỏng rồi gửi snapshot (mỗi SNAPSHOT_EVERY_TICKS tick)
let ticksThisWindow = 0
const loop = new TickLoop(() => performance.now(), (tick, serverTime) => {
  for (const room of rooms.rooms.values()) {
    stepRoom(room, cfg, serverTime, tick)
    sendSnapshots(room, tick, serverTime)
  }
  ticksThisWindow++
})
setInterval(() => loop.pump(), 1)

// Log tick/giây mỗi 10 giây khi có người chơi
let windowStart = performance.now()
setInterval(() => {
  const now = performance.now()
  let players = 0
  for (const r of rooms.rooms.values()) players += r.players.size
  if (players > 0) {
    console.log(`[tick] ${(ticksThisWindow * 1000 / (now - windowStart)).toFixed(1)}/s, bỏ ${loop.skipped}, ${players} người`)
  }
  ticksThisWindow = 0
  windowStart = now
}, 10_000)

const server = createServer((_req, res) => {
  res.writeHead(200)
  res.end(`FPS Server tick=${TICK_RATE} rooms=${rooms.rooms.size}`)
})

const wss = new WebSocketServer({ server })
startHeartbeat(wss)

const ctx: ServerContext = {
  rooms, cfg,
  tick: () => loop.tick,
  now: () => performance.now(),   // serverTime = ms kể từ lúc server khởi động
  allowDebugCmds: process.env.NODE_ENV !== 'production',
  log: text => console.log(`${stamp()} ${text}`),
}
wss.on('connection', ws => handleConnection(ctx, wrapWebSocket(ws)))

// Rapier khởi tạo wasm ở lần createWorld đầu; nhiều createWorld đồng thời lúc nguội làm hỏng bộ nhớ
// ("recursive use of an object"). Khởi tạo xong rồi mới nhận kết nối.
createWorld(map, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(w => {
  w.dispose()
  server.listen(PORT, () => {
    console.log(`listening ${PORT} (mọi card mạng)`)
    for (const a of lanAddresses()) console.log(`  LAN ${a.iface}: ws://${a.address}:${PORT}   → máy khác mở http://${a.address}:5173`)
  })
})
