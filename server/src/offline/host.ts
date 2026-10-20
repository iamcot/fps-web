// Server offline (plan 15, B.0): cùng code Room/simulation như server Node nhưng chạy trong Web Worker của trình duyệt.
// Phòng 'offline' chỉ có một người thật + bot. Không import ws/fs/process.
import {
  MsgType, defaultMovement, otherTeam, type JoinMsg, type LoadedMap, type MovementConfig, type NavDebugMsg, type Transport, type TeamId,
} from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { TickLoop } from '../tickLoop'
import { stepRoom, sendSnapshots } from '../simulation'
import { RoomManager, type Player, type Room } from '../room'
import { handleConnection, type ServerContext } from '../connection'
import { addBot, clearBots, offlineStateMsg, removeBot } from '../bots/roster'
import { buildNav } from '../bots/nav'
import { OFFLINE_ROOM, offlineRules } from './rules'

const BOT_DEBUG_EVERY_TICKS = 6

export interface OfflineHost {
  room: Room
  rooms: RoomManager
  /** Nhận một kết nối (LocalTransport). Join đầu tiên vào phòng offline. */
  connect(transport: Transport): void
  /** Chạy các tick đã tới hạn theo đồng hồ (gọi bằng setInterval) */
  pump(): void
  dispose(): void
}

export async function createOfflineHost(map: LoadedMap, now: () => number = () => performance.now(), cfg: MovementConfig = defaultMovement): Promise<OfflineHost> {
  const rules = offlineRules()
  const rooms = new RoomManager(map, now, rules, 'deathmatch')
  const room = rooms.createRoom(OFFLINE_ROOM, undefined, 'deathmatch')
  room.offline = true

  // Rapier khởi tạo wasm ở lần createWorld đầu → làm tuần tự, world này dùng riêng cho lưới di chuyển
  const navWorld: CollisionWorld = await createWorld(map, cfg.standHeight, cfg.crouchHeight, cfg.radius)
  room.nav = buildNav(navWorld, map, cfg)

  let human: Player | null = null
  let debugOn = false
  let stateDirty = false
  const dirty = () => { stateDirty = true }

  const loop = new TickLoop(now, (tick, serverTime) => {
    stepRoom(room, cfg, serverTime, tick)
    sendSnapshots(room, tick, serverTime)
    if (stateDirty && human) { stateDirty = false; human.transport.send(offlineStateMsg(room)) }
    if (debugOn && human && tick % BOT_DEBUG_EVERY_TICKS === 0) {
      const bots = []
      for (const p of room.players.values()) if (p.bot && p.alive) bots.push(p.bot.debugInfo())
      human.transport.send({ t: MsgType.BotDebug, bots })
    }
  })

  const sendNav = () => {
    const nav = room.nav!, nodes: number[] = [], edges: number[] = []
    for (let i = 0; i < nav.count; i++) nodes.push(+nav.x[i]!.toFixed(2), +nav.y[i]!.toFixed(2), +nav.z[i]!.toFixed(2), nav.cover[i]!)
    for (let i = 0; i < nav.count; i++) for (const e of nav.adj[i]!) edges.push(i, e.to)
    const msg: NavDebugMsg = { t: MsgType.NavDebug, nodes, edges }
    human?.transport.send(msg)
  }

  const ctx: ServerContext = {
    rooms, cfg,
    tick: () => loop.tick,
    now,
    allowDebugCmds: true,
    joinOverride: (transport: Transport, name: string, msg: JoinMsg) => {
      if (human) return null   // một người thật cho mỗi phòng offline
      const pref: TeamId | 'auto' = msg.team === 'A' || msg.team === 'B' ? msg.team : 'A'
      const player = room.join(name, transport, loop.tick, now(), pref)
      if (!player) return null
      human = player
      return { room, player }
    },
    onJoined: (_room, player) => { player.transport.send(offlineStateMsg(room)) },
    onLeft: () => { human = null; clearBots(room); debugOn = false },
    onOfflineCmd: (_room, player, msg) => {
      switch (msg.cmd) {
        case 'addBot': {
          if (room.players.size >= room.config.maxPlayers) break
          const team = msg.ally === true ? player.team : otherTeam(player.team)
          addBot(room, msg.difficulty === 'hard' ? 'hard' : 'medium', team)
          break
        }
        case 'removeBot': if (typeof msg.id === 'number') removeBot(room, msg.id); break
        case 'clearBots': clearBots(room); break
        case 'swapSide': {
          for (const p of room.players.values()) { room.setTeam(p, otherTeam(p.team)); room.resetEconomy(p); room.respawn(p) }
          break
        }
        case 'infiniteMoney': {
          room.infiniteMoney = msg.on === true
          if (room.infiniteMoney) for (const p of room.players.values()) { p.money = room.eco.maxMoney; p.transport.send({ t: MsgType.MoneyEvent, delta: p.money, reason: 'reset' }) }
          break
        }
        case 'botDebug': {
          debugOn = msg.on === true
          if (debugOn) sendNav()
          break
        }
      }
      dirty()
    },
  }
  room.infiniteMoney = true   // mặc định bật

  return {
    room, rooms,
    connect: transport => handleConnection(ctx, transport),
    pump: () => loop.pump(),
    dispose: () => { clearBots(room); navWorld.dispose() },
  }
}
