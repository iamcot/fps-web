// Nền zombie dùng chung cho Lây Nhiễm (plan 16) và Thủ Thành (plan 17). Thuần, không import Three.js/DOM.
import { defaultMovement, type MovementConfig } from './movement'
import { weaponByKey } from './weapons'

export type Role = 'human' | 'zombie'

export const ZOMBIE = {
  /** Bò qua lỗ bắn: ngồi thấp hơn người (1,2m) nên chui lọt */
  crouchHeight: 0.85,
  eyeCrouch: 0.7,
  /** Mỗi lần nhảy khỏi đất mất ngần này tốc độ ngang (chống bunny hop) */
  hopPenalty: 0.3,
  /** Chiêu E: vel.y 13.8 (đỉnh ≈ 4,3m), +5 m/s theo hướng nhìn, hồi 8s */
  leap: { velY: 13.8, forward: 5, cooldownMs: 8000 },
  /** Cào mạnh: trúng sau windup, damage × mult. Cào hụt nếu nạn nhân lùi ra khỏi tầm trong lúc vung */
  heavyWindupMs: 300,
  heavyDamageMult: 2,
  /** Đẩy lùi khi trúng đạn (impulse = damage × k × (1 − knockbackResist)) */
  knockbackPerDamage: { shotgun: 0.06, sniper: 0.05, rulo: 0.05, ak47: 0.025, m16: 0.02, smg: 0.015, colt: 0.02 } as Readonly<Record<string, number>>,
  knockbackUp: 0.25,        // thành phần lên = impulse × hệ số này
  knockbackMaxHSpeed: 14,   // kẹp tổng vận tốc ngang sau khi đẩy
  knockbackAirMult: 1.5,    // đang trên không bị đẩy mạnh hơn
  regenDelayMs: 4000,       // không trúng đạn trong ngần này thì mới hồi máu
} as const

/** Thông số một zombie cụ thể (Lây Nhiễm: theo loại mother/normal; Thủ Thành: theo zombieTypes.json) */
export interface ZombieStats {
  type: string
  hpMax: number
  runSpeed: number
  clawDamage: number
  knockbackResist: number
  regenPerSec: number
  windupMs?: number     // vuốt thường báo trước chừng này ms rồi mới trúng (zombie NPC của Thủ Thành: 250)
  headMult?: number     // hệ số đầu cố định thay cho hệ số của súng (zombie Thủ Thành: 2, boss 3)
  scale?: number        // cỡ hitbox so với người (boss 2.2)
  shoveSpeed?: number   // cào trúng người thì đẩy người lùi chừng này m/s (brute)
}

// Cấu hình di chuyển của zombie: cache theo (cfg người, runSpeed) để không cấp phát mỗi tick
const cache = new WeakMap<MovementConfig, Map<number, MovementConfig>>()
export function zombieMovement(base: MovementConfig, runSpeed: number): MovementConfig {
  let m = cache.get(base)
  if (!m) { m = new Map(); cache.set(base, m) }
  let c = m.get(runSpeed)
  if (!c) {
    c = {
      ...base,
      runSpeed,
      crouchSpeed: Math.min(base.crouchSpeed, runSpeed),   // zombie chậm (bò) không nhanh hơn khi ngồi
      crouchHeight: ZOMBIE.crouchHeight,
      eyeCrouch: ZOMBIE.eyeCrouch,
      slideMinSpeed: Infinity,   // không trượt
      leap: ZOMBIE.leap,
      hopPenalty: ZOMBIE.hopPenalty,
    }
    m.set(runSpeed, c)
  }
  return c
}

// Người nhanh hơn (anh hùng ×1.1): cache riêng, cùng lý do
const humanCache = new WeakMap<MovementConfig, Map<number, MovementConfig>>()
function scaledHuman(base: MovementConfig, speedMul: number): MovementConfig {
  let m = humanCache.get(base)
  if (!m) { m = new Map(); humanCache.set(base, m) }
  let c = m.get(speedMul)
  if (!c) { c = { ...base, runSpeed: base.runSpeed * speedMul }; m.set(speedMul, c) }
  return c
}

/** Cấu hình di chuyển cho một người chơi: zombie có cấu hình riêng, anh hùng chạy nhanh hơn. Server và client phải gọi như nhau. */
export function movementFor(base: MovementConfig, zombie: { runSpeed: number } | null | undefined, speedMul = 1): MovementConfig {
  if (zombie) return zombieMovement(base, zombie.runSpeed * speedMul)
  return speedMul === 1 ? base : scaledHuman(base, speedMul)
}

/** Mặc định cho test / chỗ chưa biết loại zombie */
export const ZOMBIE_DEFAULT_RUN_SPEED = 9.5
export const zombieDefaultMovement: MovementConfig = zombieMovement(defaultMovement, ZOMBIE_DEFAULT_RUN_SPEED)

/** Vận tốc đẩy lùi cộng thêm cho zombie bị bắn bởi súng `weaponKey` gây `damage`; ghi vào out = [vx, vy, vz] (dir ngang là vector đơn vị người bắn → zombie) */
export function knockbackImpulse(out: [number, number, number], weaponKey: string, damage: number, resist: number, dirX: number, dirZ: number, airborne: boolean): void {
  const k = ZOMBIE.knockbackPerDamage[weaponKey] ?? 0
  const imp = damage * k * (1 - resist) * (airborne ? ZOMBIE.knockbackAirMult : 1)
  out[0] = dirX * imp; out[1] = imp * ZOMBIE.knockbackUp; out[2] = dirZ * imp
}

