import { describe, it, expect } from 'vitest'
import { Btn, MsgType, defaultMovement, loadMap, type AnyMsg, type InputCmd, type MapFile, type Transport } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager } from './room'
import { enqueueCmds, stepPlayer, sendSnapshots } from './simulation'
import { TickLoop } from './tickLoop'

// Sàn phẳng y=0, không tường
const flatWorld: CollisionWorld = {
  moveCharacter(pos, d) {
    const y = Math.max(0, pos[1] + d[1])
    return { pos: [pos[0] + d[0], y, pos[2] + d[2]], grounded: y === 0, hitCeiling: false }
  },
  canStand: () => true,
  castRay: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}

const map = loadMap({ name: 't', mirrorX: true, boxes: [], ramps: [], spawnsA: [{ pos: [-25, 0, 0], yaw: 0 }] } as MapFile)
const cmd = (seq: number, buttons = 0, extra: Partial<InputCmd> = {}): InputCmd =>
  ({ seq, buttons, yaw: 0, pitch: 0, weapon: 0, ...extra })

function setup() {
  const got: AnyMsg[] = []
  const t: Transport = { send: m => { got.push(m) }, onMessage: () => {}, onClose: () => {} }
  const rm = new RoomManager(map, () => 0)
  const { room, player } = rm.join('r', 'A', t)
  player.world = flatWorld
  return { room, p: player, got }
}

describe('stepPlayer', () => {
  it('xử lý cmd theo thứ tự, ghi lastProcessedSeq', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0, Btn.Forward), cmd(1, Btn.Forward)])
    stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(1)    // MAX_INPUTS_PER_TICK = 2
    expect(p.inputQueue.length).toBe(0)
  })

  it('tối đa 2 cmd mỗi tick', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0), cmd(1), cmd(2), cmd(3)])
    stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(1)
    expect(p.inputQueue.length).toBe(2)
  })

  it('cmd trùng seq không chạy 2 lần', () => {
    // a: gửi cmd 0 rồi gửi trùng 2 lần; b: chỉ gửi cmd 0. Hai bên phải ra cùng state.
    const a = setup().p, b = setup().p
    enqueueCmds(a, [cmd(0, Btn.Forward)]); enqueueCmds(b, [cmd(0, Btn.Forward)])
    stepPlayer(a, defaultMovement); stepPlayer(b, defaultMovement)
    enqueueCmds(a, [cmd(0, Btn.Forward), cmd(0, Btn.Forward)])
    stepPlayer(a, defaultMovement); stepPlayer(b, defaultMovement)
    expect(a.lastProcessedSeq).toBe(0)
    expect(a.inputQueue.length).toBe(0)
    expect(a.state).toEqual(b.state)
  })

  it('bỏ cmd cũ nhất khi hàng đợi quá MAX_INPUT_QUEUE', () => {
    const { p } = setup()
    enqueueCmds(p, Array.from({ length: 15 }, (_, i) => cmd(i)))
    expect(p.inputQueue.length).toBe(10)
    expect(p.inputQueue[0]!.seq).toBe(5)
  })

  it('cmd sai bị bỏ', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0, 0, { pitch: 2 }), cmd(1, 0, { yaw: NaN }), cmd(2, 1 << 15), 'x', null])
    enqueueCmds(p, 'không phải mảng')
    expect(p.inputQueue.length).toBe(0)
  })

  it('hàng đợi trống: chạy tiếp lastCmd nhưng bỏ Jump, không tăng seq', () => {
    const { p } = setup()
    enqueueCmds(p, [cmd(0)])
    stepPlayer(p, defaultMovement)                 // chạm đất trước
    expect(p.state.grounded).toBe(true)
    enqueueCmds(p, [cmd(1, Btn.Forward | Btn.Jump)])
    stepPlayer(p, defaultMovement)
    const vy1 = p.state.vel[1]
    expect(vy1).toBeGreaterThan(0)                 // đã nhảy
    stepPlayer(p, defaultMovement)                 // idle
    expect(p.lastProcessedSeq).toBe(1)
    expect(p.idleCmd.buttons & Btn.Jump).toBe(0)
    expect(p.idleCmd.buttons & Btn.Forward).toBe(Btn.Forward)
    expect(p.state.vel[1]).toBeLessThan(vy1)      // chỉ còn trọng lực
  })

  it('chưa có world thì không chạy', () => {
    const { p } = setup()
    p.world = null
    enqueueCmds(p, [cmd(0, Btn.Forward)])
    stepPlayer(p, defaultMovement)
    expect(p.lastProcessedSeq).toBe(-1)
  })
})

describe('sendSnapshots', () => {
  it('chỉ gửi mỗi 3 tick, ack riêng từng người', () => {
    const { room, p, got } = setup()
    p.lastProcessedSeq = 7
    sendSnapshots(room, 1, 10)
    sendSnapshots(room, 2, 10)
    expect(got.filter(m => m.t === MsgType.Snapshot).length).toBe(0)
    sendSnapshots(room, 3, 50)
    const snap = got.find(m => m.t === MsgType.Snapshot)
    expect(snap).toMatchObject({ tick: 3, serverTime: 50, ack: 7 })
    expect((snap as { players: unknown[] }).players.length).toBe(1)
  })
})

describe('TickLoop', () => {
  it('chạy đủ 60 tick/giây dù pump gọi thất thường', () => {
    let now = 1000
    let n = 0
    const loop = new TickLoop(() => now, () => { n++ })
    while (now < 1000 + 60_000) { now += 1 + (now % 7); loop.pump() }   // nhịp gọi 1–7ms
    expect(n).toBeGreaterThanOrEqual(3599)
    expect(n).toBeLessThanOrEqual(3600)
  })

  it('tụt quá xa thì bỏ bớt tick thay vì chạy dồn', () => {
    let now = 0
    let n = 0
    const loop = new TickLoop(() => now, () => { n++ })
    now = 10_000
    loop.pump()
    expect(n).toBe(10)
    expect(loop.skipped).toBeGreaterThan(500)
  })
})
