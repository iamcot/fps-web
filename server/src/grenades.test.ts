import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { Btn, ECONOMY, GRENADE, GRENADE_ID, GRENADE_SLOT, MATCH, MatchPhase, MsgType, TICK_RATE, applyBuy, defaultMovement, loadMap, type AnyMsg, type InputCmd, type MapFile, type Transport, type TeamId } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { enqueueCmds, stepPlayer, stepRoom } from './simulation'
import { baseDamage, explode } from './grenades'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)

// World giả: sàn phẳng; `wall` quyết định tia che chắn có bị chặn không (nhận origin, dir, max)
function world(wall: ((o: number[], d: number[], max: number) => number | null) | null = null): CollisionWorld {
  return {
    moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
    canStand: () => true,
    castRay: (o, d, max) => { const t = wall ? wall(o, d, max) : null; return t === null ? null : { dist: t, normal: [0, 1, 0] } },
    castSphere: (o, d, max, r) => {   // sàn y = 0: quả cầu chạm khi đáy chạm sàn
      if (d[1] >= -1e-9) return null
      const t = (o[1] - r) / -d[1]
      return t >= 0 && t <= max ? { dist: t, normal: [0, 1, 0] } : null
    },
    debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
    dispose: () => {},
  }
}

function setup(w: CollisionWorld = world()) {
  const rm = new RoomManager(map, () => 0, { ...MATCH, minPlayersToStart: 99 })
  const mk = (name: string, team: TeamId) => {
    const msgs: AnyMsg[] = []
    const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', name, t, 0, team)
    player.world = w
    return { p: player, msgs }
  }
  const a = mk('a', 'A'), a2 = mk('a2', 'A'), b = mk('b', 'B')
  const room = rm.rooms.get('r')!
  room.phase = MatchPhase.Playing
  a.p.team = 'A'; a2.p.team = 'A'; b.p.team = 'B'   // join tự cân đội: ép lại cho test
  for (const x of [a, a2, b]) x.p.invulnUntil = 0
  return { room, a, a2, b, cfg: defaultMovement }
}
const at = (p: Player, x: number, y: number, z: number) => { p.state.pos = [x, y, z] }
const sentOf = (msgs: AnyMsg[], t: number) => msgs.filter(m => m.t === t)
const boom = (room: ReturnType<typeof setup>['room'], owner: Player, x: number, y: number, z: number) =>
  explode(room, { id: 1, ownerId: owner.id, team: owner.team, pos: [x, y, z] })

