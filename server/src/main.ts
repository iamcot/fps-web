import { createServer } from 'http'
import { readFileSync } from 'fs'
import { WebSocketServer } from 'ws'
import { TICK_RATE, MsgType, loadMap, type MapFile } from '@fps/shared'
import { wrapWebSocket } from './transport'
import { RoomManager, sanitizeName, sanitizeRoom, type Player, type Room } from './room'

const PORT = 8081

const mapFile = JSON.parse(
  readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8'),
) as MapFile
const rooms = new RoomManager(loadMap(mapFile))
setInterval(() => rooms.sweep(), 5000)

const server = createServer((_req, res) => {
  res.writeHead(200)
  res.end(`FPS Server tick=${TICK_RATE} rooms=${rooms.rooms.size}`)
})

const wss = new WebSocketServer({ server })

wss.on('connection', ws => {
  const transport = wrapWebSocket(ws)
  let room: Room | null = null
  let player: Player | null = null

  transport.onMessage(msg => {
    if (msg.t === MsgType.Ping) {
      // serverTime = ms kể từ lúc server khởi động
      transport.send({ t: MsgType.Pong, clientTime: msg.clientTime, serverTime: performance.now() })
    } else if (msg.t === MsgType.Join) {
      if (player) return   // mỗi kết nối chỉ join một lần
      const name = sanitizeName(msg.name)
      const roomId = sanitizeRoom(msg.room)
      if (!name || !roomId) return
      ;({ room, player } = rooms.join(roomId, name, transport))
      console.log(`[room ${roomId}] #${player.id} "${name}" vào (${room.players.size} người)`)
    }
  })

  transport.onClose(() => {
    if (!room || !player) return
    room.leave(player.id)
    console.log(`[room ${room.id}] #${player.id} "${player.name}" rời (${room.players.size} người)`)
  })
})

server.listen(PORT, () => {
  console.log(`listening ${PORT}`)
})
