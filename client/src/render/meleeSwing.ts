// Động tác viewmodel của dao theo chiêu (plan 19, P4): keyframe cho từng chiêu của KNIFE_SET, đỡ, choáng, phản ứng khi đỡ trúng.
// Thuần hình ảnh (không import Three.js/DOM, không cấp phát trong update): cho ra độ lệch `fx` cộng lên gunGroup như KnifeAnim.
// Thời gian lấy từ chính dữ liệu chiêu (windup, strikeMs, hitIntervalMs...) nên khớp cửa sổ quét của server.
import { KNIFE_SET, moveDurationMs, type MeleeMove } from '@fps/shared'

const TAU = Math.PI * 2

/** [px, py, pz, rx, ry, rz]: mét / radian, cộng lên tư thế nghỉ của gunGroup. +px phải, +py lên, +pz về phía camera, +rx ngóc mũi, +ry quay mũi sang trái, +rz lăn lưỡi */
export type Pose = readonly [number, number, number, number, number, number]
const REST: Pose = [0, 0, 0, 0, 0, 0]

export interface SwingStyle { wind: Pose; hit: Pose; perHit?: Pose }

/** Tư thế cao điểm của từng chiêu: `wind` = lúc gồng (tới đúng giờ nhát đánh), `hit` = cuối cung quét */
export const SWING_STYLES: Record<string, SwingStyle> = {
  knife_l1:   { wind: [-0.12, 0, 0.02, 0, 1.4, 0], hit: [0.14, -0.03, -0.1, 0, -1.7, 0] },            // chém ngang trái → phải
  knife_l2:   { wind: [0.14, -0.03, 0, 0, -1.6, 0], hit: [-0.12, 0, -0.1, 0, 1.4, 0] },                 // chém ngược phải → trái
  knife_l3:   { wind: [0, -0.02, 0.08, 0, 0, 0], hit: [0, 0, -0.28, 0, 0, 0] },                                        // đâm liên hoàn: giật tay rồi phóng
  knife_llr:  { wind: [0, 0.22, 0.06, 0.9, 0, 0.1], hit: [0, -0.08, -0.22, -0.9, 0, 0] },                              // giơ cao rồi giáng xuống
  knife_spin: { wind: [-0.16, 0, 0.05, 0, 1.5, -0.6], hit: [0.16, 0, -0.1, 0, -1.8, 0.6 + TAU] },                 // bão dao: quét hết tầm nhìn, lăn một vòng
  knife_lr:   { wind: [0.05, 0.2, 0.05, 0.8, 0, -0.2], hit: [-0.03, -0.08, -0.22, -0.8, 0, 0.1] },
  knife_rise: { wind: [0.06, -0.2, 0, -0.9, 0, 0.2], hit: [-0.02, 0.18, -0.2, 1.0, 0, -0.1] },                         // khoét từ thấp lên cao
  knife_r1:   { wind: [0.02, 0.2, 0.08, 0.9, 0, Math.PI], hit: [0, 0, -0.22, -0.55, 0, Math.PI] },                   // lật cầm ngược, đâm xuống
  knife_rr:   { wind: [0.03, 0.2, 0.06, 0.9, 0, 0.5], hit: [0, -0.02, -0.2, -0.6, 0, 0.5 + TAU], perHit: [0, 0, 0, 0, 0, TAU] },   // xoáy: mỗi nhát lăn thêm một vòng
  knife_flip: { wind: [0.14, -0.05, 0, 0.2, -1.4, 0.3], hit: [-0.12, 0.02, -0.1, 0.1, 1.3, -0.3] },
}

export const GUARD_POSE: Pose = [0.04, 0.09, -0.12, 0.05, 1.3, 0.1]       // lưỡi ngang trước mặt
export const STAGGER_POSE: Pose = [0, -0.06, 0.04, 0.35, 0, 0.2]            // dao tụt xuống, mũi ngóc lên
const BLOCK_KICK: Pose = [0, 0.02, 0.08, 0.12, 0, 0]                        // giật lại khi đỡ trúng
const PARRY_KICK: Pose = [0, 0.04, -0.1, -0.25, 0.3, 0.15]                  // gạt ra khi parry thành công

const CANCEL_TAU = 0.07   // s: về tư thế nghỉ khi chiêu bị huỷ
const STATE_TAU = 0.06    // s: vào/ra tư thế đỡ, choáng
const KICK_TAU = 0.09

export interface SwingFx { px: number; py: number; pz: number; rx: number; ry: number; rz: number }

interface Key { t: number; p: Pose; strike: boolean }

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v }
function smooth(x: number): number { return x * x * (3 - 2 * x) }
function easeOut(x: number): number { const k = 1 - x; return 1 - k * k * k }

/** Dựng keyframe một chiêu từ dữ liệu của nó: nghỉ → gồng (tới windupMs) → quét (strikeMs) → [các nhát sau] → về nghỉ (tới hết chiêu) */
export function buildKeys(m: MeleeMove, style: SwingStyle): Key[] {
  const keys: Key[] = [{ t: 0, p: REST, strike: false }]
  const d = style.perHit ?? REST
  for (let i = 0; i < m.hitCount; i++) {
    const t = m.windupMs + i * m.hitIntervalMs
    const w = style.wind.map((v, k) => v + d[k]! * i) as unknown as Pose
    const h = style.hit.map((v, k) => v + d[k]! * i) as unknown as Pose
    keys.push({ t, p: w, strike: false })
    keys.push({ t: t + m.strikeMs, p: h, strike: true })
  }
  // Về nghỉ ở cuối chiêu. Góc lăn về bội 2π gần nhất (cú lật cầm ngược / xoáy hoàn tất vòng thay vì tua ngược)
  const lastRz = style.hit[5]! + d[5]! * (m.hitCount - 1)
  keys.push({ t: moveDurationMs(m), p: [0, 0, 0, 0, 0, Math.round(lastRz / TAU) * TAU], strike: false })
  return keys
}

