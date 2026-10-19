import { MsgType, PLAYER_MAX_HP, RESPAWN_DELAY_MS, SPAWN_INVULN_MS, makeWeaponState, makeRecoilState, type RecoilState, type WeaponState, type InputCmd, type LoadedMap, type PlayerState, type Transport } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { LagHistory } from './lagComp'

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
  starvedTicks: number           // số tick liên tiếp hàng đợi trống
  weapon: WeaponState            // đạn/reload/fire rate do server giữ (4.1)
  recoil: RecoilState            // recoil tích luỹ để tính hướng đạn (cùng công thức với client)
  alive: boolean                 // người chết không có hitbox, không bắn, không nhận input di chuyển
  hp: number                     // hp ≤ 0 mà còn alive = chờ chốt cuối tick (để hai người bắn chết nhau cùng tick đều chết)
  respawnAt: number              // serverTime hồi sinh khi đã chết
  invulnUntil: number            // serverTime hết bất tử; về 0 khi bắn phát hợp lệ đầu tiên
  killerId: number               // ai bắn hạ (-1 = chưa); kèm vũ khí/headshot để gửi Kill
  killWeapon: number
  killHeadshot: boolean
  deadCmd: InputCmd              // scratch: cmd đã bỏ nút khi đang chết
  debugShots: boolean            // F7: gửi DebugShot cho người này
  rewindClamped: number          // số phát bị kẹp vì fireRenderTime cũ hơn MAX_REWIND_MS
  shotsFired: number             // số phát bắn hợp lệ từ lúc vào phòng (log/test)
  seqOffset: number | null       // now − seq*1000/TICK_RATE của cmd đầu tiên; chặn seq chạy nhanh hơn thời gian thực
}

export class Room {
  readonly players = new Map<number, Player>()
  emptySince: number | null
  readonly history = new LagHistory()
  serverNow = 0   // serverTime của tick đang chạy (stepRoom đặt)
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
      starvedTicks: 0,
      weapon: makeWeaponState(),
      recoil: makeRecoilState(),
      alive: true,
      hp: PLAYER_MAX_HP,
      respawnAt: 0,
      invulnUntil: 0,
      killerId: -1,
      killWeapon: 0,
      killHeadshot: false,
      deadCmd: { seq: 0, buttons: 0, yaw: 0, pitch: 0, weapon: 0 },
      debugShots: false,
      rewindClamped: 0,
      shotsFired: 0,
      seqOffset: null,
    }
    transport.send({ t: MsgType.Welcome, yourId: player.id, tick, serverTime, mapName: this.map.name,
      players: [...this.players.values()].map(o => ({ id: o.id, name: o.name })) })
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

  // Chốt người chết cuối tick: hp ≤ 0 → chết, báo cả phòng. Gọi sau khi mọi người đã bước.
  finalizeDeaths(): void {
    for (const p of this.players.values()) {
      if (!p.alive || p.hp > 0) continue
      p.alive = false
      p.hp = 0
      p.respawnAt = this.serverNow + RESPAWN_DELAY_MS
      p.weapon.triggerHeld = false
      for (const o of this.players.values()) {
        o.transport.send({ t: MsgType.Kill, killerId: p.killerId, victimId: p.id, weapon: p.killWeapon, headshot: p.killHeadshot })
      }
    }
  }

  // Hồi sinh người đã chết đủ lâu
  respawnDue(): void {
    for (const p of this.players.values()) {
      if (p.alive || this.serverNow < p.respawnAt) continue
      this.respawn(p)
    }
  }

  // Spawn xa kẻ địch còn sống nhất: chọn điểm có khoảng cách tới kẻ địch gần nhất lớn nhất
  respawn(p: Player): void {
    const all = [...this.map.spawns.A, ...this.map.spawns.B]
    let best = all[0] ?? { pos: [0, 2, 0] as [number, number, number], yaw: 0 }
    let bestScore = -1
    for (const sp of all) {
      let nearest = Infinity
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue
        nearest = Math.min(nearest, Math.hypot(o.state.pos[0] - sp.pos[0], o.state.pos[2] - sp.pos[2]))
      }
      if (nearest > bestScore) { bestScore = nearest; best = sp }
    }
    p.state = {
      pos: [best.pos[0], best.pos[1], best.pos[2]], vel: [0, 0, 0], yaw: best.yaw, pitch: 0,
      grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0,
    }
    p.alive = true
    p.hp = PLAYER_MAX_HP
    p.killerId = -1
    p.invulnUntil = this.serverNow + SPAWN_INVULN_MS
    const fresh = makeWeaponState()
    p.weapon.ammo = fresh.ammo
    p.weapon.reloadEndMs = 0
    p.weapon.nextFireMs = 0
    p.weapon.triggerHeld = false
    p.recoil.pitch = 0; p.recoil.yaw = 0
    for (const o of this.players.values()) {
      o.transport.send({ t: MsgType.Respawn, id: p.id, pos: [best.pos[0], best.pos[1], best.pos[2]], yaw: best.yaw })
    }
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
