import { describe, it, expect } from 'vitest'
import { createWorld } from './physics/world'
import { stepMovement, defaultMovement, Btn, type PlayerState, type InputCmd } from './movement'
import { zombieMovement, ZOMBIE, applyKnockback, knockbackImpulse } from './zombie'
import { loadMap } from './map/loadMap'
import type { MapFile } from './map/types'
import { mulberry32 } from './math'
import { DT } from './constants'

const slitMap = loadMap({
  name: 'slit', mirrorX: false, spawnsA: [{ pos: [0, 1, 0], yaw: 0 }], ramps: [],
  boxes: [
    { pos: [0, -0.5, 0], size: [80, 1, 80], texture: 'greenfloor' },
    { pos: [0, 0.5, 0], size: [0.4, 1, 20], texture: 'wall' },     // bệ cao 1,0m
    { pos: [0, 2.5, 0], size: [0.4, 1, 20], texture: 'wall' },     // thanh ngang từ 2,0m → khe cao đúng 1,0m
    { pos: [0, 5.0, 0], size: [0.4, 4, 20], texture: 'wall' },
  ],
} as MapFile)
const zcfg = zombieMovement(defaultMovement, 9.5)
const st = (pos: [number, number, number], yaw: number): PlayerState => ({ pos: [...pos], vel: [0, 0, 0], yaw, pitch: 0, grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 })
const cmd = (seq: number, buttons: number, yaw = -Math.PI / 2): InputCmd => ({ seq, buttons, yaw, pitch: 0, weapon: 0 })   // yaw −π/2 = nhìn về +X

// Chạy từ x=-12 về +X, đến gần tường thì ngồi + nhảy; trả x cuối
async function crawlThroughSlit(cfg: typeof defaultMovement, jumpTick: number) {
  const w = await createWorld(slitMap)
  let s = st([-12, 1, 0], -Math.PI / 2)
  for (let i = 0; i < 30; i++) s = stepMovement(s, cmd(i, 0), w, cfg, DT)
  for (let i = 0; i < 200; i++) {
    let b = Btn.Forward
    if (i >= jumpTick) b |= Btn.Crouch
    if (i === jumpTick) b |= Btn.Jump
    s = stepMovement(s, cmd(100 + i, b), w, cfg, DT)
  }
  return s.pos[0]
}

describe('zombie movement (ZF.2)', () => {
  it('bò qua khe cao 1,0m: zombie lọt (ngồi + nhảy), người thì không', async () => {
    let zombiePassed = false, humanPassed = false
    for (let j = 20; j < 70; j++) {
      if ((await crawlThroughSlit(zcfg, j)) > 2) zombiePassed = true
      if ((await crawlThroughSlit(defaultMovement, j)) > 2) humanPassed = true
    }
    expect(zombiePassed).toBe(true)
    expect(humanPassed).toBe(false)
  }, 60_000)

  it('chiêu E: đỉnh ≈ 4,3m, lên được gờ 4m; hồi chiêu 8s; không dùng được khi đang trên không', async () => {
    const w = await createWorld(slitMap)
    let s = st([-12, 0, 5], -Math.PI / 2)
    for (let i = 0; i < 30; i++) s = stepMovement(s, cmd(i, 0), w, zcfg, DT)
    s = stepMovement(s, cmd(100, Btn.Ability), w, zcfg, DT)
    expect(s.leapCd).toBeCloseTo(ZOMBIE.leap.cooldownMs / 1000 - DT, 5)
    expect(s.vel[0]).toBeGreaterThan(4)   // đà theo hướng nhìn (+X)
    let maxY = 0
    for (let i = 1; i < 120; i++) { s = stepMovement(s, cmd(100 + i, Btn.Ability), w, zcfg, DT); maxY = Math.max(maxY, s.pos[1]) }
    expect(maxY).toBeGreaterThan(4.1)
    expect(maxY).toBeLessThan(4.6)
    expect(s.leapCd).toBeGreaterThan(5)   // vẫn đang hồi: bấm E liên tục không nhảy lần hai
  })

  it('người không có chiêu E (Ability bị bỏ qua)', async () => {
    const w = await createWorld(slitMap)
    let s = st([-12, 0, 5], 0)
    for (let i = 0; i < 30; i++) s = stepMovement(s, cmd(i, 0), w, defaultMovement, DT)
    s = stepMovement(s, cmd(100, Btn.Ability), w, defaultMovement, DT)
    expect(s.vel[1]).toBeLessThanOrEqual(0)
  })

  it('không bunny hop: mỗi lần nhảy mất 30% tốc độ ngang', async () => {
    const w = await createWorld(slitMap)
    let s = st([-30, 0, 5], -Math.PI / 2)
    for (let i = 0; i < 60; i++) s = stepMovement(s, cmd(i, Btn.Forward), w, zcfg, DT)
    const before = Math.hypot(s.vel[0], s.vel[2])
    s = stepMovement(s, cmd(100, Btn.Forward | Btn.Jump), w, zcfg, DT)
    expect(Math.hypot(s.vel[0], s.vel[2])).toBeLessThan(before * 0.75)
  })

  it('không trượt khi bấm ngồi lúc đang chạy nhanh', async () => {
    const w = await createWorld(slitMap)
    let s = st([-30, 0, 5], -Math.PI / 2)
    for (let i = 0; i < 60; i++) s = stepMovement(s, cmd(i, Btn.Forward), w, zcfg, DT)
    s = stepMovement(s, cmd(100, Btn.Forward | Btn.Crouch), w, zcfg, DT)
    expect(s.slideTimer).toBe(0)
  })

  it('tất định: hai world, 600 tick ngồi-nhảy + chiêu E ngẫu nhiên, bit-identical', async () => {
    const w1 = await createWorld(slitMap), w2 = await createWorld(slitMap)
    const rng = mulberry32(0xC0FFEE)
    let a = st([-12, 1, 3], -Math.PI / 2), b = st([-12, 1, 3], -Math.PI / 2)
    for (let i = 0; i < 600; i++) {
      let buttons = 0
      if (rng() < 0.7) buttons |= Btn.Forward
      if (rng() < 0.3) buttons |= Btn.Crouch
      if (rng() < 0.2) buttons |= Btn.Jump
      if (rng() < 0.05) buttons |= Btn.Ability
      const c = cmd(i, buttons, (rng() * 2 - 1) * Math.PI)
      a = stepMovement(a, c, w1, zcfg, DT)
      b = stepMovement(b, c, w2, zcfg, DT)
      expect(a.pos, `tick ${i}`).toEqual(b.pos)
      expect(a.vel, `tick ${i}`).toEqual(b.vel)
      expect(a.leapCd).toBe(b.leapCd)
    }
  }, 30_000)
})

