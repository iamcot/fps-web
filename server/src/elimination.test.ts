import { describe, it, expect } from 'vitest'
import { ECONOMY_ELIM, MATCH, MatchPhase, MsgType, defaultMovement, loadMap, type AnyMsg, type MapFile, type Transport, type TeamId, type RoomOptions } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from './room'
import { stepRoom } from './simulation'
import { handleDebugCmd } from './debugCmds'
import type { EliminationMode } from './modes/elimination'

const map = loadMap({
  name: 't', mirrorX: true, boxes: [], ramps: [],
  spawnsA: [{ pos: [-25, 0, 0], yaw: 0 }, { pos: [-25, 0, 4], yaw: 0 }, { pos: [-25, 0, -4], yaw: 0 }],
  buyZoneA: { min: [-30, -1, -20], max: [-19, 3, 20] },
} as MapFile)

const flat: CollisionWorld = {
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true,
  castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}

const OPTS: RoomOptions = { mode: 'elimination', settings: { roundsToWin: 3, roundTimeSec: 60 } }

function setup() {
  const rm = new RoomManager(map, () => 0, MATCH)
  const msgs = new Map<string, AnyMsg[]>()
  const join = (name: string, team: TeamId) => {
    const list: AnyMsg[] = []
    msgs.set(name, list)
    const t: Transport = { send: m => { list.push(m) }, onMessage: () => {}, onClose: () => {} }
    const res = rm.tryJoin('r', name, t, 0, team, undefined, undefined, OPTS)!
    res.player.world = flat
    return res.player
  }
  return { rm, join, msgs, room: () => rm.rooms.get('r')! }
}

const run = (room: Room, ms: number) => { const to = room.serverNow + ms; for (let t = room.serverNow + 16; t <= to; t += 16) stepRoom(room, defaultMovement, t) }
const phaseOf = (r: Room): MatchPhase => r.phase
const mode = (room: Room) => room.mode as EliminationMode
const kill = (room: Room, killer: Player, victim: Player) => { victim.killerId = killer.id; victim.hp = 0; run(room, 32) }

// 1v1 ở đầu FREEZE ván 1 (freeze 1s, ván 60s để chạy nhanh)
function oneVsOne() {
  const s = setup()
  const a = s.join('a', 'A'), b = s.join('b', 'B')
  const room = s.room()
  mode(room).s.freezeSec = 1; mode(room).s.roundEndSec = 1; mode(room).s.halftimeSec = 1; mode(room).s.matchEndSec = 1
  run(room, 32)
  return { ...s, a, b, room }
}

