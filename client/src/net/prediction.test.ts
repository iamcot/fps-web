import { describe, it, expect } from 'vitest'
import { Btn, DT, defaultMovement, stepMovement, type InputCmd, type PlayerState } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { Prediction } from './prediction'

const flat: CollisionWorld = {
  moveCharacter(pos, d) {
    const y = Math.max(0, pos[1] + d[1])
    return { pos: [pos[0] + d[0], y, pos[2] + d[2]], grounded: y === 0, hitCeiling: false }
  },
  canStand: () => true,
  castRay: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}
const start = (): PlayerState => ({
  pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0,
  grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0,
})
const cmd = (seq: number, buttons = Btn.Forward | Btn.Right): InputCmd => ({ seq, buttons, yaw: 0.3, pitch: 0, weapon: 0 })
const cfg = defaultMovement

// "Server" chạy cùng cmd bằng stepMovement; trả state sau mỗi seq
function serverStates(n: number, mk = cmd): PlayerState[] {
  const out: PlayerState[] = []
  let s = start()
  for (let i = 0; i < n; i++) { s = stepMovement(s, mk(i), flat, cfg, DT); out.push(s) }
  return out
}

describe('Prediction', () => {
  it('server khớp client: sai số 0, bỏ cmd đã ack', () => {
    const p = new Prediction(flat, cfg, start())
    for (let i = 0; i < 10; i++) p.step(cmd(i))
    const srv = serverStates(10)
    p.onSnapshot(5, srv[5]!)
    expect(p.lastError).toBe(0)
    expect(p.pending.map(x => x.cmd.seq)).toEqual([6, 7, 8, 9])
    expect(p.predicted).toEqual(srv[9])
    expect(Math.hypot(...p.visualOffset)).toBe(0)
  })

  it('replay cho ra đúng state như chạy thẳng, kể cả khi nhảy/ngồi', () => {
    const mk = (i: number): InputCmd => cmd(i, Btn.Forward | (i === 3 ? Btn.Jump : 0) | (i > 20 && i < 40 ? Btn.Crouch : 0))
    const p = new Prediction(flat, cfg, start())
    for (let i = 0; i < 60; i++) p.step(mk(i))
    const srv = serverStates(60, mk)
    for (const ack of [0, 7, 22, 35, 59]) {
      p.onSnapshot(ack, srv[ack]!)
      expect(p.lastError).toBe(0)
      expect(p.predicted).toEqual(srv[59])
    }
  })

  it('lệch dưới 1m: giữ visualOffset rồi giảm dần ×0.85 mỗi frame', () => {
    const p = new Prediction(flat, cfg, start())
    for (let i = 0; i < 10; i++) p.step(cmd(i))
    const srv = serverStates(20)
    p.onSnapshot(2, srv[2]!)                       // sync lần đầu (teleport) → ready
    for (let i = 10; i < 20; i++) p.step(cmd(i))
    const before = [...p.predicted.pos]
    const bad = { ...srv[10]!, pos: [srv[10]!.pos[0] + 0.5, srv[10]!.pos[1], srv[10]!.pos[2]] as [number, number, number] }
    p.onSnapshot(10, bad)
    expect(p.lastError).toBeCloseTo(0.5, 6)
    // vị trí vẽ = predicted + offset phải liền mạch với vị trí cũ
    expect(p.predicted.pos[0] + p.visualOffset[0]).toBeCloseTo(before[0]!, 6)
    const m0 = Math.hypot(...p.visualOffset)
    expect(m0).toBeGreaterThan(0.4)
    p.decayOffset()
    expect(Math.hypot(...p.visualOffset)).toBeCloseTo(m0 * 0.85, 6)
    for (let i = 0; i < 100; i++) p.decayOffset()
    expect(Math.hypot(...p.visualOffset)).toBe(0)
  })

  it('lệch từ 1m trở lên: teleport, không có visualOffset, không kẹt', () => {
    const p = new Prediction(flat, cfg, start())
    for (let i = 0; i < 10; i++) p.step(cmd(i))
    const srv = serverStates(20)
    p.onSnapshot(2, srv[2]!)
    for (let i = 10; i < 20; i++) p.step(cmd(i))
    const pushed = { ...srv[10]!, pos: [srv[10]!.pos[0] + 2, srv[10]!.pos[1], srv[10]!.pos[2]] as [number, number, number] }
    p.onSnapshot(10, pushed)
    expect(p.lastError).toBeCloseTo(2, 6)
    expect(Math.hypot(...p.visualOffset)).toBe(0)
    // tiếp tục dự đoán từ vị trí server, đi tiếp bình thường
    const x0 = p.predicted.pos[0]
    p.step(cmd(20))
    expect(p.predicted.pos[0]).not.toBe(x0)
  })

  it('snapshot đầu tiên đặt state (teleport), chưa có offset', () => {
    const p = new Prediction(flat, cfg, start())
    expect(p.ready).toBe(false)
    p.step(cmd(0))
    const far = { ...start(), pos: [10, 0, 10] as [number, number, number] }
    p.onSnapshot(-1, far)
    expect(p.ready).toBe(true)
    expect(Math.hypot(...p.visualOffset)).toBe(0)
    expect(p.pending.length).toBe(1)    // cmd 0 chưa ack → replay từ vị trí server
  })

  it('maxError chỉ tính 5 giây gần nhất', () => {
    let now = 0
    const p = new Prediction(flat, cfg, start(), () => now)
    const srv = serverStates(40)
    for (let i = 0; i < 40; i++) p.step(cmd(i))
    p.onSnapshot(5, { ...srv[5]!, pos: [srv[5]!.pos[0] + 0.3, 0, srv[5]!.pos[2]] })
    expect(p.maxError()).toBeCloseTo(0.3, 6)
    now = 6000
    p.onSnapshot(30, p.pending.find(x => x.cmd.seq === 30)!.stateAfter)   // server khớp dự đoán
    expect(p.maxError()).toBe(0)
  })

  it('giới hạn pending', () => {
    const p = new Prediction(flat, cfg, start())
    for (let i = 0; i < 1000; i++) p.step(cmd(i))
    expect(p.pending.length).toBeLessThanOrEqual(240)
  })
})
