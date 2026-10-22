// Thủ Thành (plan 17): cả phòng cùng phe người giữ căn cứ A chống zombie NPC kéo tới theo đợt (waves.json), đợt cuối có boss.
//
// WARMUP ─(có người)→ PREP (prepSec) ─→ WAVE n ─→ INTERMISSION ─→ WAVE n+1 … ─→ WAVE N (boss) ─→ VICTORY
//                                                      WAVE (mọi người đều chết/gục cùng lúc) ─→ DEFEAT
// VICTORY / DEFEAT ─(endSec)→ WARMUP (vào lại PREP ngay nếu còn người). MatchPhase: PREP/INTERMISSION = Prep, WAVE = Playing, VICTORY/DEFEAT = Ended.
// Zombie là Player NPC (room.addNpc) dùng chung stepPlayer/stepMovement/resolveShot; xem zombies/npc.ts.
import {
  DEFENSE, ECONOMY_DEFENSE, downedSpeedMul, MatchPhase, MsgType, WAVES, ZOMBIE_TYPES, addMoney, scaledCount, waveClearBonus, zombieStatsFor, inBuyZone,
  type DefenseEndMsg, type DefensePhase, type DefenseSettings, type MatchStateMsg, type ScoreboardRow, type SpawnLane, type TeamId, type Vec3,
} from '@fps/shared'
import type { Player, Room } from '../room'
import { broadcastMatch, broadcastScoreboard, setPhase } from '../match'
import { Zone } from '../bots/nav'
import { ZombieNpc, attachNpcWorld, type NpcCtx } from '../zombies/npc'
import type { MatchMode } from './index'

const MS = 1000
const SPAWN_TRIES = 10

interface Stat { kills: number; damage: number; revives: number }
interface Queued { at: number; type: string; lanes: SpawnLane[] }

export class DefenseMode implements MatchMode {
  readonly mode = 'defense' as const
  kind: DefensePhase = 'waiting'
  wave = 0
  private queue: Queued[] = []
  private waveStartedAt = 0
  private readonly stats = new Map<number, Stat>()
  private corpses: { id: number; at: number }[] = []
  private lastBroadcast = 0
  private lanes: { baseB: number[]; laneLeft: number[]; laneRight: number[] } | null = null
  private lanesFor: unknown = null

  readonly ctx: NpcCtx

  constructor(readonly s: DefenseSettings) {
    this.ctx = {
      difficulty: s.difficulty,
      humans: room => this.humans(room).filter(p => p.alive),
      players: room => Math.max(1, this.humans(room).length),
      spawn: (type, x, y, z, free) => (this.room ? this.spawnZombie(this.room, type, [x, y, z], free === true) : null),
    }
  }
  private room: Room | null = null

  get waves(): number { return Math.min(this.s.waves, WAVES.waves.length) }

  economy() { return ECONOMY_DEFENSE }

  humans(room: Room): Player[] {
    const out: Player[] = []
    for (const p of room.players.values()) if (!p.npc) out.push(p)
    return out
  }
  zombies(room: Room): Player[] {
    const out: Player[] = []
    for (const p of room.players.values()) if (p.npc) out.push(p)
    return out
  }
  aliveZombies(room: Room): number {
    let n = 0
    for (const p of room.players.values()) if (p.npc && p.alive) n++
    return n
  }
  /** Số zombie còn phải hạ trong đợt: đang sống + còn chờ sinh */
  zombiesLeft(room: Room): number { return this.aliveZombies(room) + this.queue.length }

  private st(p: Player): Stat {
    let v = this.stats.get(p.id)
    if (!v) { v = { kills: 0, damage: 0, revives: 0 }; this.stats.set(p.id, v) }
    return v
  }
  private standing(room: Room): number {
    let n = 0
    for (const p of room.players.values()) if (!p.npc && p.alive && !p.downed) n++
    return n
  }

