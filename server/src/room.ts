import { DEFAULT_CHARACTER_SET, DEFAULT_SLOT, ECONOMY, GRENADE_ID, grenadeCount, MATCH, MatchPhase, MsgType, PLAYER_MAX_HP, WEAPONS, addMoney, defaultLoadout, killReward, loadoutWeaponIds, otherTeam, RESPAWN_DELAY_MS, SPAWN_INVULN_MS, makeWeaponState, makeRecoilState, type Loadout, type RecoilState, type WeaponState, type InputCmd, type LoadedMap, type PlayerState, type Transport, type MatchRules, type TeamId, type CharacterSetId, type RoomInfo, type MapInfo } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { LagHistory } from './lagComp'
import type { RoomGrenade } from './grenades'
import { dropOnDeath } from './grenades'
import { runKillRules } from './teamRules'

export const EMPTY_ROOM_TTL_MS = 60_000
export const MAX_NAME_LEN = 16
export const MAX_ROOM_LEN = 32

export interface Player {
  id: number
  name: string
  transport: Transport
  state: PlayerState
  inputQueue: InputCmd[]
  lastProcessedSeq: number
  lastCmd: InputCmd | null
  world: CollisionWorld | null   // Rapier world riêng mỗi người (capsule kinematic); nạp bất đồng bộ sau khi join
  idleCmd: InputCmd              // scratch tái sử dụng khi hàng đợi trống
  starvedTicks: number           // số tick liên tiếp hàng đợi trống
  weapon: WeaponState            // đạn/reload/fire rate do server giữ (4.1)
  recoil: RecoilState            // recoil tích luỹ để tính hướng đạn (cùng công thức với client)
  alive: boolean                 // người chết không có hitbox, không bắn, không nhận input di chuyển
  hp: number                     // hp ≤ 0 mà còn alive = chờ chốt cuối tick (để hai người bắn chết nhau cùng tick đều chết)
  respawnAt: number              // serverTime hồi sinh khi đã chết
  invulnUntil: number            // serverTime hết bất tử; về 0 khi bắn phát hợp lệ đầu tiên
  killerId: number               // ai bắn hạ (-1 = chưa); kèm vũ khí/headshot để gửi Kill
  killWeapon: number
  killHeadshot: boolean
  deadCmd: InputCmd              // scratch: cmd đã bỏ nút khi đang chết
  debugShots: boolean            // F7: gửi DebugShot cho người này
  rewindClamped: number          // số phát bị kẹp vì fireRenderTime cũ hơn MAX_REWIND_MS
  shotsFired: number             // số phát bắn hợp lệ từ lúc vào phòng (log/test)
  team: TeamId
  kills: number                  // trong trận hiện tại (chỉ tính ở PLAYING)
  deaths: number
  pingMs: number                 // RTT do client báo trong Ping, cho bảng điểm
  seqOffset: number | null       // now − seq*1000/TICK_RATE của cmd đầu tiên; chặn seq chạy nhanh hơn thời gian thực
  money: number                  // chỉ server quyết định (shared/economy)
  loadout: Loadout               // súng đang mang theo ô; weapon.slots là bản id của nó
  killStreak: number             // chuỗi hạ hiện tại; về 0 khi chết
  buyTimes: number[]             // serverTime các lệnh Buy trong 1 giây gần nhất (giới hạn spam)
}

export class Room {
  mapId = ''   // id map trong RoomManager.maps (RoomManager đặt khi tạo)
  readonly players = new Map<number, Player>()
  emptySince: number | null
  readonly history = new LagHistory()
  serverNow = 0   // serverTime của tick đang chạy (stepRoom đặt)
  tick = 0        // số tick của phòng (TickLoop truyền vào stepRoom; thiếu thì tự tăng) — mốc thời gian của lựu đạn
  grenades: RoomGrenade[] = []
  nextGrenadeId = 1
  private nextId = 1

  // Trận đấu (5.2): máy trạng thái chạy trong match.ts
  phase: MatchPhase = MatchPhase.Waiting
  phaseEndsAt = 0
  scoreA = 0
  scoreB = 0
  sideSwapped = false
  lastBroadcast = -Infinity   // serverTime lần gửi MatchState/Scoreboard gần nhất (mỗi 1s)

