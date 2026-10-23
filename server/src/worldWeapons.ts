import {
  CATEGORY_SLOT, MsgType, WEAPONS, WORLD_WEAPON, applyDrop, applyPickUp, canDrop, canPickUp, loadoutWeaponIds, selectSlot, resetMelee,
  type Vec3, type WorldWeaponSpawnMsg,
} from '@fps/shared'
import { anyWorld } from './grenades'
import type { Player, Room } from './room'

// Vũ khí nằm dưới đất (plan 19 P8). Server quyết định nhặt / vứt; client chỉ vẽ theo WorldWeaponSpawn / Remove.
export interface WorldWeapon {
  id: number
  weaponId: number
  pos: Vec3               // trên mặt sàn
  yaw: number
  ammo: number            // đạn trong băng lúc rơi, giữ nguyên khi nhặt lại
  despawnAtMs: number     // serverTime biến mất; Infinity = vũ khí của map (không tự mất)
  lockOwner: number       // người vừa vứt: không nhặt lại trong lockUntilMs
  lockUntilMs: number
}

const CHEST = 1.0         // m so với chân: tia vứt đi ngang ngực
const FLOOR_PROBE = 3     // m: tìm sàn dưới điểm vứt

export function worldWeaponSpawnMsg(w: WorldWeapon): WorldWeaponSpawnMsg {
  return { t: MsgType.WorldWeaponSpawn, id: w.id, weapon: w.weaponId, pos: [w.pos[0], w.pos[1], w.pos[2]], yaw: w.yaw, persist: w.despawnAtMs === Infinity || undefined }
}

function broadcast(room: Room, msg: Parameters<Player['transport']['send']>[0]): void {
  for (const o of room.players.values()) o.transport.send(msg)
}

/** Thêm vũ khí xuống đất và báo cả phòng. Quá trần thì bỏ vật cũ nhất. */
export function spawnWorldWeapon(room: Room, weaponId: number, pos: Vec3, yaw: number, ammo: number, despawnAtMs: number, lockOwner = -1, lockUntilMs = 0): WorldWeapon {
  if (room.worldWeapons.length >= WORLD_WEAPON.maxItems) removeWorldWeapon(room, room.worldWeapons[0]!)
  const w: WorldWeapon = { id: room.nextWorldWeaponId++, weaponId, pos: [pos[0], pos[1], pos[2]], yaw, ammo, despawnAtMs, lockOwner, lockUntilMs }
  room.worldWeapons.push(w)
  broadcast(room, worldWeaponSpawnMsg(w))
  return w
}

function removeWorldWeapon(room: Room, w: WorldWeapon): void {
  const i = room.worldWeapons.indexOf(w)
  if (i >= 0) room.worldWeapons.splice(i, 1)
  broadcast(room, { t: MsgType.WorldWeaponRemove, id: w.id })
}

function nearestPickable(room: Room, p: Player, nowMs: number): WorldWeapon | null {
  const s = p.state.pos
  let best: WorldWeapon | null = null
  let bestD: number = WORLD_WEAPON.pickupRadius
  for (const w of room.worldWeapons) {
    if (w.lockOwner === p.id && nowMs < w.lockUntilMs) continue
    if (Math.abs(w.pos[1] - s[1]) > WORLD_WEAPON.pickupHeight) continue
    if (!canPickUp(p.loadout, WEAPONS[w.weaponId])) continue
    const d = Math.hypot(w.pos[0] - s[0], w.pos[2] - s[2])
    if (d < bestD) { bestD = d; best = w }
  }
  return best
}

const rayO: Vec3 = [0, 0, 0]
const rayD: Vec3 = [0, 0, 0]

// Điểm đặt vật vứt: đi ngang ngực theo hướng nhìn (dừng trước tường), rồi thả xuống sàn
function dropPoint(room: Room, p: Player, out: Vec3): void {
  const s = p.state
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw)
  let reach: number = WORLD_WEAPON.dropForward
  const world = anyWorld(room, p)
  if (world) {
    rayO[0] = s.pos[0]; rayO[1] = s.pos[1] + CHEST; rayO[2] = s.pos[2]
    rayD[0] = fx; rayD[1] = 0; rayD[2] = fz
    const hit = world.castRay(rayO, rayD, reach + WORLD_WEAPON.dropWallGap)
    if (hit) reach = Math.max(0, hit.dist - WORLD_WEAPON.dropWallGap)
  }
  out[0] = s.pos[0] + fx * reach; out[1] = s.pos[1]; out[2] = s.pos[2] + fz * reach
  if (world) {
    rayO[0] = out[0]; rayO[1] = s.pos[1] + CHEST; rayO[2] = out[2]
    rayD[0] = 0; rayD[1] = -1; rayD[2] = 0
    const hit = world.castRay(rayO, rayD, CHEST + FLOOR_PROBE)
    if (hit) out[1] = rayO[1] - hit.dist
  }
}

const dropPos: Vec3 = [0, 0, 0]

/** Cạnh lên của G: có vật trong tầm và nhặt được thì nhặt, không thì vứt vũ khí đang cầm. nowMs = thang seq của cmd (như stepWeaponCmd). */
export function handleInteract(room: Room, p: Player, nowMs: number): void {
  if (!p.alive || p.hp <= 0 || p.zstats || p.downed) return
  const ws = p.weapon
  const item = nearestPickable(room, p, room.serverNow)
  if (item) {
    const def = WEAPONS[item.weaponId]!
    removeWorldWeapon(room, item)
    p.loadout = applyPickUp(p.loadout, def)
    ws.slots = loadoutWeaponIds(p.loadout)
    ws.ammo[def.id] = item.ammo
    const slot = CATEGORY_SLOT[def.category]
    selectSlot(ws, slot, nowMs)
    afterSwap(p, nowMs)
    p.transport.send({ t: MsgType.PickupResult, action: 'pick', slot })
    return
  }
  const slot = ws.slot
  if (!canDrop(p.loadout, slot)) return
  const dropped = applyDrop(p.loadout, slot)!
  p.loadout = dropped.loadout
  dropPoint(room, p, dropPos)
  spawnWorldWeapon(room, dropped.weapon.id, dropPos, p.state.yaw, ws.ammo[dropped.weapon.id] ?? 0,
    room.serverNow + WORLD_WEAPON.despawnMs, p.id, room.serverNow + WORLD_WEAPON.dropLockMs)
  ws.slots = loadoutWeaponIds(p.loadout)
  selectSlot(ws, 0, nowMs)   // ô 1 luôn có dao
  afterSwap(p, nowMs)
  p.transport.send({ t: MsgType.PickupResult, action: 'drop', slot: 0 })
}

// Sau khi đổi tay cầm: huỷ chiêu đang chạy, khựng ngắn để không bắn / chém ngay
function afterSwap(p: Player, nowMs: number): void {
  const ws = p.weapon
  resetMelee(ws)
  p.sweep = null
  ws.triggerHeld = false
  ws.nextFireMs = Math.max(ws.nextFireMs, nowMs + WORLD_WEAPON.interactLockMs)
}

/** Xoá vật hết hạn (mỗi tick) */
export function stepWorldWeapons(room: Room): void {
  if (room.worldWeapons.length === 0) return
  for (let i = room.worldWeapons.length - 1; i >= 0; i--) {
    const w = room.worldWeapons[i]!
    if (room.serverNow >= w.despawnAtMs) removeWorldWeapon(room, w)
  }
}
