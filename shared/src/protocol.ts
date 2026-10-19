import { encode as mpEncode, decode as mpDecode } from '@msgpack/msgpack'

// Phân loại message theo plan/04-phase3-netcode-move.md (C2S 1-3, S2C 101-105)
export const MsgType = {
  // Client → Server
  Join: 1,
  Inputs: 2,
  Ping: 3,
  // Server → Client
  Welcome: 101,
  Pong: 102,
  Snapshot: 103,
  PlayerJoined: 104,
  PlayerLeft: 105,
} as const

export type MsgTypeValue = (typeof MsgType)[keyof typeof MsgType]

// Client → Server
export interface PingMsg {
  t: typeof MsgType.Ping
  clientTime: number
}

export interface JoinMsg {
  t: typeof MsgType.Join
  name: string
  room: string
}

// Server → Client
export interface WelcomeMsg {
  t: typeof MsgType.Welcome
  yourId: number
  tick: number
  serverTime: number
  mapName: string
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

export interface PongMsg {
  t: typeof MsgType.Pong
  clientTime: number
  serverTime: number
}

// Inputs, Snapshot thêm ở task 3.4
export type AnyMsg = JoinMsg | PingMsg | WelcomeMsg | PongMsg | PlayerJoinedMsg | PlayerLeftMsg

export function encode(msg: AnyMsg): Uint8Array {
  return mpEncode(msg)
}

export function decode(buf: Uint8Array | ArrayBuffer): AnyMsg {
  return mpDecode(buf) as AnyMsg
}
