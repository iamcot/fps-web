// Cài đặt phòng: thể thức + thông số. Server luôn kẹp theo SETTINGS_LIMITS, không tin client.
export type GameMode = 'elimination' | 'tdm' | 'infection' | 'defense' | 'melee'
export const GAME_MODES: readonly GameMode[] = ['elimination', 'tdm', 'infection', 'defense', 'melee']
export function isGameMode(v: unknown): v is GameMode { return typeof v === 'string' && (GAME_MODES as readonly string[]).includes(v) }
/** Thể thức zombie (plan 16/17): mọi người cùng phe người (đội A), zombie là phe B; ban đêm + đèn pin; đạn dự trữ vô hạn */
export function isZombieMode(m: GameMode): boolean { return m === 'infection' || m === 'defense' }
/** Cận Chiến (plan 19 P7): chỉ vũ khí cận chiến, không súng / lựu đạn / mua đồ */
export function isMeleeMode(m: GameMode): boolean { return m === 'melee' }

export const MODE_LABEL: Record<GameMode, string> = {
  elimination: 'Elimination',
  tdm: 'Team Deathmatch',
  infection: 'Infection',
  defense: 'Defense',
  melee: 'Melee',
}
export const MODE_DESC: Record<GameMode, string> = {
  elimination: 'One life per round. First to win 10 rounds.',
  tdm: 'Continuous respawns. First to 50 kills, or when time runs out.',
  infection: 'The mother zombie infects the room. Survive until time runs out to win.',
  defense: 'Hold the base against 10 zombie waves. The last wave has a boss.',
  melee: 'Knives only. Team fight with combos, blocks and parries. Continuous respawns.',
}

export interface EliminationSettings {
  mode: 'elimination'
  roundsToWin: number     // 10 → tối đa 19 ván
  roundTimeSec: number    // 105 (1:45)
  freezeSec: number       // 5 – đứng yên đầu ván
  buyTimeSec: number      // 20 – tính từ lúc bắt đầu freeze
  roundEndSec: number     // 5 – hiện kết quả ván
  halftimeSec: number     // 10 – nghỉ giữa hiệp, đổi bên
  matchEndSec: number     // 15 – màn hình kết thúc trận
}

export interface TdmSettings {
  mode: 'tdm'
  killLimit: number       // 50
  timeLimitMin: number    // 10
}

/** Cận Chiến (plan 19 P7): luật như Hỗn Chiến, chỉ cầm dao */
export interface MeleeSettings {
  mode: 'melee'
  killLimit: number       // 30
  timeLimitMin: number    // 10
}

export type Lighting = 'day' | 'night'
export type DefenseDifficulty = 'easy' | 'normal' | 'hard'

/** Lây Nhiễm (plan 16, phần I) */
export interface InfectionSettings {
  mode: 'infection'
  rounds: number          // 8
  prepSec: number         // 20 – mọi người là người, tìm chỗ, mua súng
  roundTimeSec: number    // 180
  roundEndSec: number     // 6
  matchEndSec: number     // 15
  lighting: Lighting      // 'night'
}

/** Thủ Thành (plan 17) */
export interface DefenseSettings {
  mode: 'defense'
  difficulty: DefenseDifficulty   // 'normal'
  waves: number                   // 10
  intermissionSec: number         // 25
  prepSec: number                 // 30
  endSec: number                  // 20 – màn thắng/thua trước khi về WARMUP
  lighting: Lighting              // 'night'
}

export interface RoomConfig {
  name: string            // tên phòng, 1–32 ký tự
  map: string
  maxPlayers: number      // 2–10, chẵn
  settings: EliminationSettings | TdmSettings | InfectionSettings | DefenseSettings | MeleeSettings
}

export const DEFAULT_SETTINGS = {
  elimination: { mode: 'elimination', roundsToWin: 10, roundTimeSec: 105, freezeSec: 5, buyTimeSec: 20, roundEndSec: 5, halftimeSec: 10, matchEndSec: 15 },
  tdm: { mode: 'tdm', killLimit: 50, timeLimitMin: 10 },
  infection: { mode: 'infection', rounds: 8, prepSec: 20, roundTimeSec: 180, roundEndSec: 6, matchEndSec: 15, lighting: 'night' },
  defense: { mode: 'defense', difficulty: 'normal', waves: 10, intermissionSec: 25, prepSec: 30, endSec: 20, lighting: 'night' },
  melee: { mode: 'melee', killLimit: 30, timeLimitMin: 10 },
} as const satisfies { elimination: EliminationSettings; tdm: TdmSettings; infection: InfectionSettings; defense: DefenseSettings; melee: MeleeSettings }

