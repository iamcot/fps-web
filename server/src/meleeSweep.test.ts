import { describe, it, expect } from 'vitest'
import { Btn, MELEE, MELEE_OUTCOME, MatchPhase, MsgType, TICK_RATE, defaultMovement, loadMap, type AnyMsg, type HitConfirmMsg, type InputCmd, type MapFile, type Transport } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { enqueueCmds, stepPlayer } from './simulation'

const TICK_MS = 1000 / TICK_RATE
const map = loadMap({ name: 't', mirrorX: true, boxes: [], ramps: [], spawnsA: [{ pos: [0, 0, 0], yaw: 0 }] } as MapFile)

function flatWorld(wallDist: number | null = null): CollisionWorld {
  return {
    moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
    canStand: () => true,
    castRay: (_o, _d, max) => (wallDist !== null && wallDist < max ? { dist: wallDist, normal: [0, 0, 1] } : null),
    castSphere: () => null,
    debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
    dispose: () => {},
  }
}

const useKnife = (p: Player) => { p.weapon.slots = [6, 2, 1, 0]; p.weapon.slot = 0; p.weapon.current = 6; p.weapon.wantSlot = 0 }

function setup(wallDist: number | null = null) {
  const logs = new Map<number, AnyMsg[]>()
  const rm = new RoomManager(map, () => 0)
  const mk = (name: string): Player => {
    const msgs: AnyMsg[] = []
    const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', name, t, 0, name === 'A' ? 'A' : 'B')
    player.world = flatWorld(wallDist)
    player.invulnUntil = 0
    useKnife(player)
    logs.set(player.id, msgs)
    return player
  }
  const a = mk('A'), b = mk('B')
  const room = rm.rooms.get('r')!
  room.phase = MatchPhase.Playing
  a.state.pos = [0, 0, 0]
  b.state.pos = [0, 0, -1.5]   // trước mặt A (A nhìn -Z), trong tầm
  return { room, a, b, logs }
}

let nextSeq = 600
/** Cho A chạy `ticks` cmd; tick đầu giữ `first` (vd Btn.Fire), còn lại thả */
function swing(room: ReturnType<typeof setup>['room'], a: Player, ticks: number, first = Btn.Fire, extra: Partial<InputCmd> = {}): void {
  for (let i = 0; i < ticks; i++) {
    const c: InputCmd = { seq: nextSeq++, buttons: i === 0 ? first : 0, yaw: 0, pitch: 0, weapon: 0, ...extra }
    enqueueCmds(a, [c], c.seq * TICK_MS)   // đồng hồ thật chạy cùng nhịp seq: cmd không bị coi là chạy trước thời gian
    stepPlayer(a, defaultMovement, room)
  }
}
const hits = (logs: Map<number, AnyMsg[]>, id: number): HitConfirmMsg[] => logs.get(id)!.filter((m): m is HitConfirmMsg => m.t === MsgType.HitConfirm)

