import { describe, it, expect } from 'vitest'
import { MsgType, loadMap, type AnyMsg, type MapFile, type Transport } from '@fps/shared'
import { RoomManager, EMPTY_ROOM_TTL_MS } from './room'

const map = loadMap({
  name: 'test', mirrorX: true, boxes: [], ramps: [],
  spawnsA: [{ pos: [-25, 1, 0], yaw: 0 }, { pos: [-24, 1, 2], yaw: 0 }],
} as MapFile)

function fake() {
  const got: AnyMsg[] = []
  const t: Transport = { send: m => { got.push(m) }, onMessage: () => {}, onClose: () => {} }
  return { t, got }
}

describe('RoomManager', () => {
  it('leave giải phóng world của người chơi', () => {
    const rm = new RoomManager(map, () => 0)
    const { room, player } = rm.join('r', 'A', fake().t)
    let disposed = 0
    player.world = { dispose: () => { disposed++ } } as never
    room.leave(player.id)
    expect(disposed).toBe(1)
    expect(player.world).toBeNull()
    room.leave(player.id)   // gọi lại không dispose lần 2
    expect(disposed).toBe(1)
  })

  it('join: id tăng dần, Welcome cho người mới, PlayerJoined cho người cũ', () => {
    const rm = new RoomManager(map, () => 0)
    const a = fake(), b = fake()
    const pa = rm.join('r1', 'A', a.t, 0, 'A').player
    const pb = rm.join('r1', 'B', b.t, 0, 'B').player
    expect([pa.id, pb.id]).toEqual([1, 2])
    expect(a.got[0]).toMatchObject({ t: MsgType.Welcome, yourId: 1, mapName: 'test' })
    expect(b.got[0]).toMatchObject({ t: MsgType.Welcome, yourId: 2 })
    expect(a.got.find(m => m.t === MsgType.PlayerJoined)).toEqual({ t: MsgType.PlayerJoined, id: 2, name: 'B' })
    expect(b.got[0]!.t).toBe(MsgType.Welcome)
  })

  it('spawn xen kẽ đội A (x âm) / B (x dương)', () => {
    const rm = new RoomManager(map, () => 0)
    const a = rm.join('r', 'A', fake().t, 0, 'A').player
    const b = rm.join('r', 'B', fake().t, 0, 'B').player
    expect(a.state.pos[0]).toBeLessThan(0)
    expect(b.state.pos[0]).toBeGreaterThan(0)
  })

  it('leave: báo PlayerLeft cho người còn lại', () => {
    const rm = new RoomManager(map, () => 0)
    const a = fake(), b = fake()
    const { room } = rm.join('r', 'A', a.t)
    const pb = rm.join('r', 'B', b.t).player
    room.leave(pb.id)
    expect(a.got.at(-1)).toEqual({ t: MsgType.PlayerLeft, id: 2 })
  })

  it('hai phòng khác mã không thấy nhau', () => {
    const rm = new RoomManager(map, () => 0)
    const a = fake(), b = fake()
    rm.join('r1', 'A', a.t)
    rm.join('r2', 'B', b.t)
    expect(a.got.some(m => m.t === MsgType.PlayerJoined)).toBe(false)   // không thấy người phòng khác
    expect(rm.rooms.size).toBe(2)
  })

  it('phòng trống quá 60s bị xoá, còn người thì giữ', () => {
    let now = 0
    const rm = new RoomManager(map, () => now)
    const { room, player } = rm.join('r', 'A', fake().t)
    now = 1_000_000
    rm.sweep()
    expect(rm.rooms.size).toBe(1)   // còn người
    room.leave(player.id)
    now += EMPTY_ROOM_TTL_MS - 1
    rm.sweep()
    expect(rm.rooms.size).toBe(1)
    now += 2
    rm.sweep()
    expect(rm.rooms.size).toBe(0)
  })
})
