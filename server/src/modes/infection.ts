// Lây Nhiễm (plan 16, phần I): ai cũng là người, sau prepSec giây vài người thành zombie mẹ; zombie cào người → người thành zombie.
//
// WARMUP ─(≥ 3 người)→ PREP ─→ (chọn mẹ) LIVE ─→ ROUND_END ─┬→ PREP (ván sau)
//                                                            └→ MATCH_END ─(15s)→ PREP ván 1 / WARMUP
// Người = đội A, zombie = đội B: luật "không bắn đồng đội" có sẵn nên người không hại nhau, zombie không cào zombie.
import {
  Btn, ECONOMY_INFECTION, INFECTION, MatchPhase, MsgType, infectionStats,
  type InfectionSettings, type MatchStateMsg, type ScoreboardRow, type TeamId,
} from '@fps/shared'
import type { Player, Room } from '../room'
import { broadcastScoreboard, setPhase } from '../match'
import type { MatchMode } from './index'

const MS = 1000
const MIN_PLAYERS_TO_CONTINUE = 2
const MAX_SPAWN_CANDIDATES = 160

interface Score { pts: number; inf: number; zk: number }
interface SpawnPoint { pos: [number, number, number]; yaw: number }

export class InfectionMode implements MatchMode {
  readonly mode = 'infection' as const
  round = 1
  private readonly score = new Map<number, Score>()
  private lastMothers = new Set<number>()
  private lastCounts = { humans: -1, zombies: -1 }
  private heroChosen = false
  private candidates: SpawnPoint[] | null = null
  private candidatesFor: unknown = null

  constructor(readonly s: InfectionSettings) {}

  economy() { return ECONOMY_INFECTION }

  private sc(p: Player): Score {
    let v = this.score.get(p.id)
    if (!v) { v = { pts: 0, inf: 0, zk: 0 }; this.score.set(p.id, v) }
    return v
  }

  humans(room: Room): number {
    let n = 0
    for (const p of room.players.values()) if (p.role === 'human') n++
    return n
  }
  zombies(room: Room): number { return room.players.size - this.humans(room) }

  // ── Điểm xuất hiện: nav (mặt đất, rải đều) nếu có, không thì mọi điểm spawn của map
  private spawnCandidates(room: Room): SpawnPoint[] {
    const key = room.nav ?? room.map
    if (this.candidates && this.candidatesFor === key) return this.candidates
    const out: SpawnPoint[] = []
    const nav = room.nav
    if (nav) {
      const ground: number[] = []
      for (let i = 0; i < nav.count; i++) if (nav.y[i]! < 0.3) ground.push(i)
      const step = Math.max(1, Math.floor(ground.length / MAX_SPAWN_CANDIDATES))
      for (let k = 0; k < ground.length; k += step) { const i = ground[k]!; out.push({ pos: [nav.x[i]!, nav.y[i]! + 0.1, nav.z[i]!], yaw: 0 }) }
    }
    if (out.length === 0) for (const sp of [...room.map.spawns.A, ...room.map.spawns.B]) out.push({ pos: [sp.pos[0], sp.pos[1], sp.pos[2]], yaw: sp.yaw })
    this.candidates = out
    this.candidatesFor = key
    return out
  }

  /** n điểm xa nhau (lấy mẫu điểm xa nhất, điểm đầu ngẫu nhiên) */
  private spreadPoints(room: Room, n: number): SpawnPoint[] {
    const c = this.spawnCandidates(room)
    const chosen: SpawnPoint[] = []
    const minD = new Float64Array(c.length).fill(Infinity)
    let next = Math.floor(room.random() * c.length)
    for (let k = 0; k < n; k++) {
      const sp = c[next]!
      chosen.push({ pos: [sp.pos[0], sp.pos[1], sp.pos[2]], yaw: room.random() * Math.PI * 2 - Math.PI })
      let best = -1, bestD = -1
      for (let i = 0; i < c.length; i++) {
        minD[i] = Math.min(minD[i]!, Math.hypot(c[i]!.pos[0] - sp.pos[0], c[i]!.pos[2] - sp.pos[2]))
        if (minD[i]! > bestD) { bestD = minD[i]!; best = i }
      }
      next = best
    }
    return chosen
  }

