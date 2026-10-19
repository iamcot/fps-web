import { describe, it, expect } from 'vitest'
import { Btn, MatchPhase, MsgType, NetFlag, defaultMovement, loadMap, type AnyMsg, type InputCmd, type MapFile, type Transport } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { enqueueCmds, stepPlayer } from './simulation'
import { rewindTime } from './shooting'

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
    const { player } = rm.join('r', name, t, 0, name === 'A' ? 'A' : 'B')
    player.world = worldWithWall(wallDist)
    logs.set(player.id, msgs)
    return player
  }
  const a = mk('A'), b = mk('B')
  const room = rm.rooms.get('r')!
  room.phase = MatchPhase.Playing   // chấm điểm / hồi sinh theo luật trận, không phải WAITING
  return { room, a, b, logs }
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

describe('lag compensation (4.3)', () => {
  // Quá khứ: b đứng ở z=-10 (thời 1000–1100). Hiện tại (serverNow 1300): b đã chạy sang x=5
  function rewindSetup() {
    const r = setup()
    place(r.a, r.b)
    for (let t = 1000; t <= 1100; t += 100) r.room.history.record(t, r.room.players.values())
    r.b.state.pos = [5, 0, -10]
    r.room.serverNow = 1300
    return r
  }

  it('không có fireRenderTime: chấm theo vị trí hiện tại → trượt', () => {
    const { room, a, logs } = rewindSetup()
    shoot(room, a)
    expect(logs.get(a.id)!.some(m => m.t === MsgType.HitConfirm)).toBe(false)
  })

  it('có fireRenderTime trong quá khứ: tua b về chỗ cũ → trúng', () => {
    const { room, a, b, logs } = rewindSetup()
    shoot(room, a, fireCmd(0, { fireRenderTime: 1050 }))
    expect(logs.get(a.id)!.find(m => m.t === MsgType.HitConfirm)).toMatchObject({ targetId: b.id })
  })

  it('fireRenderTime cũ hơn MAX_REWIND_MS bị kẹp (không tua quá giới hạn)', () => {
    expect(rewindTime(0, 1300)).toBe(800)           // 1300 − 500
    expect(rewindTime(5000, 1300)).toBe(1300)       // tương lai → hiện tại
    expect(rewindTime(1200, 1300)).toBe(1200)
    expect(rewindTime(undefined, 1300)).toBe(1300)
    const { room, a, b, logs } = rewindSetup()
    b.state.pos = [5, 0, -10]
    room.history.record(4900, room.players.values())  // lịch sử: x=0 lúc 1000–1100, x=5 lúc 4900
    room.serverNow = 5000                             // cửa sổ rewind = [4500, 5000]; yêu cầu 1050 bị kẹp lên 4500
    shoot(room, a, fireCmd(0, { fireRenderTime: 1050 }))
    expect(a.rewindClamped).toBe(1)
    expect(logs.get(a.id)!.some(m => m.t === MsgType.HitConfirm)).toBe(false)
  })

  it('người bắn không bị tua: vị trí hiện tại của chính mình', () => {
    const { room, a, b, logs } = rewindSetup()
    a.state.pos = [0, 0, 0]
    // lịch sử ghi a ở chỗ khác; mắt vẫn phải ở vị trí hiện tại
    room.history.record(1100, [{ id: a.id, state: { pos: [9, 0, 9], crouching: false }, alive: true }, { id: b.id, state: b.state, alive: true }])
    shoot(room, a, fireCmd(0, { fireRenderTime: 1050 }))
    const fx = logs.get(b.id)!.find(m => m.t === MsgType.ShotFx)
    expect(fx && fx.t === MsgType.ShotFx && fx.origin[0]).toBeCloseTo(0)
  })

  it('DebugShot chỉ gửi khi bật debug, kèm hitbox đã tua', () => {
    const { room, a, b, logs } = rewindSetup()
    shoot(room, a, fireCmd(0, { fireRenderTime: 1050 }))
    expect(logs.get(a.id)!.some(m => m.t === MsgType.DebugShot)).toBe(false)
    a.debugShots = true
    shoot(room, a, fireCmd(30, { fireRenderTime: 1050 }))
    const d = logs.get(a.id)!.find(m => m.t === MsgType.DebugShot)
    if (!d || d.t !== MsgType.DebugShot) throw new Error('thiếu DebugShot')
    expect(d.boxes.length).toBe(3)
    expect(d.boxes[0]!.min[0]).toBeCloseTo(-0.3)   // quanh x=0 (vị trí cũ), không phải x=5
    void b
  })
})


