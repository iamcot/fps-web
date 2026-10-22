// Hỗn Chiến: hồi sinh liên tục, bắn tới giới hạn mạng hoặc hết giờ. Chuyển nguyên từ match.ts (task 06).
// WAITING → COUNTDOWN (đủ người) → PLAYING (hết đếm) → ENDED (hết giờ / đủ killLimit) → COUNTDOWN (đổi bên)
import { ECONOMY_TDM, MatchPhase, MsgType, RESPAWN_DELAY_MS, SPAWN_INVULN_MS, addMoney, killReward, type MatchStateMsg } from '@fps/shared'
import type { Player, Room } from '../room'
import { broadcastScoreboard, setPhase } from '../match'
import { runKillRules } from '../teamRules'
import type { MatchMode } from './index'

// Bắt đầu trận mới: điểm/kill/death về 0, mọi người về căn cứ (mỗi người một điểm spawn), máu/đạn đầy, không bất tử
function resetForCountdown(room: Room): void {
  room.scoreA = 0
  room.scoreB = 0
  const used = { A: 0, B: 0 }
  for (const p of room.players.values()) {
    p.kills = 0
    p.deaths = 0
    const spawns = room.baseSpawns(p.team)
    const sp = spawns[used[p.team]++ % spawns.length]
    room.resetEconomy(p)
    room.respawn(p, sp)
    p.invulnUntil = 0
  }
}

export class TdmMode implements MatchMode {
  readonly mode = 'tdm' as const

  economy() { return ECONOMY_TDM }

  tick(room: Room, now: number): void {
    const r = room.rules
    const enough = room.players.size >= r.minPlayersToStart
    switch (room.phase) {
      case MatchPhase.Waiting:
        if (enough) { resetForCountdown(room); setPhase(room, MatchPhase.Countdown, now + r.countdownMs) }
        break
      case MatchPhase.Countdown:
        if (!enough) { setPhase(room, MatchPhase.Waiting, 0) }
        else if (now >= room.phaseEndsAt) setPhase(room, MatchPhase.Playing, now + r.durationMs)
        break
      case MatchPhase.Playing:
        if (!enough) { room.scoreA = room.scoreB = 0; setPhase(room, MatchPhase.Waiting, 0) }
        else if (room.scoreA >= r.killLimit || room.scoreB >= r.killLimit || now >= room.phaseEndsAt) {
          setPhase(room, MatchPhase.Ended, now + r.endScreenMs)
          broadcastScoreboard(room)
        }
        break
      case MatchPhase.Ended:
        if (now >= room.phaseEndsAt) {
          if (!enough) { room.scoreA = room.scoreB = 0; setPhase(room, MatchPhase.Waiting, 0); break }
          room.sideSwapped = !room.sideSwapped
          resetForCountdown(room)
          setPhase(room, MatchPhase.Countdown, now + r.countdownMs)
        }
        break
    }
  }

  onPlayerJoin(room: Room, p: Player): void {
    // Vào giữa trận: bất tử như vừa hồi sinh (5.4)
    if (room.phase !== MatchPhase.Waiting) p.invulnUntil = room.serverNow + SPAWN_INVULN_MS
  }

  onPlayerLeave(): void { /* tick tự xử lý khi thiếu người */ }

  onKill(room: Room, killer: Player | null, victim: Player): number {
    if (room.phase !== MatchPhase.Playing) return 0
    victim.deaths++
    if (!killer || killer.team === victim.team) return 0
    killer.kills++
    if (killer.team === 'A') room.scoreA++; else room.scoreB++
    const reward = killReward(victim.killStreak, ECONOMY_TDM)
    killer.money = addMoney(killer.money, reward, ECONOMY_TDM)
    killer.killStreak++
    killer.transport.send({ t: MsgType.MoneyEvent, delta: reward, reason: victim.killStreak >= ECONOMY_TDM.bountyStreak ? 'bounty' : 'kill' })
    return reward
  }

  afterDeaths(room: Room): void { runKillRules(room) }

  respawnDelayMs(room: Room): number { return room.phase === MatchPhase.Waiting ? 0 : RESPAWN_DELAY_MS }

  canBuy(room: Room): boolean { return room.phase !== MatchPhase.Ended }

  canSwitchTeam(): boolean { return true }

  statusText(room: Room): string {
    if (room.phase === MatchPhase.Waiting) return 'Waiting'
    const left = Math.max(0, Math.ceil((room.phaseEndsAt - room.serverNow) / 1000))
    const clock = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
    return room.phase === MatchPhase.Playing ? `${clock} left · ${room.scoreA}–${room.scoreB}` : room.phase === MatchPhase.Ended ? 'Ended' : 'Get ready'
  }

  stateMessage(room: Room): MatchStateMsg {
    return {
      t: MsgType.MatchState, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
      scoreA: room.scoreA, scoreB: room.scoreB, sideSwapped: room.sideSwapped,
      mode: 'tdm', round: 0, maxRounds: 0, aliveA: 0, aliveB: 0, buyEndsAt: null,
    }
  }
}