  /** Điểm xa người nhất (cho zombie hồi sinh) */
  private farthestFromHumans(room: Room): SpawnPoint {
    const c = this.spawnCandidates(room)
    let best = c[0]!, bestD = -1
    for (const sp of c) {
      let near = Infinity
      for (const o of room.players.values()) {
        if (o.role !== 'human' || !o.alive) continue
        near = Math.min(near, Math.hypot(o.state.pos[0] - sp.pos[0], o.state.pos[2] - sp.pos[2]))
      }
      if (near > bestD) { bestD = near; best = sp }
    }
    return { pos: [best.pos[0], best.pos[1], best.pos[2]], yaw: room.random() * Math.PI * 2 - Math.PI }
  }

  // ── Máy trạng thái
  tick(room: Room, now: number): void {
    const enough = room.players.size >= INFECTION.minPlayers
    const stay = room.players.size >= MIN_PLAYERS_TO_CONTINUE
    switch (room.phase) {
      case MatchPhase.Waiting:
        if (enough) this.startPrep(room, now)
        break
      case MatchPhase.Prep:
        if (!stay) this.toWaiting(room)
        else if (now >= room.phaseEndsAt) this.pickMothers(room, now)
        break
      case MatchPhase.Playing: {
        if (!stay) { this.toWaiting(room); break }
        if (this.zombies(room) === 0 && this.humans(room) >= 2) this.makeMothers(room, 1, now)   // zombie mẹ duy nhất vừa rời đi
        this.rescaleAndAnnounce(room)
        const h = this.humans(room)
        if (h === 0) this.endRound(room, now, 'B', 'infected_all')
        else if (now >= room.phaseEndsAt) this.endRound(room, now, 'A', 'time_survive')
        break
      }
      case MatchPhase.RoundEnd:
        if (now >= room.phaseEndsAt) {
          if (this.round >= this.s.rounds) this.endMatch(room, now)
          else if (!stay) this.toWaiting(room)
          else { this.round++; this.startPrep(room, now) }
        }
        break
      case MatchPhase.Ended:
        if (now >= room.phaseEndsAt) this.newMatch(room, now, enough)
        break
    }
  }

  private toWaiting(room: Room): void {
    for (const p of room.players.values()) if (p.role === 'zombie') room.makeHuman(p, 'A')
    setPhase(room, MatchPhase.Waiting, 0)
  }

  // Đầu ván: mọi người là người, tiền = startMoney, rải đều khắp map
  private startPrep(room: Room, now: number): void {
    room.grenades = []
    this.heroChosen = false
    for (const p of room.players.values()) p.transport.send({ t: MsgType.RoundReset, round: this.round })
    const pts = this.spreadPoints(room, room.players.size)
    let i = 0
    for (const p of room.players.values()) {
      room.makeHuman(p, 'A')
      room.resetEconomy(p)
      room.respawn(p, pts[i++]!)
      p.invulnUntil = 0
    }
    this.lastCounts = { humans: -1, zombies: -1 }
    this.announceCounts(room)
    setPhase(room, MatchPhase.Prep, now + this.s.prepSec * MS)
  }

  private pickMothers(room: Room, now: number): void {
    this.makeMothers(room, INFECTION.motherCount(room.players.size), now)
    setPhase(room, MatchPhase.Playing, now + this.s.roundTimeSec * MS)
  }

  /** Chọn ngẫu nhiên `count` người làm zombie mẹ; không chọn lại người vừa làm mẹ ván trước nếu còn lựa chọn khác */
  private makeMothers(room: Room, count: number, _now: number): void {
    const humans = [...room.players.values()].filter(p => p.role === 'human')
    if (humans.length === 0) return
    const fresh = humans.filter(p => !this.lastMothers.has(p.id))
    const pool = fresh.length >= count ? fresh : humans
    const chosen: Player[] = []
    const left = pool.slice()
    while (chosen.length < count && left.length > 0) chosen.push(left.splice(Math.floor(room.random() * left.length), 1)[0]!)
    this.lastMothers = new Set(chosen.map(p => p.id))
    const humansAfter = humans.length - chosen.length
    for (const p of chosen) {
      room.makeZombie(p, infectionStats('mother', humansAfter), INFECTION.transformMs + INFECTION.pickMs)   // biến hình tại chỗ, bất tử cho tới khi banner xong
      for (const o of room.players.values()) o.transport.send({ t: MsgType.Infected, playerId: p.id, byId: null, kind: 'mother' })
    }
    this.rescaleAndAnnounce(room)
  }

