import { describe, it, expect } from 'vitest'
import { ClockSync } from './clock'

describe('ClockSync', () => {
  it('offset = serverTime + rtt/2 − now', () => {
    let now = 1000
    const c = new ClockSync(() => now)
    // gửi lúc 900, nhận lúc 1000 → rtt 100; server đọc 5000 giữa chừng → offset = 5000+50−1000
    c.addSample(900, 5000)
    expect(c.offset).toBe(4050)
    expect(c.serverNow()).toBe(5050)
  })

  it('dùng mẫu có RTT nhỏ nhất', () => {
    let now = 0
    const c = new ClockSync(() => now)
    now = 300; c.addSample(100, 10_000)     // rtt 200, offset 9800
    now = 1100; c.addSample(1060, 10_900)   // rtt 40, offset 9820
    now = 2300; c.addSample(2100, 12_100)   // rtt 200, offset 9900
    c.tick()
    expect(c.offset).toBe(9820)
  })

  it('mẫu cũ hơn 8 bị bỏ', () => {
    let now = 0
    const c = new ClockSync(() => now)
    now = 10; c.addSample(0, 1000)            // rtt 10 (tốt nhất) offset 995
    for (let i = 1; i <= 8; i++) { now = i * 1000 + 100; c.addSample(i * 1000, i * 1000 + 5000) } // rtt 100
    c.tick()
    expect(c.offset).toBe(5000 + 50 - 100)    // mẫu đầu đã bị đẩy ra
  })

  it('offset giảm thì hạ dần ≤1ms/frame, serverNow không lùi', () => {
    let now = 0
    const c = new ClockSync(() => now)
    now = 20; c.addSample(0, 1000)   // rtt 20
    const start = c.offset
    now = 1020; c.addSample(1010, 1015 + start - 30) // rtt 10 (tốt hơn), offset thấp hơn 30ms
    let prev = c.serverNow()
    let frames = 0
    while (c.offset > start - 30 + 1e-9) {
      now += 16; c.tick(); frames++
      const cur = c.serverNow()
      expect(cur).toBeGreaterThan(prev)
      prev = cur
    }
    expect(frames).toBe(30)
  })

  it('offset tăng thì nhảy ngay', () => {
    let now = 20
    const c = new ClockSync(() => now)
    c.addSample(0, 1000)
    const o = c.offset
    now = 1040; c.addSample(1030, 1035 + o + 500)   // rtt 10 nhỏ hơn → được chọn
    c.tick()
    expect(c.offset).toBeCloseTo(o + 500, 6)
  })
})
