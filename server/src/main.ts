import { createServer } from 'http'
import { readFileSync } from 'fs'
import { WebSocketServer } from 'ws'
import { TICK_RATE, MsgType, loadMap, defaultMovement, type MapFile } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { wrapWebSocket } from './transport'
import { startHeartbeat } from './heartbeat'
import { TickLoop } from './tickLoop'
import { enqueueCmds, stepRoom, sendSnapshots } from './simulation'
import { RoomManager, sanitizeName, sanitizeRoom, type Player, type Room } from './room'

const PORT = 8081
const stamp = () => new Date().toTimeString().slice(0, 8)

const mapFile = JSON.parse(
  readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8'),
) as MapFile
const map = loadMap(mapFile)
const cfg = defaultMovement
const rooms = new RoomManager(map)
setInterval(() => rooms.sweep(), 5000)

// Vòng lặp 60Hz: mô phỏng rồi gửi snapshot (mỗi SNAPSHOT_EVERY_TICKS tick)
let ticksThisWindow = 0
const loop = new TickLoop(() => performance.now(), (tick, serverTime) => {
  for (const room of rooms.rooms.values()) {
    stepRoom(room, cfg)
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
    } else if (msg.t === MsgType.Inputs) {
      if (player) enqueueCmds(player, msg.cmds)
    } else if (msg.t === MsgType.Join) {
      if (player) return   // mỗi kết nối chỉ join một lần
      const name = sanitizeName(msg.name)
      const roomId = sanitizeRoom(msg.room)
      if (!name || !roomId) return
      ;({ room, player } = rooms.join(roomId, name, transport, loop.tick))
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
    console.log(`listening ${PORT}`)
  })
})
