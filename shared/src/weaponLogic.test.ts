import { describe, it, expect } from 'vitest'
import { WEAPONS, makeWeaponState, MAX_PELLETS } from './weapons'
import {
  stepWeapon, tryFire, computeShot, spreadFor, makeRecoilState, recoverRecoil, switchWeapon, shotSpread, computeShotDirs, damageFalloff,
} from './weaponLogic'
import { Btn } from './movement'
import type { PlayerState } from './movement'
import { DT } from './constants'

const AK = WEAPONS[0]!
const COLT = WEAPONS[2]!

// Chạy `ticks` tick, trả số phát bắn và thời điểm các sự kiện
function run(ws: ReturnType<typeof makeWeaponState>, ticks: number, trigger: (t: number) => boolean, startTick = 0) {
  const ev: { t: number; e: string }[] = []
  for (let t = startTick; t < startTick + ticks; t++) {
    const e = stepWeapon(ws, t * DT * 1000, trigger(t), false)
    if (e !== 'none') ev.push({ t: t * DT * 1000, e })
  }
  return ev
}

describe('tryFire', () => {
  it('auto: giữ cò bắn đúng theo fireInterval, trừ đúng đạn', () => {
    const ws = makeWeaponState()
    const ev = run(ws, 60, () => true)   // 1 giây
    const shots = ev.filter(x => x.e === 'fired')
    expect(shots.length).toBe(Math.ceil(1000 / AK.fireIntervalMs))   // 100ms → 10 phát/s
    expect(ws.ammo[0]).toBe(AK.magSize - shots.length)
    expect(ws.shotSeq).toBe(shots.length)
  })

  it('hết đạn: tự reload một lần (dry), xong nạp đầy', () => {
    const ws = makeWeaponState()
    const ev = run(ws, 60 * 8, () => true)
    expect(ev.filter(x => x.e === 'dry').length).toBeGreaterThanOrEqual(1)
    const dry = ev.find(x => x.e === 'dry')!
    const end = ev.find(x => x.e === 'reloadEnd')!
    expect(end.t - dry.t).toBeGreaterThanOrEqual(AK.reloadMs)
    expect(end.t - dry.t).toBeLessThan(AK.reloadMs + 2 * DT * 1000)
    // không bắn trong lúc reload
    expect(ev.filter(x => x.e === 'fired' && x.t > dry.t && x.t < end.t).length).toBe(0)
  })

  it('bán tự động: giữ cò chỉ 1 phát; click nhanh bị giới hạn theo fireInterval', () => {
    const ws = makeWeaponState()
    ws.current = 2
    expect(run(ws, 120, () => true).filter(x => x.e === 'fired').length).toBe(1)

    const ws2 = makeWeaponState()
    ws2.current = 2
    // click mỗi 2 tick (30 click/s) trong 1 giây
    const ev = run(ws2, 60, t => t % 2 === 0)
    const shots = ev.filter(x => x.e === 'fired').length
    // fireInterval làm tròn lên bội số tick (160ms → 10 tick = 166.7ms) → 6 phát/s
    expect(shots).toBeLessThanOrEqual(Math.ceil(1000 / COLT.fireIntervalMs))
    expect(shots).toBeGreaterThanOrEqual(5)
  })

  it('đổi súng huỷ reload', () => {
    const ws = makeWeaponState()
    ws.ammo[0] = 5
    stepWeapon(ws, 0, false, true)
    expect(ws.reloadEndMs).toBeGreaterThan(0)
    switchWeapon(ws, 1, 100)
    expect(ws.reloadEndMs).toBe(0)
    expect(ws.ammo[0]).toBe(5)
    expect(tryFire(ws, WEAPONS[1]!, 100, true)).toBe(false)   // đang khoá đổi súng
  })
})

describe('spread', () => {
  it('air > move > crouch > stand', () => {
    const air = spreadFor(AK, false, 0, false)
    const move = spreadFor(AK, true, 5, false)
    const crouch = spreadFor(AK, true, 0, true)
    const stand = spreadFor(AK, true, 0, false)
    expect(air).toBeGreaterThan(move)
    expect(move).toBeGreaterThan(stand)
    expect(stand).toBeGreaterThan(crouch)
    expect(spreadFor(AK, false, 5, true)).toBe(air)
  })
})

describe('computeShot', () => {
  it('cùng playerId + shotSeq + trạng thái → cùng hướng', () => {
    const a: [number, number, number] = [0, 0, 0]
    const b: [number, number, number] = [0, 0, 0]
    computeShot(a, makeRecoilState(), AK, 7, 42, 0.3, 0.1, 2)
    computeShot(b, makeRecoilState(), AK, 7, 42, 0.3, 0.1, 2)
    expect(a).toEqual(b)
    computeShot(b, makeRecoilState(), AK, 7, 43, 0.3, 0.1, 2)
    expect(a).not.toEqual(b)
  })

  it('lệch không vượt quá nón spread; spread 0 thì trúng đúng hướng nhìn', () => {
    const d: [number, number, number] = [0, 0, 0]
    computeShot(d, makeRecoilState(), AK, 1, 0, 0, 0, 0)
    expect(d[2]).toBeCloseTo(-1, 9)
    const maxDeg = 5
    for (let i = 0; i < 200; i++) {
      computeShot(d, makeRecoilState(), AK, 1, i, 0, 0, maxDeg)
      const angle = Math.acos(-d[2]) * 180 / Math.PI
      expect(angle).toBeLessThanOrEqual(maxDeg + 0.01)
    }
  })

  it('recoil cộng dồn mỗi phát rồi hồi về 0', () => {
    const rec = makeRecoilState()
    const ws = makeWeaponState()
    const d: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < 5; i++) computeShot(d, rec, AK, 1, i, 0, 0, 0)
    expect(rec.pitch).toBeCloseTo(5 * AK.recoilPitchDeg * Math.PI / 180, 9)
    for (let i = 0; i < 600; i++) recoverRecoil(rec, AK, ws, 10_000 + i * 16, 1 / 60)
    expect(rec.pitch).toBe(0)
    expect(rec.yaw).toBe(0)
  })
})

