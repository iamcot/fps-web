import { describe, it, expect } from 'vitest'
import { WEAPONS, makeWeaponState, MAX_PELLETS } from './weapons'
import { computeSpreadDeg, currentBloom, onShotBloom } from './spread'
import { computeShotDirs, makeRecoilState, tryFire } from './weaponLogic'
import { defaultMovement, type PlayerState } from './movement'

const cfg = defaultMovement
const AK = WEAPONS[0]!, SG = WEAPONS[5]!, SNIPER = WEAPONS[4]!
const st = (over: Partial<PlayerState> = {}): PlayerState =>
  ({ pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0, ...over })
const wsFor = (id: number) => { const ws = makeWeaponState([6, 2, -1, id, -1]); return ws }

describe('computeSpreadDeg', () => {
  it('AK47 theo tốc độ: đứng yên 0.35, 2,5 m/s vẫn 0.35, chạy hết tốc 1.35, trên không 3.35', () => {
    const ws = wsFor(0)
    expect(computeSpreadDeg(st(), ws, AK, cfg, 0)).toBeCloseTo(0.35, 6)
    expect(computeSpreadDeg(st({ vel: [2.5, 0, 0] }), ws, AK, cfg, 0)).toBeCloseTo(0.35, 6)
    const full = cfg.runSpeed * AK.moveSpeedMul
    expect(computeSpreadDeg(st({ vel: [full, 0, 0] }), ws, AK, cfg, 0)).toBeCloseTo(1.35, 6)
    expect(computeSpreadDeg(st({ grounded: false }), ws, AK, cfg, 0)).toBeCloseTo(3.35, 6)
  })
  it('tăng dần theo tốc độ (không nhảy bậc)', () => {
    const ws = wsFor(0)
    let prev = -1
    for (let v = 0; v <= 8; v += 0.25) {
      const d = computeSpreadDeg(st({ vel: [v, 0, 0] }), ws, AK, cfg, 0)
      expect(d).toBeGreaterThanOrEqual(prev)
      if (prev >= 0) expect(d - prev).toBeLessThan(0.25)
      prev = d
    }
  })
  it('ngồi 0.20; trượt = ngồi + phần di chuyển', () => {
    const ws = wsFor(0)
    expect(computeSpreadDeg(st({ crouching: true }), ws, AK, cfg, 0)).toBeCloseTo(0.20, 6)
    const v = 9
    const slide = computeSpreadDeg(st({ crouching: true, slideTimer: 0.4, vel: [v, 0, 0] }), ws, AK, cfg, 0)
    expect(slide).toBeCloseTo(0.20 + AK.spread.moveDeg, 6)
  })
  it('xả liên tục (100ms/phát): 0.35, 0.60, 0.85 … từ phát 9 giữ 2.35', () => {
    const ws = wsFor(0)
    const p = st()
    const got: number[] = []
    for (let k = 0; k < 14; k++) {
      const t = k * 100
      expect(tryFire(ws, AK, t, true)).toBe(true)
      got.push(computeSpreadDeg(p, ws, AK, cfg, t, true))
    }
    expect(got[0]).toBeCloseTo(0.35, 6)
    expect(got[1]).toBeCloseTo(0.60, 6)
    expect(got[2]).toBeCloseTo(0.85, 6)
    for (let k = 8; k < 14; k++) expect(got[k]).toBeCloseTo(2.35, 6)
  })
  it('ngừng bắn 0,5s: bloom (0.5−0.15)×6 = 2.1° → về 0; ngừng 0,1s: chưa hồi', () => {
    const ws = wsFor(0)
    for (let k = 0; k < 12; k++) tryFire(ws, AK, k * 100, true)
    const last = 11 * 100
    expect(currentBloom(ws, AK, last)).toBeCloseTo(2.0, 6)
    expect(currentBloom(ws, AK, last + 100)).toBeCloseTo(2.0, 6)
    expect(currentBloom(ws, AK, last + 150)).toBeCloseTo(2.0, 6)
    expect(currentBloom(ws, AK, last + 250)).toBeCloseTo(2.0 - 0.1 * 6, 6)
    expect(currentBloom(ws, AK, last + 500)).toBe(0)
  })
  it('mỗi súng giữ bloom riêng; đổi súng không reset', () => {
    const ws = wsFor(0)
    for (let k = 0; k < 5; k++) tryFire(ws, AK, k * 100, true)
    expect(currentBloom(ws, WEAPONS[1]!, 400)).toBe(0)
    expect(currentBloom(ws, AK, 400)).toBeGreaterThan(0.5)
  })
  it('ngắm hẳn (adsT = 1): AK47 đứng yên 0.09°; ngắm khi chạy nhỏ hơn chạy không ngắm', () => {
    const ws = wsFor(0)
    expect(computeSpreadDeg(st({ adsT: 1 }), ws, AK, cfg, 0)).toBeCloseTo(0.35 * 0.25, 6)
    const run = [cfg.runSpeed * AK.moveSpeedMul * AK.ads!.moveMult, 0, 0] as [number, number, number]
    expect(computeSpreadDeg(st({ adsT: 1, vel: run }), ws, AK, cfg, 0)).toBeLessThan(computeSpreadDeg(st({ vel: [8, 0, 0] }), ws, AK, cfg, 0) * 0.5)
  })
  it('sniper: không ngắm 8° cố định; ngắm hẳn 0.05°; ngắm mà chạy/nhảy vẫn lớn', () => {
    const ws = wsFor(4)
    expect(computeSpreadDeg(st(), ws, SNIPER, cfg, 0)).toBeCloseTo(8, 6)
    expect(computeSpreadDeg(st({ vel: [5, 0, 0] }), ws, SNIPER, cfg, 0)).toBeCloseTo(8, 6)
    expect(computeSpreadDeg(st({ adsT: 1 }), ws, SNIPER, cfg, 0)).toBeCloseTo(0.05, 6)
    expect(computeSpreadDeg(st({ adsT: 1, vel: [3.5, 0, 0] }), ws, SNIPER, cfg, 0)).toBeGreaterThan(1.5)
    expect(computeSpreadDeg(st({ adsT: 1, grounded: false }), ws, SNIPER, cfg, 0)).toBeGreaterThan(8)
  })
})

