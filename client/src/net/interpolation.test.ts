import { describe, it, expect } from 'vitest'
import { INTERP_DELAY_MS, type NetPlayer } from '@fps/shared'
import { Interpolator, interp } from './interpolation'

const np = (id: number, x: number, yaw = 0, pitch = 0, flags = 0): NetPlayer =>
  ({ id, pos: [x, 0, 0], vel: [0, 0, 0], yaw, pitch, flags, slideTimer: 0, slideCooldown: 0, adsT: 0, hp: 100, team: 'A', weapon: 0, killStreak: 0 })
const D = INTERP_DELAY_MS

describe('Interpolator', () => {
  it('nội suy tuyến tính giữa hai snapshot', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0)]); ip.push(1050, [np(2, 10)])
    const [p] = ip.sample(1025 + D)
    expect(p!.pos[0]).toBeCloseTo(5)
  })

  it('pitch lerp, cờ lấy của a', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0, 0, 0.2, 1)]); ip.push(1050, [np(2, 0, 0, 0.6, 3)])
    const [p] = ip.sample(1025 + D)
    expect(p!.pitch).toBeCloseTo(0.4)
    expect(p!.flags).toBe(1)
  })

  it('yaw đi đường ngắn qua ±π', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0, Math.PI - 0.1)]); ip.push(1050, [np(2, 0, -Math.PI + 0.1)])
    const [p] = ip.sample(1025 + D)
    // đi đường ngắn: qua π, không quay ngược lại qua 0
    expect(Math.abs(Math.cos(p!.yaw) + 1)).toBeLessThan(1e-9)
    const [q] = ip.sample(1010 + D)
    expect(Math.abs(q!.yaw)).toBeGreaterThan(Math.PI - 0.1)
  })

  it('không có snapshot sau: giữ ở snapshot cuối, không ngoại suy; quá 250ms thì stale', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0)]); ip.push(1050, [np(2, 10)])
    let [p] = ip.sample(1100 + D)   // trễ 50ms
    expect(p!.pos[0]).toBe(10); expect(p!.stale).toBe(false)
    ;[p] = ip.sample(1400 + D)      // trễ 350ms
    expect(p!.pos[0]).toBe(10); expect(p!.stale).toBe(true)
  })

  it('renderTime trước snapshot đầu: dùng snapshot đầu', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 3)]); ip.push(1050, [np(2, 10)])
    expect(ip.sample(500 + D)[0]!.pos[0]).toBe(3)
  })

  it('chọn đúng cặp khi buffer có nhiều snapshot', () => {
    const ip = new Interpolator()
    for (let k = 0; k < 10; k++) ip.push(1000 + k * 50, [np(2, k * 10)])
    expect(ip.sample(1175 + D)[0]!.pos[0]).toBeCloseTo(35)
  })

  it('giữ ~1 giây snapshot', () => {
    const ip = new Interpolator()
    for (let k = 0; k < 100; k++) ip.push(1000 + k * 50, [np(2, k)])
    // 100 snapshot = 5s; phần cũ hơn 1s phải bị bỏ → renderTime cũ nhất còn hợp lệ ≈ 1s trước snapshot cuối
    const lastT = 1000 + 99 * 50
    expect(ip.sample(lastT - 3000 + D)[0]!.pos[0]).toBeGreaterThan(75)
  })

  it('bỏ người không còn trong snapshot và bỏ qua chính mình', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(1, 0), np(2, 0)], 1)
    expect(ip.sample(1000 + D).map(p => p.id)).toEqual([2])
    ip.push(1050, [np(1, 0)], 1)
    expect(ip.sample(1050 + D).length).toBe(0)
  })

  it('ghi currentRenderTime = serverNow − INTERP_DELAY_MS', () => {
    const ip = new Interpolator()
    ip.sample(5000)
    expect(interp.currentRenderTime).toBe(5000 - D)
  })

  it('snapshot cũ/trùng serverTime bị bỏ', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0)]); ip.push(1000, [np(2, 99)]); ip.push(900, [np(2, 99)])
    expect(ip.sample(5000)[0]!.pos[0]).toBe(0)
  })
})

import { InterpDelay } from './interpolation'

describe('InterpDelay', () => {
  it('mẫu đầu đặt thẳng INTERP_DELAY_MS + trễ một chiều', () => {
    const d = new InterpDelay()
    expect(d.update(80)).toBe(D + 80)
  })

  it('chưa đo được (0) thì dùng INTERP_DELAY_MS, rồi nhận giá trị thật ngay ở mẫu đầu', () => {
    const d = new InterpDelay()
    expect(d.update(0)).toBe(D)
    expect(d.update(60)).toBe(D + 60)
  })

  it('đổi dần ≤1ms/frame cả hai chiều', () => {
    const d = new InterpDelay()
    d.update(50)
    expect(d.update(100)).toBe(D + 51)
    for (let i = 0; i < 100; i++) d.update(100)
    expect(d.value).toBe(D + 100)
    expect(d.update(20)).toBe(D + 99)
  })

  it('chặn trễ một chiều quá lớn', () => {
    expect(new InterpDelay().update(5000)).toBe(D + 250)
  })

  it('sample dùng delay truyền vào', () => {
    const ip = new Interpolator()
    ip.push(1000, [np(2, 0)]); ip.push(1050, [np(2, 10)])
    expect(ip.sample(1025 + 180, 180)[0]!.pos[0]).toBeCloseTo(5)
    expect(interp.delayMs).toBe(180)
  })
})
