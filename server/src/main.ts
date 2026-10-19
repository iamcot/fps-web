import { createServer } from 'http'
import { readFileSync } from 'fs'
import { WebSocketServer } from 'ws'
import { TICK_RATE, MsgType, isCharacterSet, DEFAULT_CHARACTER_SET, MatchPhase, MATCH, loadMap, defaultMovement, type MapFile } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { wrapWebSocket } from './transport'
import { startHeartbeat } from './heartbeat'
import { TickLoop } from './tickLoop'
import { enqueueCmds, stepRoom, sendSnapshots } from './simulation'
import { lanAddresses } from './lan'
import { handleBuy } from './shop'
import { RoomManager, sanitizeName, sanitizeRoom, type Player, type Room } from './room'

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
const rooms = new RoomManager(map, undefined, rules)
setInterval(() => rooms.sweep(), 5000)

// Vòng lặp 60Hz: mô phỏng rồi gửi snapshot (mỗi SNAPSHOT_EVERY_TICKS tick)
let ticksThisWindow = 0
const loop = new TickLoop(() => performance.now(), (tick, serverTime) => {
  for (const room of rooms.rooms.values()) {
    stepRoom(room, cfg, serverTime)
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

wss.on('connection', ws => {
  const transport = wrapWebSocket(ws)
  let room: Room | null = null
  let player: Player | null = null

  transport.onMessage(msg => {
    if (msg.t === MsgType.Ping) {
      // serverTime = ms kể từ lúc server khởi động
      transport.send({ t: MsgType.Pong, clientTime: msg.clientTime, serverTime: performance.now() })
      if (player && typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) player.pingMs = Math.min(999, Math.max(0, msg.rtt))
    } else if (msg.t === MsgType.Inputs) {
      if (player) enqueueCmds(player, msg.cmds)
    } else if (msg.t === MsgType.SetDebug) {
      if (player) player.debugShots = msg.shots === true
    } else if (msg.t === MsgType.Buy) {
      if (room && player && typeof msg.key === 'string') handleBuy(room, player, msg.key)
    } else if (msg.t === MsgType.ChooseTeam) {
      // Chỉ đổi đội khi chưa vào trận (WAITING); còn lại giữ đội hiện tại
      if (!room || !player) return
      const pref = msg.team === 'A' || msg.team === 'B' ? msg.team : 'auto'
      const team = room.phase === MatchPhase.Waiting ? room.assignTeam(pref, player) : null
      if (team && team !== player.team) { room.setTeam(player, team); room.resetEconomy(player); room.respawn(player) }
      else transport.send({ t: MsgType.TeamAssigned, id: player.id, team: player.team })
    } else if (msg.t === MsgType.Join) {
      if (player) return   // mỗi kết nối chỉ join một lần
      const name = sanitizeName(msg.name)
      const roomId = sanitizeRoom(msg.room)
      if (!name || !roomId) return
      const pref = msg.team === 'A' || msg.team === 'B' ? msg.team : 'auto'
      const res = rooms.tryJoin(roomId, name, transport, loop.tick, pref, isCharacterSet(msg.characterSet) ? msg.characterSet : DEFAULT_CHARACTER_SET)
      if (!res) { console.log(`${stamp()} [room ${roomId}] "${name}" bị từ chối: phòng đầy`); ws.close(1008, 'room full'); return }
      ;({ room, player } = res)
      const joined = player
      createWorld(map, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(w => {
        // Người chơi có thể đã rời trước khi world nạp xong
        if (room?.players.has(joined.id)) joined.world = w
        else w.dispose()
      })
      console.log(`${stamp()} [room ${roomId}] #${player.id} "${name}" vào (${room.players.size} người)`)
    }
  })

  transport.onClose(() => {
    if (!room || !player) return
    room.leave(player.id)
    console.log(`${stamp()} [room ${room.id}] #${player.id} "${player.name}" rời (${room.players.size} người)`)
  })
})

// Rapier khởi tạo wasm ở lần createWorld đầu; nhiều createWorld đồng thời lúc nguội làm hỏng bộ nhớ
// ("recursive use of an object"). Khởi tạo xong rồi mới nhận kết nối.
createWorld(map, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(w => {
  w.dispose()
  server.listen(PORT, () => {
    console.log(`listening ${PORT} (mọi card mạng)`)
    for (const a of lanAddresses()) console.log(`  LAN ${a.iface}: ws://${a.address}:${PORT}   → máy khác mở http://${a.address}:5173`)
  })
})
