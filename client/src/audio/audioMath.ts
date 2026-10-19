// Hàm thuần của hệ thống âm thanh (không đụng Web Audio) — để test được.

export const dbToGain = (db: number): number => Math.pow(10, db / 20)

/** Chọn ngẫu nhiên một phần tử, tránh `last` nếu còn ≥ 2 lựa chọn. */
export function pickNoRepeat<T>(items: T[], last: T | undefined, rnd: () => number): T | undefined {
  if (items.length === 0) return undefined
  if (items.length === 1) return items[0]
  let i = Math.floor(rnd() * items.length)
  if (items[i] === last) i = (i + 1 + Math.floor(rnd() * (items.length - 1))) % items.length
  return items[i]
}

/** Giá trị ngẫu nhiên trong [-amp, +amp]. */
export const randSpread = (amp: number, rnd: () => number = Math.random): number => (rnd() * 2 - 1) * amp

// ── Cảnh báo sắp hết đạn ──────────────────────────────────────────────────────
export const LOW_AMMO_FRACTION = 0.25

/** `ammoLeft` là số đạn còn lại SAU phát vừa bắn. */
export const lowAmmoActive = (ammoLeft: number, magSize: number): boolean =>
  ammoLeft <= magSize * LOW_AMMO_FRACTION

/** pitchFactor = 1 + 0.6 * (1 − ammoLeft / (magSize * 0.25)) */
export const lowAmmoPitchFactor = (ammoLeft: number, magSize: number): number =>
  1 + 0.6 * (1 - ammoLeft / (magSize * LOW_AMMO_FRACTION))

// ── Reload ────────────────────────────────────────────────────────────────────
/** Thời điểm (tỉ lệ 0..1) của n tiếng nhét đạn rải đều trong [from, to]. */
export function reloadInsertTimes(n: number, from: number, to: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [(from + to) / 2]
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / (n - 1))
  return out
}

// ── Súng người khác ───────────────────────────────────────────────────────────
/** Cutoff lowpass theo khoảng cách: càng xa càng đục, tối thiểu 1500Hz. */
export const distanceCutoff = (d: number): number => Math.max(1500, 18000 * Math.pow(0.5, d / 15))

// ── Tiếng trúng ───────────────────────────────────────────────────────────────
export const COMBO_WINDOW_MS = 400
export const COMBO_STEP = 0.03
export const COMBO_MAX = 0.15
export const DEDUPE_MS = 30

/** Trúng liên tiếp trong 400ms: mỗi lần +3% cao độ, tối đa +15%. */
export class ComboTracker {
  private count = 0
  private lastMs = -Infinity
  /** Gọi mỗi lần thực sự phát tiếng trúng; trả hệ số cao độ. */
  hit(nowMs: number): number {
    this.count = nowMs - this.lastMs <= COMBO_WINDOW_MS ? this.count + 1 : 0
    this.lastMs = nowMs
    return 1 + Math.min(COMBO_MAX, COMBO_STEP * this.count)
  }
}

/** Nhiều sự kiện trong 30ms chỉ phát 1: sự kiện sau chỉ được phát nếu "nặng" hơn hẳn. */
export class HitDeduper {
  private lastMs = -Infinity
  private lastWeight = 0
  accept(nowMs: number, weight: number): boolean {
    if (nowMs - this.lastMs < DEDUPE_MS && weight <= this.lastWeight) return false
    this.lastMs = nowMs
    this.lastWeight = weight
    return true
  }
}

// ── Bước chân ─────────────────────────────────────────────────────────────────
export type StepEvent = 'step' | 'land' | null

/**
 * Quyết định lúc nào phát bước chân / tiếp đất. Mỗi `stepDist` mét đi trên mặt đất một bước;
 * không có bước khi trượt hoặc trên không. Tiếp đất khi vận tốc rơi (tick trước đó) > landSpeed.
 * Lần chạm đất đầu tiên (rơi từ điểm spawn) bị bỏ qua.
 */
export class StepTracker {
  private acc = 0
  private airVy = 0
  private wasGrounded = false
  private armed = false

  update(
    grounded: boolean, vy: number, speedXZ: number, sliding: boolean, dt: number,
    stepDist: number, landSpeed: number, minSpeed: number,
  ): StepEvent {
    if (!grounded) {
      this.airVy = vy
      this.wasGrounded = false
      return null
    }
    if (!this.wasGrounded) {
      this.wasGrounded = true
      const wasArmed = this.armed
      this.armed = true
      if (wasArmed && -this.airVy > landSpeed) { this.acc = 0; return 'land' }
    }
    if (sliding || speedXZ <= minSpeed) return null
    this.acc += speedXZ * dt
    if (this.acc >= stepDist) { this.acc -= stepDist; return 'step' }
    return null
  }
}