  // ── Máy trạng thái ────────────────────────────────────────────────────────────
  tick(room: Room, now: number): void {
    this.room = room
    const humans = this.humans(room).length
    switch (this.kind) {
      case 'waiting':
        if (humans >= 1) this.startPrep(room, now)
        break
      case 'prep':
      case 'intermission':
        if (humans === 0) { this.toWaiting(room); break }
        if (now >= room.phaseEndsAt) this.startWave(room, now, this.wave + 1)
        break
      case 'wave':
        if (humans === 0) { this.toWaiting(room); break }
        this.waveTick(room, now)
        break
      case 'victory':
      case 'defeat':
        if (now >= room.phaseEndsAt) this.toWaiting(room)
        break
    }
    this.cleanCorpses(room, now)
    if (now - this.lastBroadcast >= 1000) this.sendState(room)
  }

  private sendState(room: Room): void {
    this.lastBroadcast = room.serverNow
    const msg = { t: MsgType.DefenseState, phase: this.kind, wave: this.wave, waves: this.waves, phaseEndsAt: room.phaseEndsAt, zombiesLeft: this.kind === 'wave' ? this.zombiesLeft(room) : 0 } as const
    for (const p of room.players.values()) if (!p.npc) p.transport.send(msg)
  }

  private clearZombies(room: Room): void {
    for (const z of this.zombies(room)) room.removeNpc(z.id)
    this.queue = []
    this.corpses = []
  }

  private toWaiting(room: Room): void {
    this.clearZombies(room)
    this.kind = 'waiting'
    this.wave = 0
    setPhase(room, MatchPhase.Waiting, 0)
    this.sendState(room)
  }

  // Đầu trận: tiền/súng về ban đầu, mọi người ở căn cứ A
  private startPrep(room: Room, now: number): void {
    this.clearZombies(room)
    this.stats.clear()
    this.wave = 0
    this.kind = 'prep'
    const used = { n: 0 }
    for (const p of this.humans(room)) {
      this.reviveFully(room, p)
      room.resetEconomy(p)
      const spawns = room.baseSpawns('A')
      room.respawn(p, spawns[used.n++ % spawns.length])
      p.invulnUntil = 0
      p.kills = 0; p.deaths = 0
    }
    setPhase(room, MatchPhase.Prep, now + this.s.prepSec * MS)
    this.sendState(room)
  }

  private reviveFully(room: Room, p: Player): void {
    p.downed = false; p.downUntil = 0; p.reviveProgressMs = 0
    p.speedMult = 1
    void room
  }

  private startWave(room: Room, now: number, n: number): void {
    this.wave = n
    this.kind = 'wave'
    this.waveStartedAt = now
    const def = WAVES.waves[n - 1]!
    const players = Math.max(1, this.humans(room).length)
    this.queue = []
    for (const g of def.groups) {
      const count = g.type === 'boss' ? g.count : scaledCount(g.count, this.s.difficulty, players)
      for (let k = 0; k < count; k++) this.queue.push({ at: now + (g.delayMs ?? 0) + k * (g.everyMs ?? 0), type: g.type, lanes: g.from })
    }
    this.queue.sort((a, b) => a.at - b.at)
    for (const p of this.humans(room)) p.transport.send({ t: MsgType.WaveStart, wave: n, title: def.title, hint: def.hint })
    setPhase(room, MatchPhase.Playing, 0)
    this.sendState(room)
  }

  private waveTick(room: Room, now: number): void {
    // sinh zombie đến hạn (tạm dừng khi đã đủ maxAlive)
    let alive = this.aliveZombies(room)
    while (this.queue.length > 0 && this.queue[0]!.at <= now && alive < WAVES.maxAlive) {
      const q = this.queue.shift()!
      if (this.spawnLane(room, q.type, q.lanes)) alive++
    }
    // rơi khỏi map: bỏ, không tính tiền
    for (const z of this.zombies(room)) if (z.alive && z.state.pos[1] < DEFENSE.voidKillY) room.removeNpc(z.id)
    this.tickDowned(room, now)
    if (this.humans(room).length > 0 && this.standing(room) === 0) { this.endGame(room, now, 'defeat'); return }
    if (this.queue.length === 0 && this.aliveZombies(room) === 0) this.clearWave(room, now)
  }

