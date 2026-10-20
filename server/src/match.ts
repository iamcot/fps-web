// Phần dùng chung của mọi thể thức: đổi pha, gửi MatchState/Scoreboard. Logic từng thể thức nằm trong modes/.
import { MatchPhase, MsgType, type ScoreboardRow } from '@fps/shared'
import type { Room } from './room'

const BROADCAST_EVERY_MS = 1000

export function setPhase(room: Room, phase: MatchPhase, endsAt: number): void {
  room.phase = phase
  room.phaseEndsAt = endsAt
  broadcastMatch(room)
}

export function broadcastMatch(room: Room): void {
  const msg = room.mode.stateMessage(room)
  for (const p of room.players.values()) p.transport.send(msg)
}

// Tiền chỉ gửi cho đồng đội: mỗi đội một bản bảng điểm (người nhận khác đội không thấy cột tiền)
export function broadcastScoreboard(room: Room): void {
  const rows: Record<'A' | 'B', ScoreboardRow[]> = { A: [], B: [] }
  for (const viewer of ['A', 'B'] as const) {
    for (const p of room.players.values()) {
      if (p.npc) continue   // zombie NPC không vào bảng điểm
      const row: ScoreboardRow = { id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, ping: Math.round(p.pingMs) }
      room.mode.scoreboardRow?.(room, p, row)
      if (p.team === viewer) row.money = p.money
      rows[viewer].push(row)
    }
  }
  for (const p of room.players.values()) if (!p.npc) p.transport.send({ t: MsgType.Scoreboard, rows: rows[p.team] })
}

// Gọi mỗi tick sau khi chốt chết/hồi sinh
export function updateMatch(room: Room): void {
  const now = room.serverNow
  room.mode.tick(room, now)
  if (now - room.lastBroadcast >= BROADCAST_EVERY_MS) {
    room.lastBroadcast = now
    broadcastMatch(room)
    broadcastScoreboard(room)
  }
}
