import { encode as mpEncode, decode as mpDecode } from '@msgpack/msgpack'
import { Btn, type InputCmd, type PlayerState } from './movement'
import type { HitBox } from './hitbox'
import { WEAPONS, type WeaponState } from './weapons'
import type { MatchPhase, TeamId } from './teams'

// Phân loại message theo plan/04-phase3-netcode-move.md (C2S 1-3, S2C 101-105)
export const MsgType = {
  // Client → Server
  Join: 1,
  Inputs: 2,
  Ping: 3,
  SetDebug: 4,
  ChooseTeam: 5,
  // Server → Client
  Welcome: 101,
  Pong: 102,
  Snapshot: 103,
  PlayerJoined: 104,
  PlayerLeft: 105,
  HitConfirm: 106,
  Kill: 107,
  Respawn: 108,
  ShotFx: 109,
  DebugShot: 110,
  Hurt: 111,
  MatchState: 112,   // plan ghi 111 nhưng 111 đã là Hurt
  TeamAssigned: 113,
  Scoreboard: 114,
} as const

export type MsgTypeValue = (typeof MsgType)[keyof typeof MsgType]

// Client → Server
export interface InputsMsg {
  t: typeof MsgType.Inputs
  cmds: InputCmd[]
}

export interface PingMsg {
  t: typeof MsgType.Ping
  clientTime: number
  rtt?: number   // RTT client đo được gần nhất (ms), server dùng cho cột ping ở bảng điểm
}

export interface JoinMsg {
  t: typeof MsgType.Join
  name: string
  room: string
  team?: TeamId | 'auto'   // đội muốn vào; mặc định auto
}

// Đổi đội (server áp luật cân bằng, trả lời bằng TeamAssigned)
export interface ChooseTeamMsg {
  t: typeof MsgType.ChooseTeam
  team: TeamId | 'auto'
}

// Bật/tắt DebugShot (F7); ngoài plan, cần để server biết khi nào gửi
export interface SetDebugMsg {
  t: typeof MsgType.SetDebug
  shots: boolean
}

// Server → Client
export interface WelcomeMsg {
  t: typeof MsgType.Welcome
  yourId: number
  tick: number
  serverTime: number
  mapName: string
  players: { id: number; name: string }[]   // những người đã có trong phòng lúc vào (để biết tên cho killfeed)
}

// Đủ mọi trường của PlayerState để client đặt lại state chính xác (reconcile ở 3.6)
export const NetFlag = {
  Grounded:  1 << 0,
  Crouching: 1 << 1,
  Sliding:   1 << 2,   // slideTimer > 0; chỉ để hiển thị, không dùng để dựng lại state
  Dead:      1 << 3,   // đã chết, chờ hồi sinh (không có hitbox, không vẽ)
  Invuln:    1 << 4,   // bất tử sau hồi sinh (vẽ nhấp nháy)
} as const

export interface NetPlayer {
  id: number
  pos: [number, number, number]
  vel: [number, number, number]
  yaw: number
  pitch: number
  flags: number
  slideTimer: number
  slideCooldown: number
  hp: number
  team: TeamId
  weapon: number   // súng đang cầm (để vẽ súng trên tay người khác)
}

export interface SnapshotMsg {
  t: typeof MsgType.Snapshot
  tick: number
  serverTime: number
  ack: number          // lastProcessedSeq của chính client nhận gói này
  players: NetPlayer[]
  wpn?: WeaponState    // WeaponState của chính client nhận gói này, sau cmd `ack` (client replay cmd chưa ack lên trên)
}

export interface PlayerJoinedMsg {
  t: typeof MsgType.PlayerJoined
  id: number
  name: string
}

export interface PlayerLeftMsg {
  t: typeof MsgType.PlayerLeft
  id: number
}

// Cả phòng: ai hạ ai
export interface KillMsg {
  t: typeof MsgType.Kill
  killerId: number
  victimId: number
  weapon: number
  headshot: boolean
}

// Cả phòng: người chơi hồi sinh ở pos/yaw (client của chính người đó teleport, không làm mượt)
export interface RespawnMsg {
  t: typeof MsgType.Respawn
  id: number
  pos: [number, number, number]
  yaw: number
}

// Gửi riêng nạn nhân (ngoài plan): hướng đạn đến để vẽ viền đỏ + tiếng bị trúng
export interface HurtMsg {
  t: typeof MsgType.Hurt
  origin: [number, number, number]   // mắt người bắn
  damage: number
}