describe('Sinh Tử – các pha', () => {
  it('đủ mỗi đội 1 người: WARMUP → FREEZE → LIVE, mỗi người một điểm spawn ở căn cứ', () => {
    const { room, a, b } = oneVsOne()
    expect(room.phase).toBe(MatchPhase.Freeze)
    expect(a.state.pos[0]).toBeLessThan(0); expect(b.state.pos[0]).toBeGreaterThan(0)
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Playing)
  })

  it('WARMUP: chết hồi sinh ngay', () => {
    const s = setup()
    const a = s.join('a', 'A')
    kill(s.room(), a, a)
    run(s.room(), 64)
    expect(a.alive).toBe(true)
  })

  it('hạ đối thủ → RoundEnd cho đội thắng (1–0), tiền thắng $3000; sau roundEndSec hồi sinh cả hai ván 2', () => {
    const { room, a, b } = oneVsOne()
    run(room, 1100)
    const m0 = a.money, m1 = b.money
    kill(room, a, b)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA).toBe(1)
    expect(a.money).toBe(m0 + ECONOMY_ELIM.killReward + ECONOMY_ELIM.roundWin)
    expect(b.money).toBe(m1 + ECONOMY_ELIM.roundLossBase)
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Freeze)
    expect(mode(room).round).toBe(2)
    expect(a.alive && b.alive).toBe(true)
  })

  it('LIVE: người chết không hồi sinh', () => {
    const { room, a, b } = oneVsOne()
    run(room, 1100)
    kill(room, a, b)
    run(room, 500)
    expect(b.alive).toBe(false)
  })

  it('hết giờ, cùng số người sống: đội máu cao hơn thắng', () => {
    const { room, a, b, msgs } = oneVsOne()
    run(room, 1100)
    b.hp = 40; a.hp = 80
    run(room, 60_100)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA).toBe(1)
    expect(msgs.get('a')!.find(m => m.t === MsgType.RoundEnd)).toMatchObject({ winner: 'A', reason: 'time_hp' })
  })

  it('hết giờ, 2 sống vs 1 sống: đội đông hơn thắng (time_alive)', () => {
    const s = setup()
    s.join('a', 'A'); s.join('c', 'A'); s.join('b', 'B')
    const room = s.room()
    mode(room).s.freezeSec = 1
    run(room, 1200)
    expect(room.phase).toBe(MatchPhase.Playing)
    run(room, 60_100)
    expect(room.scoreA).toBe(1)
    expect(s.msgs.get('b')!.find(m => m.t === MsgType.RoundEnd)).toMatchObject({ winner: 'A', reason: 'time_alive' })
  })

  it('hết giờ đúng bằng nhau → hoà, tỉ số không đổi, chuỗi thua giữ nguyên', () => {
    const { room } = oneVsOne()
    run(room, 1100 + 60_100)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA + room.scoreB).toBe(0)
  })

  it('cả hai chết cùng tick → hoà', () => {
    const { room, a, b } = oneVsOne()
    run(room, 1100)
    a.hp = 0; b.hp = 0
    run(room, 32)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA + room.scoreB).toBe(0)
  })

  it('người sống sót giữ súng, người chết về bộ mặc định', () => {
    const { room, a, b } = oneVsOne()
    run(room, 1100)
    a.loadout.slots[3] = { key: 'sniper', paid: 4750 }
    b.loadout.slots[3] = { key: 'smg', paid: 1500 }
    kill(room, a, b)
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Freeze)
    expect(a.loadout.slots[3]?.key).toBe('sniper')
    expect(b.loadout.slots[3]?.key).toBe('ak47')
  })

  it('mua: chỉ trong buyTimeSec kể từ đầu FREEZE', () => {
    const { room, a } = oneVsOne()
    expect(room.mode.canBuy(room, a, room.serverNow)).toBe(true)
    run(room, 1100 + 20_000)
    expect(room.mode.canBuy(room, a, room.serverNow)).toBe(false)
  })

  it('đội đạt roundsToWin → MATCH_END, 1s sau trận mới 0–0 ván 1', () => {
    const { room, a, b, msgs } = oneVsOne()
    for (let i = 0; i < 3; i++) {
      run(room, 1100)           // hết freeze
      if (phaseOf(room) !== MatchPhase.Playing) break
      kill(room, a, b)
      if (phaseOf(room) === MatchPhase.RoundEnd) run(room, 1100)
      if (phaseOf(room) === MatchPhase.Halftime) run(room, 1100)
    }
    expect(room.phase).toBe(MatchPhase.Ended)
    expect(room.scoreA).toBe(3)
    expect(msgs.get('a')!.some(m => m.t === MsgType.MatchEnd && m.winner === 'A')).toBe(true)
    run(room, 1100)
    expect(room.scoreA + room.scoreB).toBe(0)
    expect(mode(room).round).toBe(1)
    expect(room.phase).toBe(MatchPhase.Freeze)
  })

  it('sau ván roundsToWin−1: nghỉ giữa hiệp, đổi bên, tiền về $800', () => {
    const { room, a, b } = oneVsOne()
    for (let i = 0; i < 2; i++) { run(room, 1100); kill(room, a, b); if (i === 0) run(room, 1100) }
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Halftime)
    expect(room.sideSwapped).toBe(true)
    expect(a.money).toBe(ECONOMY_ELIM.startMoney)
    run(room, 1100)
    expect(room.phase).toBe(MatchPhase.Freeze)
    expect(a.state.pos[0]).toBeGreaterThan(0)   // đội A giờ ở căn cứ phía B
  })

  it('vào giữa ván: chỉ xem, ván sau được chơi và không nhận tiền ván này', () => {
    const { room, a, b, join } = oneVsOne()
    run(room, 1100)
    const c = join('c', 'A')
    expect(c.alive).toBe(false)
    const m = c.money
    kill(room, a, b)
    expect(c.money).toBe(m)
    run(room, 1100)
    expect(c.alive).toBe(true)
  })

  it('một đội không còn ai kết nối: đội kia thắng ván, về WARMUP giữ tỉ số', () => {
    const { room, b } = oneVsOne()
    run(room, 1100)
    room.leave(b.id)
    run(room, 32)
    expect(room.phase).toBe(MatchPhase.Waiting)
    expect(room.scoreA).toBe(1)
  })

  it('ChooseTeam chỉ cho phép ở WARMUP / FREEZE', () => {
    const { room, a } = oneVsOne()
    expect(room.mode.canSwitchTeam(room, a)).toBe(true)
    run(room, 1100)
    expect(room.mode.canSwitchTeam(room, a)).toBe(false)
  })
})

describe('lệnh debug (M.8)', () => {
  it('/endround A kết thúc ván cho A; /endround draw hoà; /time đặt lại giờ; /money; /hp; /kill', () => {
    const { room, a } = oneVsOne()
    run(room, 1100)
    expect(handleDebugCmd(room, a, '/time 10')).toBe(true)
    expect(room.phaseEndsAt - room.serverNow).toBe(10_000)
    expect(handleDebugCmd(room, a, '/money 16000')).toBe(true)
    expect(a.money).toBe(16000)
    expect(handleDebugCmd(room, a, '/hp 30')).toBe(true)
    expect(a.hp).toBe(30)
    expect(handleDebugCmd(room, a, '/endround A')).toBe(true)
    expect(room.phase).toBe(MatchPhase.RoundEnd)
    expect(room.scoreA).toBe(1)
    expect(handleDebugCmd(room, a, '/endround xyz')).toBe(false)
    expect(handleDebugCmd(room, a, '/bogus')).toBe(false)
  })
  it('/setround 9 nhảy tới ván 9; /kill tự sát', () => {
    const { room, a } = oneVsOne()
    expect(handleDebugCmd(room, a, '/setround 3')).toBe(true)
    expect(mode(room).round).toBe(3)
    expect(room.phase).toBe(MatchPhase.Freeze)
    run(room, 1100)
    expect(handleDebugCmd(room, a, '/kill')).toBe(true)
    run(room, 32)
    expect(a.alive).toBe(false)
  })
})
