import { createServer } from 'http'
import { TICK_RATE } from '@fps/shared'

const PORT = 8081

const server = createServer((_req, res) => {
  res.writeHead(200)
  res.end(`FPS Server tick=${TICK_RATE}`)
})

server.listen(PORT, () => {
  console.log(`listening ${PORT}`)
})
