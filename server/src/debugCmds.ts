// Lệnh debug trong game (task M.8). main.ts chỉ gọi khi NODE_ENV !== 'production'.
import { CATEGORY_SLOT, MsgType, PLAYER_MAX_HP, loadoutWeaponIds, magSizeOf, weaponByKey } from '@fps/shared'
import { broadcastMatch } from './match'
import type { Player, Room } from './room'

/** Trả true nếu lệnh được nhận (đúng tên + đối số); false nếu bỏ qua */
export function handleDebugCmd(room: Room, p: Player, raw: string): boolean {
  const [name, arg] = raw.trim().split(/\s+/)
  const num = Number(arg)
  switch (name) {
    case '/endround': {
      const w = arg === 'A' || arg === 'B' ? arg : arg === 'draw' ? 'draw' : null
      return w !== null && (room.mode.devEndRound?.(room, w) ?? false)
    }
    case '/setround':
      return Number.isFinite(num) && (room.mode.devSetRound?.(room, num) ?? false)
    case '/time':
      if (!Number.isFinite(num) || num < 0) return false
      room.phaseEndsAt = room.serverNow + num * 1000
      broadcastMatch(room)
      return true
    case '/money':
      if (!Number.isFinite(num)) return false
      p.money = Math.min(room.eco.maxMoney, Math.max(0, Math.round(num)))
      p.transport.send({ t: MsgType.MoneyEvent, delta: p.money, reason: 'reset' })
      return true
    case '/hp':
      if (!Number.isFinite(num) || !p.alive) return false
      p.hp = Math.min(PLAYER_MAX_HP, Math.max(1, Math.round(num)))
      return true
    case '/gun': {   // bảng F9 (client/render/poseEditor): cầm súng `arg` ngay, đạn đầy, không trừ tiền
      const def = arg ? weaponByKey(arg) : undefined
      if (!def || def.consumable || !p.alive) return false
      const slot = CATEGORY_SLOT[def.category]
      const slots = p.loadout.slots.slice()
      slots[slot] = { key: def.key, paid: 0 }
      p.loadout = { slots }
      const ws = p.weapon
      ws.slots = loadoutWeaponIds(p.loadout)
      ws.slot = slot; ws.current = def.id
      ws.ammo[def.id] = magSizeOf(def, ws.magMult)
      ws.reloadEndMs = 0; ws.triggerHeld = false
      return true
    }
    case '/kill':
      if (!p.alive) return false
      p.killerId = p.id; p.hp = 0
      return true
    case '/wave':
      return Number.isFinite(num) && (room.mode.devSetWave?.(room, num) ?? false)
    case '/clearwave':
      return room.mode.devClearWave?.(room) ?? false
    case '/zombie':
    case '/human':
      return room.mode.devSetRole?.(room, p, name === '/zombie' ? 'zombie' : 'human') ?? false
    default:
      return false
  }
}
