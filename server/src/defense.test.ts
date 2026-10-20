import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { Btn, DEFENSE, MATCH, MatchPhase, MsgType, WAVES, ZOMBIE_TYPES, defaultMovement, loadMap, waveClearBonus, type AnyMsg, type MapFile, type RoomOptions, type Transport } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from './room'
import { enqueueCmds, stepRoom } from './simulation'
import { buildNav, type NavGrid } from './bots/nav'
import { handleDebugCmd } from './debugCmds'
import type { DefenseMode } from './modes/defense'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
let nav: NavGrid
const flat = (): CollisionWorld => ({
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true, castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }), dispose: () => {},
})
beforeAll(async () => { nav = buildNav(await createWorld(map), map, defaultMovement) })

const OPTS: RoomOptions = { mode: 'defense', settings: { waves: 10, intermissionSec: 2, difficulty: 'normal' } }

function setup(humans = 1) {
  const rm = new RoomManager(map, () => 0, MATCH)
  const msgs = new Map<number, AnyMsg[]>()
  const players: Player[] = []
  const join = (name: string) => {
    const list: AnyMsg[] = []
    const t: Transport = { send: m => { list.push(m) }, onMessage: () => {}, onClose: () => {} }
    const res = rm.tryJoin('r', name, t, 0, 'auto', undefined, undefined, OPTS)!
    res.player.world = flat()
    msgs.set(res.player.id, list)
    players.push(res.player)
    const room = res.room
    room.nav = nav
    room.npcWorld = flat
    return res.player
  }
  for (let i = 0; i < humans; i++) join(`p${i}`)
  const room = rm.rooms.get('r')!
  const m = room.mode as DefenseMode
  m.s.prepSec = 1; m.s.endSec = 1; m.s.intermissionSec = 2
  return { rm, room, m, players, join, msgs }
}
const run = (room: Room, ms: number) => { const to = room.serverNow + ms; for (let t = room.serverNow + 16; t <= to; t += 16) stepRoom(room, defaultMovement, t) }
const of = (msgs: Map<number, AnyMsg[]>, id: number, t: number) => msgs.get(id)!.filter(m => m.t === t)
const npcs = (room: Room) => [...room.players.values()].filter(p => p.npc)
const aliveNpcs = (room: Room) => npcs(room).filter(p => p.alive)
/** Giết mọi zombie đang sống bằng người `killer` (máu về 0, tính công cho killer) */
const killAll = (room: Room, killer: Player) => { for (const z of aliveNpcs(room)) { z.hp = 0; z.killerId = killer.id }; run(room, 32) }

function toWave1() {
  const s = setup()
  run(s.room, 100)
  expect(s.room.phase).toBe(MatchPhase.Prep)
  run(s.room, 1100)
  expect(s.room.phase).toBe(MatchPhase.Playing)
  return s
}