  // Cào chết người → người thành zombie tại chỗ (không tính là chết, không rơi súng)
  onLethal(room: Room, p: Player): boolean {
    if (room.phase !== MatchPhase.Playing || p.role !== 'human') return false
    const killer = room.players.get(p.killerId)
    const by = killer && killer.zstats && killer.id !== p.id ? killer : null
    const humansAfter = this.humans(room) - 1
    room.makeZombie(p, infectionStats('normal', humansAfter), INFECTION.transformMs)
    p.state.vel[0] = 0; p.state.vel[2] = 0
    p.killerId = -1
    if (by) {
      const sc = this.sc(by)
      sc.inf++
      sc.pts += INFECTION.points.infect + (by.zstats!.type === 'mother' ? INFECTION.points.mother : 0)
    }
    for (const o of room.players.values()) o.transport.send({ t: MsgType.Infected, playerId: p.id, byId: by ? by.id : null, kind: 'infected' })
    this.rescaleAndAnnounce(room)
    return true
  }

  // Máu zombie tính lại mỗi khi số người còn sống đổi: hpMax = hpBase + hpPerHuman × người (máu hiện tại giữ tỉ lệ %); còn 1 người → anh hùng
  private rescaleAndAnnounce(room: Room): void {
    const humans = this.humans(room)
    if (humans !== this.lastCounts.humans) {
      for (const z of room.players.values()) {
        const st = z.zstats
        if (!st || (st.type !== 'mother' && st.type !== 'normal')) continue
        const next = infectionStats(st.type, humans)
        const ratio = st.hpMax > 0 ? z.hp / st.hpMax : 1
        z.zstats = { ...st, hpMax: next.hpMax }
        if (z.alive) z.hp = Math.max(1, ratio * next.hpMax)
      }
    }
    if (room.phase === MatchPhase.Playing && humans === 1 && this.zombies(room) >= 1 && !this.heroChosen) {
      const hero = [...room.players.values()].find(p => p.role === 'human')!
      if (hero.hp <= 0) { this.announceCounts(room); return }   // người cuối đang bị chốt chết cùng tick: không cứu
      this.heroChosen = true
      hero.hero = true
      hero.hp = INFECTION.hero.hp
      hero.damageMult = INFECTION.hero.damageMult
      hero.speedMult = INFECTION.hero.speedMult
      for (const o of room.players.values()) o.transport.send({ t: MsgType.HeroChosen, playerId: hero.id })
    }
    this.announceCounts(room)
  }

  private announceCounts(room: Room): void {
    const humans = this.humans(room), zombies = this.zombies(room)
    if (humans === this.lastCounts.humans && zombies === this.lastCounts.zombies) return
    this.lastCounts = { humans, zombies }
    for (const o of room.players.values()) o.transport.send({ t: MsgType.InfectionCount, humans, zombies })
  }

  private endRound(room: Room, now: number, winner: TeamId, reason: 'infected_all' | 'time_survive'): void {
    if (winner === 'A') {   // hết giờ còn người: mỗi người sống +surviveRound
      for (const p of room.players.values()) if (p.role === 'human') this.sc(p).pts += INFECTION.points.surviveRound
    }
    for (const p of room.players.values()) p.transport.send({ t: MsgType.RoundEnd, round: this.round, winner, reason })
    setPhase(room, MatchPhase.RoundEnd, now + this.s.roundEndSec * MS)
    broadcastScoreboard(room)
  }

  private endMatch(room: Room, now: number): void {
    let mvp: Player | null = null
    for (const p of room.players.values()) if (!mvp || this.sc(p).pts > this.sc(mvp).pts) mvp = p
    for (const p of room.players.values()) p.transport.send({ t: MsgType.MatchEnd, winner: null, scoreA: 0, scoreB: 0, mvpId: mvp?.id ?? null })
    setPhase(room, MatchPhase.Ended, now + this.s.matchEndSec * MS)
    broadcastScoreboard(room)
  }

  private newMatch(room: Room, now: number, enough: boolean): void {
    this.round = 1
    this.score.clear()
    this.lastMothers.clear()
    for (const p of room.players.values()) { p.kills = 0; p.deaths = 0 }
    if (enough) this.startPrep(room, now)
    else this.toWaiting(room)
  }

  // ── Móc của MatchMode
  onPlayerJoin(room: Room, p: Player): void {
    this.sc(p)
    if (room.phase === MatchPhase.Playing) {   // vào giữa ván: vào luôn với vai zombie
      room.makeZombie(p, infectionStats('normal', this.humans(room)), 0)
      room.respawn(p, this.farthestFromHumans(room))
      p.invulnUntil = 0
    }
  }

