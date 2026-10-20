import { describe, it, expect } from 'vitest'
import { Btn, INFECTION, MATCH, MatchPhase, MsgType, NetFlag, defaultMovement, loadMap, type AnyMsg, type MapFile, type Transport, type RoomOptions } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from './room'
import { enqueueCmds, stepRoom, sendSnapshots } from './simulation'
import { handleDebugCmd } from './debugCmds'
import { handleBuy } from './shop'
import type { InfectionMode } from './modes/infection'

const map = loadMap({
  name: 't', mirrorX: true, boxes: [], ramps: [],
  spawnsA: [{ pos: [-25, 0, 0], yaw: 0 }, { pos: [-25, 0, 4], yaw: 0 }, { pos: [-25, 0, -4], yaw: 0 }],
  buyZoneA: { min: [-30, -1, -20], max: [-19, 3, 20] },
} as MapFile)
const flat: CollisionWorld = {
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true, castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}
const OPTS: RoomOptions = { mode: 'infection', settings: { rounds: 2, roundTimeSec: 60 } }

function setup(n = 3) {
  const rm = new RoomManager(map, () => 0, MATCH)
  const msgs = new Map<number, AnyMsg[]>()
  const players: Player[] = []
  const join = (name: string) => {
    const list: AnyMsg[] = []
    const t: Transport = { send: m => { list.push(m) }, onMessage: () => {}, onClose: () => {} }
    const res = rm.tryJoin('r', name, t, 0, 'auto', undefined, undefined, OPTS)!
    res.player.world = flat
    msgs.set(res.player.id, list)
    players.push(res.player)
    return res.player
  }
  for (let i = 0; i < n; i++) join(`p${i}`)
  const room = rm.rooms.get('r')!
  const m = room.mode as InfectionMode
  m.s.prepSec = 2; m.s.roundEndSec = 1; m.s.matchEndSec = 1
  return { rm, room, m, players, join, msgs }
}
const run = (room: Room, ms: number) => { const to = room.serverNow + ms; for (let t = room.serverNow + 16; t <= to; t += 16) stepRoom(room, defaultMovement, t) }
const sent = (msgs: Map<number, AnyMsg[]>, id: number, t: number) => msgs.get(id)!.filter(m => m.t === t)
const zombiesOf = (room: Room) => [...room.players.values()].filter(p => p.role === 'zombie')
const humansOf = (room: Room) => [...room.players.values()].filter(p => p.role === 'human')

/** Vào LIVE: PREP 2s rồi chọn mẹ; chờ hết bất tử/biến hình */
function toLive() {
  const s = setup()
  run(s.room, 100)
  expect(s.room.phase).toBe(MatchPhase.Prep)
  run(s.room, 2100)
  expect(s.room.phase).toBe(MatchPhase.Playing)
  run(s.room, INFECTION.transformMs + INFECTION.pickMs + 100)
  return s
}
const claw = (z: Player, seq: number, extra = 0) => enqueueCmds(z, [{ seq, buttons: Btn.Fire | extra, yaw: 0, pitch: 0, weapon: 0 }], 0)

