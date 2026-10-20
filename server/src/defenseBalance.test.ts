// Thử cân bằng Thủ Thành (T.9): bot KHÓ đóng vai người chơi giữ thành, chạy mô phỏng tới khi thắng/thua rồi in số liệu.
// Chỉ chạy khi có biến môi trường:  BALANCE=1 npx vitest run server/src/defenseBalance.test.ts
import { describe, it, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { MATCH, defaultMovement, loadMap, type MapFile, type RoomOptions, type Transport } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { RoomManager, type Room } from './room'
import { stepRoom } from './simulation'
import { buildNav, type NavGrid } from './bots/nav'
import { addBot } from './bots/roster'
import type { DefenseMode } from './modes/defense'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
let nav: NavGrid
beforeAll(async () => { nav = buildNav(await createWorld(map), map, defaultMovement) })

async function trial(bots: number, difficulty: 'easy' | 'normal' | 'hard', maxMin: number) {
  const opts: RoomOptions = { mode: 'defense', maxPlayers: 10, settings: { waves: 10, intermissionSec: 25, difficulty } }
  const rm = new RoomManager(map, () => 0, MATCH)
  const room = rm.createRoom('b', undefined, undefined, opts) as Room
  room.nav = nav
  const t: Transport = { send: () => {}, onMessage: () => {}, onClose: () => {} }
  void t
  for (let i = 0; i < bots; i++) addBot(room, 'hard', 'A')
  await new Promise(r => setTimeout(r, 400))
  const m = room.mode as DefenseMode
  m.s.prepSec = 10
  let now = 0
  const log: string[] = []
  let lastWave = 0, waveStart = 0
  const maxTicks = maxMin * 60 * 60
  for (let i = 0; i < maxTicks; i++) {
    now += 1000 / 60
    stepRoom(room, defaultMovement, now)
    if (i % 600 === 0) await new Promise(r => setTimeout(r, 0))
    if (m.wave !== lastWave && m.kind === 'wave') {
      if (lastWave > 0) log.push(`đợt ${lastWave}: ${((now - waveStart) / 1000).toFixed(0)}s`)
      lastWave = m.wave; waveStart = now
    }
    if (m.kind === 'victory' || m.kind === 'defeat') break
  }
  const humans = [...room.players.values()].filter(p => !p.npc)
  const res = `${bots} bot khó, độ khó ${difficulty}: ${m.kind} ở đợt ${m.wave}, ${(now / 1000).toFixed(0)}s; ${log.join(', ')}; tiền còn ${humans.map(h => h.money).join('/')}`
  console.log('BALANCE ' + res)
  return res
}

describe.skipIf(!process.env.BALANCE)('cân bằng Thủ Thành', () => {
  it('1 bot / 4 bot × normal', async () => {
    await trial(1, 'normal', 25)
    await trial(4, 'normal', 25)
  }, 900_000)
})
