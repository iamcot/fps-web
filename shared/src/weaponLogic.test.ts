import { describe, it, expect } from 'vitest'
import { WEAPONS, makeWeaponState } from './weapons'
import {
  stepWeapon, tryFire, computeShot, spreadFor, makeRecoilState, recoverRecoil, switchWeapon,
} from './weaponLogic'
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