  private clearWave(room: Room, now: number): void {
    const bonus = waveClearBonus(this.wave)
    for (const p of this.humans(room)) {
      p.money = addMoney(p.money, bonus, ECONOMY_DEFENSE)
      p.transport.send({ t: MsgType.MoneyEvent, delta: bonus, reason: 'round_win' })
      p.transport.send({ t: MsgType.WaveClear, wave: this.wave, bonus })
    }
    if (this.wave >= this.waves) { this.endGame(room, now, 'victory'); return }
    // nghỉ: hồi sinh và cứu mọi đồng đội, máu đầy
    this.kind = 'intermission'
    for (const p of this.humans(room)) {
      if (!p.alive) room.respawn(p, room.pickSpawn(p.team, p), true)
      else { p.hp = DEFENSE.prepReviveHp }
      this.reviveFully(room, p)
    }
    setPhase(room, MatchPhase.Prep, now + this.s.intermissionSec * MS)
    this.sendState(room)
    broadcastScoreboard(room)
  }

  private endGame(room: Room, now: number, result: 'victory' | 'defeat'): void {
    this.kind = result
    this.queue = []
    const stats = this.humans(room).map(p => { const s = this.st(p); return { id: p.id, kills: s.kills, damage: Math.round(s.damage), revives: s.revives } })
    const msg: DefenseEndMsg = { t: MsgType.DefenseEnd, result, wave: this.wave, stats }
    for (const p of this.humans(room)) p.transport.send(msg)
    setPhase(room, MatchPhase.Ended, now + this.s.endSec * MS)
    this.sendState(room)
    broadcastScoreboard(room)
  }

  // ── Sinh zombie ───────────────────────────────────────────────────────────────
  private laneNodes(room: Room): { baseB: number[]; laneLeft: number[]; laneRight: number[] } {
    const nav = room.nav
    const key = nav ?? room.map
    if (this.lanes && this.lanesFor === key) return this.lanes
    const lanes = { baseB: [] as number[], laneLeft: [] as number[], laneRight: [] as number[] }
    if (nav) {
      for (let i = 0; i < nav.count; i++) {
        if (nav.y[i]! > 0.5) continue
        const x = nav.x[i]!, z = nav.z[i]!
        if (nav.zone[i] === Zone.BaseB) lanes.baseB.push(i)
        else if (x > 5 && z <= -16) lanes.laneLeft.push(i)
        else if (x > 5 && z >= 16) lanes.laneRight.push(i)
      }
      if (lanes.laneLeft.length === 0) lanes.laneLeft = lanes.baseB
      if (lanes.laneRight.length === 0) lanes.laneRight = lanes.baseB
    }
    this.lanes = lanes; this.lanesFor = key
    return lanes
  }

  /** Chọn điểm sinh không nằm trong tầm nhìn người chơi nào (raycast); không được thì lấy điểm cuối cùng thử */
  private pickSpawnPoint(room: Room, lanes: SpawnLane[]): Vec3 | null {
    const nav = room.nav
    const humans = this.ctx.humans(room)
    if (!nav) {
      const sp = room.map.spawns.B
      const s = sp[Math.floor(room.random() * sp.length)]
      return s ? [s.pos[0], s.pos[1], s.pos[2]] : null
    }
    const L = this.laneNodes(room)
    const lane = lanes[Math.floor(room.random() * lanes.length)] ?? 'baseB'
    const nodes = L[lane]
    if (!nodes || nodes.length === 0) return null
    let last: Vec3 = [0, 0, 0]
    for (let t = 0; t < SPAWN_TRIES; t++) {
      const i = nodes[Math.floor(room.random() * nodes.length)]!
      last = [nav.x[i]!, nav.y[i]! + 0.1, nav.z[i]!]
      let seen = false
      for (const h of humans) {
        if (!h.world) continue
        const eye: Vec3 = [h.state.pos[0], h.state.pos[1] + 1.6, h.state.pos[2]]
        const dx = last[0] - eye[0], dy = last[1] + 1 - eye[1], dz = last[2] - eye[2]
        const len = Math.hypot(dx, dy, dz)
        if (len > 60) continue
        const hit = h.world.castRay(eye, [dx / len, dy / len, dz / len], len)
        if (!hit || hit.dist >= len - 0.3) { seen = true; break }
      }
      if (!seen) return last
    }
    return last
  }