  constructor(
    readonly id: string,
    readonly map: LoadedMap,
    private now: () => number,
    private random: () => number = Math.random,
    readonly rules: MatchRules = MATCH,
    readonly characterSet: CharacterSetId = DEFAULT_CHARACTER_SET,   // chọn lúc tạo phòng, không đổi sau đó
  ) {
    this.emptySince = now()
  }

  teamCount(team: TeamId): number {
    let n = 0
    for (const p of this.players.values()) if (p.team === team) n++
    return n
  }

  // Luật chọn đội: tự động → đội ít người hơn (bằng nhau thì ngẫu nhiên); chọn đội làm chênh lệch quá rules.maxTeamDiff thì bị chuyển sang đội kia.
  // Đội đầy (maxPerTeam) cũng chuyển; cả hai đầy → null (phòng đầy). `except` = người đang đổi đội (không tính vào đội cũ).
  assignTeam(pref: TeamId | 'auto', except: Player | null = null): TeamId | null {
    let a = this.teamCount('A'), b = this.teamCount('B')
    if (except) { if (except.team === 'A') a--; else b-- }
    const count = (t: TeamId) => (t === 'A' ? a : b)
    let team: TeamId = pref === 'auto' ? (a === b ? (this.random() < 0.5 ? 'A' : 'B') : a < b ? 'A' : 'B') : pref
    if (count(team) + 1 - count(otherTeam(team)) > this.rules.maxTeamDiff) team = otherTeam(team)
    if (count(team) >= this.rules.maxPerTeam) team = otherTeam(team)
    return count(team) >= this.rules.maxPerTeam ? null : team
  }

  // Căn cứ của đội: đổi bên thì đội A ở căn cứ B và ngược lại (5.4)
  baseSpawns(team: TeamId): LoadedMap['spawns']['A'] {
    return (team === 'A') !== this.sideSwapped ? this.map.spawns.A : this.map.spawns.B
  }

  setTeam(p: Player, team: TeamId): void {
    p.team = team
    for (const o of this.players.values()) o.transport.send({ t: MsgType.TeamAssigned, id: p.id, team })
  }

  // null = phòng đầy
  join(name: string, transport: Transport, tick: number, serverTime: number, pref: TeamId | 'auto' = 'auto'): Player | null {
    const team = this.assignTeam(pref)
    if (!team) return null
    const sp = this.pickSpawn(team, null, true)
    const loadout = defaultLoadout(team)
    const player: Player = {
      id: this.nextId++,
      name,
      transport,
      state: {
        pos: [sp.pos[0], sp.pos[1], sp.pos[2]], vel: [0, 0, 0],
        yaw: sp.yaw, pitch: 0,
        grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0,
      },
      inputQueue: [],
      lastProcessedSeq: -1,   // client đếm seq từ 0
      lastCmd: null,
      world: null,
      idleCmd: { seq: 0, buttons: 0, yaw: sp.yaw, pitch: 0, weapon: 0 },
      starvedTicks: 0,
      weapon: makeWeaponState(loadoutWeaponIds(loadout)),
      recoil: makeRecoilState(),
      alive: true,
      hp: PLAYER_MAX_HP,
      respawnAt: 0,
      invulnUntil: 0,
      killerId: -1,
      killWeapon: 0,
      killHeadshot: false,
      deadCmd: { seq: 0, buttons: 0, yaw: 0, pitch: 0, weapon: 0 },
      debugShots: false,
      rewindClamped: 0,
      shotsFired: 0,
      team,
      kills: 0,
      deaths: 0,
      pingMs: 0,
      seqOffset: null,
      money: ECONOMY.startMoney,
      loadout,
      killStreak: 0,
      buyTimes: [],
    }
    transport.send({ t: MsgType.Welcome, yourId: player.id, tick, serverTime, mapName: this.map.name, characterSet: this.characterSet,
      players: [...this.players.values()].map(o => ({ id: o.id, name: o.name })) })
    for (const other of this.players.values()) {
      other.transport.send({ t: MsgType.PlayerJoined, id: player.id, name: player.name })
    }
    this.players.set(player.id, player)
    this.emptySince = null
    // Đội của mọi người cho người mới; đội của người mới cho cả phòng
    for (const o of this.players.values()) if (o !== player) transport.send({ t: MsgType.TeamAssigned, id: o.id, team: o.team })
    for (const o of this.players.values()) o.transport.send({ t: MsgType.TeamAssigned, id: player.id, team })
    // Vào giữa trận: bất tử như vừa hồi sinh (5.4)
    if (this.phase !== MatchPhase.Waiting) player.invulnUntil = this.serverNow + SPAWN_INVULN_MS
    transport.send({ t: MsgType.MoneyEvent, delta: player.money, reason: 'reset' })
    return player
  }

