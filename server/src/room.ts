import { DEFAULT_CHARACTER_SET, DEFAULT_SLOT, DEFAULT_SETTINGS, GRENADE_ID, grenadeCount, MATCH, MatchPhase, MsgType, PLAYER_MAX_HP, WEAPONS, defaultLoadout, loadoutWeaponIds, otherTeam, SPAWN_INVULN_MS, makeWeaponState, magSizeOf, makeRecoilState, sanitizeRoomConfig, type Role, type ZombieStats, type EconomyConfig, type RoomConfig, type RoomOptions, type Loadout, type RecoilState, type WeaponState, type InputCmd, type LoadedMap, type PlayerState, type Transport, type MatchRules, type TeamId, type CharacterSetId, type RoomInfo, type MapInfo } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { LagHistory } from './lagComp'
import type { RoomGrenade } from './grenades'
import { dropOnDeath } from './grenades'
import { createMode, type MatchMode } from './modes'
import type { BotController } from './bots/controller'
import type { NavGrid } from './bots/nav'

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
  inRound: boolean               // Sinh Tử: có mặt trong ván hiện tại (người vào giữa ván chỉ xem → không nhận tiền cuối ván)
  survived: boolean              // Sinh Tử: còn sống tới hết ván trước → giữ súng sang ván sau
  bot: BotController | null      // plan 15: có = bot (transport rỗng, input do BotController sinh mỗi tick)
  role: Role                     // plan 16: 'zombie' dùng movement/vuốt/hitbox riêng (xem shared/zombie.ts)
  zstats: ZombieStats | null     // thông số zombie đang áp (null = người)
  lastHurtAt: number             // serverTime lần cuối trúng đạn (zombie hồi máu sau regenDelayMs không bị bắn)
  transformUntil: number         // serverTime hết biến hình: trước đó bất tử, không di chuyển/bắn được
  pendingClaw: { at: number; cmd: InputCmd; defId: number } | null   // cào mạnh đang vung: trúng khi tới `at` (xác định lúc đó)
  damageMult: number             // anh hùng (Lây Nhiễm) ×1.5
  speedMult: number              // anh hùng ×1.1 tốc độ chạy
  hero: boolean
  flashlight: boolean            // đèn pin đang bật (người, còn sống): từ Btn.Flashlight của cmd gần nhất
  npc: NpcDriver | null          // plan 17: zombie của Thủ Thành — một Player không có kết nối, input do NpcDriver sinh mỗi tick
  takenMult: number              // nhân sát thương nhận vào (boss choáng ×1.5)
  downed: boolean                // Thủ Thành (T.6): gục chờ cứu — chưa chết hẳn
  downUntil: number              // serverTime hết hạn gục → chết hẳn
  reviveProgressMs: number       // đồng đội đang cứu mình: ms đã giữ
  sniffUntil: number             // Lây Nhiễm: chiêu đánh hơi chạy tới serverTime này
  sniffReadyAt: number           // hồi chiêu đánh hơi xong lúc này
}

/** Người điều khiển một Player không phải người thật (bot dùng BotController, zombie Thủ Thành dùng ZombieNpc) */
export interface NpcDriver {
  drive(room: Room, p: Player, nowMs: number): void
}

/** Hỗn Chiến theo luật của server (dùng khi phòng tạo không kèm cài đặt, và trong test) */
export function defaultRoomConfig(name: string, map: string, rules: MatchRules): RoomConfig {
  return { name, map, maxPlayers: rules.maxPerTeam * 2, settings: { ...DEFAULT_SETTINGS.tdm, killLimit: rules.killLimit, timeLimitMin: rules.durationMs / 60000 } }
}

