// Sinh Tử: chơi theo ván, mỗi ván một mạng. Đội đạt roundsToWin ván trước thắng.
//
// WARMUP(Waiting) ─(mỗi đội ≥ 1 người)→ FREEZE ─→ LIVE(Playing) ─→ ROUND_END ─┬→ FREEZE (ván sau)
//                                                                              ├→ HALFTIME → FREEZE
//                                                                              └→ MATCH_END(Ended) → FREEZE ván 1 / WARMUP
// Một đội không còn ai kết nối → ván hiện tại xử thua cho đội đó (nếu đang LIVE), về WARMUP, giữ tỉ số.
import {
  ECONOMY_ELIM, MatchPhase, MsgType, addMoney, killReward, roundIncome,
  type EliminationSettings, type MatchStateMsg, type RoundEndReason, type RoundOutcome, type TeamId,
} from '@fps/shared'
import type { Player, Room } from '../room'
import { broadcastScoreboard, setPhase } from '../match'
import type { MatchMode } from './index'

const MS = 1000

export class EliminationMode implements MatchMode {
  readonly mode = 'elimination' as const
  round = 1                                   // ván đang chơi / sắp chơi (1…)
  private lossStreak: Record<TeamId, number> = { A: 0, B: 0 }
  private buyEndsAt: number | null = null
  private fresh = true                        // true: trận mới chưa vào FREEZE lần nào → FREEZE đầu tiên đặt lại tiền/súng

  constructor(readonly s: EliminationSettings) {}

  get maxRounds(): number { return 2 * this.s.roundsToWin - 1 }

  economy() { return ECONOMY_ELIM }

  private alive(room: Room, team: TeamId): number {
    let n = 0
    for (const p of room.players.values()) if (p.team === team && p.alive) n++
    return n
  }

  private hpSum(room: Room, team: TeamId): number {
    let n = 0
    for (const p of room.players.values()) if (p.team === team && p.alive) n += p.hp
    return n
  }

  tick(room: Room, now: number): void {
    const a = room.teamCount('A'), b = room.teamCount('B')
    const ready = a >= 1 && b >= 1
    switch (room.phase) {
      case MatchPhase.Waiting:
        if (ready) this.startFreeze(room, now)
        break
      case MatchPhase.Freeze:
        if (!ready) setPhase(room, MatchPhase.Waiting, 0)
        else if (now >= room.phaseEndsAt) setPhase(room, MatchPhase.Playing, now + this.s.roundTimeSec * MS)
        break
      case MatchPhase.Playing: {
        if (!ready) {   // một đội không còn ai: xử thua ván cho đội đó, về WARMUP giữ tỉ số
          const winner: TeamId | null = a > 0 ? 'A' : b > 0 ? 'B' : null
          if (winner) { if (winner === 'A') room.scoreA++; else room.scoreB++; this.round++ }
          if (room.scoreA >= this.s.roundsToWin || room.scoreB >= this.s.roundsToWin) this.endMatch(room, now)
          else setPhase(room, MatchPhase.Waiting, 0)
          break
        }
        const aa = this.alive(room, 'A'), ab = this.alive(room, 'B')
        if (aa === 0 && ab === 0) this.endRound(room, now, null, 'draw')
        else if (ab === 0) this.endRound(room, now, 'A', 'elimination')
        else if (aa === 0) this.endRound(room, now, 'B', 'elimination')
        else if (now >= room.phaseEndsAt) {
          if (aa !== ab) this.endRound(room, now, aa > ab ? 'A' : 'B', 'time_alive')
          else {
            const ha = this.hpSum(room, 'A'), hb = this.hpSum(room, 'B')
            if (ha !== hb) this.endRound(room, now, ha > hb ? 'A' : 'B', 'time_hp')
            else this.endRound(room, now, null, 'draw')
          }
        }
        break
      }
      case MatchPhase.RoundEnd:
        if (!ready) { setPhase(room, MatchPhase.Waiting, 0); this.round++; break }
        if (now >= room.phaseEndsAt) this.afterRoundEnd(room, now)
        break
      case MatchPhase.Halftime:
        if (!ready) setPhase(room, MatchPhase.Waiting, 0)
        else if (now >= room.phaseEndsAt) this.startFreeze(room, now)
        break
      case MatchPhase.Ended:
        if (now >= room.phaseEndsAt) this.newMatch(room, now, ready)
        break
    }
  }