  onPlayerLeave(_room: Room, p: Player): void { this.score.delete(p.id) }

  onKill(room: Room, killer: Player | null, victim: Player): number {
    if (room.phase !== MatchPhase.Playing && room.phase !== MatchPhase.RoundEnd) return 0
    victim.deaths++
    if (victim.role === 'zombie' && killer && killer.role === 'human') {
      killer.kills++
      const sc = this.sc(killer)
      sc.zk++
      sc.pts += killer.hero ? INFECTION.points.killAsHero : INFECTION.points.killZombie
    }
    return 0
  }

  afterDeaths(): void { /* không đổi đội theo số mạng */ }

  respawnDelayMs(room: Room, p?: Player): number | null {
    if (room.phase === MatchPhase.Prep || room.phase === MatchPhase.Waiting || room.phase === MatchPhase.Ended) return 0
    return p?.role === 'zombie' ? INFECTION.zombieRespawnMs : 3000
  }

  pickSpawn(room: Room, p: Player): SpawnPoint | null {
    if (room.phase === MatchPhase.Playing && p.role === 'zombie') return this.farthestFromHumans(room)
    return this.spreadPoints(room, 1)[0] ?? null
  }

  joinTeam(): TeamId { return 'A' }
  buyAnywhere(room: Room, p: Player): boolean { return room.phase === MatchPhase.Prep && p.role === 'human' && INFECTION.buyAnywhereDuringPrep }
  canBuy(room: Room, p: Player): boolean { return room.phase === MatchPhase.Prep && p.role === 'human' }
  canSwitchTeam(): boolean { return false }

  scoreboardRow(_room: Room, p: Player, row: ScoreboardRow): void {
    const sc = this.sc(p)
    row.pts = sc.pts; row.inf = sc.inf; row.zk = sc.zk; row.role = p.role
  }

  statusText(room: Room): string {
    if (room.phase === MatchPhase.Waiting) return 'Waiting'
    return `Round ${Math.min(this.round, this.s.rounds)}/${this.s.rounds} · ${this.humans(room)} humans – ${this.zombies(room)} zombies`
  }

  stateMessage(room: Room): MatchStateMsg {
    return {
      t: MsgType.MatchState, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
      scoreA: 0, scoreB: 0, sideSwapped: false,
      mode: 'infection', round: this.round, maxRounds: this.s.rounds,
      aliveA: this.humans(room), aliveB: this.zombies(room),
      buyEndsAt: room.phase === MatchPhase.Prep ? room.phaseEndsAt : null,
    }
  }

  // Q: zombie đánh hơi — người trong bán kính hiện viền đỏ xuyên tường trên màn hình zombie (client vẽ), và nghe tiếng gầm gần
  onCmd(room: Room, p: Player, buttons: number): void {
    if ((buttons & Btn.Sniff) === 0 || p.role !== 'zombie' || !p.alive || room.phase !== MatchPhase.Playing) return
    if (room.serverNow < p.sniffReadyAt || room.serverNow < p.transformUntil) return
    p.sniffUntil = room.serverNow + INFECTION.sniff.durationMs
    p.sniffReadyAt = room.serverNow + INFECTION.sniff.cooldownMs
    for (const o of room.players.values()) {
      if (o.role !== 'human' || !o.alive) continue
      if (Math.hypot(o.state.pos[0] - p.state.pos[0], o.state.pos[2] - p.state.pos[2]) <= INFECTION.sniff.radius) o.transport.send({ t: MsgType.Sniffed, byId: p.id })
    }
  }

  // ── Lệnh debug
  devSetRole(room: Room, p: Player, role: 'zombie' | 'human'): boolean {
    if (role === 'zombie') room.makeZombie(p, infectionStats('normal', this.humans(room) - (p.role === 'human' ? 1 : 0)), 0)
    else room.makeHuman(p, 'A')
    this.rescaleAndAnnounce(room)
    return true
  }

  devEndRound(room: Room, winner: 'A' | 'B' | 'draw'): boolean {
    if (room.phase !== MatchPhase.Playing) return false
    this.endRound(room, room.serverNow, winner === 'B' ? 'B' : 'A', winner === 'B' ? 'infected_all' : 'time_survive')
    return true
  }
}
