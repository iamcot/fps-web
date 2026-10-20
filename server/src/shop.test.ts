import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { Btn, ECONOMY, MATCH, MatchPhase, MsgType, defaultMovement, loadMap, weaponByKey, type AnyMsg, type InputCmd, type MapFile, type Transport, type TeamId } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player } from './room'
import { enqueueCmds, sendSnapshots, stepPlayer } from './simulation'
import { handleBuy } from './shop'
import { broadcastScoreboard } from './match'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)

const flat: CollisionWorld = {
  moveCharacter: (pos, d) => ({ pos: [pos[0] + d[0], Math.max(0, pos[1] + d[1]), pos[2] + d[2]], grounded: true, hitCeiling: false }),
  canStand: () => true,
  castRay: () => null, castSphere: () => null,
  debugRender: () => ({ vertices: new Float32Array(0), colors: new Float32Array(0) }),
  dispose: () => {},
}

function setup() {
  const rm = new RoomManager(map, () => 0, { ...MATCH, minPlayersToStart: 99 })   // không tự chạy trận: test chỉnh phase tay
  const mk = (name: string, team: TeamId) => {
    const msgs: AnyMsg[] = []
    const t: Transport = { send: m => { msgs.push(m) }, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', name, t, 0, team)
    player.world = flat
    return { p: player, msgs }
  }
  const a = mk('a', 'A'), b = mk('b', 'B')
  const room = rm.rooms.get('r')!
  room.phase = MatchPhase.Playing
  return { room, a, b }
}

const at = (p: Player, x: number, y: number, z: number) => { p.state.pos = [x, y, z] }
const last = (msgs: AnyMsg[], t: number) => [...msgs].reverse().find(m => m.t === t)

describe('mua súng (H.3)', () => {
  it('trong căn cứ: mua SMG → trừ tiền, cầm luôn, đạn đầy; BuyResult + MoneyEvent', () => {
    const { room, a } = setup()
    at(a.p, -25, 0, 0)
    handleBuy(room, a.p, 'smg')
    expect(a.p.money).toBe(750)
    expect(a.p.loadout.slots[2]).toEqual({ key: 'smg', paid: 1250 })
    const smg = weaponByKey('smg')!
    expect(a.p.weapon).toMatchObject({ current: smg.id, slot: 2 })
    expect(a.p.weapon.slots[2]).toBe(smg.id)
    expect(a.p.weapon.ammo[smg.id]).toBe(smg.magSize)
    expect(last(a.msgs, MsgType.BuyResult)).toMatchObject({ ok: true, key: 'smg' })
    expect(a.msgs.filter(m => m.t === MsgType.MoneyEvent)).toContainEqual({ t: MsgType.MoneyEvent, delta: -1250, reason: 'buy' })
  })

  it('mua tiếp Shotgun cùng dòng: bán SMG 80%, còn $650, MoneyEvent sell +1000', () => {
    const { room, a } = setup()
    at(a.p, -25, 0, 0)
    handleBuy(room, a.p, 'smg'); handleBuy(room, a.p, 'shotgun')
    expect(a.p.money).toBe(650)
    expect(a.p.loadout.slots[2]?.key).toBe('shotgun')
    expect(a.msgs.filter(m => m.t === MsgType.MoneyEvent)).toContainEqual({ t: MsgType.MoneyEvent, delta: 1000, reason: 'sell' })
  })

  it('mua lựu đạn (G.1): $300/quả, tối đa 2, không tự cầm, lần 3 bị từ chối max_carry', () => {
    const { room, a } = setup()
    at(a.p, -25, 0, 0)
    const cur = a.p.weapon.current, slot = a.p.weapon.slot
    handleBuy(room, a.p, 'm67'); room.serverNow += 300
    expect(a.p.money).toBe(1700); expect(a.p.loadout.slots[4]).toEqual({ key: 'm67', paid: 300, count: 1 })
    expect(a.p.weapon.slots[4]).toBe(weaponByKey('m67')!.id)
    expect(a.p.weapon.current).toBe(cur); expect(a.p.weapon.slot).toBe(slot)   // vẫn cầm súng cũ
    handleBuy(room, a.p, 'm67'); room.serverNow += 300
    expect(a.p.money).toBe(1400); expect(a.p.loadout.slots[4]!.count).toBe(2)
    handleBuy(room, a.p, 'm67')
    expect(last(a.msgs, MsgType.BuyResult)).toMatchObject({ ok: false, reason: 'max_carry' })
    expect(a.p.money).toBe(1400)
  })

  it('từ chối: ngoài khu (giữa map / trên gờ tường / đỉnh tháp), chết, hết trận, thiếu tiền, đã có', () => {
    const { room, a } = setup()
    const reason = () => { room.serverNow += 300; return (last(a.msgs, MsgType.BuyResult) as { ok: boolean; reason?: string }).reason }   // cách nhau > 1/5s để không dính giới hạn spam
    at(a.p, 0, 0, 0); handleBuy(room, a.p, 'smg'); expect(reason()).toBe('out_of_zone')
    at(a.p, -25, 4.1, 0); handleBuy(room, a.p, 'smg'); expect(reason()).toBe('out_of_zone')      // trên gờ tường/ramp cao
    at(a.p, -17, 0, 0); handleBuy(room, a.p, 'smg'); expect(reason()).toBe('out_of_zone')        // ngoài tường thành
    at(a.p, -25, 0, 0)
    handleBuy(room, a.p, 'sniper'); expect(reason()).toBe('not_enough_money')
    handleBuy(room, a.p, 'm16'); expect(reason()).toBe('already_owned')
    handleBuy(room, a.p, 'knife'); expect(reason()).toBe('not_buyable')
    handleBuy(room, a.p, 'bazooka'); expect(reason()).toBe('unknown')
    a.p.alive = false; handleBuy(room, a.p, 'smg'); expect(reason()).toBe('dead')
    a.p.alive = true; room.phase = MatchPhase.Ended; handleBuy(room, a.p, 'smg'); expect(reason()).toBe('phase')
    expect(a.p.money).toBe(ECONOMY.startMoney)
  })

  it('tối đa 5 lệnh Buy mỗi giây', () => {
    const { room, a } = setup()
    at(a.p, -25, 0, 0)
    room.serverNow = 5000
    for (let i = 0; i < 6; i++) handleBuy(room, a.p, 'bazooka')
    expect((last(a.msgs, MsgType.BuyResult) as { reason?: string }).reason).toBe('rate')
    room.serverNow = 6001
    handleBuy(room, a.p, 'smg')
    expect((last(a.msgs, MsgType.BuyResult) as { ok: boolean }).ok).toBe(true)
  })

  it('đội B mua ở căn cứ x dương; đổi bên thì ngược lại', () => {
    const { room, a, b } = setup()
    at(b.p, 25, 0, 0); handleBuy(room, b.p, 'smg')
    expect((last(b.msgs, MsgType.BuyResult) as { ok: boolean }).ok).toBe(true)
    at(b.p, -25, 0, 0); handleBuy(room, b.p, 'shotgun')
    expect((last(b.msgs, MsgType.BuyResult) as { reason?: string }).reason).toBe('out_of_zone')
    room.sideSwapped = true
    at(a.p, 25, 0, 0); handleBuy(room, a.p, 'smg')
    expect((last(a.msgs, MsgType.BuyResult) as { ok: boolean }).ok).toBe(true)
    at(a.p, -25, 0, 0); handleBuy(room, a.p, 'shotgun')
    expect((last(a.msgs, MsgType.BuyResult) as { reason?: string }).reason).toBe('out_of_zone')
  })

  it('snapshot gửi riêng money + loadout + súng; NetPlayer có killStreak', () => {
    const { room, a } = setup()
    at(a.p, -25, 0, 0); handleBuy(room, a.p, 'smg'); a.p.killStreak = 4
    sendSnapshots(room, 0, 0)
    const snap = last(a.msgs, MsgType.Snapshot) as Extract<AnyMsg, { t: 103 }>
    expect(snap.money).toBe(750)
    expect(snap.loadout![2]).toEqual({ key: 'smg', paid: 1250 })
    expect(snap.wpn!.slot).toBe(2)
    expect(snap.players.find(p => p.id === a.p.id)!.killStreak).toBe(4)
  })
})

describe('thưởng, chuỗi hạ, mất súng khi chết (H.3)', () => {
  function kill(room: ReturnType<typeof setup>['room'], killer: Player, victim: Player) {
    victim.hp = 0; victim.killerId = killer.id
    room.finalizeDeaths()
  }

  it('hạ 1 mạng +$500, chuỗi tăng; nạn nhân chuỗi về 0', () => {
    const { room, a, b } = setup()
    kill(room, a.p, b.p)
    expect(a.p.money).toBe(2500); expect(a.p.killStreak).toBe(1); expect(b.p.killStreak).toBe(0)
    expect(a.msgs.filter(m => m.t === MsgType.MoneyEvent)).toContainEqual({ t: MsgType.MoneyEvent, delta: 500, reason: 'kill' })
    expect(last(b.msgs, MsgType.Kill)).toMatchObject({ reward: 500, victimStreak: 0 })
  })

  it('hạ người có chuỗi ≥ 3 → +$1000 (bounty); sau đó nạn nhân hồi sinh với chuỗi 0', () => {
    const { room, a, b } = setup()
    b.p.killStreak = 3
    kill(room, a.p, b.p)
    expect(a.p.money).toBe(3000)
    expect(a.msgs.filter(m => m.t === MsgType.MoneyEvent)).toContainEqual({ t: MsgType.MoneyEvent, delta: 1000, reason: 'bounty' })
    expect(last(a.msgs, MsgType.Kill)).toMatchObject({ reward: 1000, victimStreak: 3 })
    room.respawn(b.p)
    expect(b.p.killStreak).toBe(0)
  })

  it('tiền không vượt $16000; không thưởng khi chưa PLAYING hoặc đồng đội', () => {
    const { room, a, b } = setup()
    a.p.money = 15800
    kill(room, a.p, b.p)
    expect(a.p.money).toBe(16000)
    const { room: r2, a: a2, b: b2 } = setup()
    r2.phase = MatchPhase.Countdown
    kill(r2, a2.p, b2.p)
    expect(a2.p.money).toBe(2000)
  })

  it('mua Sniper, chết, hồi sinh: về bộ mặc định của đội (Cớm: Colt + M16), tiền giữ nguyên', () => {
    const { room, a, b } = setup()
    a.p.money = 8000
    at(a.p, -25, 0, 0); handleBuy(room, a.p, 'sniper')
    expect(a.p.money).toBe(3250)
    kill(room, b.p, a.p)
    room.respawn(a.p)
    expect(a.p.loadout.slots.map(w => w?.key ?? null)).toEqual(['knife', 'colt', null, 'm16', null])
    expect(a.p.weapon.slots).toEqual([weaponByKey('knife')!.id, weaponByKey('colt')!.id, -1, weaponByKey('m16')!.id, -1])
    expect(a.p.weapon).toMatchObject({ slot: 3, current: weaponByKey('m16')!.id })
    expect(a.p.money).toBe(3250 + 500 * 0)   // a là nạn nhân: không đổi
  })

  it('trận mới: mọi người $2000, bộ mặc định, chuỗi 0 (+ MoneyEvent reset)', () => {
    const { room, a } = setup()
    a.p.money = 9000; a.p.killStreak = 5
    room.resetEconomy(a.p)
    expect(a.p).toMatchObject({ money: 2000, killStreak: 0 })
    expect(last(a.msgs, MsgType.MoneyEvent)).toMatchObject({ delta: 2000, reason: 'reset' })
  })

  it('bảng điểm: tiền chỉ gửi cho đồng đội, đối phương không thấy', () => {
    const { room, a, b } = setup()
    a.p.money = 5000; b.p.money = 7000
    broadcastScoreboard(room)
    const rowsA = (last(a.msgs, MsgType.Scoreboard) as Extract<AnyMsg, { t: 114 }>).rows
    expect(rowsA.find(r => r.id === a.p.id)!.money).toBe(5000)
    expect(rowsA.find(r => r.id === b.p.id)!.money).toBeUndefined()
    const rowsB = (last(b.msgs, MsgType.Scoreboard) as Extract<AnyMsg, { t: 114 }>).rows
    expect(rowsB.find(r => r.id === b.p.id)!.money).toBe(7000)
    expect(rowsB.find(r => r.id === a.p.id)!.money).toBeUndefined()
  })
})

describe('đổi súng theo ô + tốc độ (H.1/H.4)', () => {
  const cmd = (seq: number, weapon: number, buttons = 0): InputCmd => ({ seq, buttons, yaw: 0, pitch: 0, weapon })
  const speedWith = (slot: number) => {
    const { room, a } = setup()
    for (let i = 0; i < 180; i++) { enqueueCmds(a.p, [cmd(i, slot, Btn.Forward)], i * 1000 / 60); stepPlayer(a.p, defaultMovement, room) }
    return Math.hypot(a.p.state.vel[0], a.p.state.vel[2])
  }
  it('cầm dao chạy nhanh hơn cầm súng dài; ô trống không đổi súng', () => {
    expect(speedWith(0)).toBeGreaterThan(speedWith(3) + 0.5)
    const { room, a } = setup()
    enqueueCmds(a.p, [cmd(0, 2)], 0); stepPlayer(a.p, defaultMovement, room)
    expect(a.p.weapon.slot).toBe(3)   // ô 2 trống
  })
  it('cmd còn bay mang ô cũ sau khi mua không kéo súng về ô cũ', () => {
    const { room, a } = setup()
    at(a.p, -25, 0, 0)
    enqueueCmds(a.p, [cmd(0, 3)], 0); stepPlayer(a.p, defaultMovement, room)
    handleBuy(room, a.p, 'smg')
    enqueueCmds(a.p, [cmd(1, 3), cmd(2, 3)], 20); stepPlayer(a.p, defaultMovement, room)
    expect(a.p.weapon.current).toBe(weaponByKey('smg')!.id)
    enqueueCmds(a.p, [cmd(3, 2)], 30); stepPlayer(a.p, defaultMovement, room)   // client bấm ô 2: đã cầm rồi
    expect(a.p.weapon.slot).toBe(2)
  })
})
