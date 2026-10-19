import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { TICK_RATE, MsgType } from '@fps/shared'
import { wrapWebSocket } from './transport'

const PORT = 8081

const server = createServer((_req, res) => {
  res.writeHead(200)
  res.end(`FPS Server tick=${TICK_RATE}`)
})

const wss = new WebSocketServer({ server })

wss.on('connection', ws => {
  const transport = wrapWebSocket(ws)
  transport.onMessage(msg => {
    if (msg.t === MsgType.Ping) {
      // serverTime = ms kể từ lúc server khởi động
      transport.send({ t: MsgType.Pong, clientTime: msg.clientTime, serverTime: performance.now() })
    }
  })
})

server.listen(PORT, () => {
  console.log(`listening ${PORT}`)
})
