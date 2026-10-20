// Cài đặt phòng: thể thức + thông số. Server luôn kẹp theo SETTINGS_LIMITS, không tin client.
export type GameMode = 'elimination' | 'tdm'
export const GAME_MODES: readonly GameMode[] = ['elimination', 'tdm']
export function isGameMode(v: unknown): v is GameMode { return v === 'elimination' || v === 'tdm' }

export const MODE_LABEL: Record<GameMode, string> = {
  elimination: 'Sinh Tử',
  tdm: 'Hỗn Chiến',
}
export const MODE_DESC: Record<GameMode, string> = {
  elimination: 'Mỗi ván một mạng. Thắng 10 ván trước.',
  tdm: 'Hồi sinh liên tục. Bắn tới 50 mạng hoặc hết giờ.',
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

export interface RoomConfig {
  name: string            // tên phòng, 1–32 ký tự
  map: string
  maxPlayers: number      // 2–10, chẵn
  settings: EliminationSettings | TdmSettings
}

export const DEFAULT_SETTINGS = {
  elimination: { mode: 'elimination', roundsToWin: 10, roundTimeSec: 105, freezeSec: 5, buyTimeSec: 20, roundEndSec: 5, halftimeSec: 10, matchEndSec: 15 },
  tdm: { mode: 'tdm', killLimit: 50, timeLimitMin: 10 },
} as const satisfies { elimination: EliminationSettings; tdm: TdmSettings }

export const SETTINGS_LIMITS = {
  roundsToWin: [3, 16], roundTimeSec: [60, 300], killLimit: [10, 200], timeLimitMin: [3, 30],
} as const

export const MAX_PLAYERS_LIMITS = [2, 10] as const
export const DEFAULT_MAX_PLAYERS = 10

/** Phần client gửi khi tạo phòng (chưa tin cậy) */
export interface RoomOptions {
  mode?: GameMode
  maxPlayers?: number
  settings?: Partial<Record<'roundsToWin' | 'roundTimeSec' | 'killLimit' | 'timeLimitMin', number>>
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
  const d = DEFAULT_SETTINGS.tdm
  return { name, map, maxPlayers, settings: {
    ...d,
    killLimit: clampInt(s.killLimit, SETTINGS_LIMITS.killLimit, d.killLimit),
    timeLimitMin: clampInt(s.timeLimitMin, SETTINGS_LIMITS.timeLimitMin, d.timeLimitMin),
  } }
}
