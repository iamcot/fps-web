import { describe, it, expect } from 'vitest'
import { createWorld, type CollisionWorld } from './physics/world'
import { loadMap } from './map/loadMap'
import type { MapFile } from './map/types'
import { throwInitial, stepGrenade, type GrenadeState, type GrenadeEvent } from './grenadePhysics'
import { GRENADE } from './grenade'
import { DT } from './constants'
import type { PlayerState } from './movement'
import mapRaw from '../../assets/maps/deathmatch.json'

// Bản đồ thật (Deathmatch, Rapier thật). Tường thành ở x = −19: cột cao −0,2…2,6 m cách nhau khe rộng 2 m
// (khe ở z ∈ (−1, 1) nhưng đó là chân ramp; dùng khe (4,67; 6,67)), bệ thấp dưới 0,5 m, đỉnh tường cao tới ~5,25 m. Tường biên tây ở x = −31.
const map = loadMap(mapRaw as unknown as MapFile)
const player = (pos: [number, number, number], yaw: number, pitch: number, vel: [number, number, number] = [0, 0, 0]): PlayerState =>
  ({ pos, vel, yaw, pitch, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0 })
const FACE_PLUS_X = -Math.PI / 2   // yaw: forward = (−sin yaw, −cos yaw) = (+1, 0)
const make = (pos: [number, number, number], vel: [number, number, number]): GrenadeState =>
  ({ id: 1, ownerId: 1, team: 'A', pos: [...pos] as [number, number, number], vel: [...vel] as [number, number, number], spawnTick: 0, resting: false })

function run(g: GrenadeState, world: CollisionWorld, ticks: number): { events: GrenadeEvent[]; maxY: number; restTick: number } {
  const events: GrenadeEvent[] = []
  let maxY = g.pos[1], restTick = -1
  for (let i = 0; i < ticks; i++) {
    const e = stepGrenade(g, world, DT)
    if (e) events.push(e)
    maxY = Math.max(maxY, g.pos[1])
    if (g.resting && restTick < 0) restTick = i
  }
  return { events, maxY, restTick }
}

describe('throwInitial', () => {
  it('ném mạnh: tốc độ 16 m/s theo pitch + 6°, cộng 50% vận tốc người ném', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-25, 0, -3], FACE_PLUS_X, 0, [4, 0, 0]), 'strong', w)
    const up = 6 * Math.PI / 180
    expect(t.vel[0]).toBeCloseTo(16 * Math.cos(up) + 2, 4)
    expect(t.vel[1]).toBeCloseTo(16 * Math.sin(up), 4)
    expect(Math.abs(t.vel[2])).toBeLessThan(1e-6)
    // xuất phát: trước mắt 0,3 m, lệch phải 0,15 m, thấp hơn mắt 0,05 m
    expect(t.pos[0]).toBeCloseTo(-25 + 0.3, 4); expect(t.pos[1]).toBeCloseTo(1.6 - 0.05, 4); expect(t.pos[2]).toBeCloseTo(-3 - 0.15 * Math.sin(FACE_PLUS_X), 4)
    w.dispose()
  })
  it('ném thấp (lob): 7 m/s, pitch + 2°', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-25, 0, -3], FACE_PLUS_X, 0), 'lob', w)
    expect(Math.hypot(...t.vel)).toBeCloseTo(7, 4)
    w.dispose()
  })
  it('đứng sát tường: xuất phát tại mắt (không chui qua tường)', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-19.45, 0, -3], FACE_PLUS_X, 0), 'strong', w)   // cách mặt tường (−19,2) 0,25 m < 0,3 m phía trước
    expect(t.pos[0]).toBeCloseTo(-19.45, 6); expect(t.pos[1]).toBeCloseTo(1.6, 6)
    w.dispose()
  })
})

