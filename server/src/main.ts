import { createServer } from 'http'
import { readFileSync, readdirSync } from 'fs'
import { WebSocketServer } from 'ws'
import { TICK_RATE, MATCH, type MapFile } from '@fps/shared'
import { lanAddresses } from './lan'
import { createGameServer } from './gameServer'
import { APP_VERSION } from './version'

const PORT = Number(process.env.FPS_PORT) || 8081   // npm run play dùng 8082 để chạy song song với npm run dev

// Biến môi trường để thử nhanh: FPS_MATCH_MS (thời lượng trận), FPS_KILL_LIMIT
const rules = { ...MATCH }
if (Number(process.env.FPS_MATCH_MS) > 0) rules.durationMs = Number(process.env.FPS_MATCH_MS)
if (Number(process.env.FPS_KILL_LIMIT) > 0) rules.killLimit = Number(process.env.FPS_KILL_LIMIT)
if (Number(process.env.FPS_END_MS) > 0) rules.endScreenMs = Number(process.env.FPS_END_MS)

// Mọi map trong assets/maps/*.json chọn được khi tạo phòng (client hiện chỉ dựng được map deathmatch — xem plan/PROGRESS)
const maps: Record<string, MapFile> = {}
for (const f of readdirSync(new URL('../../assets/maps/', import.meta.url))) {
  if (f.endsWith('.json')) maps[f.slice(0, -5)] = JSON.parse(readFileSync(new URL(`../../assets/maps/${f}`, import.meta.url), 'utf8')) as MapFile
}

const game = createGameServer({ maps, rules, allowDebugCmds: process.env.NODE_ENV !== 'production', logTicks: true, version: APP_VERSION })

const server = createServer((_req, res) => {
  res.writeHead(200)
  res.end(`FPS Server tick=${TICK_RATE} rooms=${game.rooms.rooms.size}`)
})
game.attach(new WebSocketServer({ server }))

game.ready.then(() => {
  server.listen(PORT, () => {
    console.log(`listening ${PORT} (mọi card mạng)`)
    for (const a of lanAddresses()) console.log(`  LAN ${a.iface}: ws://${a.address}:${PORT}   → máy khác mở http://${a.address}:${process.env.FPS_WEB_PORT ?? 5173}`)
  })
})
