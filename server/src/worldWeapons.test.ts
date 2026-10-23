import { describe, it, expect } from 'vitest'
import { Btn, MatchPhase, MsgType, TICK_RATE, WORLD_WEAPON, defaultMovement, loadMap, weaponByKey, type AnyMsg, type InputCmd, type MapFile, type Transport } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { enqueueCmds, stepPlayer, stepRoom } from './simulation'

const TICK_MS = 1000 / TICK_RATE
const map = loadMap({ name: 't', mirrorX: true, boxes: [], ramps: [], spawnsA: [{ pos: [0, 0, 0], yaw: 0 }] } as MapFile)

function flatWorld(wallDist: number | null = null): CollisionWorld {
  return {
    moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
    canStand: () => true,
    castRay: (o, d, max) => {
      if (d[1] < -0.5) return o[1] <= max ? { dist: o[1], normal: [0, 1, 0] } : null   // sàn y = 0
      return wallDist !== null && wallDist < max ? { dist: wallDist, normal: [0, 0, 1] } : null
    },
    castSphere: () => null,
    debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
    dispose: () => {},
  }
}

const id = (key: string) => weaponByKey(key)!.id

function setup(wallDist: number | null = null) {
  const logs = new Map<number, AnyMsg[]>()
  const rm = new RoomManager(map, () => 0)
  const mk = (name: string): Player => {
    const msgs: AnyMsg[] = []
    const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', name, t, 0, 'A')
    player.world = flatWorld(wallDist)
    player.invulnUntil = 0
    logs.set(player.id, msgs)
    return player
  }
  const a = mk('A'), b = mk('B')
  const room = rm.rooms.get('r')!
  room.phase = MatchPhase.Playing
  a.state.pos = [0, 0, 0]; b.state.pos = [0, 0, 20]
  a.loadout = { slots: [{ key: 'knife', paid: 0 }, { key: 'colt', paid: 300 }, null, { key: 'ak47', paid: 2700 }, null] }
  rm.rooms.get('r')!.equip(a, 3)
  return { room, a, b, logs, rm }
}

let nextSeq = 900
function press(room: ReturnType<typeof setup>['room'], p: Player, buttons: number): void {
  for (const b of [buttons, 0]) {   // nhấn rồi thả: cạnh lên
    const c: InputCmd = { seq: nextSeq++, buttons: b, yaw: 0, pitch: 0, weapon: p.weapon.slot }
    enqueueCmds(p, [c], c.seq * TICK_MS)
    stepPlayer(p, defaultMovement, room)
  }
}
const msgsOf = (logs: Map<number, AnyMsg[]>, pid: number, t: number) => logs.get(pid)!.filter(m => m.t === t)

