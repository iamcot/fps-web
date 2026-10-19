import { describe, it, expect } from 'vitest'
import {
  Btn, MATCH, MatchPhase, MsgType, defaultMovement, loadMap,
  type AnyMsg, type InputCmd, type MapFile, type MatchRules, type TeamId, type Transport,
} from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from './room'
import { enqueueCmds, stepPlayer, stepRoom } from './simulation'

const map = loadMap({
  name: 't', mirrorX: true, boxes: [], ramps: [],
  spawnsA: [{ pos: [-25, 0, 0], yaw: 0 }, { pos: [-25, 0, 4], yaw: 0 }, { pos: [-25, 0, -4], yaw: 0 }],
} as MapFile)

const flat: CollisionWorld = {
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true,
  castRay: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}

const rules: MatchRules = { ...MATCH, countdownMs: 1000, durationMs: 5000, killLimit: 2, endScreenMs: 2000 }

function mk(rm: RoomManager, name: string, team: TeamId | 'auto' = 'auto') {
  const msgs: AnyMsg[] = []
  const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
  const res = rm.tryJoin('r', name, t, 0, team)
  if (res) res.player.world = flat
  return { res, msgs, p: res?.player as Player }
}

const cmd = (seq: number, buttons = 0, extra: Partial<InputCmd> = {}): InputCmd =>
  ({ seq, buttons, yaw: 0, pitch: 0, weapon: 3, ...extra })

// Chạy room tới serverTime `to` (ms), mỗi 16ms một tick
function run(room: Room, to: number) {
  for (let t = room.serverNow + 16; t <= to; t += 16) stepRoom(room, defaultMovement, t)
}

describe('chia đội (5.1)', () => {
  it('3 người đều chọn A: không thể cả 3 vào A khi B có 0', () => {
    const rm = new RoomManager(map, () => 0, rules)
    const teams = [mk(rm, '1', 'A'), mk(rm, '2', 'A'), mk(rm, '3', 'A')].map(x => x.p.team)
    expect(teams).toEqual(['A', 'B', 'A'])
  })

  it('auto vào đội ít người hơn', () => {
    const rm = new RoomManager(map, () => 0, rules)
    mk(rm, '1', 'A'); mk(rm, '2', 'A')
    mk(rm, '3', 'auto')
    const room = rm.rooms.get('r')!
    expect(Math.abs(room.teamCount('A') - room.teamCount('B'))).toBeLessThanOrEqual(1)
  })

  it('phòng đầy: tryJoin trả null', () => {
    const rm = new RoomManager(map, () => 0, { ...rules, maxPerTeam: 1 })
    mk(rm, '1'); mk(rm, '2')
    expect(mk(rm, '3').res).toBeNull()
  })

  it('đội của mọi người được báo bằng TeamAssigned', () => {
    const rm = new RoomManager(map, () => 0, rules)
    const a = mk(rm, '1', 'A'), b = mk(rm, '2', 'B')
    expect(a.msgs.filter(m => m.t === MsgType.TeamAssigned)).toContainEqual({ t: MsgType.TeamAssigned, id: b.p.id, team: 'B' })
    expect(b.msgs.filter(m => m.t === MsgType.TeamAssigned)).toContainEqual({ t: MsgType.TeamAssigned, id: a.p.id, team: 'A' })
  })

  it('đạn xuyên qua đồng đội, trúng kẻ địch phía sau; đồng đội không mất máu, không hitmarker', () => {
    const rm = new RoomManager(map, () => 0, { ...rules, minPlayersToStart: 99 })
    const a = mk(rm, 'a', 'A'), mate = mk(rm, 'm', 'B'), foe = mk(rm, 'f', 'B')
    // chia lại: mate cùng đội với a
    const room = rm.rooms.get('r')!
    mate.p.team = 'A'
    a.p.state.pos = [0, 0, 0]; mate.p.state.pos = [0, 0, -5]; foe.p.state.pos = [0, 0, -10]
    room.phase = MatchPhase.Playing
    for (const x of [mate.p, foe.p]) x.invulnUntil = 0
    enqueueCmds(a.p, [cmd(0, Btn.Fire, { pitch: -0.04 })], 0)
    stepPlayer(a.p, defaultMovement, room)
    expect(mate.p.hp).toBe(100)
    expect(foe.p.hp).toBeLessThan(100)
    const hits = a.msgs.filter(m => m.t === MsgType.HitConfirm)
    expect(hits.length).toBe(1)
    expect(hits[0]).toMatchObject({ targetId: foe.p.id })
  })
})

