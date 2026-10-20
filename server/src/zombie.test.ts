import { describe, it, expect } from 'vitest'
import { Btn, MatchPhase, MsgType, NetFlag, ZOMBIE, WEAPONS, CLAW_ID, CLAW_HEAVY_ID, defaultMovement, loadMap, type AnyMsg, type InputCmd, type MapFile, type Transport, type ZombieStats } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { enqueueCmds, stepRoom, sendSnapshots } from './simulation'

const map = loadMap({ name: 't', mirrorX: true, boxes: [], ramps: [], spawnsA: [{ pos: [0, 0, 0], yaw: 0 }] } as MapFile)
const cfg = defaultMovement
const world = (): CollisionWorld => ({
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true, castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }), dispose: () => {},
})
const stats = (over: Partial<ZombieStats> = {}): ZombieStats => ({ type: 'normal', hpMax: 1500, runSpeed: 9.5, clawDamage: 45, knockbackResist: 0, regenPerSec: 50, ...over })

function setup() {
  const logs = new Map<number, AnyMsg[]>()
  const rm = new RoomManager(map, () => 0)
  const mk = (name: string, team: 'A' | 'B'): Player => {
    const msgs: AnyMsg[] = []
    const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', name, t, 0, team)
    player.world = world()
    logs.set(player.id, msgs)
    return player
  }
  const human = mk('H', 'A'), z = mk('Z', 'A')
  const room = rm.rooms.get('r')!
  room.phase = MatchPhase.Playing
  room.serverNow = 1000
  room.makeZombie(z, stats())
  human.state.pos = [0, 0, -1.5]   // zombie ở gốc, nhìn -Z, người cách 1,5m
  z.state.pos = [0, 0, 0]
  return { room, human, z, logs }
}
let seq = 0
const send = (p: Player, buttons: number, extra: Partial<InputCmd> = {}) => enqueueCmds(p, [{ seq: seq++, buttons, yaw: 0, pitch: 0, weapon: 0, ...extra }], 0)
const run = (room: ReturnType<typeof setup>['room'], ticks: number) => { for (let i = 0; i < ticks; i++) stepRoom(room, cfg, room.serverNow + 1000 / 60) }

describe('vai trò zombie (ZF.2)', () => {
  it('makeZombie: sang phe B, cầm vuốt (ô 0), máu theo loại', () => {
    const { z } = setup()
    expect(z.role).toBe('zombie')
    expect(z.team).toBe('B')
    expect(z.hp).toBe(1500)
    expect(z.weapon.current).toBe(CLAW_ID)
    expect(z.weapon.slots.slice(1).every(id => id === -1)).toBe(true)
  })

  it('cào thường trừ clawDamage, nhịp 550ms', () => {
    const { room, human, z } = setup()
    send(z, Btn.Fire); run(room, 1)
    expect(human.hp).toBe(100 - 45)
    // 20 tick (333ms) sau chưa cào được lần hai
    for (let i = 0; i < 20; i++) send(z, Btn.Fire)
    run(room, 20)
    expect(human.hp).toBe(55)
  })

  it('cào ngoài tầm 1,8m thì hụt', () => {
    const { room, human, z } = setup()
    human.state.pos = [0, 0, -2.2]
    send(z, Btn.Fire); run(room, 1)
    expect(human.hp).toBe(100)
  })

  it('cào mạnh: trúng sau 0,3s, damage ×2; người lùi ra ngoài tầm 2m thì hụt', () => {
    const { room, human, z } = setup()
    human.state.pos = [0, 0, -1.9]
    send(z, Btn.Aim); run(room, 1)
    expect(z.weapon.current).toBe(CLAW_HEAVY_ID)
    expect(human.hp).toBe(100)   // đang vung
    run(room, 20)                // > 0,3s
    expect(human.hp).toBe(100 - 90)

    const t = setup()
    t.human.state.pos = [0, 0, -1.9]
    send(t.z, Btn.Aim); run(t.room, 1)
    t.human.state.pos = [0, 0, -4]   // lùi kịp
    run(t.room, 20)
    expect(t.human.hp).toBe(100)
  })

  it('zombie không cào được zombie (cùng phe B)', () => {
    const { room, human, z } = setup()
    room.makeZombie(human, stats())
    human.state.pos = [0, 0, -1.5]
    send(z, Btn.Fire); run(room, 1)
    expect(human.hp).toBe(1500)
  })

  it('đạn đẩy zombie lùi; kháng đẩy giảm; hồi máu sau 4s không bị bắn', () => {
    const { room, human, z } = setup()
    // người bắn shotgun vào zombie cách 5m
    human.weapon.slots = [6, -1, 5, -1, -1]; human.weapon.slot = 2; human.weapon.current = 5; human.weapon.wantSlot = 2
    human.state.pos = [0, 0, -5]; z.state.pos = [0, 0, 0]
    send(human, Btn.Fire, { yaw: 0, pitch: -0.0, weapon: 2 })
    // người nhìn +Z (yaw π) để bắn về phía zombie
    human.inputQueue.length = 0
    send(human, Btn.Fire, { yaw: Math.PI, pitch: -0.28, weapon: 2 })
    const hp0 = z.hp
    run(room, 1)
    expect(z.hp).toBeLessThan(hp0)
    // đẩy lùi hướng +Z (ra xa người bắn)
    expect(z.state.vel[2]).toBeGreaterThan(1)

    const before = z.hp
    z.lastHurtAt = room.serverNow
    run(room, 60)
    expect(z.hp).toBe(before)             // chưa tới regenDelay
    run(room, 240)                        // qua 4s
    expect(z.hp).toBeGreaterThan(before + 20)
    expect(z.hp).toBeLessThanOrEqual(1500)
  })

  it('snapshot đánh dấu zombie + máu tối đa + loại', () => {
    const { room, z, human, logs } = setup()
    sendSnapshots(room, 0, 1000)
    const snap = logs.get(human.id)!.filter(m => m.t === MsgType.Snapshot).pop() as Extract<AnyMsg, { t: typeof MsgType.Snapshot }>
    const nz = snap.players.find(p => p.id === z.id)!
    expect(nz.flags & NetFlag.Zombie).toBeTruthy()
    expect(nz.hpMax).toBe(1500)
    expect(nz.ztype).toBe('normal')
    const nh = snap.players.find(p => p.id === human.id)!
    expect(nh.flags & NetFlag.Zombie).toBe(0)
  })

  it('biến hình: bất tử và không bắn được trong transformMs', () => {
    const { room, human, z } = setup()
    room.makeZombie(human, stats(), 1500)
    expect(human.invulnUntil).toBeGreaterThan(room.serverNow)
    send(human, Btn.Fire); run(room, 1)
    expect(z.hp).toBe(1500)   // vuốt của người đang biến hình không trúng
  })

  it('def vuốt: tầm 1,8 / 2,0 và nhịp 550 / 1100', () => {
    expect(WEAPONS[CLAW_ID]!.range).toBe(1.8)
    expect(WEAPONS[CLAW_HEAVY_ID]!.range).toBe(2.0)
    expect(WEAPONS[CLAW_ID]!.fireIntervalMs).toBe(550)
    expect(WEAPONS[CLAW_HEAVY_ID]!.fireIntervalMs).toBe(1100)
    expect(ZOMBIE.heavyWindupMs).toBe(300)
  })
})
