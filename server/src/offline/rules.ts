import { MATCH, type MatchRules } from '@fps/shared'

/** Luật phòng offline (plan 15, B.7): Hỗn Chiến không giới hạn mạng và thời gian; một người là đủ để bắt đầu; phe do người chơi tự chọn */
export function offlineRules(): MatchRules {
  return { ...MATCH, maxPerTeam: 5, maxTeamDiff: 10, minPlayersToStart: 1, countdownMs: 1500, durationMs: 1e11, killLimit: 1e9, endScreenMs: 5000, friendlyFire: false }
}

export const OFFLINE_ROOM = 'offline'
