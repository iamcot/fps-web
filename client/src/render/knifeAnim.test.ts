import { describe, it, expect } from 'vitest'
import { KnifeAnim, FLOURISH_KINDS } from './knifeAnim'

const DT = 1 / 60

function run(k: KnifeAnim, seconds: number, opts: { idle?: boolean; speedN?: number; bobPhase?: number; bobAmp?: number } = {}): void {
  const n = Math.round(seconds / DT)
  for (let i = 0; i < n; i++) k.update(DT, true, opts.idle ?? true, opts.speedN ?? 0, opts.bobPhase ?? 0, opts.bobAmp ?? 0)
}
const mag = (k: KnifeAnim): number => Math.hypot(k.fx.px, k.fx.py, k.fx.pz, k.fx.rx, k.fx.ry, k.fx.rz)

describe('KnifeAnim', () => {
  it('không cầm dao thì độ lệch bằng 0', () => {
    const k = new KnifeAnim()
    k.update(DT, false, true, 0, 0, 0)
    expect(mag(k)).toBe(0)
  })

  it('đứng yên chỉ thở rất nhẹ', () => {
    const k = new KnifeAnim()
    for (let i = 0; i < 120; i++) { k.update(DT, true, true, 0, 0, 0); expect(Math.abs(k.fx.py)).toBeLessThan(0.01); expect(Math.abs(k.fx.rx)).toBeLessThan(0.02) }
  })

  it('quay trái (yaw tăng) thì dao trễ sang phải: px > 0, ry < 0', () => {
    const k = new KnifeAnim()
    k.update(DT, true, true, 0, 0, 0)
    let yaw = 0
    for (let i = 0; i < 20; i++) { yaw += 0.05; k.setLook(yaw, 0); k.update(DT, true, true, 0, 0, 0) }
    expect(k.fx.px).toBeGreaterThan(0)
    expect(k.fx.ry).toBeLessThan(0)
  })

  it('quán tính chuột hồi về 0 khi ngừng quay', () => {
    const k = new KnifeAnim()
    let yaw = 0
    for (let i = 0; i < 20; i++) { yaw += 0.05; k.setLook(yaw, 0); k.update(DT, true, true, 0, 0, 0) }
    k.setLook(yaw, 0)
    run(k, 1)
    expect(Math.abs(k.fx.ry)).toBeLessThan(0.003)
  })

  it('yaw quấn vòng (±π) không tạo giật', () => {
    const k = new KnifeAnim()
    k.setLook(Math.PI - 0.001, 0); k.update(DT, true, true, 0, 0, 0)
    k.setLook(-Math.PI + 0.001, 0); k.update(DT, true, true, 0, 0, 0)
    expect(Math.abs(k.fx.ry)).toBeLessThan(0.05)
  })

  it('chạy nước rút hạ thấp và chúc mũi dao; đi chậm thì không', () => {
    const slow = new KnifeAnim(), fast = new KnifeAnim()
    slow.setMotion(3, true); fast.setMotion(8.5, true)
    run(slow, 1, { speedN: 0.35, bobAmp: 0.35 }); run(fast, 1, { speedN: 1, bobAmp: 1 })
    expect(fast.fx.rx).toBeLessThan(slow.fx.rx - 0.15)
    expect(fast.fx.py).toBeLessThan(slow.fx.py)
  })

  it('đi sang phải nghiêng dương, sang trái nghiêng âm', () => {
    const r = new KnifeAnim(), l = new KnifeAnim()
    r.setMove(6, 0); l.setMove(-6, 0)
    run(r, 0.2); run(l, 0.2)
    expect(r.fx.rz).toBeGreaterThan(0.1)
    expect(l.fx.rz).toBeLessThan(-0.1)
  })

  it('tiếp đất sau cú rơi nhanh thì nhún xuống rồi hồi', () => {
    const k = new KnifeAnim()
    k.setMove(0, -10); k.setMotion(0, false); run(k, 0.1)
    k.setMove(0, 0); k.setMotion(0, true)
    k.update(DT, true, true, 0, 0, 0)
    expect(k.fx.py).toBeLessThan(-0.03)
    run(k, 1)
    expect(Math.abs(k.fx.py)).toBeLessThan(0.006)
  })

  it('rút dao: xoay đủ một vòng rồi kết thúc đúng góc ban đầu', () => {
    const k = new KnifeAnim()
    k.startDraw()
    k.update(DT, true, false, 0, 0, 0)
    expect(k.drawing).toBe(true)
    expect(k.fx.rx).toBeGreaterThan(Math.PI)   // gần một vòng đầy ở đầu clip
    run(k, 0.6, { idle: false })
    expect(k.drawing).toBe(false)
    expect(Math.abs(k.fx.rx)).toBeLessThan(0.02)
  })

  it('đứng yên đủ lâu thì tự múa, múa xong về lại tư thế cũ', () => {
    const k = new KnifeAnim()
    run(k, 6.5)
    expect(k.flourishing).toBe(false)
    run(k, 1)
    expect(k.flourishing).toBe(true)
    run(k, 2)
    expect(k.flourishing).toBe(false)
    run(k, 0.5)
    expect(Math.abs(k.fx.rz)).toBeLessThan(0.01)
    expect(Math.abs(k.fx.rx)).toBeLessThan(0.02)
  })

  it('đi lại thì không tự múa', () => {
    const k = new KnifeAnim()
    k.setMotion(4, true)
    run(k, 15, { speedN: 0.5, bobAmp: 0.5 })
    expect(k.flourishing).toBe(false)
  })

  it('đang đổi súng thì không tự múa', () => {
    const k = new KnifeAnim()
    run(k, 15, { idle: false })
    expect(k.flourishing).toBe(false)
  })

  it('ra đòn hoặc chạy nhanh thì ngắt múa', () => {
    const k = new KnifeAnim()
    k.inspect(); run(k, 0.3)
    expect(k.flourishing).toBe(true)
    k.interrupt()
    expect(k.flourishing).toBe(false)
    k.inspect(); k.setMotion(6, true); run(k, 0.1)
    expect(k.flourishing).toBe(false)
  })

  it('phím xem dao lần lượt qua mọi kiểu và kiểu nào cũng quay về góc ban đầu', () => {
    const k = new KnifeAnim()
    for (let i = 0; i < FLOURISH_KINDS; i++) {
      k.inspect(); run(k, 2)
      expect(k.flourishing).toBe(false)
      run(k, 0.4)
      expect(Math.abs(k.fx.rz)).toBeLessThan(0.01)
      expect(Math.abs(k.fx.rx)).toBeLessThan(0.02)
    }
  })

  it('rời dao thì mọi trạng thái hoạt cảnh bị huỷ', () => {
    const k = new KnifeAnim()
    k.startDraw(); k.update(DT, false, true, 0, 0, 0)
    expect(k.drawing).toBe(false)
    k.inspect(); k.update(DT, false, true, 0, 0, 0)
    expect(k.flourishing).toBe(false)
  })
})
