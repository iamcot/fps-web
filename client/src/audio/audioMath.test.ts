import { describe, it, expect } from 'vitest'
import {
  dbToGain, pickNoRepeat, lowAmmoActive, lowAmmoPitchFactor, reloadInsertTimes,
  distanceCutoff, ComboTracker, HitDeduper,
} from './audioMath'

describe('audioMath', () => {
  it('dbToGain', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2)
    expect(dbToGain(20)).toBeCloseTo(10, 6)
  })

  it('pickNoRepeat không lặp file vừa dùng khi có ≥ 2 file', () => {
    const items = ['a', 'b', 'c']
    for (let i = 0; i < 200; i++) expect(pickNoRepeat(items, 'b', Math.random)).not.toBe('b')
    expect(pickNoRepeat(['x'], 'x', Math.random)).toBe('x')
    expect(pickNoRepeat([], undefined, Math.random)).toBeUndefined()
  })

  it('cảnh báo sắp hết đạn: AK 30 viên báo 8 viên cuối, Rulô báo từ viên thứ 5', () => {
    const flagged = (mag: number) => {
      let n = 0
      for (let left = mag - 1; left >= 0; left--) if (lowAmmoActive(left, mag)) n++
      return n
    }
    expect(flagged(30)).toBe(8)
    expect(lowAmmoActive(2, 6)).toBe(false)   // viên thứ 4
    expect(lowAmmoActive(1, 6)).toBe(true)    // viên thứ 5
    expect(lowAmmoActive(0, 6)).toBe(true)
  })

  it('pitch cảnh báo tăng dần tới 1.6 ở viên cuối', () => {
    expect(lowAmmoPitchFactor(7, 30)).toBeLessThan(lowAmmoPitchFactor(3, 30))
    expect(lowAmmoPitchFactor(0, 30)).toBeCloseTo(1.6, 9)
  })

  it('rulô nhét đúng n viên, rải đều trong from..to', () => {
    expect(reloadInsertTimes(0, 0.35, 0.8)).toEqual([])
    expect(reloadInsertTimes(1, 0.35, 0.8)).toEqual([0.575])
    const t = reloadInsertTimes(6, 0.35, 0.8)
    expect(t.length).toBe(6)
    expect(t[0]).toBeCloseTo(0.35, 9)
    expect(t[5]).toBeCloseTo(0.8, 9)
  })

  it('lowpass theo khoảng cách: gần trong, xa đục, kẹp 1500Hz', () => {
    expect(distanceCutoff(0)).toBe(18000)
    expect(distanceCutoff(15)).toBeCloseTo(9000, 6)
    expect(distanceCutoff(500)).toBe(1500)
  })

  it('combo cao độ: +3% mỗi lần, tối đa +15%, quá 400ms về gốc', () => {
    const c = new ComboTracker()
    expect(c.hit(0)).toBe(1)
    expect(c.hit(100)).toBeCloseTo(1.03, 9)
    expect(c.hit(200)).toBeCloseTo(1.06, 9)
    for (let i = 0; i < 20; i++) c.hit(300 + i * 50)
    expect(c.hit(1400)).toBeCloseTo(1.15, 9)
    expect(c.hit(1900)).toBe(1)   // dừng > 400ms
  })

  it('dedupe 30ms: chỉ phát lại nếu nặng hơn', () => {
    const d = new HitDeduper()
    expect(d.accept(0, 1)).toBe(true)
    expect(d.accept(10, 1)).toBe(false)
    expect(d.accept(15, 3)).toBe(true)    // kill đè hit
    expect(d.accept(20, 2)).toBe(false)
    expect(d.accept(100, 1)).toBe(true)   // ngoài 30ms
  })
})
