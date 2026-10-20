import {
  GRENADE, GRENADE_ID, MsgType, TICK_RATE, DT, consumeGrenade, defaultMovement, loadoutWeaponIds, stepGrenade, throwInitial,
  type GrenadeState, type MovementConfig, type ThrowMode, type TeamId, type Vec3,
} from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import type { Player, Room } from './room'

// Lựu đạn phía server (plan 12, G.3). Vật lý tất định (shared/grenadePhysics) chạy trên world của một người trong phòng
// (castSphere chỉ chạm map nên world nào cũng như nhau). Nổ quyết định sát thương; client tự mô phỏng quỹ đạo từ GrenadeSpawn.
export interface RoomGrenade extends GrenadeState {
  explodeTick: number
}

const FUSE_TICKS = Math.round(GRENADE.fuseMs * TICK_RATE / 1000)
const OCCLUSION_EPS = 0.05    // tia chạm tường cách đích dưới mức này vẫn coi là không bị che
const CENTER_LIFT = 0.1       // nâng tâm nổ khi bắn tia che chắn (không bắn xuyên sàn ngay dưới quả)
const CHEST = 1.1, FEET = 0.15   // độ cao điểm ngực/chân so với chân người (đứng); ngồi nhân tỉ lệ

function anyWorld(room: Room, prefer?: Player): CollisionWorld | null {
  if (prefer?.world) return prefer.world
  for (const p of room.players.values()) if (p.world) return p.world
  return null
}

export function createGrenade(room: Room, ownerId: number, team: TeamId, pos: Vec3, vel: Vec3, mode: ThrowMode, throwSeq: number): RoomGrenade {
  const g: RoomGrenade = {
    id: room.nextGrenadeId++, ownerId, team,
    pos: [pos[0], pos[1], pos[2]], vel: [vel[0], vel[1], vel[2]],
    spawnTick: room.tick, resting: false,
    explodeTick: room.tick + FUSE_TICKS,
  }
  room.grenades.push(g)
  const msg = { t: MsgType.GrenadeSpawn, id: g.id, ownerId, mode, pos: [pos[0], pos[1], pos[2]] as Vec3, vel: [vel[0], vel[1], vel[2]] as Vec3, spawnTick: g.spawnTick, throwSeq }
  for (const o of room.players.values()) o.transport.send(msg)
  return g
}

/** Người chơi vừa ném (stepWeaponCmd trả 'threw'; state đã là sau cmd): tạo quả, trừ lựu đạn trong loadout. */
export function spawnThrown(room: Room, p: Player, mode: ThrowMode, cfg: MovementConfig = defaultMovement): void {
  const world = anyWorld(room, p)
  if (!world) return
  const t = throwInitial(p.state, mode, world, cfg)
  p.loadout = consumeGrenade(p.loadout)
  createGrenade(room, p.id, p.team, t.pos, t.vel, mode, p.weapon.throwSeq)
}

/** Chết khi đang rút chốt: ready → lựu đạn rơi tại chỗ (vận tốc người chết) và vẫn nổ; pulling → huỷ. Gọi trước khi mất đồ. */
export function dropOnDeath(room: Room, p: Player): void {
  const n = p.weapon.nade
  if (n.phase === 'idle') return
  const wasReady = n.phase === 'ready'
  n.phase = 'idle'; n.quick = false
  if (wasReady) {
    p.weapon.ammo[GRENADE_ID] = Math.max(0, (p.weapon.ammo[GRENADE_ID] ?? 0) - 1)
    p.weapon.throwSeq++
    p.loadout = consumeGrenade(p.loadout)
    p.weapon.slots = loadoutWeaponIds(p.loadout)
    const s = p.state
    createGrenade(room, p.id, p.team, [s.pos[0], s.pos[1] + 1.0, s.pos[2]], [s.vel[0], s.vel[1], s.vel[2]], n.mode, p.weapon.throwSeq)
    for (const o of room.players.values()) o.transport.send({ t: MsgType.GrenadeAnim, playerId: p.id, phase: 'throw', mode: n.mode })
  } else {
    for (const o of room.players.values()) o.transport.send({ t: MsgType.GrenadeAnim, playerId: p.id, phase: 'cancel' })
  }
}