  private spawnLane(room: Room, type: string, lanes: SpawnLane[]): Player | null {
    const pos = this.pickSpawnPoint(room, lanes)
    return pos ? this.spawnZombie(room, type, pos, false) : null
  }

  spawnZombie(room: Room, type: string, pos: Vec3, _free: boolean): Player | null {
    if (!ZOMBIE_TYPES[type] || !room.nav) return null
    const players = Math.max(1, this.humans(room).length)
    const npc = new ZombieNpc(type, this.ctx, room, players, room.random)
    let yaw = 0
    const near = this.ctx.humans(room)[0]
    if (near) yaw = Math.atan2(-(near.state.pos[0] - pos[0]), -(near.state.pos[2] - pos[2]))
    const p = room.addNpc(ZOMBIE_TYPES[type]!.name, npc, { pos: [pos[0], pos[1], pos[2]], yaw }, 'B')
    room.makeZombie(p, npc.stats)
    p.state.pos[0] = pos[0]; p.state.pos[1] = pos[1]; p.state.pos[2] = pos[2]
    attachNpcWorld(room, p)
    return p
  }

  private cleanCorpses(room: Room, now: number): void {
    for (const z of this.zombies(room)) {
      if (!z.alive && !this.corpses.some(c => c.id === z.id)) this.corpses.push({ id: z.id, at: now })
    }
    // xác cũ hết hạn chìm → xoá; quá maxCorpses thì xoá xác cũ nhất trước
    this.corpses = this.corpses.filter(c => room.players.has(c.id))
    while (this.corpses.length > DEFENSE.maxCorpses) room.removeNpc(this.corpses.shift()!.id)
    this.corpses = this.corpses.filter(c => {
      if (now - c.at < DEFENSE.corpseMs + DEFENSE.corpseSinkMs) return true
      room.removeNpc(c.id)
      return false
    })
  }

  // ── Gục và cứu (T.6) ──────────────────────────────────────────────────────────
  onLethal(room: Room, p: Player): boolean {
    if (p.npc || this.kind !== 'wave' || p.downed || p.downUntil < 0) return false   // downUntil < 0: đã chảy máu tới chết
    // Chỉ gục khi còn đồng đội đứng được để cứu; một mình / đồng đội đã chết hoặc đang gục: chết luôn (thua ngay)
    let rescuers = 0
    for (const o of this.humans(room)) if (o !== p && o.alive && !o.downed) rescuers++
    if (rescuers === 0) return false
    p.downed = true
    p.downUntil = room.serverNow + DEFENSE.down.dieAfterMs
    p.reviveProgressMs = 0
    p.hp = DEFENSE.down.reviveHp
    p.killerId = -1
    p.speedMult = downedSpeedMul()
    p.weapon.reloadEndMs = 0
    return true
  }

  private tickDowned(room: Room, now: number): void {
    const humans = this.humans(room)
    for (const d of humans) {
      if (!d.downed) continue
      if (now >= d.downUntil) { d.downed = false; d.speedMult = 1; d.hp = 0; d.killerId = d.id; d.downUntil = -1; continue }   // chết hẳn
      // cứu: đồng đội đứng cạnh giữ E
      let rescuer: Player | null = null
      for (const r of humans) {
        if (r === d || !r.alive || r.downed || !r.lastCmd) continue
        if ((r.lastCmd.buttons & 1024) === 0) continue   // Btn.Ability = E
        if (Math.hypot(r.state.pos[0] - d.state.pos[0], r.state.pos[2] - d.state.pos[2]) > DEFENSE.down.reviveRangeM || Math.abs(r.state.pos[1] - d.state.pos[1]) > 1.2) continue
        rescuer = r; break
      }
      if (!rescuer) { d.reviveProgressMs = 0; continue }
      if (now - rescuer.lastHurtAt < 100) { d.reviveProgressMs = 0; continue }   // bị đánh trúng thì phải giữ lại từ đầu
      d.reviveProgressMs += 1000 / 60
      if (d.reviveProgressMs >= DEFENSE.down.reviveMs) {
        d.downed = false; d.speedMult = 1; d.hp = DEFENSE.down.reviveHp; d.reviveProgressMs = 0
        this.st(rescuer).revives++
      }
    }
  }

