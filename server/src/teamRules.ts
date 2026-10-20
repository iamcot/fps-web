// Luật đội động: danh sách luật chạy sau mỗi sự kiện (hiện chỉ "có người bị hạ"). Thêm luật mới = viết hàm và thêm vào mảng.
import { otherTeam, type TeamId } from '@fps/shared'
import type { Player, Room } from './room'

export type TeamRule = (room: Room) => void

/** Người điểm cao nhất (nhiều kill, ít chết hơn, id nhỏ) của đội `team` */
export function topScorer(room: Room, team: TeamId): Player | null {
  let best: Player | null = null
  for (const p of room.players.values()) {
    if (p.team !== team) continue
    if (!best || p.kills > best.kills || (p.kills === best.kills && (p.deaths < best.deaths || (p.deaths === best.deaths && p.id < best.id)))) best = p
  }
  return best
}

/** Đội đông hơn đội kia quá 1 người (được phép lệch tới maxTeamDiff lúc chọn đội) → chuyển người cao điểm nhất sang đội ít người */
export const rebalanceTopScorer: TeamRule = room => {
  if (room.offline) return   // offline: bot ở phe nào là do người chơi chọn, không tự cân bằng
  const a = room.teamCount('A'), b = room.teamCount('B')
  if (Math.abs(a - b) <= 1) return
  const big: TeamId = a > b ? 'A' : 'B'
  const p = topScorer(room, big)
  if (!p) return
  room.setTeam(p, otherTeam(big))
  room.respawn(p)   // về căn cứ đội mới, bộ súng mặc định của đội mới; tiền giữ nguyên
}

export const RULES_ON_KILL: TeamRule[] = [rebalanceTopScorer]

export function runKillRules(room: Room): void {
  for (const rule of RULES_ON_KILL) rule(room)
}
