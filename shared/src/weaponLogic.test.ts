import { describe, it, expect } from 'vitest'
import { WEAPONS, makeWeaponState, MAX_PELLETS } from './weapons'
import {
  stepWeapon, tryFire, computeShot, makeRecoilState, recoverRecoil, switchWeapon, computeShotDirs, damageFalloff,
} from './weaponLogic'
import { Btn } from './movement'
import type { PlayerState } from './movement'
import { DT } from './constants'
import { moveSpeedMul, adsMoveFor, adsWanted, stepWeaponCmd, selectSlot, copyWeaponState, weaponStatesEqual } from './weaponLogic'
import { weaponByKey, CATEGORY_SLOT } from './weapons'
import { stepMovement, defaultMovement } from './movement'

const AK_SLOTS = [6, 2, -1, 0, -1]   // AK47 ở ô 3, ô 4 (lựu đạn) trống
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
    const ws = makeWeaponState(AK_SLOTS)
    const ev = run(ws, 60, () => true)   // 1 giây
    const shots = ev.filter(x => x.e === 'fired')
    expect(shots.length).toBe(Math.ceil(1000 / AK.fireIntervalMs))   // 100ms → 10 phát/s
    expect(ws.ammo[0]).toBe(AK.magSize - shots.length)
    expect(ws.shotSeq).toBe(shots.length)
  })

  it('hết đạn: tự reload một lần (dry), xong nạp đầy', () => {
    const ws = makeWeaponState(AK_SLOTS)
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
    const ws = makeWeaponState(AK_SLOTS)
    ws.current = 2
    expect(run(ws, 120, () => true).filter(x => x.e === 'fired').length).toBe(1)

    const ws2 = makeWeaponState(AK_SLOTS)
    ws2.current = 2
    // click mỗi 2 tick (30 click/s) trong 1 giây
    const ev = run(ws2, 60, t => t % 2 === 0)
    const shots = ev.filter(x => x.e === 'fired').length
    // fireInterval làm tròn lên bội số tick (160ms → 10 tick = 166.7ms) → 6 phát/s
    expect(shots).toBeLessThanOrEqual(Math.ceil(1000 / COLT.fireIntervalMs))
    expect(shots).toBeGreaterThanOrEqual(5)
  })

  it('đổi súng huỷ reload', () => {
    const ws = makeWeaponState(AK_SLOTS)
    ws.ammo[0] = 5
    stepWeapon(ws, 0, false, true)
    expect(ws.reloadEndMs).toBeGreaterThan(0)
    switchWeapon(ws, 1, 100)
    expect(ws.reloadEndMs).toBe(0)
    expect(ws.ammo[0]).toBe(5)
    expect(tryFire(ws, WEAPONS[1]!, 100, true)).toBe(false)   // đang khoá đổi súng
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
    const ws = makeWeaponState(AK_SLOTS)
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

  it('thông số theo plan: 1 phát/1,2s, 90 dmg, đầu ×2, scope FOV 30, một tầng', () => {
    expect(SNIPER.fireIntervalMs).toBe(1200)
    expect(SNIPER.damage).toBe(90)
    expect(SNIPER.headMult).toBe(2)
    expect(SNIPER.ads?.scope).toBe(true)
    expect(SNIPER.ads?.fovMult).toBeCloseTo(0.4)
  })
  it('súng trường ngắm không che màn hình; súng ngắn dao lựu đạn không ngắm; shotgun và SMG không ngắm', () => {
    expect(AK.ads?.scope).toBe(false)
    expect(WEAPONS[1]!.ads?.scope).toBe(false)
    expect(WEAPONS[5]!.ads).toBeUndefined()   // shotgun và SMG (dòng súng vừa) không ngắm
    expect(WEAPONS[7]!.ads).toBeUndefined()
    expect(WEAPONS[6]!.ads).toBeUndefined()
  })
  it('adsMoveFor/adsWanted: không ngắm khi nạp hoặc khoá đổi súng', () => {
    const ws = makeWeaponState(AK_SLOTS)
    expect(adsMoveFor(ws)).toEqual({ inMs: AK.ads!.inMs, outMs: AK.ads!.outMs, moveMult: AK.ads!.moveMult })
    expect(adsWanted(ws, Btn.Aim, 0)).toBe(true)
    expect(adsWanted(ws, 0, 0)).toBe(false)
    ws.reloadEndMs = 500
    expect(adsWanted(ws, Btn.Aim, 0)).toBe(false)
    ws.reloadEndMs = 0
    selectSlot(ws, 1, 1000)
    expect(adsWanted(ws, Btn.Aim, 1100)).toBe(false)
    expect(adsWanted(ws, Btn.Aim, 1000 + 300)).toBe(true)
  })
  it('sniper hồi recoil ngay sau ~120ms (không đợi hết 1,2s giữa hai phát)', () => {
    const ws = makeWeaponState(AK_SLOTS); ws.current = 4
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
    expect(computeShotDirs(a, makeRecoilState(), SG, 7, 3, 0, 0, SG.spread.moveDeg)).toBe(8)
    computeShotDirs(b, makeRecoilState(), SG, 7, 3, 0, 0, SG.spread.moveDeg)
    expect(b.slice(0, 8)).toEqual(a.slice(0, 8))
    expect(new Set(a.slice(0, 8).map(d => d.join(','))).size).toBe(8)
    const c = mk(); computeShotDirs(c, makeRecoilState(), SG, 7, 4, 0, 0, SG.spread.moveDeg)   // phát khác → khác
    expect(c[0]).not.toEqual(a[0])
  })
  it('recoil chỉ cộng một lần cho cả phát, không phải 8 lần', () => {
    const rec = makeRecoilState()
    computeShotDirs(mk(), rec, SG, 1, 0, 0, 0, SG.spread.moveDeg)
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


describe('vũ khí mới (H.1)', () => {
  const SHOTGUN = weaponByKey('shotgun')!, SMG = weaponByKey('smg')!, KNIFE = weaponByKey('knife')!, SNIPER = weaponByKey('sniper')!

  it('mỗi súng có dòng/ô hợp lệ, dao không mua được, giá khớp bảng', () => {
    const price: Record<string, number> = { knife: 0, colt: 300, rulo: 700, shotgun: 1100, smg: 1250, ak47: 2700, m16: 3100, sniper: 4750, m67: 300 }
    expect(WEAPONS.length).toBe(9)   // 8 súng + lựu đạn M67
    for (const w of WEAPONS) {
      expect(price[w.key], w.key).toBe(w.price)
      expect(CATEGORY_SLOT[w.category]).toBeGreaterThanOrEqual(0)
    }
    expect(KNIFE.buyable).toBe(false)
  })

  it('shotgun: 8 tia; 3m đủ sát thương, 25m giảm còn ~37% (falloff nội suy)', () => {
    expect(SHOTGUN.pellets).toBe(8)
    expect(damageFalloff(SHOTGUN, 3)).toBe(1)
    expect(8 * SHOTGUN.damage * damageFalloff(SHOTGUN, 3)).toBe(8 * SHOTGUN.damage)
    expect(damageFalloff(SHOTGUN, 25)).toBeCloseTo(1 + (0.2 - 1) * (25 - 6) / (30 - 6), 6)
    expect(damageFalloff(SHOTGUN, 100)).toBe(0.2)
    expect(damageFalloff(SMG, 10)).toBe(1)
    expect(damageFalloff(SMG, 40)).toBe(0.6)
  })

  it('shotgun: cùng playerId + shotSeq → 8 hướng tia giống hệt giữa 2 lần chạy', () => {
    const mk = () => Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])
    const a = mk(), b = mk()
    expect(computeShotDirs(a, makeRecoilState(), SHOTGUN, 7, 12, 0.4, 0.1, 4)).toBe(8)
    computeShotDirs(b, makeRecoilState(), SHOTGUN, 7, 12, 0.4, 0.1, 4)
    expect(a.slice(0, 8)).toEqual(b.slice(0, 8))
    expect(a[0]).not.toEqual(a[1])
  })

  it('dao: không đạn, không reload, giữ cò chém liên tục theo fireInterval, không spread/recoil', () => {
    const ws = makeWeaponState([KNIFE.id, -1, -1, -1])
    expect(ws.current).toBe(KNIFE.id)
    const ev = run(ws, 60, () => true)
    expect(ev.filter(x => x.e === 'fired').length).toBe(Math.ceil(1000 / KNIFE.fireIntervalMs))
    expect(ev.some(x => x.e === 'dry' || x.e === 'reloadStart')).toBe(false)
    expect(KNIFE.range).toBeCloseTo(2.2)
    const out: [number, number, number] = [0, 0, 0], rec = makeRecoilState()
    computeShot(out, rec, KNIFE, 1, 0, 0, 0, 0)
    expect(out).toEqual([-0, 0, -1])
    expect(rec).toEqual({ pitch: 0, yaw: 0 })
  })

  it('dao: bấm R không nạp', () => {
    const ws = makeWeaponState([KNIFE.id, -1, -1, -1])
    expect(stepWeapon(ws, 0, false, true)).toBe('none')
  })

  it('moveSpeedMul: dao nhanh hơn AK47; sniper ngắm hẳn chậm thêm một nửa (qua adsT)', () => {
    const knife = makeWeaponState([KNIFE.id, -1, -1, -1]), ak = makeWeaponState(AK_SLOTS)
    expect(moveSpeedMul(knife)).toBeGreaterThan(moveSpeedMul(ak))
    const sn = makeWeaponState([-1, -1, -1, SNIPER.id])
    expect(moveSpeedMul(sn)).toBe(SNIPER.moveSpeedMul)
    expect(adsMoveFor(sn)!.moveMult).toBe(0.5)
  })

  it('cmd.weapon là ô: chỉ đổi khi giá trị đổi; ô trống bị bỏ qua; cmd cũ không kéo ngược ô vừa mua', () => {
    const ws = makeWeaponState([KNIFE.id, 2, -1, 0, -1])   // ô 3 = AK47
    const cmd = (seq: number, weapon: number) => ({ seq, buttons: 0, yaw: 0, pitch: 0, weapon })
    stepWeaponCmd(ws, cmd(0, 2))      // ô vừa trống
    expect(ws.slot).toBe(3)
    stepWeaponCmd(ws, cmd(1, 0))      // dao
    expect(ws.current).toBe(KNIFE.id); expect(ws.slot).toBe(0)
    // server "mua" SMG ở ô 2 và chuyển sang đó
    ws.slots[2] = SMG.id; ws.slot = 2; ws.current = SMG.id
    stepWeaponCmd(ws, cmd(2, 0))      // cmd cũ còn bay (cùng ô 0): không kéo về dao
    expect(ws.current).toBe(SMG.id)
    stepWeaponCmd(ws, cmd(3, 2))      // client bấm ô 2 → no-op (đang cầm)
    expect(ws.current).toBe(SMG.id)
    stepWeaponCmd(ws, cmd(4, 3))
    expect(ws.current).toBe(0)
    expect(selectSlot(ws, 9, 0)).toBe(false)
    const copy = makeWeaponState(); copyWeaponState(copy, ws)
    expect(weaponStatesEqual(copy, ws)).toBe(true)
    copy.slots[2] = -1
    expect(weaponStatesEqual(copy, ws)).toBe(false)
  })

  it('movement: speedMul nhân tốc độ chạy; mặc định 1 giữ nguyên hành vi cũ', () => {
    const flat = {
      moveCharacter: (pos: [number, number, number], d: [number, number, number]) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]] as [number, number, number], grounded: true, hitCeiling: false }),
      canStand: () => true, castRay: () => null, castSphere: () => null, debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }), dispose: () => {},
    }
    const speedAfter = (mul?: number) => {
      let st: PlayerState = { pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0 }
      for (let i = 0; i < 180; i++) st = stepMovement(st, { seq: i, buttons: Btn.Forward, yaw: 0, pitch: 0, weapon: 0 }, flat, defaultMovement, DT, mul)
      return Math.hypot(st.vel[0], st.vel[2])
    }
    expect(speedAfter()).toBeCloseTo(speedAfter(1), 9)
    expect(speedAfter(1.1)).toBeCloseTo(defaultMovement.runSpeed * 1.1, 1)
    expect(speedAfter(0.92)).toBeCloseTo(defaultMovement.runSpeed * 0.92, 1)
  })
})
