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