describe('Thủ Thành – các pha (T.1)', () => {
  it('có người → PREP → ĐỢT 1; người ở căn cứ A (đội A), tiền $1500, WaveStart gửi cho người chơi', () => {
    const s = setup()
    run(s.room, 100)
    const p = s.players[0]!
    expect(p.team).toBe('A')
    expect(p.money).toBe(DEFENSE.startMoney)
    expect(p.state.pos[0]).toBeLessThan(0)
    run(s.room, 1100)
    expect(s.m.wave).toBe(1)
    expect(of(s.msgs, p.id, MsgType.WaveStart).pop()).toMatchObject({ wave: 1, title: 'ĐỢT 1', hint: 'Làm quen nào' })
  })

  it('đợt 1: sinh dần 10 walker (1,5s/con), mỗi con theo lịch; còn zombiesLeft đúng', () => {
    const s = toWave1()
    run(s.room, 100)
    expect(aliveNpcs(s.room).length).toBe(1)
    run(s.room, 1500 * 4)
    expect(aliveNpcs(s.room).length).toBe(5)
    expect(aliveNpcs(s.room).every(z => z.zstats!.type === 'walker' && z.team === 'B')).toBe(true)
    expect(s.m.zombiesLeft(s.room)).toBe(10)
    run(s.room, 1500 * 8)
    expect(aliveNpcs(s.room).length).toBe(10)
  })

  it('hạ hết zombie: nhận tiền theo loại + thưởng hết đợt 800+100n, WaveClear, rồi nghỉ; tới giờ nghỉ → đợt 2', () => {
    const s = toWave1()
    const p = s.players[0]!
    run(s.room, 1500 * 10)
    const money0 = p.money
    killAll(s.room, p)
    expect(p.money).toBe(money0 + 10 * ZOMBIE_TYPES.walker!.reward + waveClearBonus(1))
    expect(of(s.msgs, p.id, MsgType.WaveClear).pop()).toMatchObject({ wave: 1, bonus: 900 })
    expect(s.m.kind).toBe('intermission')
    expect(s.room.phase).toBe(MatchPhase.Prep)
    run(s.room, 2200)
    expect(s.m.wave).toBe(2)
    expect(of(s.msgs, p.id, MsgType.WaveStart).pop()).toMatchObject({ wave: 2, title: 'ĐỢT 2' })
  })

  it('đợt có nhiều nhóm: đợt 2 có runner trễ 8s; số lượng nhân theo số người (2 người ×1,6)', () => {
    const s = setup(2)
    run(s.room, 100)
    run(s.room, 1100)
    s.m.devSetWave(s.room, 2)
    run(s.room, 7000)
    expect(aliveNpcs(s.room).some(z => z.zstats!.type === 'runner')).toBe(false)
    run(s.room, 3000)
    expect(aliveNpcs(s.room).some(z => z.zstats!.type === 'runner')).toBe(true)
    expect(Math.round(10 * (1 + 0.6))).toBe(16)
    expect(s.m.zombiesLeft(s.room)).toBeGreaterThan(16)   // walker 16 + runner 10 (một số đã sinh)
  })

  it('maxAlive: không quá 28 zombie sống cùng lúc, hết chỗ thì chờ', () => {
    const s = setup(4)
    run(s.room, 100); run(s.room, 1100)
    s.m.devSetWave(s.room, 8)
    run(s.room, 60_000)
    expect(aliveNpcs(s.room).length).toBeLessThanOrEqual(WAVES.maxAlive)
  })

  it('chơi một mình: chết là DEFEAT ngay (không có gục); DefenseEnd kèm thống kê; 20s sau về WARMUP rồi vào lại', () => {
    const s = toWave1()
    const p = s.players[0]!
    run(s.room, 3000)
    p.hp = 0; p.killerId = aliveNpcs(s.room)[0]!.id
    run(s.room, 64)
    expect(p.alive).toBe(false)
    expect(s.m.kind).toBe('defeat')
    expect(s.room.phase).toBe(MatchPhase.Ended)
    expect(of(s.msgs, p.id, MsgType.DefenseEnd).pop()).toMatchObject({ result: 'defeat', wave: 1 })
    run(s.room, 1200)
    expect(['waiting', 'prep']).toContain(s.m.kind)
  })

  it('chết giữa đợt (nhiều người): không hồi sinh tới giờ nghỉ, rồi hồi sinh đầy máu với súng đã có', () => {
    const s = setup(2)
    run(s.room, 100); run(s.room, 1100)
    const [a, b] = s.players as [Player, Player]
    // a gục rồi chết hẳn (hết giờ gục)
    a.hp = 0; run(s.room, 32)
    expect(a.downed).toBe(true)
    a.downUntil = s.room.serverNow + 10
    run(s.room, 100)
    expect(a.alive).toBe(false)
    run(s.room, 3000)
    expect(a.alive).toBe(false)   // vẫn chưa hồi sinh giữa đợt
    killAll(s.room, b); run(s.room, 1500 * 20)   // 2 người: 16 walker
    killAll(s.room, b)
    run(s.room, 100)
    expect(s.m.kind).toBe('intermission')
    expect(a.alive).toBe(true)
    expect(a.hp).toBe(DEFENSE.prepReviveHp)
  })

  it('đợt 10 hạ hết (có boss) → VICTORY', () => {
    const s = setup()
    run(s.room, 100); run(s.room, 1100)
    const p = s.players[0]!
    s.m.devSetWave(s.room, 10)
    run(s.room, 300)
    expect(aliveNpcs(s.room).some(z => z.zstats!.type === 'boss')).toBe(true)
    run(s.room, 12_000)
    killAll(s.room, p)
    run(s.room, 50_000)   // 16 walker, 2,5s/con, trễ 10s
    killAll(s.room, p)
    run(s.room, 100)
    expect(s.m.kind).toBe('victory')
    expect(of(s.msgs, p.id, MsgType.DefenseEnd).pop()).toMatchObject({ result: 'victory' })
  })

  it('/wave 9 nhảy tới đợt 9; /clearwave xoá zombie đợt hiện tại → hết đợt', () => {
    const s = setup()
    run(s.room, 100); run(s.room, 1100)
    const p = s.players[0]!
    expect(handleDebugCmd(s.room, p, '/wave 9')).toBe(true)
    expect(s.m.wave).toBe(9)
    run(s.room, 2000)
    expect(aliveNpcs(s.room).length).toBeGreaterThan(0)
    expect(handleDebugCmd(s.room, p, '/clearwave')).toBe(true)
    run(s.room, 100)
    expect(s.m.kind).toBe('intermission')
  })
})