export class MeleeSwing {
  readonly fx: SwingFx = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }

  private readonly keys: Key[][] = KNIFE_SET.moves.map(m => buildKeys(m, SWING_STYLES[m.key] ?? { wind: REST, hit: REST }))
  private readonly durations: number[] = KNIFE_SET.moves.map(m => moveDurationMs(m))
  private move = -1
  private t = 0                 // ms từ lúc bắt đầu chiêu
  // Phần bị huỷ đang hồi về nghỉ
  private readonly fade: number[] = [0, 0, 0, 0, 0, 0]
  // Đỡ / choáng (0..1 mượt) và cú giật phản ứng
  private guardW = 0
  private staggerW = 0
  private guardOn = false
  private staggerOn = false
  private readonly kick: number[] = [0, 0, 0, 0, 0, 0]
  private readonly cur: number[] = [0, 0, 0, 0, 0, 0]

  get active(): boolean { return this.move >= 0 }
  get moveIdx(): number { return this.move }
  /** Tiến độ chiêu 0..1 */
  get progress(): number { return this.move < 0 ? 0 : clamp01(this.t / this.durations[this.move]!) }

  /** Bắt đầu chiêu `idx` (tick logic báo 'meleeStart'). Chiêu trước còn dở thì để nó mờ dần về nghỉ */
  start(idx: number): void {
    if (idx < 0 || idx >= this.keys.length) return
    if (this.move >= 0) this.captureFade()
    this.move = idx; this.t = 0
  }

  /** Chiêu bị cắt (choáng, parry, đổi vũ khí): mờ dần từ tư thế hiện tại về nghỉ */
  cancel(): void {
    if (this.move < 0) return
    this.captureFade()
    this.move = -1
  }

  /** Tắt hết ngay (đổi vũ khí) */
  reset(): void {
    this.move = -1; this.guardW = this.staggerW = 0; this.guardOn = this.staggerOn = false
    for (let i = 0; i < 6; i++) this.fade[i] = this.kick[i] = 0
  }

  /** Mỗi tick logic: trạng thái đỡ / choáng + chiêu có còn đang chạy bên logic không (đồng bộ để huỷ khi bị cắt giữa chừng) */
  sync(guard: boolean, stagger: boolean, moveActive: boolean): void {
    this.guardOn = guard; this.staggerOn = stagger
    if (this.move >= 0 && !moveActive && this.t < this.durations[this.move]! - 40) this.cancel()
  }

  /** Phản ứng khi đỡ trúng (blocked) hoặc parry thành công */
  react(kind: 'block' | 'parry'): void {
    const k = kind === 'parry' ? PARRY_KICK : BLOCK_KICK
    for (let i = 0; i < 6; i++) this.kick[i] = k[i]!
  }

  private captureFade(): void {
    this.sampleMove(this.fade)
  }

  private sampleMove(out: number[]): void {
    const keys = this.keys[this.move]!
    const t = this.t
    let i = 1
    while (i < keys.length - 1 && t > keys[i]!.t) i++
    const a = keys[i - 1]!, b = keys[i]!
    const span = b.t - a.t
    const x = span <= 0 ? 1 : clamp01((t - a.t) / span)
    const e = b.strike ? easeOut(x) : smooth(x)
    for (let k = 0; k < 6; k++) out[k] = a.p[k]! + (b.p[k]! - a.p[k]!) * e
  }

  update(dtSec: number): void {
    const f = this.fx
    const c = this.cur
    c[0] = c[1] = c[2] = c[3] = c[4] = c[5] = 0
    const dt = dtSec > 0 ? dtSec : 0

    // Phần chiêu bị huỷ mờ dần
    const kF = Math.exp(-dt / CANCEL_TAU)
    for (let i = 0; i < 6; i++) this.fade[i]! *= kF
    for (let i = 0; i < 6; i++) c[i]! += this.fade[i]!

    // Chiêu đang chạy
    if (this.move >= 0) {
      this.t += dt * 1000
      if (this.t >= this.durations[this.move]!) this.move = -1
      else { this.sampleMove(this.tmp); for (let i = 0; i < 6; i++) c[i]! += this.tmp[i]! }
    }

    // Đỡ / choáng: chỉ khi không đang ra chiêu
    const kS = 1 - Math.exp(-dt / STATE_TAU)
    this.guardW += ((this.guardOn && this.move < 0 ? 1 : 0) - this.guardW) * kS
    this.staggerW += ((this.staggerOn ? 1 : 0) - this.staggerW) * kS
    for (let i = 0; i < 6; i++) c[i]! += GUARD_POSE[i]! * this.guardW + STAGGER_POSE[i]! * this.staggerW

    // Giật phản ứng
    const kK = Math.exp(-dt / KICK_TAU)
    for (let i = 0; i < 6; i++) { this.kick[i]! *= kK; c[i]! += this.kick[i]! }

    f.px = c[0]!; f.py = c[1]!; f.pz = c[2]!; f.rx = c[3]!; f.ry = c[4]!; f.rz = c[5]!
  }

  private readonly tmp: number[] = [0, 0, 0, 0, 0, 0]
}