  // Đầu ván: xoá lựu đạn, mọi người hồi sinh ở căn cứ (mỗi người một điểm), người sống sót giữ súng
  private startFreeze(room: Room, now: number): void {
    room.grenades = []
    for (const p of room.players.values()) p.transport.send({ t: MsgType.RoundReset, round: this.round })
    const used = { A: 0, B: 0 }
    for (const p of room.players.values()) {
      if (this.fresh) room.resetEconomy(p)
      const spawns = room.baseSpawns(p.team)
      const sp = spawns[used[p.team]++ % spawns.length]
      room.respawn(p, sp, p.survived && ECONOMY_ELIM.keepLoadoutIfSurvived)
      p.invulnUntil = 0
      p.survived = false
      p.inRound = true
    }
    this.fresh = false
    this.buyEndsAt = now + this.s.buyTimeSec * MS
    setPhase(room, MatchPhase.Freeze, now + this.s.freezeSec * MS)
  }

  private endRound(room: Room, now: number, winner: TeamId | null, reason: RoundEndReason): void {
    if (winner === 'A') room.scoreA++; else if (winner === 'B') room.scoreB++
    // Tiền cuối ván cho mọi người trong đội, kể cả người đã chết; người đang xem chờ vào (không có trong ván) thì không
    for (const team of ['A', 'B'] as const) {
      const outcome: RoundOutcome = winner === null ? 'draw' : winner === team ? 'win' : 'loss'
      const inc = roundIncome(outcome, this.lossStreak[team])
      this.lossStreak[team] = inc.lossStreak
      for (const p of room.players.values()) {
        if (p.team !== team || !p.inRound) continue
        p.money = addMoney(p.money, inc.amount, ECONOMY_ELIM)
        p.transport.send({ t: MsgType.MoneyEvent, delta: inc.amount, reason: outcome === 'win' ? 'round_win' : outcome === 'loss' ? 'round_loss' : 'round_draw' })
      }
    }
    for (const p of room.players.values()) p.transport.send({ t: MsgType.RoundEnd, round: this.round, winner, reason })
    setPhase(room, MatchPhase.RoundEnd, now + this.s.roundEndSec * MS)
    broadcastScoreboard(room)
  }

  private afterRoundEnd(room: Room, now: number): void {
    for (const p of room.players.values()) { p.survived = p.alive; p.inRound = false }   // sống tới hết ROUND_END mới giữ súng
    const finished = this.round
    const toWin = this.s.roundsToWin
    if (room.scoreA >= toWin || room.scoreB >= toWin || finished >= this.maxRounds) { this.endMatch(room, now); return }
    this.round++
    if (finished === toWin - 1) {   // hết hiệp 1: đổi bên, tiền và súng về ban đầu
      room.sideSwapped = !room.sideSwapped
      if (ECONOMY_ELIM.resetAtHalftime) {
        this.lossStreak = { A: 0, B: 0 }
        for (const p of room.players.values()) { room.resetEconomy(p); p.survived = false }
      }
      setPhase(room, MatchPhase.Halftime, now + this.s.halftimeSec * MS)
      return
    }
    this.startFreeze(room, now)
  }

  private endMatch(room: Room, now: number): void {
    const winner: TeamId | null = room.scoreA === room.scoreB ? null : room.scoreA > room.scoreB ? 'A' : 'B'
    let mvp: Player | null = null
    for (const p of room.players.values()) if (!mvp || p.kills > mvp.kills || (p.kills === mvp.kills && p.deaths < mvp.deaths)) mvp = p
    for (const p of room.players.values()) p.transport.send({ t: MsgType.MatchEnd, winner, scoreA: room.scoreA, scoreB: room.scoreB, mvpId: mvp?.id ?? null })
    setPhase(room, MatchPhase.Ended, now + this.s.matchEndSec * MS)
    broadcastScoreboard(room)
  }