describe('sát thương nổ (G.3)', () => {
  it('đường cong: 98 trong 1m, giảm tuyến tính tới 0 ở 7m', () => {
    expect(baseDamage(0)).toBe(98); expect(baseDamage(1)).toBe(98)
    expect(baseDamage(4)).toBeCloseTo(49, 6); expect(baseDamage(7)).toBe(0); expect(baseDamage(9)).toBe(0)
  })

  it('ném vào chân kẻ địch đầy máu: còn ~2 máu, không chết', () => {
    const { room, a, b } = setup()
    at(a.p, -25, 0, 0); at(b.p, 0, 0, 0)
    const hits = boom(room, a.p, 0.3, 0.05, 0)   // sát chân (chạm sàn)
    expect(b.p.hp).toBeGreaterThanOrEqual(2); expect(b.p.hp).toBeLessThanOrEqual(10); expect(b.p.alive).toBe(true)
    expect(hits).toHaveLength(1); expect(hits[0]!.id).toBe(b.p.id); expect(hits[0]!.damage).toBe(100 - b.p.hp)
    expect(sentOf(b.msgs, MsgType.Hurt)).toHaveLength(1)
    expect(sentOf(a.msgs, MsgType.GrenadeExplode)).toHaveLength(1)   // cả phòng nhận
  })

  it('sau tường dày, địch nấp hẳn: không mất máu; ló nửa người (đầu+ngực lộ): mất ~2/3', () => {
    // tường tại x = 1: chặn mọi tia từ tâm nổ (x < 1) tới mục tiêu (x > 1)
    const wall = (o: number[], d: number[], max: number) => (o[0]! < 1 && o[0]! + d[0]! * max > 1 ? (1 - o[0]!) / d[0]! : null)
    const { room, a, b } = setup(world(wall))
    at(a.p, -25, 0, 0); at(b.p, 3, 0, 0)
    expect(boom(room, a.p, 0, 0.05, 0)).toEqual([]); expect(b.p.hp).toBe(100)
    // chỉ tia xuống chân bị chặn (tường thấp): đầu + ngực thấy → exposure 2/3
    const low = (o: number[], d: number[], max: number) => (d[1]! < -0.2 && o[0]! < 1 && o[0]! + d[0]! * max > 1 ? (1 - o[0]!) / d[0]! : null)
    const s2 = setup(world(low))
    at(s2.a.p, -25, 0, 0); at(s2.b.p, 1.5, 0, 0)
    boom(s2.room, s2.a.p, 0, 1.0, 0)
    const full = Math.round(baseDamage(Math.hypot(1.5, 0.1)))
    expect(100 - s2.b.p.hp).toBe(Math.round(full * 2 / 3))
  })

  it('đồng đội sát chỗ nổ: không mất máu; chính mình sát chỗ nổ: mất 49', () => {
    const { room, a, a2 } = setup()
    at(a.p, 0, 0, 0); at(a2.p, 0.5, 0, 0)
    const hits = boom(room, a.p, 0.2, 0.05, 0)
    expect(a2.p.hp).toBe(100)
    expect(100 - a.p.hp).toBeGreaterThanOrEqual(47); expect(100 - a.p.hp).toBeLessThanOrEqual(49)   // ~49: một nửa 98 (hơi giảm vì tâm nổ cách ngực ~1,07m)
    expect(hits).toHaveLength(1); expect(hits[0]!.id).toBe(a.p.id)
  })

  it('người đang bất tử (vừa hồi sinh) không mất máu', () => {
    const { room, a, b } = setup()
    at(a.p, -25, 0, 0); at(b.p, 0, 0, 0)
    room.serverNow = 100; b.p.invulnUntil = 5000
    expect(boom(room, a.p, 0, 0.05, 0)).toEqual([]); expect(b.p.hp).toBe(100)
  })

  it('đẩy lùi: ra xa tâm nổ, thành phần y ≥ 1 m/s', () => {
    const { room, a, b } = setup()
    at(a.p, -25, 0, 0); at(b.p, 2, 0, 0); b.p.state.vel = [0, 0, 0]
    boom(room, a.p, 0, 0.05, 0)
    expect(b.p.state.vel[0]).toBeGreaterThan(0); expect(b.p.state.vel[1]).toBeGreaterThanOrEqual(1)
  })

  it('hạ người có chuỗi 3 bằng lựu đạn: +$1000, Kill ghi vũ khí m67; tự nổ chết mình không có thưởng', () => {
    const { room, a, b } = setup()
    at(a.p, -25, 0, 0); at(b.p, 0, 0, 0)
    b.p.killStreak = ECONOMY.bountyStreak; b.p.hp = 50
    const money = a.p.money
    boom(room, a.p, 0, 0.05, 0)
    room.finalizeDeaths()
    expect(b.p.alive).toBe(false)
    expect(a.p.money).toBe(money + ECONOMY.bountyReward)
    expect(sentOf(a.msgs, MsgType.Kill)[0]).toMatchObject({ killerId: a.p.id, victimId: b.p.id, weapon: GRENADE_ID, headshot: false })
    // tự sát: không thưởng, không cộng kill
    const s = setup()
    at(s.a.p, 0, 0, 0); s.a.p.hp = 10
    const m = s.a.p.money
    boom(s.room, s.a.p, 0, 0.05, 0); s.room.finalizeDeaths()
    expect(s.a.p.alive).toBe(false); expect(s.a.p.money).toBe(m); expect(s.a.p.kills).toBe(0)
  })

  it('người ném đã rời phòng: vẫn gây sát thương nhưng không ai nhận thưởng', () => {
    const { room, a, b } = setup()
    at(b.p, 0, 0, 0); b.p.hp = 50
    const ownerId = a.p.id, money = a.p.money
    room.leave(ownerId)
    explode(room, { id: 1, ownerId, team: 'A', pos: [0, 0.05, 0] })
    room.finalizeDeaths()
    expect(b.p.alive).toBe(false); expect(money).toBe(a.p.money)
    expect(sentOf(b.msgs, MsgType.Kill)[0]).toMatchObject({ killerId: -1, victimId: b.p.id })
  })
})