export function stepGrenades(room: Room): void {
  if (room.grenades.length === 0) return
  for (let i = room.grenades.length - 1; i >= 0; i--) {
    const g = room.grenades[i]!
    if (room.tick > g.spawnTick) {   // quả vừa ném trong tick này: bước đầu tiên ở tick sau (client tua nhanh từ spawnTick giống hệt)
      const world = anyWorld(room, room.players.get(g.ownerId))
      if (world) stepGrenade(g, world, DT)
    }
    if (room.tick >= g.explodeTick) {
      room.grenades.splice(i, 1)
      explode(room, g)
    }
  }
}

/** Sát thương theo khoảng cách tới ngực: đầy trong innerRadius, giảm tuyến tính về 0 ở outerRadius */
export function baseDamage(d: number): number {
  if (d <= GRENADE.innerRadius) return GRENADE.damageMax
  if (d >= GRENADE.outerRadius) return 0
  return GRENADE.damageMax * (1 - (d - GRENADE.innerRadius) / (GRENADE.outerRadius - GRENADE.innerRadius))
}

const origin: Vec3 = [0, 0, 0]
const target: Vec3 = [0, 0, 0]
const dir: Vec3 = [0, 0, 0]

// Tỉ lệ phần thân không bị tường che: 3 tia (đầu, ngực, chân) từ tâm nổ (nâng lên 0,1m), chỉ tính map
function exposure(world: CollisionWorld | null, center: Vec3, x: number, y: number, z: number, crouching: boolean, cfg: MovementConfig): number {
  if (!world) return 1
  const sc = crouching ? cfg.crouchHeight / cfg.standHeight : 1
  const ys = [y + (crouching ? cfg.eyeCrouch : cfg.eyeStand), y + CHEST * sc, y + FEET * sc]
  origin[0] = center[0]; origin[1] = center[1] + CENTER_LIFT; origin[2] = center[2]
  let seen = 0
  for (const ty of ys) {
    target[0] = x; target[1] = ty; target[2] = z
    const dx = target[0] - origin[0], dy = target[1] - origin[1], dz = target[2] - origin[2]
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) { seen++; continue }
    dir[0] = dx / len; dir[1] = dy / len; dir[2] = dz / len
    const hit = world.castRay(origin, dir, len)
    if (!hit || hit.dist >= len - OCCLUSION_EPS) seen++
  }
  return seen / ys.length
}

/** Nổ tại `pos`: áp sát thương + đẩy lùi cho người chơi, báo cả phòng. Trả danh sách (id, sát thương đã áp). */
export function explode(room: Room, g: Pick<RoomGrenade, 'id' | 'ownerId' | 'team' | 'pos'>, cfg: MovementConfig = defaultMovement): { id: number; damage: number }[] {
  const world = anyWorld(room, room.players.get(g.ownerId))
  const owner = room.players.get(g.ownerId)
  const hits: { id: number; damage: number }[] = []
  for (const p of room.players.values()) {
    if (!p.alive || p.hp <= 0) continue
    const self = p.id === g.ownerId
    if (!self && p.team === g.team && !room.rules.friendlyFire) continue
    const s = p.state
    const sc = s.crouching ? cfg.crouchHeight / cfg.standHeight : 1
    const cx = s.pos[0], cy = s.pos[1] + CHEST * sc, cz = s.pos[2]
    const dx = cx - g.pos[0], dy = cy - g.pos[1], dz = cz - g.pos[2]
    const d = Math.hypot(dx, dy, dz)
    const base = baseDamage(d)
    if (base <= 0) continue
    const expo = exposure(world, g.pos, s.pos[0], s.pos[1], s.pos[2], s.crouching, cfg)
    const damage = Math.round(base * expo * (self ? GRENADE.selfDamageMult : 1))
    if (damage <= 0 || room.serverNow < p.invulnUntil) continue
    p.hp -= damage
    if (p.hp <= 0) { p.killerId = owner ? g.ownerId : -1; p.killWeapon = GRENADE_ID; p.killHeadshot = false }
    hits.push({ id: p.id, damage })
    p.transport.send({ t: MsgType.Hurt, origin: [g.pos[0], g.pos[1], g.pos[2]], damage })
    if (GRENADE.knockback > 0 && d > 1e-6) {
      const k = GRENADE.knockback * base / GRENADE.damageMax / d
      s.vel[0] += dx * k; s.vel[1] += Math.max(1, dy * k); s.vel[2] += dz * k
    }
  }
  const msg = { t: MsgType.GrenadeExplode, id: g.id, pos: [g.pos[0], g.pos[1], g.pos[2]] as Vec3, hits }
  for (const o of room.players.values()) o.transport.send(msg)
  return hits
}