describe('trận đấu (5.2)', () => {
  function two() {
    const rm = new RoomManager(map, () => 0, rules)
    const a = mk(rm, 'a', 'A'), b = mk(rm, 'b', 'B')
    const room = rm.rooms.get('r')!
    return { rm, room, a: a.p, b: b.p, msgs: a.msgs }
  }
  // a hạ b một lần (đặt thẳng hp rồi bắn)
  function kill(room: Room, a: Player, b: Player, seq: number) {
    a.state.pos = [0, 0, 0]; b.state.pos = [0, 0, -10]
    b.hp = 1; b.invulnUntil = 0; a.invulnUntil = 0
    a.weapon.nextFireMs = 0   // Cớm: M16 ở ô 3
    enqueueCmds(a, [cmd(seq, Btn.Fire, { weapon: 3 })], seq * 1000 / 60)
    stepPlayer(a, defaultMovement, room)
    room.finalizeDeaths()
  }

  it('một người: WAITING; đủ 2 người: COUNTDOWN rồi PLAYING sau countdownMs', () => {
    const rm = new RoomManager(map, () => 0, rules)
    const a = mk(rm, 'a', 'A')
    const room = rm.rooms.get('r')!
    run(room, 200)
    expect(room.phase).toBe(MatchPhase.Waiting)
    mk(rm, 'b', 'B')
    run(room, 400)
    expect(room.phase).toBe(MatchPhase.Countdown)
    expect(room.phaseEndsAt).toBeGreaterThan(1000)
    run(room, 1600)
    expect(room.phase).toBe(MatchPhase.Playing)
    expect(a.msgs.some(m => m.t === MsgType.MatchState && m.phase === MatchPhase.Playing)).toBe(true)
  })

  it('COUNTDOWN: không đi được nhưng xoay được; PLAYING đi được', () => {
    const { room, a } = two()
    run(room, 100)
    expect(room.phase).toBe(MatchPhase.Countdown)
    const x0 = a.state.pos[0], z0 = a.state.pos[2]
    enqueueCmds(a, [cmd(0, Btn.Forward, { yaw: 1 })], 0)
    stepPlayer(a, defaultMovement, room)
    expect(a.state.pos[0]).toBe(x0); expect(a.state.pos[2]).toBe(z0)
    expect(a.state.yaw).toBe(1)
    run(room, 1200)
    expect(room.phase).toBe(MatchPhase.Playing)
    enqueueCmds(a, [cmd(1, Btn.Forward), cmd(2, Btn.Forward)], 1000)
    stepPlayer(a, defaultMovement, room)
    expect(a.state.pos[0] !== x0 || a.state.pos[2] !== z0).toBe(true)
  })

  it('kill cộng điểm đội người bắn, kill/death cá nhân; đủ killLimit → ENDED + bắn bị chặn', () => {
    const { room, a, b } = two()
    run(room, 1200)
    expect(room.phase).toBe(MatchPhase.Playing)
    kill(room, a, b, 100)
    expect(room.scoreA).toBe(1); expect(room.scoreB).toBe(0)
    expect(a.kills).toBe(1); expect(b.deaths).toBe(1)
    room.respawn(b); b.invulnUntil = 0
    kill(room, a, b, 200)
    expect(room.scoreA).toBe(2)
    stepRoom(room, defaultMovement, room.serverNow + 16)
    expect(room.phase).toBe(MatchPhase.Ended)
    // ENDED: không bắn được
    const shots = a.shotsFired
    room.respawn(b); a.weapon.nextFireMs = 0
    enqueueCmds(a, [cmd(400, Btn.Fire, { weapon: 3 })], 400 * 1000 / 60)
    stepPlayer(a, defaultMovement, room)
    expect(a.shotsFired).toBe(shots)
  })

  it('hết giờ → ENDED; hoà khi bằng điểm', () => {
    const { room } = two()
    run(room, 1200)
    run(room, 1000 + 5000 + 100)
    expect(room.phase).toBe(MatchPhase.Ended)
    expect(room.scoreA).toBe(room.scoreB)
  })

  it('hết ENDED: reset điểm/kd/máu, đổi bên, COUNTDOWN; đội A spawn ở căn cứ B', () => {
    const { room, a, b } = two()
    expect(a.state.pos[0]).toBeLessThan(0)   // trận 1: A ở căn cứ A (x âm)
    run(room, 1200)
    kill(room, a, b, 100); room.respawn(b); b.invulnUntil = 0
    kill(room, a, b, 200)
    stepRoom(room, defaultMovement, room.serverNow + 16)
    expect(room.phase).toBe(MatchPhase.Ended)
    expect(room.sideSwapped).toBe(false)
    run(room, room.phaseEndsAt + 50)
    expect(room.phase).toBe(MatchPhase.Countdown)
    expect(room.sideSwapped).toBe(true)
    expect([room.scoreA, room.scoreB]).toEqual([0, 0])
    expect([a.kills, b.deaths]).toEqual([0, 0])
    expect(a.state.pos[0]).toBeGreaterThan(0)   // trận 2: A ở căn cứ B (x dương)
    expect(b.state.pos[0]).toBeLessThan(0)
    expect(b.alive && b.hp === 100).toBe(true)
    run(room, room.phaseEndsAt + 50)
    expect(room.phase).toBe(MatchPhase.Playing)
  })

  it('còn 1 người giữa trận → WAITING; điểm đội giữ khi một người rời nhưng vẫn đủ người', () => {
    const rm = new RoomManager(map, () => 0, rules)
    const a = mk(rm, 'a', 'A'), b = mk(rm, 'b', 'B'), c = mk(rm, 'c', 'B')
    const room = rm.rooms.get('r')!
    run(room, 1200)
    expect(room.phase).toBe(MatchPhase.Playing)
    room.scoreA = 1
    room.leave(c.p.id)
    run(room, 1400)
    expect(room.phase).toBe(MatchPhase.Playing)
    expect(room.scoreA).toBe(1)
    room.leave(b.p.id)
    run(room, 1600)
    expect(room.phase).toBe(MatchPhase.Waiting)
    expect(a.p.alive).toBe(true)
  })

  it('người vào giữa trận: chia vào đội ít người, bất tử, đứng ở căn cứ đội', () => {
    const rm = new RoomManager(map, () => 0, rules)
    mk(rm, 'a', 'A'); mk(rm, 'b', 'B'); mk(rm, 'c', 'B')
    const room = rm.rooms.get('r')!
    run(room, 1200)
    expect(room.phase).toBe(MatchPhase.Playing)
    const d = mk(rm, 'd', 'auto')
    expect(d.p.team).toBe('A')   // A 1 người, B 2 người
    expect(room.serverNow).toBeLessThan(d.p.invulnUntil)
    expect(d.p.state.pos[0]).toBeLessThan(0)
  })

  it('Scoreboard + MatchState gửi mỗi 1s kèm ping', () => {
    const { room, a, msgs } = two()
    a.pingMs = 42
    run(room, 2500)
    const sb = msgs.filter(m => m.t === MsgType.Scoreboard)
    expect(sb.length).toBeGreaterThanOrEqual(2)
    expect((sb.at(-1) as { rows: { ping: number; id: number }[] }).rows.find(r => r.id === a.id)?.ping).toBe(42)
  })
})