  leave(id: number): void {
    const p = this.players.get(id)
    if (!p) return
    this.players.delete(id)
    p.world?.dispose()
    p.world = null
    for (const other of this.players.values()) other.transport.send({ t: MsgType.PlayerLeft, id })
    if (this.players.size === 0) this.emptySince = this.now()
  }

  // Đặt súng theo p.loadout: cầm ô `slot` (không có thì ô có súng đầu tiên), đạn đầy, huỷ nạp
  equip(p: Player, slot = DEFAULT_SLOT): void {
    const ws = p.weapon
    ws.slots = loadoutWeaponIds(p.loadout)
    ws.slot = ws.slots[slot]! >= 0 ? slot : Math.max(0, ws.slots.findIndex(id => id >= 0))
    ws.current = ws.slots[ws.slot]!
    ws.ammo = WEAPONS.map(w => w.magSize)
    ws.ammo[GRENADE_ID] = grenadeCount(p.loadout)
    ws.nade.phase = 'idle'; ws.nade.quick = false; ws.quickHeld = false; ws.switchBackAtMs = 0
    ws.reloadEndMs = 0
    ws.nextFireMs = 0
    ws.triggerHeld = false
    p.recoil.pitch = 0; p.recoil.yaw = 0
  }

  // Trận mới / đổi đội: tiền ban đầu, bộ mặc định của đội, chuỗi hạ 0
  resetEconomy(p: Player): void {
    p.money = ECONOMY.startMoney
    p.killStreak = 0
    p.loadout = defaultLoadout(p.team)
    this.equip(p)
    p.transport.send({ t: MsgType.MoneyEvent, delta: p.money, reason: 'reset' })
  }

  // Chốt người chết cuối tick: hp ≤ 0 → chết, báo cả phòng. Gọi sau khi mọi người đã bước.
  finalizeDeaths(): void {
    let anyDeath = false
    for (const p of this.players.values()) {
      if (!p.alive || p.hp > 0) continue
      anyDeath = true
      dropOnDeath(this, p)   // đang rút chốt: ready → lựu đạn rơi tại chỗ, pulling → huỷ
      p.alive = false
      p.hp = 0
      // WAITING hồi sinh ngay; còn lại theo RESPAWN_DELAY_MS
      p.respawnAt = this.serverNow + (this.phase === MatchPhase.Waiting ? 0 : RESPAWN_DELAY_MS)
      p.weapon.triggerHeld = false
      const victimStreak = p.killStreak
      let reward = 0
      if (this.phase === MatchPhase.Playing) {
        p.deaths++
        const killer = this.players.get(p.killerId)
        if (killer && killer.team !== p.team) {
          killer.kills++
          if (killer.team === 'A') this.scoreA++; else this.scoreB++
          reward = killReward(victimStreak)
          killer.money = addMoney(killer.money, reward)
          killer.killStreak++
          killer.transport.send({ t: MsgType.MoneyEvent, delta: reward, reason: victimStreak >= ECONOMY.bountyStreak ? 'bounty' : 'kill' })
        }
      }
      p.killStreak = 0
      for (const o of this.players.values()) {
        o.transport.send({ t: MsgType.Kill, killerId: p.killerId, victimId: p.id, weapon: p.killWeapon, headshot: p.killHeadshot, reward, victimStreak })
      }
    }
    if (anyDeath) runKillRules(this)
  }

  // Hồi sinh người đã chết đủ lâu
  respawnDue(): void {
    for (const p of this.players.values()) {
      if (p.alive || this.serverNow < p.respawnAt) continue
      this.respawn(p)
    }
  }