/** Luật trận của một phòng: luật server + thông số từ cài đặt phòng */
export function roomRules(base: MatchRules, config: RoomConfig): MatchRules {
  const r = { ...base, maxPerTeam: config.maxPlayers / 2 }
  if (config.settings.mode === 'tdm') { r.killLimit = config.settings.killLimit; r.durationMs = config.settings.timeLimitMin * 60000 }
  return r
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

  // Phòng offline (plan 15): chỉ một người thật + bot. Cho phép lệnh OfflineCmd, tắt cân bằng đội tự động.
  offline = false
  infiniteMoney = false
  nav: NavGrid | null = null   // lưới di chuyển cho bot (host đặt); null = bot không đi được
  npcWorld: (() => CollisionWorld | Promise<CollisionWorld>) | null = null   // test: world giả cho zombie NPC (mặc định dựng Rapier thật)

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
    readonly random: () => number = Math.random,
    readonly rules: MatchRules = MATCH,
    readonly characterSet: CharacterSetId = DEFAULT_CHARACTER_SET,   // chọn lúc tạo phòng, không đổi sau đó
    readonly config: RoomConfig = defaultRoomConfig(id, '', rules),
  ) {
    this.emptySince = now()
    this.mode = createMode(config)
  }

  readonly mode: MatchMode
  get eco(): EconomyConfig { return this.mode.economy() }

  /** Số người chơi thật (không tính zombie NPC) */
  humanCount(): number {
    let n = 0
    for (const p of this.players.values()) if (!p.npc) n++
    return n
  }

  /** Thêm zombie NPC (không gửi PlayerJoined/TeamAssigned: client chỉ biết qua snapshot). Gọi bằng mode, không qua join(). */
  addNpc(name: string, npc: NpcDriver, sp: { pos: [number, number, number]; yaw: number }, team: TeamId = 'B'): Player {
    const sink: Transport = { send: () => {}, onMessage: () => {}, onClose: () => {} }
    const p = this.makePlayer(name, sink, team, sp)
    p.npc = npc
    p.invulnUntil = 0
    this.players.set(p.id, p)
    return p
  }

  /** Xoá zombie NPC (không gửi PlayerLeft). */
  removeNpc(id: number): void {
    const p = this.players.get(id)
    if (!p?.npc) return
    this.players.delete(id)
    p.world?.dispose()
    p.world = null
  }

  teamCount(team: TeamId): number {
    let n = 0
    for (const p of this.players.values()) if (p.team === team) n++
    return n
  }

  // Luật chọn đội: tự động → đội ít người hơn (bằng nhau thì ngẫu nhiên); chọn đội làm chênh lệch quá rules.maxTeamDiff thì bị chuyển sang đội kia.
  // Đội đầy (maxPerTeam) cũng chuyển; cả hai đầy → null (phòng đầy). `except` = người đang đổi đội (không tính vào đội cũ).
  assignTeam(pref: TeamId | 'auto', except: Player | null = null): TeamId | null {
    const jt = this.mode.joinTeam?.(this)   // thể thức zombie: mọi người vào phe người, chỉ giới hạn tổng số người
    if (jt !== undefined) return this.humanCount() - (except ? 1 : 0) >= this.config.maxPlayers ? null : jt
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

  // Dựng một Player mới (chưa vào danh sách, chưa gửi tin nào)
  private makePlayer(name: string, transport: Transport, team: TeamId, sp: { pos: [number, number, number]; yaw: number }): Player {
    const loadout = defaultLoadout(team, this.eco)
    const player: Player = {
      id: this.nextId++,
      name,
      transport,
      state: {
        pos: [sp.pos[0], sp.pos[1], sp.pos[2]], vel: [0, 0, 0],
        yaw: sp.yaw, pitch: 0,
        grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0,
      },
      inputQueue: [],
      lastProcessedSeq: -1,   // client đếm seq từ 0
      lastCmd: null,
      world: null,
      idleCmd: { seq: 0, buttons: 0, yaw: sp.yaw, pitch: 0, weapon: 0 },
      starvedTicks: 0,
      weapon: makeWeaponState(loadoutWeaponIds(loadout), this.eco.magMult ?? 1),
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
      money: this.eco.startMoney,
      loadout,
      killStreak: 0,
      buyTimes: [],
      inRound: true,
      survived: false,
      bot: null,
      role: 'human',
      zstats: null,
      lastHurtAt: 0,
      transformUntil: 0,
      pendingClaw: null,
      damageMult: 1,
      speedMult: 1,
      hero: false,
      flashlight: false,
      npc: null,
      takenMult: 1,
      downed: false,
      downUntil: 0,
      reviveProgressMs: 0,
      sniffUntil: 0,
      sniffReadyAt: 0,
    }
    return player
  }

  // null = phòng đầy
  join(name: string, transport: Transport, tick: number, serverTime: number, pref: TeamId | 'auto' = 'auto'): Player | null {
    const team = this.assignTeam(pref)
    if (!team) return null
    const sp = this.pickSpawn(team, null, true)
    const player = this.makePlayer(name, transport, team, sp)
    transport.send({ t: MsgType.Welcome, yourId: player.id, tick, serverTime, mapName: this.map.name, characterSet: this.characterSet,
      config: this.config, players: [...this.players.values()].map(o => ({ id: o.id, name: o.name })) })
    for (const other of this.players.values()) {
      other.transport.send({ t: MsgType.PlayerJoined, id: player.id, name: player.name })
    }
    this.players.set(player.id, player)
    this.emptySince = null
    // Đội của mọi người cho người mới; đội của người mới cho cả phòng
    for (const o of this.players.values()) if (o !== player) transport.send({ t: MsgType.TeamAssigned, id: o.id, team: o.team })
    for (const o of this.players.values()) o.transport.send({ t: MsgType.TeamAssigned, id: player.id, team })
    this.mode.onPlayerJoin(this, player)
    if (this.offline) player.money = this.eco.maxMoney   // offline: tiền vô hạn hoặc nạp lại $16000 mỗi lần hồi sinh
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
    this.mode.onPlayerLeave(this, p)
    if (this.humanCount() === 0) {
      for (const o of [...this.players.values()]) if (o.npc) this.removeNpc(o.id)   // hết người thật: bỏ zombie, phòng sẽ hết hạn
      this.emptySince = this.now()
    }
  }

  // Đặt súng theo p.loadout: cầm ô `slot` (không có thì ô có súng đầu tiên), đạn đầy, huỷ nạp
  equip(p: Player, slot = DEFAULT_SLOT): void {
    const ws = p.weapon
    ws.slots = loadoutWeaponIds(p.loadout)
    ws.slot = ws.slots[slot]! >= 0 ? slot : Math.max(0, ws.slots.findIndex(id => id >= 0))
    ws.current = ws.slots[ws.slot]!
    ws.ammo = WEAPONS.map(w => magSizeOf(w, ws.magMult))
    ws.ammo[GRENADE_ID] = grenadeCount(p.loadout)
    ws.nade.phase = 'idle'; ws.nade.quick = false; ws.quickHeld = false; ws.switchBackAtMs = 0
    ws.reloadEndMs = 0
    ws.nextFireMs = 0
    ws.triggerHeld = false
    p.recoil.pitch = 0; p.recoil.yaw = 0
  }

  // Trận mới / đổi đội: tiền ban đầu, bộ mặc định của đội, chuỗi hạ 0
  resetEconomy(p: Player): void {
    p.money = this.offline ? this.eco.maxMoney : this.eco.startMoney
    p.killStreak = 0
    p.loadout = defaultLoadout(p.team, this.eco)
    this.equip(p)
    p.transport.send({ t: MsgType.MoneyEvent, delta: p.money, reason: 'reset' })
  }

  // Chốt người chết cuối tick: hp ≤ 0 → chết, báo cả phòng. Gọi sau khi mọi người đã bước.
  finalizeDeaths(): void {
    let anyDeath = false
    for (const p of this.players.values()) {
      if (!p.alive || p.hp > 0) continue
      if (this.mode.onLethal?.(this, p)) continue   // thể thức tự xử lý (Lây Nhiễm: người chết = bị lây nhiễm, không phải chết)
      anyDeath = true
      dropOnDeath(this, p)   // đang rút chốt: ready → lựu đạn rơi tại chỗ, pulling → huỷ
      p.alive = false
      p.hp = 0
      const delay = this.mode.respawnDelayMs(this, p)
      p.respawnAt = delay === null ? Infinity : this.serverNow + delay
      p.weapon.triggerHeld = false
      const victimStreak = p.killStreak
      const reward = this.mode.onKill(this, this.players.get(p.killerId) ?? null, p)
      p.killStreak = 0
      for (const o of this.players.values()) {
        if (p.npc && o.id !== p.killerId) continue   // zombie NPC chết: chỉ người hạ nó nhận (hiệu ứng trúng), cả phòng không bị killfeed rác
        o.transport.send({ t: MsgType.Kill, killerId: p.killerId, victimId: p.id, weapon: p.killWeapon, headshot: p.killHeadshot, reward, victimStreak })
      }
    }
    if (anyDeath) this.mode.afterDeaths(this)
  }

  // Biến thành zombie (plan 16): sang phe B (không có friendly fire giữa zombie), cầm vuốt, máu theo loại. transformMs > 0: bất tử + đứng yên chừng đó
  makeZombie(p: Player, stats: ZombieStats, transformMs = 0): void {
    p.role = 'zombie'
    p.zstats = stats
    p.hp = stats.hpMax
    p.lastHurtAt = -Infinity
    p.pendingClaw = null
    p.sniffUntil = 0; p.sniffReadyAt = 0
    p.loadout = { slots: [{ key: 'claw', paid: 0 }, null, null, null, null] }
    this.equip(p)
    if (p.team !== 'B') this.setTeam(p, 'B')
    if (transformMs > 0) { p.transformUntil = this.serverNow + transformMs; p.invulnUntil = p.transformUntil }
  }

  // Về làm người (hết ván, lệnh debug): bộ súng mặc định của đội
  makeHuman(p: Player, team: TeamId = 'A'): void {
    p.role = 'human'
    p.zstats = null
    p.hp = PLAYER_MAX_HP
    p.pendingClaw = null
    p.transformUntil = 0
    p.hero = false; p.damageMult = 1; p.speedMult = 1
    if (p.team !== team) this.setTeam(p, team)
    p.loadout = defaultLoadout(p.team, this.eco)
    this.equip(p)
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

  // keepLoadout: giữ súng đang mang (người sống sót qua ván Sinh Tử); mặc định chết thì về bộ của đội
  respawn(p: Player, spawn?: { pos: [number, number, number]; yaw: number }, keepLoadout = false): void {
    const best = spawn ?? this.mode.pickSpawn?.(this, p) ?? this.pickSpawn(p.team, p)
    p.state = {
      pos: [best.pos[0], best.pos[1], best.pos[2]], vel: [0, 0, 0], yaw: best.yaw, pitch: 0,
      grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0,
    }
    p.alive = true
    p.hp = p.zstats ? p.zstats.hpMax : PLAYER_MAX_HP
    p.killerId = -1
    p.invulnUntil = this.serverNow + SPAWN_INVULN_MS
    p.lastHurtAt = -Infinity
    if (p.downed || p.downUntil !== 0) { p.downed = false; p.downUntil = 0; p.reviveProgressMs = 0; if (!p.hero) p.speedMult = 1 }   // Thủ Thành: hồi sinh xoá trạng thái gục
    // Chết thì mất súng đã mua (tiền giữ nguyên): hồi sinh với bộ mặc định của đội, cầm súng dài
    const keep = keepLoadout || this.eco.keepLoadoutOnDeath || p.zstats !== null
    if (!keep) p.loadout = defaultLoadout(p.team, this.eco)
    this.equip(p, keep ? p.weapon.slot : DEFAULT_SLOT)
    if (p.zstats) p.pendingClaw = null
    if (this.offline && p.money !== this.eco.maxMoney) {   // offline: mỗi lần hồi sinh nạp lại đủ tiền
      p.money = this.eco.maxMoney
      p.transport.send({ t: MsgType.MoneyEvent, delta: p.money, reason: 'reset' })
    }
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
  /** Lưới di chuyển theo map (zombie Thủ Thành và bot cần). Host dựng lúc khởi động; map chưa có lưới thì phòng không có zombie đi được. */
  readonly navs = new Map<string, NavGrid>()
  /** Số phòng tối đa cùng lúc (standalone đặt từ config.json); phòng mới quá giới hạn bị từ chối như phòng đầy. */
  maxRooms = Infinity

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

  tryJoin(roomId: string, name: string, transport: Transport, tick = 0, team: TeamId | 'auto' = 'auto', characterSet: CharacterSetId = DEFAULT_CHARACTER_SET, mapId?: string, options?: RoomOptions): { room: Room; player: Player } | null {
    if (!this.rooms.has(roomId) && this.rooms.size >= this.maxRooms) return null
    const room = this.rooms.get(roomId) ?? this.createRoom(roomId, characterSet, mapId, options)
    const player = room.join(name, transport, tick, this.now(), team)
    return player ? { room, player } : null
  }

  createRoom(roomId: string, characterSet: CharacterSetId = DEFAULT_CHARACTER_SET, mapId?: string, options?: RoomOptions): Room {
    const id = mapId !== undefined && this.maps.has(mapId) ? mapId : this.defaultMapId
    // Cài đặt do client gửi luôn được kẹp theo SETTINGS_LIMITS; không gửi thì Hỗn Chiến theo luật mặc định của server
    const config = options ? sanitizeRoomConfig(roomId, id, options) : defaultRoomConfig(roomId, id, this.rules)
    const rules = roomRules(this.rules, config)
    const room = new Room(roomId, this.maps.get(id)!.map, this.now, Math.random, rules, characterSet, config)
    room.mapId = id
    room.nav = this.navs.get(id) ?? null
    this.rooms.set(roomId, room)
    return room
  }

  list(): RoomInfo[] {
    const out: RoomInfo[] = []
    for (const r of this.rooms.values()) {
      out.push({ id: r.id, mapId: r.mapId, characterSet: r.characterSet, players: r.humanCount(), maxPlayers: r.config.maxPlayers, teamA: r.teamCount('A'), teamB: r.teamCount('B'), mode: r.config.settings.mode, status: r.mode.statusText(r) })
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