describe('stepGrenade (Rapier thật)', () => {
  it('ném cao từ sát tường thành: bay qua đỉnh tường rơi xuống khu giữa', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-21.5, 0, -3], FACE_PLUS_X, 70 * Math.PI / 180), 'strong', w)
    const g = make(t.pos, t.vel)
    const r = run(g, w, 300)
    expect(r.maxY).toBeGreaterThan(5.3)        // vượt đỉnh tường
    expect(g.pos[0]).toBeGreaterThan(-18.5)    // đã ở bên kia tường
    expect(g.pos[1]).toBeLessThan(1)           // rơi xuống đất
    w.dispose()
  })

  it('ném thẳng vào tường cách 2 m: nảy ngược lại, không xuyên tường', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-21.2, 0, -3], FACE_PLUS_X, 0), 'strong', w)   // cột tại z = −3 (−4,67…−1)
    const g = make(t.pos, t.vel)
    let minX = 1e9, maxX = -1e9
    for (let i = 0; i < 240; i++) { stepGrenade(g, w, DT); maxX = Math.max(maxX, g.pos[0]); minX = Math.min(minX, g.pos[0]) }
    expect(maxX).toBeLessThan(-19.2 + 1e-3)    // không vượt mặt tường (cột dày 0,4 quanh x = −19)
    expect(g.pos[0]).toBeLessThan(-19.5)       // nằm bên này, đã nảy ngược
    expect(g.pos[1]).toBeLessThan(0.2)
    w.dispose()
  })

  it('thả rơi từ 2 m: nảy vài lần thấp dần rồi nằm yên trong < 2 giây', async () => {
    const w = await createWorld(map)
    const g = make([-5, 2, 5], [0, 0, 0])
    const speeds: number[] = []
    let restTick = -1
    for (let i = 0; i < 180; i++) {
      const e = stepGrenade(g, w, DT)
      if (e) speeds.push(e.speed)
      if (g.resting && restTick < 0) restTick = i
    }
    expect(speeds.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeLessThan(speeds[i - 1]!)
    expect(restTick).toBeGreaterThan(0); expect(restTick).toBeLessThan(120)
    expect(g.pos[1]).toBeLessThan(GRENADE.radius + 0.02)   // nằm trên sàn
    expect(g.vel).toEqual([0, 0, 0])
    w.dispose()
  })

  it('tất định: 2 world riêng, cùng đầu vào, 300 tick → từng số giống hệt', async () => {
    const w1 = await createWorld(map), w2 = await createWorld(map)
    const t = throwInitial(player([-23, 0, -2], FACE_PLUS_X + 0.2, 0.35, [1, 0, 0.5]), 'strong', w1)
    const a = make(t.pos, t.vel), b = make(t.pos, t.vel)
    for (let i = 0; i < 300; i++) {
      const ea = stepGrenade(a, w1, DT), eb = stepGrenade(b, w2, DT)
      expect(eb).toEqual(ea)
      expect(b.pos).toEqual(a.pos); expect(b.vel).toEqual(a.vel); expect(b.resting).toBe(a.resting)
    }
    w1.dispose(); w2.dispose()
  })

  it('ném vào khe lỗ bắn (rộng 2 m, z ∈ (4,67; 6,67)): đi lọt qua', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-24, 0, 5.667], FACE_PLUS_X, 0), 'strong', w)
    const g = make(t.pos, t.vel)
    run(g, w, 90)
    expect(g.pos[0]).toBeGreaterThan(-17)      // qua bức tường x = −19
    w.dispose()
  })

  it('lăn trên dốc (ramp) không xuyên xuống dưới', async () => {
    const w = await createWorld(map)
    const g = make([-23, 2.5, 0], [0, 0, 0])   // thả lên ramp (−27,0,0)→(−19,75,4,1,0)
    for (let i = 0; i < 240; i++) stepGrenade(g, w, DT)
    expect(g.pos[1]).toBeGreaterThan(-0.05)
    w.dispose()
  })

  it('ném thấp (lob) trên sàn phẳng: nảy rồi lăn một đoạn và nằm yên (không lăn mãi)', async () => {
    const w = await createWorld(map)
    const t = throwInitial(player([-5, 0, 5], FACE_PLUS_X, -0.3), 'lob', w)
    const g = make(t.pos, t.vel)
    const r = run(g, w, 600)
    expect(r.restTick).toBeGreaterThan(0)
    expect(g.pos[0]).toBeGreaterThan(-4)   // đã đi về phía trước
    expect(g.pos[1]).toBeLessThan(GRENADE.radius + 0.02)
    w.dispose()
  })

  it('resting: không làm gì, không phát sự kiện', async () => {
    const w = await createWorld(map)
    const g = make([-5, 0.05, 5], [3, 0, 0]); g.resting = true
    expect(stepGrenade(g, w, DT)).toBeNull(); expect(g.pos).toEqual([-5, 0.05, 5])
    w.dispose()
  })
})
