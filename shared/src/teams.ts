import { Btn } from './movement'

export const TEAMS = {
  A: { name: 'Cớm',  color: 0x2f6fd6, uiColor: '#2f6fd6' },
  B: { name: 'Cướp', color: 0x2b2b2b, uiColor: '#e0a030' },
} as const
export type TeamId = 'A' | 'B'

export function otherTeam(t: TeamId): TeamId { return t === 'A' ? 'B' : 'A' }

export interface MatchRules {
  maxPerTeam: number
  maxTeamDiff: number   // chênh lệch số người tối đa giữa 2 đội khi chọn/đổi đội
  minPlayersToStart: number
  countdownMs: number
  durationMs: number
  killLimit: number
  endScreenMs: number
  friendlyFire: boolean
}

export const MATCH: MatchRules = {
  maxPerTeam: 5,
  maxTeamDiff: 2,
  minPlayersToStart: 2,
  countdownMs: 5000,
  durationMs: 10 * 60 * 1000,
  killLimit: 50,
  endScreenMs: 10000,
  friendlyFire: false,
}

export const MatchPhase = {
  Waiting: 0,
  Countdown: 1,
  Playing: 2,
  Ended: 3,
} as const
export type MatchPhase = (typeof MatchPhase)[keyof typeof MatchPhase]

const ALL_BTNS = Object.values(Btn).reduce((a, b) => a | b, 0)

/**
 * Nút được phép theo pha trận + còn sống hay không. Server và client dùng chung để dự đoán khớp nhau:
 * chết hoặc COUNTDOWN → không nút nào (vẫn xoay chuột được); ENDED → đi được nhưng không bắn/nạp.
 */
export function phaseButtonMask(phase: MatchPhase, alive: boolean): number {
  if (!alive || phase === MatchPhase.Countdown) return 0
  if (phase === MatchPhase.Ended) return ALL_BTNS & ~(Btn.Fire | Btn.Reload)
  return ALL_BTNS
}

// Đội thắng khi hết trận; null = hoà
export function winnerOf(scoreA: number, scoreB: number): TeamId | null {
  return scoreA === scoreB ? null : scoreA > scoreB ? 'A' : 'B'
}