/** Cộng impulse vào vận tốc rồi kẹp tốc độ ngang ≤ knockbackMaxHSpeed */
export function applyKnockback(vel: [number, number, number], imp: readonly [number, number, number]): void {
  vel[0] += imp[0]; vel[1] += imp[1]; vel[2] += imp[2]
  const h = Math.hypot(vel[0], vel[2])
  if (h > ZOMBIE.knockbackMaxHSpeed) { const k = ZOMBIE.knockbackMaxHSpeed / h; vel[0] *= k; vel[2] *= k }
}

export function isClawKey(key: string): boolean { return weaponByKey(key)?.category === 'claw' }

/**
 * Chiêu E bật từ ĐỨNG YÊN (vận tốc ngang 0 → chỉ còn đà `forward`): thời gian bay và quãng ngang đi được tới khi rơi xuống độ cao `dy`
 * so với chỗ bật (mô phỏng đúng từng tick như stepMovement: gravity trừ trước khi dịch chuyển). null = không lên tới độ cao đó.
 * Nav (cạnh nhảy) và bộ não zombie dùng chung để bật đúng chỗ.
 */
export function leapFlight(dy: number, gravity = defaultMovement.gravity, dt = 1 / 60): { time: number; dist: number } | null {
  let y = 0, vy: number = ZOMBIE.leap.velY, ticks = 0, reached = dy <= 0
  while (ticks < 600) {
    vy -= gravity * dt
    y += vy * dt
    ticks++
    if (y >= dy) reached = true
    if (reached && vy < 0 && y <= dy) return { time: ticks * dt, dist: ZOMBIE.leap.forward * ticks * dt }
    if (vy < 0 && y < Math.min(dy, 0) - 1) return null
  }
  return null
}
/** Độ cao đỉnh của chiêu E so với chỗ bật */
export function leapApex(gravity = defaultMovement.gravity): number { return ZOMBIE.leap.velY * ZOMBIE.leap.velY / (2 * gravity) }

// ── Hình dáng zombie (ZF.1): mỗi zombie chọn ngẫu nhiên (theo id, tất định) một model + tint + cỡ lệch ±6%.
// `models` rỗng (chưa build glb zombie) → client dùng model Cớm/Cướp của người đó + tint (xem plan 16, ZF.1).
import zombieModelsRaw from './zombieModels.json'
import { hashSeed, mulberry32 } from './math'

export interface ZombieModelDef { id: string; file: string; scale: number; eyeBone: string; eyeOffset: [number, number, number] }
export interface ZombieLookDef {
  models: ZombieModelDef[]
  /** id model riêng của zombie mẹ (Lây Nhiễm); không nằm trong lượt chọn ngẫu nhiên của zombie thường */
  motherModel?: string
  variation: { scaleJitter: number; tints: string[]; tintStrength: number; infectedTint: string; infectedTintStrength: number; eyeGlow: string }
}
export const ZOMBIE_LOOK: ZombieLookDef = zombieModelsRaw as ZombieLookDef

export interface ZombieVariation { model: ZombieModelDef | null; scale: number; tint: string; tintStrength: number }

/**
 * Biến thể của zombie `id`. `fromHuman`: zombie do người bị lây (dùng model Cớm/Cướp, tint xanh xám cố định);
 * `tintOverride` (Thủ Thành: màu theo loại) thay tint ngẫu nhiên. `modelOverride` gán riêng model cho một loại.
 */
export function zombieVariation(id: number, opts: { fromHuman?: boolean; tintOverride?: string | null; modelOverride?: string | null } = {}): ZombieVariation {
  const v = ZOMBIE_LOOK.variation
  const rng = mulberry32(hashSeed(id, 0x2b1e))
  const scale = 1 + (rng() * 2 - 1) * v.scaleJitter
  const tintPick = v.tints[Math.floor(rng() * v.tints.length)] ?? '#9fb59a'
  const pool = ZOMBIE_LOOK.models.filter(m => m.id !== ZOMBIE_LOOK.motherModel)
  const modelPick = pool.length > 0 ? pool[Math.floor(rng() * pool.length)]! : null
  if (opts.fromHuman) {   // người bị lây giữ model của mình; riêng mẹ (modelOverride) có model zombie riêng, ít ngả màu để còn thấy texture gốc
    const own = opts.modelOverride ? ZOMBIE_LOOK.models.find(m => m.id === opts.modelOverride) ?? null : null
    return { model: own, scale, tint: v.infectedTint, tintStrength: own ? v.infectedTintStrength * 0.4 : v.infectedTintStrength }
  }
  const model = opts.modelOverride ? ZOMBIE_LOOK.models.find(m => m.id === opts.modelOverride) ?? modelPick : modelPick
  return { model, scale, tint: opts.tintOverride ?? tintPick, tintStrength: opts.tintOverride ? Math.max(v.tintStrength, 0.5) : v.tintStrength }
}
