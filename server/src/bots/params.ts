// Tham số bot (plan 15, B.8): server/src/bots/bots.json. Mọi khoảng [min, max] lấy ngẫu nhiên đều mỗi lần dùng.
import type { BotDifficulty } from '@fps/shared'
import defaults from './bots.json'

export type Range = [number, number]

export interface BotSkills { strafe: boolean; cover: boolean; peek: boolean; flank: boolean; push: boolean; grenade: boolean }
export interface BotBuy { long: string[]; pistol: string[]; mid: string[]; grenades: number }
/** Thể thức Cận Chiến (plan 19 P7) */
export interface BotMelee {
  reactionMs: Range        // thấy đối thủ bắt đầu chiêu bao lâu thì kịp phản ứng
  guardChance: number      // xác suất giơ dao đỡ một chiêu đang tới
  parryChance: number      // xác suất canh parry (bấm đỡ sát lúc trúng) thay vì đỡ thường
  aimErrorDeg: number      // lệch hướng nhìn tối đa (ngẫu nhiên mỗi combo)
  turnDegPerSec: number
  comboPauseMs: Range      // nghỉ giữa hai chuỗi combo
  strafeMs: Range          // đổi hướng đi vòng quanh đối thủ
  retreatStamina: number   // thể lực dưới mức này thì lùi lại, chỉ đỡ
  resumeStamina: number    // hồi tới mức này mới đánh tiếp
}

export interface BotParams {
  reactionMs: Range
  fovDeg: number
  hearingRadius: number
  memoryMs: number
  aimSpeedDegPerSec: number
  aimErrorDeg: Range
  aimErrorDecayPerSec: number
  aimJitterDeg: number
  trackingLagMs: number
  headChance: number
  fireThresholdDeg: number
  burst: Range
  burstPauseMs: Range
  recoilCompensation: number
  moveSpeedMul: number
  crouchChance: number
  skills: BotSkills
  buy: BotBuy
  melee: BotMelee
}

type ParamTable = Record<BotDifficulty, BotParams>

let table: ParamTable = structuredClone(defaults) as unknown as ParamTable

export function getBotParams(d: BotDifficulty): BotParams { return table[d] }

/** Hot-reload (dev): thay cả bảng; bot đang chơi đọc lại ở lần dùng kế tiếp vì chỉ giữ tham chiếu tới difficulty */
export function setBotParams(next: unknown): void {
  const t = next as Partial<ParamTable> | null
  if (!t || typeof t !== 'object' || !t.medium || !t.hard) return
  table = structuredClone(t) as ParamTable
}

export function rand(rng: () => number, [lo, hi]: Range): number { return lo + (hi - lo) * rng() }
export function randInt(rng: () => number, [lo, hi]: Range): number { return Math.round(rand(rng, [lo, hi])) }