describe('cung quét cận chiến (P3)', () => {
  it('chém ngang trúng người đứng trước trong tầm: đúng một HitConfirm, trừ máu, người kia nhận ShotFx với moveId', () => {
    const { room, a, b, logs } = setup()
    const hp0 = b.hp
    swing(room, a, 40)
    const h = hits(logs, a.id)
    expect(h.length).toBe(1)
    expect(h[0]!.targetId).toBe(b.id)
    expect(h[0]!.damage).toBeGreaterThanOrEqual(40)
    expect(b.hp).toBe(hp0 - h[0]!.damage)
    const fx = logs.get(b.id)!.find(m => m.t === MsgType.ShotFx)
    expect(fx).toMatchObject({ shooterId: a.id, weapon: 6, moveId: 0 })
    expect(logs.get(a.id)!.some(m => m.t === MsgType.ShotFx)).toBe(false)
  })

  it('xa quá tầm hoặc ở sau lưng: không trúng', () => {
    const far = setup(); far.b.state.pos = [0, 0, -6]
    swing(far.room, far.a, 40)
    expect(hits(far.logs, far.a.id).length).toBe(0)
    const behind = setup(); behind.b.state.pos = [0, 0, 1.5]
    swing(behind.room, behind.a, 40)
    expect(hits(behind.logs, behind.a.id).length).toBe(0)
  })

  it('tường chắn giữa mắt và điểm chạm: không trúng', () => {
    const { room, a, logs } = setup(0.8)
    swing(room, a, 40)
    expect(hits(logs, a.id).length).toBe(0)
  })

  it('đồng đội không bị chém (friendlyFire tắt)', () => {
    const { room, a, b, logs } = setup()
    b.team = a.team
    swing(room, a, 40)
    expect(hits(logs, a.id).length).toBe(0)
    expect(b.hp).toBeGreaterThan(0)
  })

  it('L L L: chém, chém ngược, đâm liên hoàn 4 nhát = đúng 6 lần trúng (mỗi nhát một lần)', () => {
    const { room, a, b, logs } = setup()
    b.hp = 100000
    for (let i = 0; i < 3; i++) swing(room, a, 24)   // bấm rồi chờ chiêu xong, còn trong cửa sổ nối
    swing(room, a, 40, 0)
    expect(hits(logs, a.id).length).toBe(6)
  })

  it('đối thủ đang đỡ chắn phía trước: bị đỡ, chỉ lọt 15% damage, outcome = blocked', () => {
    const { room, a, b, logs } = setup()
    b.state.yaw = Math.PI   // B nhìn +Z, tức hướng về A
    const vNow = (b.lastProcessedSeq = nextSeq + 100) * TICK_MS
    b.weapon.guardSinceMs = vNow - 1000; b.weapon.parryUntilMs = 0
    swing(room, a, 40)
    const h = hits(logs, a.id)
    expect(h.length).toBe(1)
    expect(h[0]!.outcome).toBe(MELEE_OUTCOME.blocked)
    expect(h[0]!.damage).toBeLessThan(40 * MELEE.guardDamageMult * 2.6)
    expect(b.weapon.stamina).toBeLessThan(MELEE.staminaMax)
  })

  it('đối thủ parry đúng lúc: không mất máu, người đánh bị choáng', () => {
    const { room, a, b, logs } = setup()
    b.state.yaw = Math.PI
    const vNow = (b.lastProcessedSeq = nextSeq + 100) * TICK_MS
    b.weapon.guardSinceMs = vNow - 10; b.weapon.parryUntilMs = vNow + 100
    const hp0 = b.hp
    swing(room, a, 40)
    const h = hits(logs, a.id)
    expect(h[0]!.outcome).toBe(MELEE_OUTCOME.parried)
    expect(h[0]!.damage).toBe(0)
    expect(b.hp).toBe(hp0)
    expect(a.weapon.staggerUntilMs).toBeGreaterThan(0)
    expect(a.weapon.meleeMove).toBe(-1)
  })

  it('đòn từ sau lưng người đang đỡ vẫn trúng đủ', () => {
    const { room, a, b, logs } = setup()
    b.state.yaw = 0   // B quay lưng lại A
    const vNow = (b.lastProcessedSeq = nextSeq + 100) * TICK_MS
    b.weapon.guardSinceMs = vNow - 1000
    swing(room, a, 40)
    expect(hits(logs, a.id)[0]!.outcome).toBeUndefined()
    expect(hits(logs, a.id)[0]!.damage).toBeGreaterThanOrEqual(40)
  })

  it('lag compensation: người đã chạy ra xa nhưng lúc người đánh nhìn thấy còn trong tầm thì vẫn trúng; không có mốc tua thì hụt', () => {
    const run = (withRender: boolean): number => {
      const { room, a, b, logs } = setup()
      for (let i = 0; i < 40; i++) { room.serverNow = 1000 + i * TICK_MS; room.history.record(room.serverNow, room.players.values()) }   // B ở -1.5
      b.state.pos = [0, 0, -8]
      room.serverNow = 1000 + 40 * TICK_MS
      swing(room, a, 30, Btn.Fire, withRender ? { fireRenderTime: 1000 } : {})
      return hits(logs, a.id).length
    }
    expect(run(true)).toBe(1)
    expect(run(false)).toBe(0)
  })

  it('đòn bị huỷ giữa chừng (bị choáng trước khi tới nhát) thì không trúng', () => {
    const { room, a, logs } = setup()
    swing(room, a, 2)                      // vừa bắt đầu chiêu, chưa tới nhát đánh (windup 110 ms)
    a.weapon.staggerUntilMs = (nextSeq + 60) * TICK_MS
    swing(room, a, 30, 0)
    expect(hits(logs, a.id).length).toBe(0)
  })

  it('người chết không bị chém', () => {
    const { room, a, b, logs } = setup()
    b.alive = false
    swing(room, a, 40)
    expect(hits(logs, a.id).length).toBe(0)
  })
})