describe('shotgun: spread dịch tâm chùm, không làm chùm to ra', () => {
  const mk = () => Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])
  const angle = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!))) * 180 / Math.PI
  it('chạy: tâm lệch, nhưng mọi viên cách nhau như khi đứng yên (≤ 2 × 4.5°)', () => {
    const still = mk(), run = mk()
    const spreadRun = 0.6
    for (let seq = 0; seq < 100; seq++) {
      computeShotDirs(still, makeRecoilState(), SG, 3, seq, 0, 0, 0)
      computeShotDirs(run, makeRecoilState(), SG, 3, seq, 0, 0, spreadRun)
      for (let i = 0; i < 8; i++) {
        expect(angle(still[i]!, [0, 0, -1])).toBeLessThanOrEqual(4.5 + 1e-6)
        expect(angle(run[i]!, [0, 0, -1])).toBeLessThanOrEqual(4.5 + spreadRun + 1e-6)
        for (let j = i + 1; j < 8; j++) expect(Math.abs(angle(run[i]!, run[j]!) - angle(still[i]!, still[j]!))).toBeLessThan(0.05)
      }
    }
  })
})

describe('đồng bộ client/server', () => {
  it('cùng chuỗi phát bắn trên 2 bản state riêng → cùng hướng đạn từng phát', () => {
    const a = wsFor(0), b = wsFor(0)
    const ra = makeRecoilState(), rb = makeRecoilState()
    const da = [[0, 0, 0] as [number, number, number]], db = [[0, 0, 0] as [number, number, number]]
    const p = st({ vel: [5, 0, 0] })
    for (let k = 0; k < 40; k++) {
      const t = k * 100
      expect(tryFire(a, AK, t, true)).toBe(tryFire(b, AK, t, true))
      computeShotDirs(da, ra, AK, 9, a.shotSeq - 1, 0.3, 0.1, computeSpreadDeg(p, a, AK, cfg, t, true))
      computeShotDirs(db, rb, AK, 9, b.shotSeq - 1, 0.3, 0.1, computeSpreadDeg(p, b, AK, cfg, t, true))
      expect(da[0]).toEqual(db[0])
    }
  })
  it('onShotBloom: bloom không vượt trần', () => {
    const ws = wsFor(0)
    for (let k = 0; k < 50; k++) onShotBloom(ws, AK, k * 10)
    expect(ws.bloomDeg[0]).toBe(AK.spread.bloomMaxDeg)
  })
})
