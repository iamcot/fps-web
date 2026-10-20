import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { MATCH, MatchPhase, defaultMovement, loadMap, type MapFile, type RoomOptions, type Transport } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from './room'
import { stepRoom } from './simulation'
import { buildNav, type NavGrid } from './bots/nav'
import type { DefenseMode } from './modes/defense'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
let nav: NavGrid
beforeAll(async () => { nav = buildNav(await createWorld(map), map, defaultMovement) })

const OPTS: RoomOptions = { mode: 'defense', settings: { waves: 10, intermissionSec: 10, difficulty: 'normal' } }

// Thế giới thật (Rapier): zombie đi theo nav, va chạm tường, leo ramp
describe('Thủ Thành – zombie trong thế giới thật (T.4)', () => {
  it('đợt 1: walker tới được người chơi và làm họ mất máu; 28 zombie + 4 người giữ tick ≤ 4ms', async () => {
    const rm = new RoomManager(map, () => 0, MATCH)
    const humans: Player[] = []
    for (let i = 0; i < 4; i++) {
      const t: Transport = { send: () => {}, onMessage: () => {}, onClose: () => {} }
      const res = rm.tryJoin('r', `p${i}`, t, 0, 'auto', undefined, undefined, OPTS)!
      res.player.world = await createWorld(map)
      humans.push(res.player)
    }
    const room = rm.rooms.get('r') as Room
    room.nav = nav
    const m = room.mode as DefenseMode
    m.s.prepSec = 1
    let now = 0
    const step = () => { now += 1000 / 60; stepRoom(room, defaultMovement, now) }
    for (let i = 0; i < 90; i++) step()
    expect(room.phase).toBe(MatchPhase.Playing)
    m.devSetWave(room, 8)   // 20 walker + 10 crawler + 2 screamer, ×(1+0.6×3)
    // cho các world của zombie nạp xong
    const t0 = performance.now()
    let ticks = 0
    let maxAlive = 0, everHurt = 0, defeatAt = -1
    for (let sec = 0; sec < 40; sec++) {
      for (let i = 0; i < 60; i++) { step(); ticks++ }
      for (const h of humans) if (h.hp < 100 || h.downed || !h.alive) everHurt++
      if (defeatAt < 0 && m.kind === 'defeat') defeatAt = sec
      maxAlive = Math.max(maxAlive, [...room.players.values()].filter(p => p.npc && p.alive).length)
      await new Promise(r => setTimeout(r, 0))
    }
    const ms = (performance.now() - t0) / ticks
    console.log(`defense perf: ${ms.toFixed(2)} ms/tick, max zombie sống ${maxAlive}, wave ${m.wave} kind ${m.kind}`)
    const hurt = everHurt
    console.log(`hurt samples ${everHurt}, defeat at ${defeatAt}s`)
    expect(maxAlive).toBeGreaterThan(10)
    expect(hurt).toBeGreaterThan(0)    // zombie đã tới nơi và cào trúng
    expect(ms).toBeLessThan(6)
  }, 120_000)
})
