import { describe, it, expect } from 'vitest'
import { createWorld } from './physics/world'
import { stepMovement, defaultMovement, Btn } from './movement'
import { loadMap } from './map/loadMap'
import type { MapFile } from './map/types'
import type { PlayerState } from './movement'
import { mulberry32 } from './math'
import { DT, TICK_RATE } from './constants'
import mapRaw from '../../assets/maps/deathmatch.json'

const loadedMap = loadMap(mapRaw as unknown as MapFile)
const cfg = defaultMovement

function makeState(pos: [number, number, number], yaw: number): PlayerState {
  return { pos: [...pos] as [number, number, number], vel: [0, 0, 0], yaw, pitch: 0, grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0 }
}

describe('stepMovement', () => {
  it('determinism: two identical worlds produce bit-identical states for 600 ticks', async () => {
    const world1 = await createWorld(loadedMap)
    const world2 = await createWorld(loadedMap)

    const rng   = mulberry32(0xDEADBEEF)
    const spawn: [number, number, number] = [-28, 1, -6]
    const yaw0  = -Math.PI / 2

    let s1 = makeState(spawn, yaw0)
    let s2 = makeState(spawn, yaw0)

    for (let i = 0; i < 600; i++) {
      let buttons = 0
      if (rng() < 0.7)  buttons |= Btn.Forward
      if (rng() < 0.3)  buttons |= Btn.Left
      if (rng() < 0.3)  buttons |= Btn.Right
      if (rng() < 0.15) buttons |= Btn.Jump
      const yaw = (rng() * 2 - 1) * Math.PI
      const cmd = { seq: i, buttons, yaw, pitch: 0, weapon: 0 }

      s1 = stepMovement(s1, cmd, world1, cfg, DT)
      s2 = stepMovement(s2, cmd, world2, cfg, DT)

      expect(s1.pos[0], `tick ${i} pos.x`).toBe(s2.pos[0])
      expect(s1.pos[1], `tick ${i} pos.y`).toBe(s2.pos[1])
      expect(s1.pos[2], `tick ${i} pos.z`).toBe(s2.pos[2])
      expect(s1.vel[0], `tick ${i} vel.x`).toBe(s2.vel[0])
      expect(s1.vel[1], `tick ${i} vel.y`).toBe(s2.vel[1])
      expect(s1.vel[2], `tick ${i} vel.z`).toBe(s2.vel[2])
      expect(s1.grounded, `tick ${i} grounded`).toBe(s2.grounded)
    }
  }, 20_000)

  it('running straight 2 s reaches 8.4–8.6 m/s', async () => {
    const world = await createWorld(loadedMap)
    const spawn: [number, number, number] = [-28, 1, -6]
    const yaw0  = -Math.PI / 2   // nhìn về +X

    let state = makeState(spawn, yaw0)

    // Để nhân vật rơi xuống sàn (~0.5 s)
    for (let i = 0; i < 30; i++) {
      state = stepMovement(state, { seq: i, buttons: 0, yaw: yaw0, pitch: 0, weapon: 0 }, world, cfg, DT)
    }

    // Chạy thẳng 2 giây
    for (let i = 0; i < TICK_RATE * 2; i++) {
      state = stepMovement(state, { seq: 30 + i, buttons: Btn.Forward, yaw: yaw0, pitch: 0, weapon: 0 }, world, cfg, DT)
    }

    const horizSpeed = Math.hypot(state.vel[0], state.vel[2])
    expect(horizSpeed).toBeGreaterThan(8.4)
    expect(horizSpeed).toBeLessThan(8.6)
  }, 20_000)
})