describe('nhặt / vứt vũ khí (P8)', () => {
  it('G khi cầm súng dài: vứt xuống sàn trước mặt, ô trống, chuyển về dao, báo cả phòng', () => {
    const { room, a, b, logs } = setup()
    press(room, a, Btn.Interact)
    expect(a.loadout.slots[3]).toBeNull()
    expect(a.weapon.slot).toBe(0)
    expect(a.weapon.current).toBe(id('knife'))
    expect(room.worldWeapons.length).toBe(1)
    const w = room.worldWeapons[0]!
    expect(w.weaponId).toBe(id('ak47'))
    expect(w.pos[2]).toBeCloseTo(-WORLD_WEAPON.dropForward, 3)   // yaw 0 nhìn -Z
    expect(w.pos[1]).toBeCloseTo(0, 3)
    expect(msgsOf(logs, b.id, MsgType.WorldWeaponSpawn).length).toBe(1)
    expect(msgsOf(logs, a.id, MsgType.PickupResult)).toEqual([{ t: MsgType.PickupResult, action: 'drop', slot: 0 }])
  })

  it('giữ phím G không vứt liên tục; thả ra nhấn lại thì mới tác động', () => {
    const { room, a } = setup()
    for (const b of [Btn.Interact, Btn.Interact, Btn.Interact]) {
      const c: InputCmd = { seq: nextSeq++, buttons: b, yaw: 0, pitch: 0, weapon: a.weapon.slot }
      enqueueCmds(a, [c], c.seq * TICK_MS); stepPlayer(a, defaultMovement, room)
    }
    expect(room.worldWeapons.length).toBe(1)
  })

  it('cầm dao gốc nhấn G: không vứt gì', () => {
    const { room, a } = setup()
    a.weapon.slot = 0; a.weapon.current = id('knife')
    press(room, a, Btn.Interact)
    expect(room.worldWeapons.length).toBe(0)
    expect(a.loadout.slots[0]!.key).toBe('knife')
  })

  it('vứt xong chưa nhặt lại được ngay (khoá người vứt), hết khoá thì nhặt lại, đạn giữ nguyên', () => {
    const { room, a } = setup()
    a.weapon.ammo[id('ak47')] = 7
    press(room, a, Btn.Interact)
    const w = room.worldWeapons[0]!
    expect(w.ammo).toBe(7)
    a.state.pos = [w.pos[0], 0, w.pos[2]]
    press(room, a, Btn.Interact)
    expect(room.worldWeapons.length).toBe(1)   // còn khoá
    room.serverNow = w.lockUntilMs + 1
    press(room, a, Btn.Interact)
    expect(room.worldWeapons.length).toBe(0)
    expect(a.loadout.slots[3]).toEqual({ key: 'ak47', paid: 0 })
    expect(a.weapon.slot).toBe(3)
    expect(a.weapon.current).toBe(id('ak47'))
    expect(a.weapon.ammo[id('ak47')]).toBe(7)
  })

  it('người khác nhặt được ngay; ô đã có súng thì không nhặt được (G vứt súng đang cầm)', () => {
    const { room, a, b, logs } = setup()
    press(room, a, Btn.Interact)
    const w = room.worldWeapons[0]!
    b.loadout = { slots: [{ key: 'knife', paid: 0 }, { key: 'colt', paid: 300 }, null, null, null] }
    room.equip(b, 1)
    b.state.pos = [w.pos[0] + 0.5, 0, w.pos[2]]
    press(room, b, Btn.Interact)
    expect(room.worldWeapons.length).toBe(0)
    expect(b.loadout.slots[3]!.key).toBe('ak47')
    expect(msgsOf(logs, b.id, MsgType.WorldWeaponRemove).length).toBe(1)
    // b đang cầm ak47 (ô 3, đầy): G tiếp theo vứt chứ không nhặt cái khác
    b.state.pos = [w.pos[0], 0, w.pos[2]]
    press(room, b, Btn.Interact)
    expect(room.worldWeapons.length).toBe(1)
    expect(b.loadout.slots[3]).toBeNull()
  })

  it('đứng xa quá tầm thì không nhặt được', () => {
    const { room, a, b } = setup()
    press(room, a, Btn.Interact)
    b.loadout = { slots: [{ key: 'knife', paid: 0 }, null, null, null, null] }
    b.state.pos = [0, 0, 20]
    press(room, b, Btn.Interact)
    expect(room.worldWeapons.length).toBe(1)
  })

  it('có tường sát trước mặt: vật rơi trước tường, không xuyên', () => {
    const { room, a } = setup(0.8)
    press(room, a, Btn.Interact)
    expect(room.worldWeapons[0]!.pos[2]).toBeCloseTo(-(0.8 - WORLD_WEAPON.dropWallGap), 3)
  })

  it('cầm búa nhấn G: búa rơi, ô 1 về dao; nhặt búa lại thay dao', () => {
    const { room, a } = setup()
    a.loadout = { slots: [{ key: 'hammer', paid: 1500 }, null, null, null, null] }
    room.equip(a, 0)
    press(room, a, Btn.Interact)
    expect(a.loadout.slots[0]!.key).toBe('knife')
    expect(room.worldWeapons[0]!.weaponId).toBe(id('hammer'))
    room.serverNow = room.worldWeapons[0]!.lockUntilMs + 1
    a.state.pos = [room.worldWeapons[0]!.pos[0], 0, room.worldWeapons[0]!.pos[2]]
    press(room, a, Btn.Interact)
    expect(a.loadout.slots[0]).toEqual({ key: 'hammer', paid: 0 })
    expect(a.weapon.current).toBe(id('hammer'))
  })

  it('vật tự biến mất sau despawnMs; vật persist thì ở lại', () => {
    const { room, a, logs, b } = setup()
    press(room, a, Btn.Interact)
    const w = room.worldWeapons[0]!
    stepRoom(room, defaultMovement, w.despawnAtMs - 1)
    expect(room.worldWeapons.length).toBe(1)
    stepRoom(room, defaultMovement, w.despawnAtMs)
    expect(room.worldWeapons.length).toBe(0)
    expect(msgsOf(logs, b.id, MsgType.WorldWeaponRemove).length).toBe(1)
  })

  it('người vào sau nhận danh sách vật đang nằm dưới đất', () => {
    const { room, a, rm } = setup()
    press(room, a, Btn.Interact)
    const msgs: AnyMsg[] = []
    rm.join('r', 'C', { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }, 0, 'B')
    expect(msgs.filter(m => m.t === MsgType.WorldWeaponSpawn).length).toBe(1)
    expect(room.worldWeapons.length).toBe(1)
  })

  it('người chết hoặc gục không nhặt / vứt', () => {
    const { room, a } = setup()
    a.downed = true
    press(room, a, Btn.Interact)
    a.downed = false; a.alive = false
    press(room, a, Btn.Interact)
    expect(room.worldWeapons.length).toBe(0)
  })
})
