import { describe, it, expect } from 'vitest'
import { Btn, MsgType, defaultMovement, loadMap, type AnyMsg, type InputCmd, type MapFile, type Transport } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { enqueueCmds, stepPlayer } from './simulation'

const map = loadMap({ name: 't', mirrorX: true, boxes: [], ramps: [], spawnsA: [{ pos: [0, 0, 0], yaw: 0 }] } as MapFile)

function worldWithWall(wallDist: number | null): CollisionWorld {
  return {
    moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
    canStand: () => true,
    castRay: (_o, _d, max) => (wallDist !== null && wallDist < max ? { dist: wallDist, normal: [0, 0, 1] } : null),
    debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
    dispose: () => {},
  }
}

function setup(wallDist: number | null = null) {
  const logs = new Map<number, AnyMsg[]>()
  const rm = new RoomManager(map, () => 0)
  const mk = (name: string): Player => {
    const msgs: AnyMsg[] = []
    const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', name, t)
    player.world = worldWithWall(wallDist)
    logs.set(player.id, msgs)
    return player
  }
  const a = mk('A'), b = mk('B')
  return { room: rm.rooms.get('r')!, a, b, logs }
}

const fireCmd = (seq: number, extra: Partial<InputCmd> = {}): InputCmd =>
  ({ seq, buttons: Btn.Fire, yaw: 0, pitch: 0, weapon: 0, ...extra })

// Người bắn đứng gốc, nhìn -Z; mục tiêu cách 10m phía trước
function place(a: Player, b: Player, targetZ = -10) {
  a.state.pos = [0, 0, 0]
  b.state.pos = [0, 0, targetZ]
}

function shoot(room: ReturnType<typeof setup>['room'], a: Player, cmd = fireCmd(0)) {
  enqueueCmds(a, [cmd], 0)
  stepPlayer(a, defaultMovement, room)
}

describe('resolveShot (4.2)', () => {
  it('bắn trúng thân: HitConfirm cho người bắn, ShotFx cho người kia', () => {
    const { room, a, b, logs } = setup()
    place(a, b)
    // mắt 1.6m, thân 0.8–1.45, đầu 1.45–1.8: ngắm ngang trúng đầu; hạ pitch xuống để trúng thân
    shoot(room, a, fireCmd(0, { pitch: -0.05 }))
    const hit = logs.get(a.id)!.find(m => m.t === MsgType.HitConfirm)
    expect(hit).toMatchObject({ headshot: false, targetId: b.id })
    const fx = logs.get(b.id)!.find(m => m.t === MsgType.ShotFx)
    expect(fx).toMatchObject({ shooterId: a.id, weapon: 0 })
    expect(logs.get(a.id)!.some(m => m.t === MsgType.ShotFx)).toBe(false)
  })

  it('bắn đầu: headshot và damage nhân headMult', () => {
    const { room, a, b, logs } = setup()
    place(a, b)
    shoot(room, a)
    const hit = logs.get(a.id)!.find(m => m.t === MsgType.HitConfirm)
    expect(hit).toMatchObject({ headshot: true, targetId: b.id, damage: Math.round(36 * 3.5) })
  })

  it('tường chắn giữa: không trúng, ShotFx dist = khoảng cách tường', () => {
    const { room, a, b, logs } = setup(4)
    place(a, b)
    shoot(room, a)
    expect(logs.get(a.id)!.some(m => m.t === MsgType.HitConfirm)).toBe(false)
    const fx = logs.get(b.id)!.find(m => m.t === MsgType.ShotFx)
    expect(fx && fx.t === MsgType.ShotFx && fx.dist).toBeCloseTo(4)
  })

  it('bắn lệch sang bên: trượt', () => {
    const { room, a, b, logs } = setup()
    place(a, b)
    b.state.pos = [3, 0, -10]
    shoot(room, a)
    expect(logs.get(a.id)!.some(m => m.t === MsgType.HitConfirm)).toBe(false)
  })

  it('không tự bắn trúng mình', () => {
    const { room, a, b, logs } = setup()
    a.state.pos = [0, 0, 0]
    b.state.pos = [50, 0, 50]
    shoot(room, a)
    expect(logs.get(a.id)!.some(m => m.t === MsgType.HitConfirm)).toBe(false)
  })

  it('cùng cmd cho cùng hướng đạn (deterministic theo playerId, shotSeq)', () => {
    const r1 = setup(), r2 = setup()
    place(r1.a, r1.b); place(r2.a, r2.b)
    shoot(r1.room, r1.a); shoot(r2.room, r2.a)
    const fx = (l: ReturnType<typeof setup>['logs'], id: number) => l.get(id)!.find(m => m.t === MsgType.ShotFx)
    expect(fx(r1.logs, r1.b.id)).toEqual(fx(r2.logs, r2.b.id))
  })
})