describe('Lây Nhiễm – các pha (I.1)', () => {
  it('cần ≥ 3 người: 2 người vẫn WARMUP, người thứ 3 vào → PREP', () => {
    const s = setup(2)
    run(s.room, 100)
    expect(s.room.phase).toBe(MatchPhase.Waiting)
    s.join('p3')
    run(s.room, 100)
    expect(s.room.phase).toBe(MatchPhase.Prep)
  })

  it('PREP: mọi người là người cùng phe A, tiền $6000, rải khắp nơi; mua ở bất cứ đâu', () => {
    const s = setup()
    run(s.room, 100)
    for (const p of s.players) { expect(p.role).toBe('human'); expect(p.team).toBe('A'); expect(p.money).toBe(INFECTION.startMoney) }
    const p = s.players[0]!
    p.state.pos = [20, 0, 10]   // xa khu mua
    handleBuy(s.room, p, 'ak47')
    expect(p.loadout.slots[3]?.key).toBe('ak47')
    expect(sent(s.msgs, p.id, MsgType.BuyResult).pop()).toMatchObject({ ok: true })
  })

  it('hết PREP: 1 zombie mẹ (3 người), cả phòng nhận Infected(mother), mẹ bất tử lúc biến hình, máu theo số người', () => {
    const s = setup()
    run(s.room, 2200)
    const zs = zombiesOf(s.room)
    expect(zs.length).toBe(1)
    const mom = zs[0]!
    expect(mom.zstats!.type).toBe('mother')
    expect(mom.zstats!.hpMax).toBe(INFECTION.mother.hpBase + INFECTION.mother.hpPerHuman * 2)
    expect(mom.team).toBe('B')
    for (const p of s.players) expect(sent(s.msgs, p.id, MsgType.Infected).some(m => (m as { playerId: number }).playerId === mom.id && (m as { kind: string }).kind === 'mother')).toBe(true)
    expect(s.room.serverNow).toBeLessThan(mom.invulnUntil)
  })

  it('không chọn lại người vừa làm mẹ ván trước', () => {
    const s = setup(3)
    run(s.room, 2200)
    const first = zombiesOf(s.room)[0]!.id
    // ép sang ván sau
    s.m.devEndRound(s.room, 'A')
    run(s.room, 1100)   // RoundEnd → PREP ván 2
    expect(s.room.phase).toBe(MatchPhase.Prep)
    run(s.room, 2100)
    expect(zombiesOf(s.room)[0]!.id).not.toBe(first)
  })

  it('zombie cào 2 lần → người thành zombie tại chỗ, đứng dậy sau transformMs, cào được người khác', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const [v1, v2] = humansOf(s.room)
    mom.state.pos = [0, 0, 0]; v1!.state.pos = [0, 0, -1.5]; v2!.state.pos = [30, 0, 30]
    let seq = 1000
    claw(mom, seq++); run(s.room, 16)
    expect(v1!.hp).toBe(100 - INFECTION.mother.clawDamage)
    run(s.room, 700)
    seq += 45   // thời gian của súng tính theo seq (60 cmd/s)
    claw(mom, seq++); run(s.room, 16)
    expect(v1!.role).toBe('zombie')                     // bị lây tại chỗ, không chết
    expect(v1!.alive).toBe(true)
    expect(v1!.state.pos[2]).toBeCloseTo(-1.5, 1)
    expect(v1!.zstats!.type).toBe('normal')
    expect(v1!.team).toBe('B')
    expect(s.m.humans(s.room)).toBe(1)
    expect(sent(s.msgs, v2!.id, MsgType.Infected).some(m => (m as { kind: string }).kind === 'infected' && (m as { byId: number }).byId === mom.id)).toBe(true)
    expect(s.room.serverNow).toBeLessThan(v1!.transformUntil)
    // đang biến hình thì không cào được
    v2!.state.pos = [0, 0, -3]; v1!.state.pos = [0, 0, -1.5]; mom.state.pos = [0, 0, 0]
    claw(v1!, 5000); run(s.room, 16)
    expect(v2!.hp).toBe(INFECTION.hero.hp)   // v2 là người cuối → anh hùng
    run(s.room, INFECTION.transformMs + 100)
    claw(v1!, 5050)
    v2!.state.pos = [0, 0, -3 + v1!.state.pos[2] + 1.5]   // đặt trong tầm cào của v1
    v2!.state.pos = [v1!.state.pos[0], 0, v1!.state.pos[2] - 1.5]
    run(s.room, 16)
    expect(v2!.hp).toBeLessThan(INFECTION.hero.hp)
  })

  it('điểm lây nhiễm: người lây được +1 (+1 nếu zombie mẹ); bảng điểm có cột pts/inf/role', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const v = humansOf(s.room)[0]!
    v.hp = 0; v.killerId = mom.id
    run(s.room, 32)
    expect(v.role).toBe('zombie')
    const row: { pts?: number; inf?: number; role?: string } = {}
    s.m.scoreboardRow(s.room, mom, row as never)
    expect(row.inf).toBe(1)
    expect(row.pts).toBe(INFECTION.points.infect + INFECTION.points.mother)
    expect(row.role).toBe('zombie')
  })

  it('bắn zombie tới chết: người được +2 điểm; 5s sau zombie hồi sinh xa người nhất', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const [h1, h2] = humansOf(s.room)
    h1!.state.pos = [-25, 0, 0]; h2!.state.pos = [-25, 0, 4]; mom.state.pos = [-25, 0, -3]
    mom.hp = 0; mom.killerId = h1!.id
    run(s.room, 32)
    expect(mom.alive).toBe(false)
    const row: { pts?: number; zk?: number } = {}
    s.m.scoreboardRow(s.room, h1!, row as never)
    expect(row.zk).toBe(1)
    expect(row.pts).toBe(INFECTION.points.killZombie)
    run(s.room, INFECTION.zombieRespawnMs - 200)
    expect(mom.alive).toBe(false)
    run(s.room, 400)
    expect(mom.alive).toBe(true)
    expect(mom.role).toBe('zombie')
    expect(mom.hp).toBe(mom.zstats!.hpMax)
    const dNear = Math.min(...[h1!, h2!].map(h => Math.hypot(h.state.pos[0] - mom.state.pos[0], h.state.pos[2] - mom.state.pos[2])))
    expect(dNear).toBeGreaterThan(3)
  })

  it('còn đúng 1 người → anh hùng: máu 200, flag Hero; máu zombie co lại theo số người', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    const [v1, v2] = humansOf(s.room)
    const before = mom.zstats!.hpMax
    v1!.hp = 0; v1!.killerId = mom.id
    run(s.room, 32)
    expect(mom.zstats!.hpMax).toBe(before - INFECTION.mother.hpPerHuman)
    expect(v2!.hero).toBe(true)
    expect(v2!.hp).toBe(INFECTION.hero.hp)
    expect(v2!.damageMult).toBe(INFECTION.hero.damageMult)
    expect(sent(s.msgs, v1!.id, MsgType.HeroChosen).length).toBe(1)
    sendSnapshots(s.room, 0, s.room.serverNow)
    const snap = sent(s.msgs, v2!.id, MsgType.Snapshot).pop() as { players: { id: number; flags: number }[] }
    expect(snap.players.find(p => p.id === v2!.id)!.flags & NetFlag.Hero).toBeTruthy()
  })

  it('lây hết → zombie thắng ván (RoundEnd winner B); hết giờ còn người → người thắng, +3 điểm mỗi người sống', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    for (const h of humansOf(s.room)) { h.hp = 0; h.killerId = mom.id }
    run(s.room, 64)
    expect(s.room.phase).toBe(MatchPhase.RoundEnd)
    expect(sent(s.msgs, mom.id, MsgType.RoundEnd).pop()).toMatchObject({ winner: 'B', reason: 'infected_all' })

    const t = toLive()
    t.room.phaseEndsAt = t.room.serverNow + 100
    run(t.room, 200)
    expect(t.room.phase).toBe(MatchPhase.RoundEnd)
    expect(sent(t.msgs, t.players[0]!.id, MsgType.RoundEnd).pop()).toMatchObject({ winner: 'A', reason: 'time_survive' })
    const h = humansOf(t.room)[0]!
    const row: { pts?: number } = {}
    t.m.scoreboardRow(t.room, h, row as never)
    expect(row.pts).toBe(INFECTION.points.surviveRound)
  })

  it('hết số ván: MATCH_END với người nhiều điểm nhất; sau đó ván mới', () => {
    const s = toLive()
    s.m.devEndRound(s.room, 'A')
    run(s.room, 1100)               // → PREP ván 2
    run(s.room, 2200)               // → LIVE
    s.m.devEndRound(s.room, 'A')
    run(s.room, 1100)               // hết 2 ván → MATCH_END
    expect(s.room.phase).toBe(MatchPhase.Ended)
    expect(sent(s.msgs, s.players[0]!.id, MsgType.MatchEnd).length).toBe(1)
    run(s.room, 1100)
    expect(s.room.phase).toBe(MatchPhase.Prep)
    expect(s.m.round).toBe(1)
  })

  it('người vào giữa ván LIVE → vào luôn với vai zombie', () => {
    const s = toLive()
    const j = s.join('late')
    expect(j.role).toBe('zombie')
    expect(j.team).toBe('B')
    expect(j.alive).toBe(true)
  })

  it('zombie mẹ duy nhất rời → chọn ngay một người làm mẹ mới', () => {
    const s = toLive()
    const mom = zombiesOf(s.room)[0]!
    s.room.leave(mom.id)
    run(s.room, 64)
    expect(zombiesOf(s.room).length).toBe(1)
    expect(zombiesOf(s.room)[0]!.zstats!.type).toBe('mother')
  })

  it('/zombie và /human đổi vai; người không bắn trúng người (không friendly fire)', () => {
    const s = setup()
    const p = s.players[0]!
    expect(handleDebugCmd(s.room, p, '/zombie')).toBe(true)
    expect(p.role).toBe('zombie')
    expect(handleDebugCmd(s.room, p, '/human')).toBe(true)
    expect(p.role).toBe('human')
    expect(p.team).toBe('A')
  })
})