describe('Thủ Thành – gục và cứu (T.6)', () => {
  function twoPlayers() {
    const s = setup(2)
    run(s.room, 100); run(s.room, 1100)
    run(s.room, 200)
    return s
  }
  it('nhiều người: hết máu → gục (hp 40, bò chậm), chưa chết; chỉ cầm súng ngắn', () => {
    const s = twoPlayers()
    const [a] = s.players as [Player, Player]
    a.hp = 0; a.killerId = aliveNpcs(s.room)[0]?.id ?? -1
    run(s.room, 32)
    expect(a.alive).toBe(true)
    expect(a.downed).toBe(true)
    expect(a.hp).toBe(DEFENSE.down.reviveHp)
    expect(a.speedMult).toBeCloseTo(DEFENSE.down.crawlSpeed / defaultMovement.runSpeed, 6)
  })
  it('đồng đội ≤ 1,5m giữ E 3s → cứu dậy với 40 máu; bị đánh trúng thì làm lại từ đầu', () => {
    const s = twoPlayers()
    const [a, b] = s.players as [Player, Player]
    a.hp = 0; run(s.room, 32)
    b.state.pos = [a.state.pos[0] + 1, a.state.pos[1], a.state.pos[2]]
    const hold = (n: number) => { for (let i = 0; i < n; i++) enqueueCmds(b, [{ seq: 3000 + (seq++), buttons: Btn.Ability, yaw: 0, pitch: 0, weapon: 0 }], 0) }
    let seq = 0
    hold(60); run(s.room, 1000)
    expect(a.downed).toBe(true)
    expect(a.reviveProgressMs).toBeGreaterThan(500)
    b.lastHurtAt = s.room.serverNow   // bị đánh trúng
    run(s.room, 32)
    expect(a.reviveProgressMs).toBe(0)
    b.lastHurtAt = -Infinity
    hold(200); run(s.room, 3500)
    expect(a.downed).toBe(false)
    expect(a.hp).toBe(DEFENSE.down.reviveHp)
    expect(a.speedMult).toBe(1)
  })
  it('cả hai gục/chết cùng lúc → DEFEAT', () => {
    const s = twoPlayers()
    const [a, b] = s.players as [Player, Player]
    a.hp = 0; b.hp = 0
    run(s.room, 64)
    expect(s.m.kind).toBe('defeat')
  })
})
