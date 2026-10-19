import { MatchPhase, MsgType, makeWeaponState, type ScoreboardRow } from '@fps/shared'
import type { Room } from './room'

const BROADCAST_EVERY_MS = 1000

function setPhase(room: Room, phase: MatchPhase, endsAt: number): void {
  room.phase = phase
  room.phaseEndsAt = endsAt
  broadcastMatch(room)
}

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
    room.respawn(p, sp)
    p.invulnUntil = 0
    p.weapon.ammo = makeWeaponState().ammo
  }
}

export function broadcastMatch(room: Room): void {
  const msg = {
    t: MsgType.MatchState, phase: room.phase, phaseEndsAt: room.phaseEndsAt,
    scoreA: room.scoreA, scoreB: room.scoreB, sideSwapped: room.sideSwapped,
  }
  for (const p of room.players.values()) p.transport.send(msg)
}

export function broadcastScoreboard(room: Room): void {
  const rows: ScoreboardRow[] = []
  for (const p of room.players.values()) {
    rows.push({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, ping: Math.round(p.pingMs) })
  }
  const msg = { t: MsgType.Scoreboard, rows }
  for (const p of room.players.values()) p.transport.send(msg)
}

// Máy trạng thái trận, gọi mỗi tick sau khi chốt chết/hồi sinh:
// WAITING → COUNTDOWN (đủ người) → PLAYING (hết đếm) → ENDED (hết giờ / đủ killLimit) → COUNTDOWN (đổi bên)
export function updateMatch(room: Room): void {
  const now = room.serverNow
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

  if (now - room.lastBroadcast >= BROADCAST_EVERY_MS) {
    room.lastBroadcast = now
    broadcastMatch(room)
    broadcastScoreboard(room)
  }
}