  // Spawn trong căn cứ của đội, xa kẻ địch còn sống nhất (điểm có khoảng cách tới kẻ địch gần nhất lớn nhất).
  // `p` = null: người đang vào phòng (chưa có trong danh sách).
  pickSpawn(team: TeamId, p: Player | null, spreadTeammates = false): LoadedMap['spawns']['A'][number] {
    const all = this.baseSpawns(team)
    let best = all[0] ?? { pos: [0, 2, 0] as [number, number, number], yaw: 0 }
    let bestScore = -1
    for (const sp of all) {
      let nearest = Infinity
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue
        // Đồng đội cũng tránh để không chồng lên nhau, nhưng kẻ địch mới là tiêu chí chính
        if (o.team === team && !spreadTeammates) continue
        nearest = Math.min(nearest, Math.hypot(o.state.pos[0] - sp.pos[0], o.state.pos[2] - sp.pos[2]))
      }
      if (nearest > bestScore) { bestScore = nearest; best = sp }
    }
    return best
  }

  respawn(p: Player, spawn?: { pos: [number, number, number]; yaw: number }): void {
    const best = spawn ?? this.pickSpawn(p.team, p)
    p.state = {
      pos: [best.pos[0], best.pos[1], best.pos[2]], vel: [0, 0, 0], yaw: best.yaw, pitch: 0,
      grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0,
    }
    p.alive = true
    p.hp = PLAYER_MAX_HP
    p.killerId = -1
    p.invulnUntil = this.serverNow + SPAWN_INVULN_MS
    // Chết thì mất súng đã mua (tiền giữ nguyên): hồi sinh với bộ mặc định của đội, cầm súng dài
    if (!ECONOMY.keepLoadoutOnDeath) p.loadout = defaultLoadout(p.team)
    this.equip(p, ECONOMY.keepLoadoutOnDeath ? p.weapon.slot : DEFAULT_SLOT)
    for (const o of this.players.values()) {
      o.transport.send({ t: MsgType.Respawn, id: p.id, pos: [best.pos[0], best.pos[1], best.pos[2]], yaw: best.yaw })
    }
  }

  isExpired(): boolean {
    return this.emptySince !== null && this.now() - this.emptySince > EMPTY_ROOM_TTL_MS
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>()
  /** Các map chọn được khi tạo phòng; map đầu tiên là mặc định */
  readonly maps = new Map<string, { name: string; map: LoadedMap }>()

  constructor(private map: LoadedMap, private now: () => number = () => performance.now(), private rules: MatchRules = MATCH, private defaultMapId = 'default') {
    this.maps.set(defaultMapId, { name: map.name, map })
  }

  registerMap(id: string, name: string, map: LoadedMap): void { this.maps.set(id, { name, map }) }

  // Vào phòng chưa có thì tạo mới. tryJoin trả null khi phòng đầy
  join(roomId: string, name: string, transport: Transport, tick = 0, team: TeamId | 'auto' = 'auto', characterSet: CharacterSetId = DEFAULT_CHARACTER_SET, mapId?: string): { room: Room; player: Player } {
    const res = this.tryJoin(roomId, name, transport, tick, team, characterSet, mapId)
    if (!res) throw new Error('phòng đầy')
    return res
  }

  tryJoin(roomId: string, name: string, transport: Transport, tick = 0, team: TeamId | 'auto' = 'auto', characterSet: CharacterSetId = DEFAULT_CHARACTER_SET, mapId?: string): { room: Room; player: Player } | null {
    let room = this.rooms.get(roomId)
    if (!room) {
      const id = mapId !== undefined && this.maps.has(mapId) ? mapId : this.defaultMapId
      room = new Room(roomId, this.maps.get(id)!.map, this.now, Math.random, this.rules, characterSet)
      room.mapId = id
      this.rooms.set(roomId, room)
    }
    const player = room.join(name, transport, tick, this.now(), team)
    return player ? { room, player } : null
  }

  list(): RoomInfo[] {
    const out: RoomInfo[] = []
    for (const r of this.rooms.values()) {
      out.push({ id: r.id, mapId: r.mapId, characterSet: r.characterSet, players: r.players.size, maxPlayers: this.rules.maxPerTeam * 2, teamA: r.teamCount('A'), teamB: r.teamCount('B') })
    }
    return out
  }

  mapList(): MapInfo[] { return [...this.maps].map(([id, m]) => ({ id, name: m.name })) }

  // Xoá phòng trống quá 60 giây; gọi định kỳ
  sweep(): void {
    for (const [id, room] of this.rooms) if (room.isExpired()) this.rooms.delete(id)
  }
}

export function sanitizeName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_NAME_LEN) : ''
}

export function sanitizeRoom(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_ROOM_LEN) : ''
}