describe('sniper + ngắm', () => {
  const SNIPER = WEAPONS[4]!
  const st = (over: Partial<PlayerState> = {}) => ({ grounded: true, crouching: false, slideTimer: 0, vel: [0, 0, 0], ...over }) as PlayerState

  it('thông số theo plan: 1 phát/1,2s, 90 dmg, đầu ×2, scope FOV 30, một tầng', () => {
    expect(SNIPER.fireIntervalMs).toBe(1200)
    expect(SNIPER.damage).toBe(90)
    expect(SNIPER.headMult).toBe(2)
    expect(SNIPER.ads).toEqual({ fovs: [30], scope: true })
  })
  it('không ngắm: spread rất lớn; ngắm đứng yên: gần như 0; ngắm mà di chuyển/nhảy: vẫn lớn', () => {
    expect(shotSpread(SNIPER, st(), 0)).toBeGreaterThanOrEqual(4)
    expect(shotSpread(SNIPER, st(), Btn.Aim)).toBeLessThan(0.1)
    expect(shotSpread(SNIPER, st({ vel: [3, 0, 0] }), Btn.Aim | Btn.Forward)).toBeGreaterThanOrEqual(4)
    expect(shotSpread(SNIPER, st({ grounded: false }), Btn.Aim)).toBeGreaterThanOrEqual(4)
  })
  it('súng trường: ngắm đứng yên chụm hơn, ngắm khi chạy không đổi; ADS không che màn hình', () => {
    expect(shotSpread(AK, st(), Btn.Aim)).toBeLessThan(shotSpread(AK, st(), 0))
    expect(shotSpread(AK, st({ vel: [3, 0, 0] }), Btn.Aim | Btn.Forward)).toBe(shotSpread(AK, st({ vel: [3, 0, 0] }), Btn.Forward))
    expect(AK.ads).toEqual({ fovs: [65], scope: false })
    expect(WEAPONS[1]!.ads?.scope).toBe(false)
    expect(COLT.ads).toBeUndefined()
  })
  it('sniper hồi recoil ngay sau ~120ms (không đợi hết 1,2s giữa hai phát)', () => {
    const ws = makeWeaponState(); ws.current = 4
    const rec = makeRecoilState(); rec.pitch = 0.05
    ws.nextFireMs = 1200   // vừa bắn lúc t=0
    recoverRecoil(rec, SNIPER, ws, 100, 0.016)
    expect(rec.pitch).toBe(0.05)
    recoverRecoil(rec, SNIPER, ws, 130, 0.016)
    expect(rec.pitch).toBeLessThan(0.05)
  })
})

describe('shotgun', () => {
  const SG = WEAPONS[5]!
  const mk = () => Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])

  it('8 tia/phát, mỗi tia một hướng khác nhau, lặp lại được theo seed', () => {
    const a = mk(), b = mk()
    expect(computeShotDirs(a, makeRecoilState(), SG, 7, 3, 0, 0, SG.spreadDeg.stand)).toBe(8)
    computeShotDirs(b, makeRecoilState(), SG, 7, 3, 0, 0, SG.spreadDeg.stand)
    expect(b.slice(0, 8)).toEqual(a.slice(0, 8))
    expect(new Set(a.slice(0, 8).map(d => d.join(','))).size).toBe(8)
    const c = mk(); computeShotDirs(c, makeRecoilState(), SG, 7, 4, 0, 0, SG.spreadDeg.stand)   // phát khác → khác
    expect(c[0]).not.toEqual(a[0])
  })
  it('recoil chỉ cộng một lần cho cả phát, không phải 8 lần', () => {
    const rec = makeRecoilState()
    computeShotDirs(mk(), rec, SG, 1, 0, 0, 0, SG.spreadDeg.stand)
    expect(rec.pitch).toBeCloseTo(SG.recoilPitchDeg * Math.PI / 180, 6)
  })
  it('súng 1 tia dùng đúng computeShot cũ (cùng hướng, cùng recoil)', () => {
    const o1 = mk(), r1 = makeRecoilState(), r2 = makeRecoilState()
    const o2: [number, number, number] = [0, 0, 0]
    computeShotDirs(o1, r1, AK, 5, 9, 0.3, 0.1, 0.5)
    computeShot(o2, r2, AK, 5, 9, 0.3, 0.1, 0.5)
    expect(o1[0]).toEqual(o2); expect(r1).toEqual(r2)
  })
  it('sát thương giảm theo khoảng cách', () => {
    expect(damageFalloff(SG, 3)).toBe(1)
    expect(damageFalloff(SG, 18)).toBeCloseTo(0.6, 5)
    expect(damageFalloff(SG, 50)).toBe(0.2)
    expect(damageFalloff(AK, 100)).toBe(1)
  })
})