  // ── Móc của MatchMode ─────────────────────────────────────────────────────────
  onPlayerJoin(room: Room, p: Player): void {
    this.room = room
    this.st(p)
    if (this.kind === 'wave') p.invulnUntil = room.serverNow + 2000
  }
  onPlayerLeave(_room: Room, p: Player): void { if (!p.npc) this.stats.delete(p.id) }

  onDamage(_room: Room, shooter: Player, target: Player, applied: number): void {
    if (!shooter.npc && target.npc) this.st(shooter).damage += applied
  }

  onKill(room: Room, killer: Player | null, victim: Player): number {
    if (victim.npc) {
      const def = ZOMBIE_TYPES[victim.zstats?.type ?? '']
      if (!killer || killer.npc || !def) return 0
      killer.kills++
      this.st(killer).kills++
      killer.money = addMoney(killer.money, def.reward, ECONOMY_DEFENSE)
      killer.transport.send({ t: MsgType.MoneyEvent, delta: def.reward, reason: 'kill' })
      return def.reward
    }
    victim.deaths++
    return 0
  }

  afterDeaths(): void { /* không đổi đội */ }

  respawnDelayMs(room: Room, p?: Player): number | null {
    if (p?.npc) return null
    if (this.kind === 'wave') return null   // chết trong đợt: chờ tới giờ nghỉ (hồi sinh trong clearWave)
    return 0
  }

  joinTeam(): TeamId { return 'A' }
  canBuy(room: Room, p: Player): boolean { return (room.phase === MatchPhase.Prep || room.phase === MatchPhase.Waiting) && p.alive && !p.downed }
  canSwitchTeam(): boolean { return false }

  scoreboardRow(_room: Room, p: Player, row: ScoreboardRow): void {
    const s = this.st(p)
    row.zk = s.kills; row.dmg = Math.round(s.damage); row.rev = s.revives; row.role = 'human'
  }

  statusText(room: Room): string {
    if (this.kind === 'waiting') return 'Waiting'
    return `Wave ${Math.max(1, this.wave)}/${this.waves} · ${this.humans(room).length} players`
  }

  stateMessage(room: Room): MatchStateMsg {
    return {
      t: MsgType.MatchState, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
      scoreA: 0, scoreB: 0, sideSwapped: false,
      mode: 'defense', round: this.wave, maxRounds: this.waves,
      aliveA: this.standing(room), aliveB: this.kind === 'wave' ? this.zombiesLeft(room) : 0,
      buyEndsAt: room.phase === MatchPhase.Prep ? room.phaseEndsAt : null,
    }
  }

  // ── Lệnh debug ────────────────────────────────────────────────────────────────
  devSetWave(room: Room, n: number): boolean {
    const w = Math.max(1, Math.min(this.waves, Math.round(n)))
    this.clearZombies(room)
    for (const p of this.humans(room)) { if (!p.alive) room.respawn(p, room.pickSpawn(p.team, p), true); this.reviveFully(room, p) }
    this.startWave(room, room.serverNow, w)
    return true
  }
  devClearWave(room: Room): boolean {
    if (this.kind !== 'wave') return false
    for (const z of this.zombies(room)) room.removeNpc(z.id)
    this.queue = []
    return true
  }
}
void inBuyZone; void broadcastMatch
