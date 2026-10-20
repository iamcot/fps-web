import { describe, it, expect } from 'vitest'
import { MATCH, MatchPhase, MsgType, loadMap, type AnyMsg, type MapFile, type MatchRules, type TeamId, type Transport } from '@fps/shared'
import { RoomManager, type Player, type Room } from './room'
import { rebalanceTopScorer, topScorer } from './teamRules'

const map = loadMap({
  name: 'test', mirrorX: true, boxes: [], ramps: [],
  spawnsA: [{ pos: [-25, 1, 0], yaw: 0 }, { pos: [-24, 1, 2], yaw: 0 }],
} as MapFile)
const rules: MatchRules = { ...MATCH, minPlayersToStart: 99 }

function add(rm: RoomManager, name: string, team: TeamId | 'auto', roomId = 'r') {
  const msgs: AnyMsg[] = []
  const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
  const res = rm.tryJoin(roomId, name, t, 0, team)
  return { p: res?.player as Player, room: res?.room as Room, msgs }
}

describe('chọn đội với maxTeamDiff = 2', () => {
  it('được chọn đội đông hơn tới khi chênh 2, người tiếp theo bị chuyển sang đội kia', () => {
    const rm = new RoomManager(map, () => 0, rules)
    const teams = ['1', '2', '3', '4'].map(n => add(rm, n, 'A').p.team)
    expect(teams).toEqual(['A', 'A', 'B', 'A'])   // 3 vào A thì A−B = 3 > 2 nên người 3 sang B; người 4 vào A (2 vs 1)
  })

  it('đổi đội giữa trận được nếu không làm lệch quá 2', () => {
    const rm = new RoomManager(map, () => 0, rules)
    const a = add(rm, 'a', 'A'), b = add(rm, 'b', 'B'), c = add(rm, 'c', 'B')
    a.room.phase = MatchPhase.Playing
    // c (B) muốn sang A: A=1→2, B=2→1 → hợp lệ
    expect(a.room.assignTeam('A', c.p)).toBe('A')
    // a (A) muốn sang B: B có 2 người → 3 vs 0 → chênh 3 > 2 nên bị giữ ở A
    expect(a.room.assignTeam('B', a.p)).toBe('A')
    expect(b.p.team).toBe('B')
  })
})

describe('luật đẩy người cao điểm sang đội ít người', () => {
  function setup(nA: number, nB: number) {
    const rm = new RoomManager(map, () => 0, { ...rules, maxTeamDiff: 9, maxPerTeam: 9 })
    const ps: Player[] = []
    let room!: Room
    for (let i = 0; i < nA; i++) { const x = add(rm, 'a' + i, 'A'); ps.push(x.p); room = x.room }
    for (let i = 0; i < nB; i++) { const x = add(rm, 'b' + i, 'B'); ps.push(x.p) }
    return { room, ps }
  }

  it('chênh 2: chuyển người nhiều kill nhất của đội đông, còn 3–3', () => {
    const { room, ps } = setup(4, 2)
    ps[0]!.kills = 1; ps[1]!.kills = 7; ps[2]!.kills = 3
    ps[4]!.kills = 20   // đội ít người điểm cao hơn cũng không bị đụng
    rebalanceTopScorer(room)
    expect(ps[1]!.team).toBe('B')
    expect([room.teamCount('A'), room.teamCount('B')]).toEqual([3, 3])
    expect(ps[4]!.team).toBe('B')
  })

  it('chênh 1 hoặc 0: không làm gì', () => {
    const { room, ps } = setup(3, 2)
    ps[0]!.kills = 5
    rebalanceTopScorer(room)
    expect([room.teamCount('A'), room.teamCount('B')]).toEqual([3, 2])
  })

  it('bằng kill: ít chết hơn thắng, rồi id nhỏ', () => {
    const { room, ps } = setup(3, 0)
    ps[0]!.kills = ps[1]!.kills = 4; ps[0]!.deaths = 3; ps[1]!.deaths = 1
    expect(topScorer(room, 'A')).toBe(ps[1])
  })

  it('chạy khi có người bị hạ (finalizeDeaths) và người bị chuyển được báo TeamAssigned + hồi sinh', () => {
    const { room, ps } = setup(4, 2)
    ps[2]!.kills = 9
    const msgs: AnyMsg[] = []
    ;(ps[2]!.transport as { send: (m: AnyMsg) => void }).send = m => { msgs.push(m) }
    ps[5]!.hp = 0   // một người đội B chết
    room.phase = MatchPhase.Playing
    room.finalizeDeaths()
    expect(ps[2]!.team).toBe('B')
    expect(msgs).toContainEqual({ t: MsgType.TeamAssigned, id: ps[2]!.id, team: 'B' })
    expect(ps[2]!.alive).toBe(true)
  })
})

describe('danh sách phòng', () => {
  it('list: số người từng đội, map; phòng mới nhận mapId hợp lệ', () => {
    const rm = new RoomManager(map, () => 0, rules, 'dm')
    rm.registerMap('m2', 'Map 2', map)
    add(rm, 'a', 'A'); add(rm, 'b', 'B')
    rm.tryJoin('x', 'c', { send: () => {}, onMessage: () => {}, onClose: () => {} }, 0, 'auto', 'copRobber', 'm2')
    const list = rm.list()
    expect(list.find(r => r.id === 'r')).toMatchObject({ mapId: 'dm', players: 2, teamA: 1, teamB: 1, maxPlayers: 10 })
    expect(list.find(r => r.id === 'x')).toMatchObject({ mapId: 'm2', players: 1 })
    expect(rm.mapList()).toEqual([{ id: 'dm', name: 'test' }, { id: 'm2', name: 'Map 2' }])
  })
})
