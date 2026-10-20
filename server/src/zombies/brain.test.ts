import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { DT, defaultMovement, loadMap, stepMovement, zombieMovement, type InputCmd, type MapFile, type PlayerState, type Vec3 } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { buildNav, type NavGrid } from '../bots/nav'
import { ZombieBrain, ZOMBIE_AI } from './brain'

const map = loadMap(JSON.parse(readFileSync(new URL('../../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
let nav: NavGrid
beforeAll(async () => { nav = buildNav(await createWorld(map), map, defaultMovement) })

interface Result { reached: boolean; t: number; maxY: number; pos: Vec3; usedKinds: Set<number>; stuckMs: number }

// Mô phỏng một zombie (world Rapier thật, stepMovement của zombie) đi từ `from` tới `to`
async function run(from: Vec3, to: Vec3, ability: { hole: boolean; leap: boolean }, runSpeed = 9.5, seconds = 40): Promise<Result> {
  const world: CollisionWorld = await createWorld(map)
  const cfg = zombieMovement(defaultMovement, runSpeed)
  const brain = new ZombieBrain(nav, ability, () => 0.5)
  let s: PlayerState = { pos: [from[0], from[1] + 0.05, from[2]], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 }
  const cmd: InputCmd = { seq: 0, buttons: 0, yaw: 0, pitch: 0, weapon: 0 }
  const used = new Set<number>()
  let maxY = 0, stuck = 0
  const ticks = Math.round(seconds / DT)
  for (let i = 0; i < ticks; i++) {
    const now = i * DT * 1000
    cmd.seq = i
    const r = brain.step(cmd, s, to, now, (s.leapCd ?? 0) <= 0)
    stuck = Math.max(stuck, r.stuckMs)
    const wp = brain.waypoint
    if (wp) used.add(wp.kind)
    s = stepMovement(s, cmd, world, cfg, DT)
    maxY = Math.max(maxY, s.pos[1])
    if (s.grounded && Math.hypot(s.pos[0] - to[0], s.pos[2] - to[2]) < ZOMBIE_AI.attackRange && Math.abs(s.pos[1] - to[1]) < 1.0) return { reached: true, t: now / 1000, maxY, pos: [...s.pos], usedKinds: used, stuckMs: stuck }
  }
  return { reached: false, t: seconds, maxY, pos: [...s.pos], usedKinds: used, stuckMs: stuck }
}

describe('bộ não zombie (T.4)', () => {
  it('walker tới được căn cứ A và không dùng cạnh Hole', async () => {
    const r = await run([-14, 0, 5.5], [-24, 0, 5.5], { hole: false, leap: false })
    console.log('walker', r.reached, r.t.toFixed(1), [...r.usedKinds], r.pos.map(v => +v.toFixed(1)), 'maxY', r.maxY.toFixed(1))
    expect(r.reached).toBe(true)
    expect(r.usedKinds.has(3)).toBe(false)   // (map hiện tại: khe có bệ 0,5m nên walker vẫn nhảy qua được bằng cạnh Jump thường — xem PROGRESS)
  }, 60_000)

  it('crawler chui qua khe tường thành vào căn cứ A', async () => {
    const r = await run([-14, 0, 5.5], [-24, 0, 5.5], { hole: true, leap: false })
    console.log('crawler', r.reached, r.t.toFixed(1), [...r.usedKinds], r.pos.map(v => +v.toFixed(1)), 'maxY', r.maxY.toFixed(1))
    expect(r.reached).toBe(true)
    expect(r.usedKinds.has(3)).toBe(true)
    expect(r.maxY).toBeLessThan(2)   // không leo tường
    expect(r.t).toBeLessThan(10)
  }, 60_000)

  it('leaper bật E từ đất lên gờ tường', async () => {
    const r = await run([-14, 0, 12], [-19.2, 4.2, 12], { hole: false, leap: true })
    console.log('leaper', r.reached, r.t.toFixed(1), [...r.usedKinds], r.pos.map(v => +v.toFixed(1)), 'maxY', r.maxY.toFixed(1))
    expect(r.reached).toBe(true)
    expect(r.usedKinds.has(4)).toBe(true)
    expect(r.pos[1]).toBeGreaterThan(3.9)
  }, 60_000)
})
