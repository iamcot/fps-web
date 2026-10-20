// Sân thử bot không giao diện (test + bot-bench): Room thật + Rapier thật + map thật, tự bước tick bằng tay.
import { readFileSync } from 'fs'
import { TICK_RATE, defaultMovement, loadMap, type AnyMsg, type LoadedMap, type MapFile, type Transport } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { RoomManager, type Player, type Room } from '../room'
import { stepRoom } from '../simulation'
import { offlineRules, OFFLINE_ROOM } from '../offline/rules'
import { buildNav } from './nav'

export function loadDeathmatch(): LoadedMap {
  return loadMap(JSON.parse(readFileSync(new URL('../../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
}

export interface Dummy {
  player: Player
  got: AnyMsg[]
}

export interface Arena {
  room: Room
  map: LoadedMap
  nav: ReturnType<typeof buildNav>
  tick: number
  step(ticks: number, each?: (tick: number) => void): void
  /** Người "thật" không có client: đứng yên, có world để bị bắn. Tuỳ chọn teleport/giữ máu. */
  addDummy(team: 'A' | 'B', pos?: [number, number, number]): Promise<Dummy>
  dispose(): void
}

export async function createArena(opts: { nav?: boolean } = {}): Promise<Arena> {
  const map = loadDeathmatch()
  let clock = 0
  const rooms = new RoomManager(map, () => clock, offlineRules(), 'deathmatch')
  const room = rooms.createRoom(OFFLINE_ROOM, undefined, 'deathmatch')
  room.offline = true
  room.infiniteMoney = true
  const cfg = defaultMovement
  const navWorld: CollisionWorld = await createWorld(map, cfg.standHeight, cfg.crouchHeight, cfg.radius)
  const nav = buildNav(navWorld, map, cfg)
  if (opts.nav !== false) room.nav = nav
  const arena: Arena = {
    room, map, nav, tick: 0,
    step(ticks, each) {
      for (let i = 0; i < ticks; i++) {
        arena.tick++
        clock = arena.tick * 1000 / TICK_RATE
        stepRoom(room, cfg, clock, arena.tick)
        each?.(arena.tick)
      }
    },
    async addDummy(team, pos) {
      const got: AnyMsg[] = []
      const t: Transport = { send: m => { got.push(m) }, onMessage: () => {}, onClose: () => {} }
      const p = room.join('Dummy', t, arena.tick, clock, team)!
      p.world = await createWorld(map, cfg.standHeight, cfg.crouchHeight, cfg.radius)
      if (pos) { p.state.pos = [pos[0], pos[1], pos[2]] }
      return { player: p, got }
    },
    dispose() { for (const p of room.players.values()) p.world?.dispose(); navWorld.dispose() },
  }
  return arena
}