describe('máu, chết, hồi sinh (4.4)', () => {
  // a bắn b ở 10m. pitch -0.05 trúng thân (AK 36 dmg), pitch 0 trúng đầu (126)
  function duel() {
    const r = setup()
    place(r.a, r.b)
    r.b.invulnUntil = 0
    enqueueCmds(r.a, [{ seq: 0, buttons: 0, yaw: 0, pitch: 0, weapon: 1 }], 0)   // đổi sang M16 (khoá bắn 300ms)
    stepPlayer(r.a, defaultMovement, r.room)
    return r
  }
  let seq = 0
  const nextShot = (room: ReturnType<typeof setup>['room'], a: Player, extra: Partial<InputCmd> = {}) => {
    seq += 12   // đủ cách nhau vượt fireIntervalMs của M16 (80ms = 5 tick)
    enqueueCmds(a, [fireCmd(seq, { weapon: 1, ...extra })], seq * 1000 / 60)   // M16: 30 sát thương, đổi súng khoá 300ms
    stepPlayer(a, defaultMovement, room)
    room.finalizeDeaths()
  }

  it('bắn thân M16 trừ 30 máu mỗi phát, 3 phát chưa chết, phát 4 chết', () => {
    seq = 12
    const { room, a, b, logs } = duel()
    for (let i = 0; i < 3; i++) nextShot(room, a, { pitch: -0.05 })
    expect(b.hp).toBe(100 - 30 * 3)
    expect(b.alive).toBe(true)
    nextShot(room, a, { pitch: -0.05 })
    expect(b.alive).toBe(false)
    const kill = logs.get(a.id)!.find(m => m.t === MsgType.Kill)
    expect(kill).toMatchObject({ killerId: a.id, victimId: b.id, weapon: 1, headshot: false })
    expect(logs.get(b.id)!.some(m => m.t === MsgType.Kill)).toBe(true)   // cả phòng nhận
  })

  it('bắn đầu: 1 phát chết, Kill đánh dấu headshot', () => {
    seq = 12
    const { room, a, b, logs } = duel()
    nextShot(room, a)
    expect(b.alive).toBe(false)
    expect(logs.get(a.id)!.find(m => m.t === MsgType.Kill)).toMatchObject({ headshot: true })
  })

  it('người chết không có hitbox: bị bắn tiếp không HitConfirm/Hurt', () => {
    seq = 12
    const { room, a, b, logs } = duel()
    nextShot(room, a)
    const before = logs.get(a.id)!.filter(m => m.t === MsgType.HitConfirm).length
    nextShot(room, a)
    expect(logs.get(a.id)!.filter(m => m.t === MsgType.HitConfirm).length).toBe(before)
    expect(b.hp).toBe(0)
  })

  it('người chết không bắn, không đi', () => {
    seq = 12
    const { room, a, b } = duel()
    nextShot(room, a)
    enqueueCmds(b, [fireCmd(0, { buttons: Btn.Fire | Btn.Forward })], 0)
    stepPlayer(b, defaultMovement, room)
    expect(b.shotsFired).toBe(0)
    expect(b.state.pos[2]).toBeCloseTo(-10)
  })

  it('hồi sinh sau RESPAWN_DELAY_MS: hp đầy, đạn đầy, bất tử, Respawn gửi cả phòng, xa kẻ địch', () => {
    seq = 12
    const { room, a, b, logs } = duel()
    room.serverNow = 1000
    nextShot(room, a)
    expect(b.alive).toBe(false)
    expect(b.respawnAt).toBe(1000 + 3000)
    b.weapon.ammo[0] = 3
    room.serverNow = 3999; room.respawnDue(); expect(b.alive).toBe(false)
    room.serverNow = 4000; room.respawnDue()
    expect(b.alive).toBe(true)
    expect(b.hp).toBe(100)
    expect(b.weapon.ammo[0]).toBe(30)
    expect(b.invulnUntil).toBe(4000 + 2000)
    const rs = logs.get(a.id)!.find(m => m.t === MsgType.Respawn)
    expect(rs).toMatchObject({ id: b.id })
  })

  it('bất tử: bị bắn không mất máu (damage 0); bắn một phát thì hết bất tử', () => {
    seq = 12
    const { room, a, b, logs } = duel()
    room.serverNow = 1000
    b.invulnUntil = 3000
    nextShot(room, a, { pitch: -0.05 })
    expect(b.hp).toBe(100)
    expect(logs.get(a.id)!.find(m => m.t === MsgType.HitConfirm)).toMatchObject({ damage: 0 })
    // b bắn một phát hợp lệ → hết bất tử, rồi bị bắn thì mất máu
    enqueueCmds(b, [fireCmd(0, { yaw: Math.PI })], 0)
    stepPlayer(b, defaultMovement, room)
    expect(b.invulnUntil).toBe(0)
    nextShot(room, a, { pitch: -0.05 })
    expect(b.hp).toBe(70)
  })

  it('hai người bắn chết nhau cùng tick: cả hai đều chết, hai Kill', () => {
    const { room, a, b, logs } = setup()
    a.hp = 1; b.hp = 1
    a.state.pos = [0, 0, 0]; b.state.pos = [0, 0, -10]
    enqueueCmds(a, [fireCmd(0)], 0)               // a ngắm -Z, trúng đầu b
    enqueueCmds(b, [fireCmd(0, { yaw: Math.PI })], 0)   // b quay về +Z, trúng đầu a
    stepPlayer(a, defaultMovement, room)
    stepPlayer(b, defaultMovement, room)          // b vẫn còn alive tới cuối tick nên bắn được
    room.finalizeDeaths()
    expect(a.alive).toBe(false)
    expect(b.alive).toBe(false)
    expect(logs.get(a.id)!.filter(m => m.t === MsgType.Kill).length).toBe(2)
  })

  it('snapshot: hp và cờ Dead/Invuln', async () => {
    const { sendSnapshots } = await import('./simulation')
    const { room, a, b, logs } = duel()
    room.serverNow = 100
    b.invulnUntil = 500
    sendSnapshots(room, 0, 100)
    const snap = [...logs.get(a.id)!].reverse().find(m => m.t === MsgType.Snapshot)
    if (!snap || snap.t !== MsgType.Snapshot) throw new Error('thiếu snapshot')
    const nb = snap.players.find(p => p.id === b.id)!
    expect(nb.hp).toBe(100)
    expect(nb.flags & NetFlag.Invuln).toBeTruthy()
    b.alive = false; b.hp = 0
    sendSnapshots(room, 3, 150)
    const s2 = [...logs.get(a.id)!].reverse().find(m => m.t === MsgType.Snapshot)
    if (!s2 || s2.t !== MsgType.Snapshot) throw new Error('thiếu snapshot')
    expect(s2.players.find(p => p.id === b.id)!.flags & NetFlag.Dead).toBeTruthy()
    void a
  })
})
