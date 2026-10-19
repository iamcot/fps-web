import { describe, it, expect } from 'vitest'
import { LagHistory, type PastPlayer } from './lagComp'

const pl = (id: number, x: number, crouching = false, alive = true) => ({ id, state: { pos: [x, 0, 0], crouching }, alive })
const out = (): PastPlayer => ({ pos: [0, 0, 0], crouching: false, alive: true })

describe('LagHistory', () => {
  it('nội suy tuyến tính vị trí giữa hai mục', () => {
    const h = new LagHistory()
    h.record(1000, [pl(1, 0)])
    h.record(1016, [pl(1, 1.6)])
    expect(h.locate(1008)).toBe(true)
    const o = out()
    expect(h.get(1, o)).toBe(true)
    expect(o.pos[0]).toBeCloseTo(0.8)
  })

  it('crouching/alive lấy theo mục trước', () => {
    const h = new LagHistory()
    h.record(0, [pl(1, 0, false, true)])
    h.record(16, [pl(1, 0, true, false)])
    h.locate(10)
    const o = out(); h.get(1, o)
    expect(o.crouching).toBe(false)
    expect(o.alive).toBe(true)
  })

  it('t mới hơn mục mới nhất / cũ hơn mục cũ nhất: dùng mục biên', () => {
    const h = new LagHistory()
    h.record(100, [pl(1, 5)]); h.record(116, [pl(1, 6)])
    const o = out()
    h.locate(999); h.get(1, o); expect(o.pos[0]).toBe(6)
    h.locate(-5);  h.get(1, o); expect(o.pos[0]).toBe(5)
  })

  it('ring buffer: ghi nhiều hơn dung lượng vẫn tìm đúng, cũ nhất ≈ HITBOX_HISTORY_MS', () => {
    const h = new LagHistory()
    for (let i = 0; i < 500; i++) h.record(i * 16.667, [pl(1, i)])
    expect(h.newestTime).toBeCloseTo(499 * 16.667)
    expect(h.newestTime - h.oldestTime).toBeGreaterThanOrEqual(990)
    h.locate(470 * 16.667 + 8.3335); const o = out(); h.get(1, o)
    expect(o.pos[0]).toBeCloseTo(470.5)
  })

  it('người mới vào (chỉ có ở mục sau) vẫn lấy được; người không có thì false', () => {
    const h = new LagHistory()
    h.record(0, [pl(1, 0)]); h.record(16, [pl(1, 0), pl(2, 7)])
    h.locate(8); const o = out()
    expect(h.get(2, o)).toBe(false)   // không có ở mục trước → bỏ qua phát này
    expect(h.get(3, o)).toBe(false)
  })

  it('chưa có lịch sử: locate false', () => {
    expect(new LagHistory().locate(5)).toBe(false)
  })
})
