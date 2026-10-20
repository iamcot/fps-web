// Thể thức chơi (task 13). Mọi chỗ khác nhau giữa các thể thức nằm trong class thể thức; phần còn lại của server chỉ gọi qua room.mode.
import type { EconomyConfig, GameMode, MatchStateMsg, RoomConfig, ScoreboardRow, TeamId } from '@fps/shared'
import type { Player, Room } from '../room'
import { TdmMode } from './tdm'
import { EliminationMode } from './elimination'
import { InfectionMode } from './infection'

export interface MatchMode {
  readonly mode: GameMode
  economy(): EconomyConfig
  /** Gọi mỗi tick sau khi chốt chết/hồi sinh: máy trạng thái trận */
  tick(room: Room, now: number): void
  /** `p` đã nằm trong room.players và đã nhận Welcome/đội */
  onPlayerJoin(room: Room, p: Player): void
  /** Sau khi `p` đã bị xoá khỏi room.players */
  onPlayerLeave(room: Room, p: Player): void
  /** `victim` vừa chết (alive=false, killStreak còn nguyên). Trả số tiền thưởng đã cộng cho `killer` (0 nếu không tính) */
  onKill(room: Room, killer: Player | null, victim: Player): number
  /** Chạy một lần sau khi chốt xong các ca chết của tick (luật đội động...) */
  afterDeaths(room: Room): void
  /** ms chờ hồi sinh sau khi chết; null = không hồi sinh cho tới khi mode tự hồi sinh */
  respawnDelayMs(room: Room, p?: Player): number | null
  canBuy(room: Room, p: Player, nowMs: number): boolean   // ngoài kiểm tra còn sống + khu mua
  canSwitchTeam(room: Room, p: Player): boolean
  statusText(room: Room): string
  stateMessage(room: Room): MatchStateMsg
  // ── Móc tuỳ chọn cho thể thức zombie (plan 16/17)
  /** Đội mọi người vào khi join (zombie: phe người 'A'); có = bỏ luật cân bằng đội */
  joinTeam?(room: Room): TeamId
  /** Mua ở bất cứ đâu (bỏ kiểm tra khu mua) */
  buyAnywhere?(room: Room, p: Player): boolean
  /** `p` vừa hết máu (hp ≤ 0). Trả true = thể thức đã xử lý (không tính là chết) */
  onLethal?(room: Room, p: Player): boolean
  /** Điểm hồi sinh riêng; null/thiếu = luật mặc định */
  pickSpawn?(room: Room, p: Player): { pos: [number, number, number]; yaw: number } | null
  /** Thêm cột riêng của thể thức vào một dòng bảng điểm */
  scoreboardRow?(room: Room, p: Player, row: ScoreboardRow): void
  /** Lệnh debug riêng của thể thức (M.8); undefined nếu không hỗ trợ */
  devEndRound?(room: Room, winner: 'A' | 'B' | 'draw'): boolean
  devSetRound?(room: Room, round: number): boolean
  /** /zombie, /human (plan 16): đổi vai người chơi để thử */
  devSetRole?(room: Room, p: Player, role: 'zombie' | 'human'): boolean
}

export function createMode(config: RoomConfig): MatchMode {
  const s = config.settings
  switch (s.mode) {
    case 'elimination': return new EliminationMode(s)
    case 'infection': return new InfectionMode(s)
    default: return new TdmMode()
  }
}