export const SETTINGS_LIMITS = {
  roundsToWin: [3, 16], roundTimeSec: [60, 300], killLimit: [10, 200], timeLimitMin: [3, 30],
  infectionRounds: [1, 20], infectionRoundTimeSec: [60, 300], waves: [1, 10], intermissionSec: [10, 60],
} as const

export const MAX_PLAYERS_LIMITS = [2, 10] as const
export const DEFAULT_MAX_PLAYERS = 10

/** Phần client gửi khi tạo phòng (chưa tin cậy) */
export interface RoomOptions {
  mode?: GameMode
  maxPlayers?: number
  settings?: Partial<Record<'roundsToWin' | 'roundTimeSec' | 'killLimit' | 'timeLimitMin' | 'rounds' | 'waves' | 'intermissionSec', number>> & { lighting?: string; difficulty?: string }
}

function clampInt(v: unknown, [lo, hi]: readonly [number, number], def: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : def
  return Math.min(hi, Math.max(lo, n))
}

/** Số người tối đa: kẹp 2–10 rồi làm tròn xuống số chẵn (mỗi đội bằng nhau) */
export function clampMaxPlayers(v: unknown): number {
  const n = clampInt(v, MAX_PLAYERS_LIMITS, DEFAULT_MAX_PLAYERS)
  return n - (n % 2)
}

export function sanitizeRoomConfig(name: string, map: string, raw: unknown): RoomConfig {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as RoomOptions
  const mode: GameMode = isGameMode(o.mode) ? o.mode : 'tdm'
  const s = (typeof o.settings === 'object' && o.settings !== null ? o.settings : {}) as NonNullable<RoomOptions['settings']>
  const maxPlayers = clampMaxPlayers(o.maxPlayers)
  if (mode === 'elimination') {
    const d = DEFAULT_SETTINGS.elimination
    return { name, map, maxPlayers, settings: {
      ...d,
      roundsToWin: clampInt(s.roundsToWin, SETTINGS_LIMITS.roundsToWin, d.roundsToWin),
      roundTimeSec: clampInt(s.roundTimeSec, SETTINGS_LIMITS.roundTimeSec, d.roundTimeSec),
    } }
  }
  const lighting: Lighting = s.lighting === 'day' ? 'day' : s.lighting === 'night' ? 'night' : DEFAULT_SETTINGS.infection.lighting
  if (mode === 'infection') {
    const d = DEFAULT_SETTINGS.infection
    return { name, map, maxPlayers, settings: {
      ...d, lighting,
      rounds: clampInt(s.rounds, SETTINGS_LIMITS.infectionRounds, d.rounds),
      roundTimeSec: clampInt(s.roundTimeSec, SETTINGS_LIMITS.infectionRoundTimeSec, d.roundTimeSec),
    } }
  }
  if (mode === 'defense') {
    const d = DEFAULT_SETTINGS.defense
    const difficulty: DefenseDifficulty = s.difficulty === 'easy' || s.difficulty === 'hard' ? s.difficulty : 'normal'
    return { name, map, maxPlayers, settings: {
      ...d, lighting, difficulty,
      waves: clampInt(s.waves, SETTINGS_LIMITS.waves, d.waves),
      intermissionSec: clampInt(s.intermissionSec, SETTINGS_LIMITS.intermissionSec, d.intermissionSec),
    } }
  }
  if (mode === 'melee') {
    const d = DEFAULT_SETTINGS.melee
    return { name, map, maxPlayers, settings: {
      ...d,
      killLimit: clampInt(s.killLimit, SETTINGS_LIMITS.killLimit, d.killLimit),
      timeLimitMin: clampInt(s.timeLimitMin, SETTINGS_LIMITS.timeLimitMin, d.timeLimitMin),
    } }
  }
  const d = DEFAULT_SETTINGS.tdm
  return { name, map, maxPlayers, settings: {
    ...d,
    killLimit: clampInt(s.killLimit, SETTINGS_LIMITS.killLimit, d.killLimit),
    timeLimitMin: clampInt(s.timeLimitMin, SETTINGS_LIMITS.timeLimitMin, d.timeLimitMin),
  } }
}
