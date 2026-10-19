import { MsgType, type InputCmd, type LoadedMap, type PlayerState, type Transport } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'

export const EMPTY_ROOM_TTL_MS = 60_000
export const MAX_NAME_LEN = 16
export const MAX_ROOM_LEN = 32

export interface Player {
  id: number
  name: string
  transport: Transport
  state: PlayerState
  inputQueue: InputCmd[]
  lastProcessedSeq: number
  lastCmd: InputCmd | null
  world: CollisionWorld | null   // Rapier world riêng mỗi người (capsule kinematic); nạp bất đồng bộ sau khi join
  idleCmd: InputCmd              // scratch tái sử dụng khi hàng đợi trống
}

export class Room {
  readonly players = new Map<number, Player>()
  emptySince: number | null
  private nextId = 1
  private spawnTurn = 0   // phase 5 mới có đội: tạm xen kẽ spawn A/B

  constructor(
    readonly id: string,
    private map: LoadedMap,
    private now: () => number,
    private random: () => number = Math.random,
  ) {
    this.emptySince = now()
  }

  join(name: string, transport: Transport, tick: number, serverTime: number): Player {
    const spawns = (this.spawnTurn++ % 2 === 0 ? this.map.spawns.A : this.map.spawns.B)
    const sp = spawns[Math.floor(this.random() * spawns.length)] ?? { pos: [0, 2, 0] as [number, number, number], yaw: 0 }
    const player: Player = {
      id: this.nextId++,
      name,
      transport,
      state: {
        pos: [sp.pos[0], sp.pos[1], sp.pos[2]], vel: [0, 0, 0],
        yaw: sp.yaw, pitch: 0,
        grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0,
      },
      inputQueue: [],
      lastProcessedSeq: -1,   // client đếm seq từ 0
      lastCmd: null,
      world: null,
      idleCmd: { seq: 0, buttons: 0, yaw: sp.yaw, pitch: 0, weapon: 0 },
    }
    transport.send({ t: MsgType.Welcome, yourId: player.id, tick, serverTime, mapName: this.map.name })
    for (const other of this.players.values()) {
      other.transport.send({ t: MsgType.PlayerJoined, id: player.id, name: player.name })
    }
    this.players.set(player.id, player)
    this.emptySince = null
    return player
  }

  leave(id: number): void {
    const p = this.players.get(id)
    if (!p) return
    this.players.delete(id)
    p.world?.dispose()
    p.world = null
    for (const other of this.players.values()) other.transport.send({ t: MsgType.PlayerLeft, id })
    if (this.players.size === 0) this.emptySince = this.now()
  }

  isExpired(): boolean {
    return this.emptySince !== null && this.now() - this.emptySince > EMPTY_ROOM_TTL_MS
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>()

  constructor(private map: LoadedMap, private now: () => number = () => performance.now()) {}

  // Vào phòng chưa có thì tạo mới
  join(roomId: string, name: string, transport: Transport, tick = 0): { room: Room; player: Player } {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Room(roomId, this.map, this.now)
      this.rooms.set(roomId, room)
    }
    const player = room.join(name, transport, tick, this.now())
    return { room, player }
  }

  // Xoá phòng trống quá 60 giây; gọi định kỳ
  sweep(): void {
    for (const [id, room] of this.rooms) if (room.isExpired()) this.rooms.delete(id)
  }
}

export function sanitizeName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_NAME_LEN) : ''
}

export function sanitizeRoom(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_ROOM_LEN) : ''
}
