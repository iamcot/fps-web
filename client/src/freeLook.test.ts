import { describe, it, expect, beforeEach } from 'vitest'
import { Btn } from '@fps/shared'

// input.ts đọc localStorage khi nạp module: dựng bản giả rồi mới import
;(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const g = globalThis as { document?: unknown }
g.document ??= { createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }), body: { appendChild() {} }, addEventListener() {} }
const live = await import('./input')   // namespace: yaw / camYaw là liên kết sống
const { setFreeCamera, setLook, freeLookStep, viewYaw } = live

const DT = 1 / 60
function settle(b: number, ticks = 120): number { let out = b; for (let i = 0; i < ticks; i++) out = freeLookStep(DT, b); return out }

describe('camera tự do (V)', () => {
  beforeEach(() => { setFreeCamera(false); setLook(0, 0); setFreeCamera(true) })

  it('tắt: nút giữ nguyên', () => {
    setFreeCamera(false)
    expect(freeLookStep(DT, Btn.Back | Btn.Left)).toBe(Btn.Back | Btn.Left)
  })

  it('bấm W: nhân vật đi theo hướng camera, chỉ gửi Forward', () => {
    setLook(1, 0)   // camera nhìn yaw 1
    const out = settle(Btn.Forward)
    expect(out).toBe(Btn.Forward)
    expect(live.yaw).toBeCloseTo(1, 2)
    expect(viewYaw()).toBeCloseTo(1, 5)
  })

  it('bấm D: nhân vật quay sang phải của camera (yaw giảm 90°) và đi tới', () => {
    const out = settle(Btn.Right)
    expect(out).toBe(Btn.Forward)
    expect(live.yaw).toBeCloseTo(-Math.PI / 2, 2)
    expect(live.camYaw).toBeCloseTo(0, 5)
  })

  it('bấm S: quay lại phía camera (quay theo đường ngắn nhất, không xoay vòng)', () => {
    settle(Btn.Back)
    expect(Math.abs(Math.abs(live.yaw) - Math.PI)).toBeLessThan(0.02)
  })

  it('đánh: nhân vật quay ngay về hướng camera, WASD giữ nguyên (strafe)', () => {
    settle(Btn.Right)
    setLook(0.5, 0)
    const b = Btn.Fire | Btn.Left
    expect(freeLookStep(DT, b)).toBe(b)
    expect(live.yaw).toBeCloseTo(0.5, 5)
  })

  it('đứng yên: giữ hướng, bỏ nút di chuyển', () => {
    settle(Btn.Right)
    const y = live.yaw
    expect(freeLookStep(DT, Btn.Jump)).toBe(Btn.Jump)
    expect(live.yaw).toBe(y)
  })
})
