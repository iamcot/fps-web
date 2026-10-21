// Xử lý một kết nối (WebSocket thật hoặc LocalTransport của offline): dùng chung cho server Node và Web Worker offline.
// Không import ws/fs/process — chạy được trong trình duyệt.
import { MsgType, isCharacterSet, DEFAULT_CHARACTER_SET, type JoinMsg, type MovementConfig, type Transport } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { enqueueCmds } from './simulation'
import { handleBuy } from './shop'
import { handleDebugCmd } from './debugCmds'
import { RoomManager, sanitizeName, sanitizeRoom, type Player, type Room } from './room'

export interface ServerContext {
  rooms: RoomManager
  cfg: MovementConfig
  tick(): number                       // tick hiện tại của TickLoop
  now(): number                        // serverTime (ms) để trả Pong
  allowDebugCmds: boolean              // lệnh debug M.8: false khi chạy production
  log?(text: string): void
  /** Phiên bản server: có đặt thì client phải gửi cùng phiên bản ở ListRooms/Join, khác thì bị từ chối. Offline (cùng bundle với client) không đặt. */
  version?: string
  /** Offline: tạo phòng riêng cho kết nối đầu tiên (thay vì Join thường). */
  joinOverride?(transport: Transport, name: string, msg: JoinMsg): { room: Room; player: Player } | null
  /** Sau khi người vào phòng (đã có world hay chưa): host offline đặt bot... */
  onJoined?(room: Room, player: Player): void
  onOfflineCmd?(room: Room, player: Player, msg: Extract<import('@fps/shared').AnyMsg, { t: typeof MsgType.OfflineCmd }>): void
  onLeft?(room: Room, player: Player): void
}

export function handleConnection(ctx: ServerContext, transport: Transport): void {
  const { rooms, cfg } = ctx
  const log = ctx.log ?? (() => {})
  let room: Room | null = null
  let player: Player | null = null
  let refused = false   // đã bị từ chối vì khác phiên bản: bỏ qua mọi tin sau đó

  transport.onMessage(msg => {
    if (refused) return
    if (ctx.version !== undefined && (msg.t === MsgType.ListRooms || msg.t === MsgType.Join) && msg.version !== ctx.version) {
      refused = true
      log(`Từ chối client phiên bản ${String(msg.version)} (server ${ctx.version})`)
      transport.send({ t: MsgType.JoinRejected, reason: 'version' })
      return
    }
    if (msg.t === MsgType.Ping) {
      transport.send({ t: MsgType.Pong, clientTime: msg.clientTime, serverTime: ctx.now() })
      if (player && typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) player.pingMs = Math.min(999, Math.max(0, msg.rtt))
    } else if (msg.t === MsgType.Inputs) {
      if (player) enqueueCmds(player, msg.cmds, ctx.now())
    } else if (msg.t === MsgType.SetDebug) {
      if (player) player.debugShots = msg.shots === true
    } else if (msg.t === MsgType.Buy) {
      if (room && player && typeof msg.key === 'string') handleBuy(room, player, msg.key)
    } else if (msg.t === MsgType.ChooseTeam) {
      // Đổi đội bất cứ lúc nào nếu luật cân bằng (maxTeamDiff, maxPerTeam) cho phép; không thì giữ đội cũ
      if (!room || !player) return
      const pref = msg.team === 'A' || msg.team === 'B' ? msg.team : 'auto'
      const team = room.assignTeam(pref, player)
      if (team && team !== player.team && room.mode.canSwitchTeam(room, player)) { room.setTeam(player, team); room.resetEconomy(player); room.respawn(player) }
      else transport.send({ t: MsgType.TeamAssigned, id: player.id, team: player.team })
    } else if (msg.t === MsgType.DebugCmd) {
      // Lệnh debug (M.8): chỉ nhận khi không chạy production
      if (ctx.allowDebugCmds && room && player && typeof msg.cmd === 'string') handleDebugCmd(room, player, msg.cmd.slice(0, 64))
    } else if (msg.t === MsgType.OfflineCmd) {
      if (room && player && room.offline) ctx.onOfflineCmd?.(room, player, msg)
    } else if (msg.t === MsgType.ListRooms) {
      transport.send({ t: MsgType.RoomList, rooms: rooms.list(), maps: rooms.mapList() })
    } else if (msg.t === MsgType.Join) {
      if (player) return   // mỗi kết nối chỉ join một lần
      const name = sanitizeName(msg.name)
      const roomId = sanitizeRoom(msg.room)
      if (!name || !roomId) { transport.send({ t: MsgType.JoinRejected, reason: 'bad' }); return }
      let res: { room: Room; player: Player } | null
      if (ctx.joinOverride) {
        res = ctx.joinOverride(transport, name, msg)
      } else {
        const exists = rooms.rooms.has(roomId)
        if (msg.create === true && exists) { transport.send({ t: MsgType.JoinRejected, reason: 'exists' }); return }
        if (msg.create === false && !exists) { transport.send({ t: MsgType.JoinRejected, reason: 'missing' }); return }
        const pref = msg.team === 'A' || msg.team === 'B' ? msg.team : 'auto'
        res = rooms.tryJoin(roomId, name, transport, ctx.tick(), pref, isCharacterSet(msg.characterSet) ? msg.characterSet : DEFAULT_CHARACTER_SET, typeof msg.mapId === 'string' ? msg.mapId : undefined, msg.create === true && typeof msg.options === 'object' ? msg.options : undefined)
      }
      if (!res) { log(`[room ${roomId}] "${name}" bị từ chối: phòng đầy`); transport.send({ t: MsgType.JoinRejected, reason: 'full' }); return }
      ;({ room, player } = res)
      const joined = player, joinedRoom = room
      createWorld(room.map, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(w => {
        // Người chơi có thể đã rời trước khi world nạp xong
        if (joinedRoom.players.has(joined.id)) joined.world = w
        else w.dispose()
      })
      log(`[room ${roomId}] #${player.id} "${name}" vào (${room.players.size} người)`)
      ctx.onJoined?.(room, player)
    }
  })

  transport.onClose(() => {
    if (!room || !player) return
    room.leave(player.id)
    log(`[room ${room.id}] #${player.id} "${player.name}" rời (${room.players.size} người)`)
    ctx.onLeft?.(room, player)
  })
}