describe('đẩy lùi (ZF.2)', () => {
  it('shotgun đẩy mạnh hơn AK; resist giảm; trên không ×1,5; kẹp 14 m/s', () => {
    const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0]
    knockbackImpulse(a, 'shotgun', 128, 0, 1, 0, false)   // 8 viên × 16
    knockbackImpulse(b, 'ak47', 36, 0, 1, 0, false)
    expect(a[0]).toBeGreaterThan(b[0] * 5)
    expect(a[1]).toBeCloseTo(a[0] * ZOMBIE.knockbackUp, 6)
    const c: [number, number, number] = [0, 0, 0]
    knockbackImpulse(c, 'shotgun', 128, 0.5, 1, 0, false)
    expect(c[0]).toBeCloseTo(a[0] * 0.5, 6)
    const d: [number, number, number] = [0, 0, 0]
    knockbackImpulse(d, 'shotgun', 128, 0, 1, 0, true)
    expect(d[0]).toBeCloseTo(a[0] * 1.5, 6)
    const vel: [number, number, number] = [10, 0, 0]
    applyKnockback(vel, [20, 3, 0])
    expect(Math.hypot(vel[0], vel[2])).toBeCloseTo(ZOMBIE.knockbackMaxHSpeed, 6)
    expect(vel[1]).toBe(3)
  })
})

describe('hình dáng zombie (ZF.1)', () => {
  it('tất định theo id; cỡ lệch ≤ ±6%; 10 zombie không cùng một tint+cỡ', async () => {
    const { zombieVariation } = await import('./zombie')
    expect(zombieVariation(7)).toEqual(zombieVariation(7))
    const seen = new Set<string>()
    for (let id = 1; id <= 10; id++) {
      const v = zombieVariation(id)
      expect(Math.abs(v.scale - 1)).toBeLessThanOrEqual(0.0601)
      seen.add(`${v.tint}|${v.scale.toFixed(3)}`)
    }
    expect(seen.size).toBeGreaterThanOrEqual(8)
  })
  it('zombie do người bị lây: tint xanh xám cố định, không model riêng; tintOverride thay tint', async () => {
    const { zombieVariation, ZOMBIE_LOOK } = await import('./zombie')
    const h = zombieVariation(3, { fromHuman: true })
    expect(h.tint).toBe(ZOMBIE_LOOK.variation.infectedTint)
    expect(h.model).toBeNull()
    expect(zombieVariation(3, { tintOverride: '#c9b28a' }).tint).toBe('#c9b28a')
  })
})

describe('leapFlight', () => {
  it('lên gờ 4,2m: bay ≈ 0,74s, đi ngang ≈ 3,7m; không lên được 4,5m (đỉnh 4,33m)', async () => {
    const { leapFlight, leapApex } = await import('./zombie')
    const f = leapFlight(4.2)!
    expect(f.time).toBeGreaterThan(0.6); expect(f.time).toBeLessThan(0.9)
    expect(f.dist).toBeCloseTo(5 * f.time, 6)
    expect(leapApex()).toBeCloseTo(4.33, 1)
    expect(leapFlight(4.6)).toBeNull()
    expect(leapFlight(2.2)!.dist).toBeGreaterThan(leapFlight(4.2)!.dist)   // thấp hơn thì bay lâu hơn (rơi xuống muộn)
  })
})