describe('ném qua input (G.3)', () => {
  const cmd = (seq: number, buttons: number, weapon = GRENADE_SLOT): InputCmd => ({ seq, buttons, yaw: 0, pitch: 0, weapon })
  const give = (s: ReturnType<typeof setup>, n: number) => {
    s.a.p.money = 10000
    for (let i = 0; i < n; i++) {
      const r = applyBuy(s.a.p.money, s.a.p.loadout, 'm67')!
      s.a.p.money = r.money; s.a.p.loadout = r.loadout
    }
    s.room.equip(s.a.p, 3)
  }
  let seq = 0, nowMs = 0
  const send = (s: ReturnType<typeof setup>, buttons: number, ticks: number, weapon = GRENADE_SLOT) => {
    for (let i = 0; i < ticks; i++) { enqueueCmds(s.a.p, [cmd(seq++, buttons, weapon)], nowMs); nowMs += 1000 / TICK_RATE; stepPlayer(s.a.p, defaultMovement, s.room) }
  }
  const pullTicks = Math.ceil(GRENADE.pinPullMs * TICK_RATE / 1000) + 2

  it('giữ Fire đủ lâu rồi thả: GrenadeSpawn cho cả phòng, trừ 1 quả, nổ sau fuseMs', () => {
    const s = setup(); give(s, 2); seq = 0; nowMs = 0
    at(s.a.p, -20, 0, 0)
    send(s, 0, 1); send(s, Btn.Fire, pullTicks); send(s, 0, 1)
    const spawn = sentOf(s.b.msgs, MsgType.GrenadeSpawn)
    expect(spawn).toHaveLength(1)
    expect(spawn[0]).toMatchObject({ ownerId: s.a.p.id, mode: 'strong', throwSeq: 1 })
    expect(s.a.p.loadout.slots[4]!.count).toBe(1); expect(s.a.p.weapon.ammo[GRENADE_ID]).toBe(1)
    expect(s.room.grenades).toHaveLength(1)
    // anim: pulling → throw
    expect(sentOf(s.b.msgs, MsgType.GrenadeAnim).map(m => (m as { phase: string }).phase)).toEqual(['pulling', 'throw'])
    // 3 giây sau nổ
    const ticksToBlow = Math.round(GRENADE.fuseMs * TICK_RATE / 1000)
    for (let i = 0; i < ticksToBlow + 2; i++) stepRoom(s.room, defaultMovement, 1000 + i * 16.7)
    expect(s.room.grenades).toHaveLength(0)
    expect(sentOf(s.b.msgs, MsgType.GrenadeExplode)).toHaveLength(1)
  })

  it('giữ chuột 0,2s rồi thả: không ném, còn đủ lựu đạn', () => {
    const s = setup(); give(s, 2); seq = 0; nowMs = 0
    send(s, 0, 1); send(s, Btn.Fire, Math.round(0.2 * TICK_RATE)); send(s, 0, 1)
    expect(sentOf(s.b.msgs, MsgType.GrenadeSpawn)).toHaveLength(0)
    expect(s.a.p.loadout.slots[4]!.count).toBe(2)
    expect(sentOf(s.b.msgs, MsgType.GrenadeAnim).map(m => (m as { phase: string }).phase)).toEqual(['pulling', 'cancel'])
  })

  it('spam Fire liên tục: không ném quá số lựu đạn đang có', () => {
    const s = setup(); give(s, 2); seq = 0; nowMs = 0
    send(s, 0, 1)
    for (let i = 0; i < 80; i++) { send(s, Btn.Fire, 1); send(s, 0, 1) }   // nhấn-nhả mỗi tick (không đủ rút chốt)
    expect(sentOf(s.b.msgs, MsgType.GrenadeSpawn)).toHaveLength(0)
    for (let i = 0; i < 60; i++) { send(s, Btn.Fire, pullTicks); send(s, 0, 40) }
    expect(sentOf(s.b.msgs, MsgType.GrenadeSpawn)).toHaveLength(2)
    expect(s.a.p.loadout.slots[4]).toBeNull()
  })

  it('rút chốt xong (ready) rồi bị bắn chết: lựu đạn rơi tại chỗ và nổ sau 3 giây', () => {
    const s = setup(); give(s, 1); seq = 0; nowMs = 0
    at(s.a.p, -20, 0, 0)
    send(s, 0, 1); send(s, Btn.Fire, pullTicks)
    expect(s.a.p.weapon.nade.phase).toBe('ready')
    s.a.p.state.vel = [2, 0, 0]
    s.a.p.hp = 0; s.a.p.killerId = s.b.p.id; s.a.p.killWeapon = 0
    s.room.finalizeDeaths()
    expect(s.a.p.alive).toBe(false)
    expect(s.room.grenades).toHaveLength(1)
    expect(s.room.grenades[0]!.vel[0]).toBeCloseTo(2, 6)   // giữ vận tốc người chết
    expect(sentOf(s.b.msgs, MsgType.GrenadeSpawn)).toHaveLength(1)
    const ticksToBlow = Math.round(GRENADE.fuseMs * TICK_RATE / 1000)
    for (let i = 0; i < ticksToBlow + 2; i++) stepRoom(s.room, defaultMovement, 2000 + i * 16.7)
    expect(sentOf(s.b.msgs, MsgType.GrenadeExplode)).toHaveLength(1)
  })

  it('đang pulling mà chết: huỷ, không có lựu đạn nào rơi', () => {
    const s = setup(); give(s, 2); seq = 0; nowMs = 0
    send(s, 0, 1); send(s, Btn.Fire, 5)
    s.a.p.hp = 0
    s.room.finalizeDeaths()
    expect(s.room.grenades).toHaveLength(0)
    expect(sentOf(s.b.msgs, MsgType.GrenadeAnim).map(m => (m as { phase: string }).phase)).toEqual(['pulling', 'cancel'])
  })

  it('lựu đạn bay nảy rồi nằm yên trước khi nổ (vật lý chạy trong stepRoom)', () => {
    const s = setup(); give(s, 1); seq = 0; nowMs = 0
    at(s.a.p, -20, 0, 0)
    send(s, 0, 1); send(s, Btn.Fire, pullTicks); send(s, 0, 1)
    const g = s.room.grenades[0]!
    for (let i = 0; i < 120; i++) stepRoom(s.room, defaultMovement, 3000 + i * 16.7)
    expect(g.resting).toBe(true); expect(g.pos[1]).toBeLessThan(0.1)
  })
})