  // Trận mới từ 0–0: điểm, tiền, súng về ban đầu; đội giữ nguyên
  private newMatch(room: Room, now: number, ready: boolean): void {
    room.scoreA = room.scoreB = 0
    room.sideSwapped = false
    this.round = 1
    this.lossStreak = { A: 0, B: 0 }
    this.fresh = true
    for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; p.survived = false; p.inRound = false }
    if (ready) this.startFreeze(room, now)
    else setPhase(room, MatchPhase.Waiting, 0)
  }

  onPlayerJoin(room: Room, p: Player): void {
    p.inRound = false
    p.survived = false
    if (room.phase === MatchPhase.Waiting) { p.inRound = true; return }   // khởi động: chơi ngay
    // Vào giữa trận: xem cho tới FREEZE ván sau
    p.alive = false
    p.hp = 0
    p.respawnAt = Infinity
  }

  onPlayerLeave(): void { /* tick kiểm tra điều kiện kết thúc ván ngay ở tick kế */ }

  onKill(room: Room, killer: Player | null, victim: Player): number {
    if (room.phase !== MatchPhase.Playing && room.phase !== MatchPhase.RoundEnd) return 0
    victim.deaths++
    if (!killer || killer.team === victim.team) return 0
    killer.kills++
    const reward = killReward(victim.killStreak, ECONOMY_ELIM)
    killer.money = addMoney(killer.money, reward, ECONOMY_ELIM)
    killer.killStreak++
    killer.transport.send({ t: MsgType.MoneyEvent, delta: reward, reason: victim.killStreak >= ECONOMY_ELIM.bountyStreak ? 'bounty' : 'kill' })
    return reward
  }

  afterDeaths(): void { /* không đổi đội giữa ván */ }

  respawnDelayMs(room: Room): number | null { return room.phase === MatchPhase.Waiting ? 0 : null }

  canBuy(room: Room, _p: Player, nowMs: number): boolean {
    if (room.phase === MatchPhase.Waiting) return true
    if (room.phase === MatchPhase.Ended || room.phase === MatchPhase.Halftime) return false
    return this.buyEndsAt !== null && nowMs < this.buyEndsAt
  }

  canSwitchTeam(room: Room): boolean { return room.phase === MatchPhase.Waiting || room.phase === MatchPhase.Freeze }

  statusText(room: Room): string {
    if (room.phase === MatchPhase.Waiting) return 'Đang chờ'
    return `Ván ${Math.min(this.round, this.maxRounds)}/${this.maxRounds} · ${room.scoreA}–${room.scoreB}`
  }

  stateMessage(room: Room): MatchStateMsg {
    const live = room.phase !== MatchPhase.Waiting
    return {
      t: MsgType.MatchState, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
      scoreA: room.scoreA, scoreB: room.scoreB, sideSwapped: room.sideSwapped,
      mode: 'elimination', round: this.round, maxRounds: this.maxRounds,
      aliveA: this.alive(room, 'A'), aliveB: this.alive(room, 'B'),
      buyEndsAt: live && room.phase !== MatchPhase.Ended ? this.buyEndsAt : null,
    }
  }

  // ── Lệnh debug (M.8)
  devEndRound(room: Room, winner: 'A' | 'B' | 'draw'): boolean {
    if (room.phase !== MatchPhase.Playing) return false
    this.endRound(room, room.serverNow, winner === 'draw' ? null : winner, winner === 'draw' ? 'draw' : 'elimination')
    return true
  }

  /** Nhảy tới ván `n`: tỉ số giả lập (nửa số ván thắng mỗi đội), chuyển ngay sang FREEZE */
  devSetRound(room: Room, n: number): boolean {
    this.round = Math.max(1, Math.min(this.maxRounds, Math.round(n)))
    const wins = this.round - 1
    room.scoreA = Math.ceil(wins / 2); room.scoreB = Math.floor(wins / 2)
    room.sideSwapped = this.round > this.s.roundsToWin - 1
    this.startFreeze(room, room.serverNow)
    return true
  }
}