describe('crouch release', () => {
  const settle = (world: Awaited<ReturnType<typeof createWorld>>, s: PlayerState, buttons: number, n: number) => {
    for (let i = 0; i < n; i++) s = stepMovement(s, { seq: i, buttons, yaw: 0, pitch: 0, weapon: 0 }, world, cfg, DT)
    return s
  }

  it('nhả Ctrl ngoài trống thì đứng dậy ngay', async () => {
    const world = await createWorld(loadedMap)
    let s = settle(world, makeState([-28, 1, -6], 0), 0, 30)
    s = settle(world, s, Btn.Crouch, 30)
    expect(s.crouching).toBe(true)
    s = settle(world, s, 0, 2)
    expect(s.crouching).toBe(false)
  })

  it('nhả Ctrl sát tường (các hướng) vẫn đứng dậy', async () => {
    const world = await createWorld(loadedMap)
    const base = settle(world, makeState([-28, 1, -6], 0), 0, 30)
    for (const buttons of [Btn.Forward, Btn.Back, Btn.Left, Btn.Right]) {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        let s: PlayerState = { ...base, pos: [...base.pos] as [number, number, number], vel: [0, 0, 0] }
        const cmd = (b: number) => ({ seq: 0, buttons: b, yaw, pitch: 0, weapon: 0 })
        for (let i = 0; i < 240; i++) s = stepMovement(s, cmd(buttons | Btn.Crouch), world, cfg, DT)
        for (let i = 0; i < 5; i++) s = stepMovement(s, cmd(0), world, cfg, DT)
        expect(s.crouching, `buttons=${buttons} yaw=${yaw}`).toBe(false)
      }
    }
  })
})

describe('slide', () => {
  const run = (world: Awaited<ReturnType<typeof createWorld>>, s: PlayerState, buttons: number, n: number) => {
    for (let i = 0; i < n; i++) s = stepMovement(s, { seq: i, buttons, yaw: -Math.PI / 2, pitch: 0, weapon: 0 }, world, cfg, DT)
    return s
  }
  const hs = (s: PlayerState) => Math.hypot(s.vel[0], s.vel[2])

  it('chạy + Crouch: trượt có boost, chậm dần, hết cooldown mới trượt lại', async () => {
    const world = await createWorld(loadedMap)
    let s = run(world, makeState([-28, 1, -6], -Math.PI / 2), Btn.Forward, 90)   // chạy tới tốc độ tối đa
    const before = hs(s)
    expect(before).toBeGreaterThan(cfg.slideMinSpeed)

    s = run(world, s, Btn.Forward | Btn.Crouch, 1)
    expect(s.slideTimer).toBeGreaterThan(0)
    expect(hs(s)).toBeGreaterThan(before + cfg.slideBoost * 0.9)

    // Trượt không lái được: nhả W vẫn lướt, tốc độ giảm chậm (ma sát thấp)
    const v1 = hs(s)
    s = run(world, s, Btn.Crouch, 20)
    expect(hs(s)).toBeLessThan(v1)
    expect(hs(s)).toBeGreaterThan(v1 * 0.6)

    // Nhả rồi bấm lại C khi còn cooldown (~0.5s sau lần trượt đầu): không trượt thêm
    s = run(world, s, Btn.Forward, 5)
    expect(s.slideCooldown).toBeGreaterThan(0)
    s = run(world, s, Btn.Forward | Btn.Crouch, 1)
    expect(s.slideTimer).toBe(0)

    // Hết cooldown, chạy lại đủ nhanh → trượt được lần nữa
    s = run(world, s, Btn.Forward, 120)
    expect(s.slideCooldown).toBe(0)
    s = run(world, s, Btn.Forward | Btn.Crouch, 1)
    expect(s.slideTimer).toBeGreaterThan(0)
  })

  it('đi chậm + Crouch: không trượt', async () => {
    const world = await createWorld(loadedMap)
    let s = run(world, makeState([-28, 1, -6], -Math.PI / 2), 0, 30)
    s = run(world, s, Btn.Crouch, 5)
    expect(s.slideTimer).toBe(0)
  })
})

describe('tường chắn trời', () => {
  it('bunny-hop từ viền bệ cao (7.2m) về phía tường không vượt ra khỏi map', async () => {
    const world = await createWorld(loadedMap)
    let s = makeState([-15, 7.3, -16], 0)
    for (let i = 0; i < 30; i++) s = stepMovement(s, { seq: i, buttons: 0, yaw: 0, pitch: 0, weapon: 0 }, world, cfg, DT)
    for (let i = 0; i < 600; i++) {
      s = stepMovement(s, { seq: i, buttons: Btn.Forward | Btn.Jump, yaw: 0, pitch: 0, weapon: 0 }, world, cfg, DT)
      expect(s.pos[2]).toBeGreaterThan(-20.1)
    }
  })
})