// Gửi riêng người bắn: phát bắn trúng người (hitmarker chỉ hiện khi nhận gói này)
export interface HitConfirmMsg {
  t: typeof MsgType.HitConfirm
  damage: number
  headshot: boolean
  targetId: number
}

// Gửi cả phòng trừ người bắn: vẽ vệt đạn + tiếng súng có vị trí. `weapon` ngoài plan, cần để chọn tiếng súng.
export interface ShotFxMsg {
  t: typeof MsgType.ShotFx
  shooterId: number
  weapon: number
  origin: [number, number, number]
  dir: [number, number, number]
  dist: number
}

// Chỉ gửi người bắn khi đã bật debug: tia + hitbox mọi người khác ở thời điểm đã tua
export interface DebugShotMsg {
  t: typeof MsgType.DebugShot
  origin: [number, number, number]
  dir: [number, number, number]
  boxes: HitBox[]
}

// Cả phòng: gửi khi đổi pha và mỗi 1s. phaseEndsAt theo serverTime (0 = không có hạn)
export interface MatchStateMsg {
  t: typeof MsgType.MatchState
  phase: MatchPhase
  phaseEndsAt: number
  scoreA: number
  scoreB: number
  sideSwapped: boolean
}

export interface TeamAssignedMsg {
  t: typeof MsgType.TeamAssigned
  id: number
  team: TeamId
}

export interface ScoreboardRow { id: number; name: string; team: TeamId; kills: number; deaths: number; ping: number }
export interface ScoreboardMsg {
  t: typeof MsgType.Scoreboard
  rows: ScoreboardRow[]
}

export interface PongMsg {
  t: typeof MsgType.Pong
  clientTime: number
  serverTime: number
}

export type AnyMsg =
  | JoinMsg | InputsMsg | PingMsg | SetDebugMsg | ChooseTeamMsg
  | WelcomeMsg | PongMsg | SnapshotMsg | PlayerJoinedMsg | PlayerLeftMsg | HitConfirmMsg | ShotFxMsg | DebugShotMsg | KillMsg | RespawnMsg | HurtMsg | MatchStateMsg | TeamAssignedMsg | ScoreboardMsg

export const MAX_PITCH = 1.56
const ALL_BUTTONS = Object.values(Btn).reduce((a, b) => a | b, 0)

// Cmd từ client không đáng tin: kiểm tra trước khi cho vào hàng đợi
export function isValidCmd(c: unknown): c is InputCmd {
  if (typeof c !== 'object' || c === null) return false
  const m = c as Record<string, unknown>
  return (
    typeof m.seq === 'number' && Number.isInteger(m.seq) &&
    typeof m.buttons === 'number' && Number.isInteger(m.buttons) && m.buttons >= 0 &&
    (m.buttons & ~ALL_BUTTONS) === 0 &&
    typeof m.yaw === 'number' && Number.isFinite(m.yaw) &&
    typeof m.pitch === 'number' && Math.abs(m.pitch) <= MAX_PITCH &&
    typeof m.weapon === 'number' && Number.isInteger(m.weapon) && m.weapon >= 0 && m.weapon < WEAPONS.length &&
    (m.fireRenderTime === undefined || (typeof m.fireRenderTime === 'number' && Number.isFinite(m.fireRenderTime)))
  )
}

export function stateToNet(id: number, s: PlayerState, hp = 100, extraFlags = 0, team: TeamId = 'A', weapon = 0): NetPlayer {
  return {
    id,
    pos: [s.pos[0], s.pos[1], s.pos[2]],
    vel: [s.vel[0], s.vel[1], s.vel[2]],
    yaw: s.yaw, pitch: s.pitch,
    flags: (s.grounded ? NetFlag.Grounded : 0) | (s.crouching ? NetFlag.Crouching : 0) | (s.slideTimer > 0 ? NetFlag.Sliding : 0) | extraFlags,
    slideTimer: s.slideTimer, slideCooldown: s.slideCooldown,
    hp, team, weapon,
  }
}

export function netToState(n: NetPlayer): PlayerState {
  return {
    pos: [n.pos[0], n.pos[1], n.pos[2]],
    vel: [n.vel[0], n.vel[1], n.vel[2]],
    yaw: n.yaw, pitch: n.pitch,
    grounded: (n.flags & NetFlag.Grounded) !== 0,
    crouching: (n.flags & NetFlag.Crouching) !== 0,
    slideTimer: n.slideTimer, slideCooldown: n.slideCooldown,
  }
}

export function encode(msg: AnyMsg): Uint8Array {
  return mpEncode(msg)
}

export function decode(buf: Uint8Array | ArrayBuffer): AnyMsg {
  return mpDecode(buf) as AnyMsg
}
