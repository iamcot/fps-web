import { lerp } from './math'
import type { MovementConfig, PlayerState } from './movement'
import type { WeaponDef, WeaponState } from './weapons'

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const smoothstep = (t: number): number => t * t * (3 - 2 * t)

/** Bloom của súng `def` tại thời điểm nowMs (thang seq): hồi sau bloomRecoverDelayMs kể từ phát gần nhất. */
export function currentBloom(ws: WeaponState, def: WeaponDef, nowMs: number): number {
  const sp = def.spread
  const dt = Math.max(0, (nowMs - ws.lastShotMs[def.id]! - sp.bloomRecoverDelayMs) / 1000)
  return Math.max(0, ws.bloomDeg[def.id]! - sp.bloomRecoverDegPerSec * dt)
}

/**
 * Độ toé (nửa góc nón, độ) của súng `def` ngay lúc này. Thuần: chỉ đọc state + nowMs (không đọc đồng hồ thật).
 * `forShot` = lấy bloom đã dùng cho phát vừa bắn (ws.shotBloomDeg) thay vì bloom hiện tại, để viên đầu không dính bloom của chính nó.
 */
export function computeSpreadDeg(p: PlayerState, ws: WeaponState, def: WeaponDef, cfg: MovementConfig, nowMs: number, forShot = false): number {
  const s = def.spread
  const ads = def.ads
  const adsT = p.adsT
  const lowStance = p.crouching || p.slideTimer > 0
  let deg = lowStance ? s.crouchDeg : s.standDeg
  if (!p.grounded) {
    deg += s.airDeg
  } else {
    const speed = Math.hypot(p.vel[0], p.vel[2])
    // Tốc độ chạy hết tốc của súng này (đã nhân moveSpeedMul và hệ số ngắm) → t = 1
    const runMax = cfg.runSpeed * def.moveSpeedMul * (ads ? lerp(1, ads.moveMult, adsT) : 1)
    const t = clamp01((speed - s.accurateSpeed) / Math.max(1e-3, runMax - s.accurateSpeed))
    deg += s.moveDeg * smoothstep(t)
  }
  deg += forShot ? ws.shotBloomDeg : currentBloom(ws, def, nowMs)
  if (s.unscopedDeg !== undefined) return lerp(s.unscopedDeg, deg, adsT)   // sniper: không ngắm = cố định, ngắm hẳn = công thức thường
  return ads ? deg * lerp(1, ads.spreadMult, adsT) : deg
}

/** Gọi khi vừa bắn một phát: nhớ bloom đã dùng cho phát này rồi cộng bloom của nó. nowMs = thời điểm phát bắn (thang seq). */
export function onShotBloom(ws: WeaponState, def: WeaponDef, nowMs: number): void {
  const before = currentBloom(ws, def, nowMs)
  ws.shotBloomDeg = before
  ws.bloomDeg[def.id] = Math.min(def.spread.bloomMaxDeg, before + def.spread.bloomPerShotDeg)
  ws.lastShotMs[def.id] = nowMs
}
