// Động tác viewmodel của dao theo chiêu (plan 19, P4): keyframe cho từng chiêu của KNIFE_SET, đỡ, choáng, phản ứng khi đỡ trúng.
// Quơ dao = quơ cả cánh tay quanh khớp vai (viewmodel xoay gunGroup quanh vai, tay IK đi theo), không bẻ cổ tay: dao luôn cứng theo cánh tay.
// Thuần hình ảnh (không import Three.js/DOM, không cấp phát trong update). Thời gian lấy từ dữ liệu chiêu (windup, strikeMs, hitIntervalMs...)
// nên khớp cửa sổ quét của server.
import { KNIFE_SET, moveDurationMs, type MeleeMove } from '@fps/shared'

/**
 * [yaw, pitch, ext, wx, wy, wz]
 * yaw / pitch (rad): xoay cả cánh tay quanh vai trong không gian camera. +yaw = quơ sang trái, +pitch = nâng lên.
 * ext (m): duỗi tay ra / co về dọc hướng vai → tay. Tay dài tối đa ~0,9 m, tư thế nghỉ đã ~0,77 m nên ext tối đa ~ +0,12.
 * wx, wy, wz (rad): góc cổ tay quanh bàn tay, theo trục CAMERA (wx âm = ngửa ra trước, wz dương = nghiêng lưỡi sang trái), cộng lên góc cầm nghỉ (dao đứng trong nắm tay).
 */
export type Pose = readonly [number, number, number, number, number, number]
const REST: Pose = [0, 0, 0, 0, 0, 0]

export interface SwingStyle { wind: Pose; hit: Pose; perHit?: Pose; reverse?: boolean }   // reverse: lật dao cầm ngược (lưỡi lòi phía ngón út, chúc xuống)

/** Dao đặt đứng trong nắm tay; khi ra đòn cổ tay ngửa ra trước (chưa tới mức chỉa thẳng) */
const FWD = -0.55
/** Cầm ngược: lưỡi chúc xuống, nghiêng mũi về phía trái màn hình */
const REV_ROLL = -0.4
/** Cầm xuôi khi ra đòn: mũi ngả sang trái về giữa màn hình (như dao CS2) */
const LEAN = 0.6
/** Tư thế cao điểm của từng chiêu: `wind` = lúc gồng (tới đúng giờ nhát đánh), `hit` = cuối cung quét */
export const SWING_STYLES: Record<string, SwingStyle> = {
  knife_l1:   { wind: [0.45, 0.05, 0, FWD, 0, LEAN], hit: [-0.4, 0, 0.12, FWD, 0, LEAN] },                                  // chém ngang trái → phải
  knife_l2:   { wind: [-0.4, -0.05, 0, FWD, 0, LEAN], hit: [0.45, 0.05, 0.12, FWD, 0, LEAN] },                              // chém ngược phải → trái
  knife_l3:   { wind: [0, 0.02, -0.2, FWD, 0, LEAN], hit: [0, 0, 0.12, FWD, 0, LEAN] },                                       // đâm liên hoàn: co tay rồi duỗi thẳng
  knife_llr:  { wind: [0.05, 0.28, -0.05, 0, 0, REV_ROLL], hit: [0, 0, 0.12, 0, 0, REV_ROLL], reverse: true },                           // giơ cao rồi giáng xuống
  knife_spin: { wind: [0.6, 0.1, -0.05, FWD, 0, LEAN], hit: [-0.45, 0.05, 0.12, FWD, 0, LEAN] },                              // bão dao: quét hết tầm nhìn
  knife_lr:   { wind: [-0.05, 0.28, -0.05, 0, 0, REV_ROLL], hit: [0.05, 0, 0.12, 0, 0, REV_ROLL], reverse: true },
  knife_rise: { wind: [0.05, -0.35, -0.05, FWD + 0.4, 0, 0], hit: [0, 0.3, 0.12, FWD + 0.4, 0, 0] },                           // khoét từ thấp lên cao
  knife_r1:   { wind: [0, 0.28, -0.1, 0, 0, REV_ROLL], hit: [0, -0.02, 0.12, 0, 0, REV_ROLL], reverse: true },                              // cầm ngược, đâm xuống
  knife_rr:   { wind: [0, 0.28, -0.05, 0, 0, REV_ROLL], hit: [0, 0, 0.12, 0, 0, REV_ROLL], reverse: true },                              // xoáy kép: hai nhát giáng liền
  knife_flip: { wind: [0.45, 0, 0, FWD, 0, LEAN], hit: [-0.4, 0.05, 0.12, FWD, 0, LEAN] },                                    // lật tay chém nhanh
}

export const GUARD_POSE: Pose = [0.2, 0.1, -0.04, -0.2, 0, 1.2]             // cánh tay đưa chếch trái, lưỡi ngang trước mặt
export const STAGGER_POSE: Pose = [0, -0.25, -0.1, 0.35, 0, 0.2]             // tay hạ xuống, dao ngóc lên
const BLOCK_KICK: Pose = [0, 0.05, -0.06, 0, 0, 0]                           // giật lại khi đỡ trúng
const PARRY_KICK: Pose = [0.25, 0.08, 0.05, 0, 0.2, 0]                       // gạt ra khi parry thành công

const CANCEL_TAU = 0.07   // s: về tư thế nghỉ khi chiêu bị huỷ
const STATE_TAU = 0.06    // s: vào/ra tư thế đỡ, choáng
const KICK_TAU = 0.09
const GRIP_TAU = 0.045    // s: lật dao xuôi ↔ ngược
const GRIP_BACK_MS = 160  // lật về cầm xuôi trước khi chiêu cầm ngược kết thúc bấy nhiêu ms

/** grip: 0 = cầm xuôi, 1 = cầm ngược (mượt) */
export interface SwingFx { yaw: number; pitch: number; ext: number; wx: number; wy: number; wz: number; grip: number }

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
  keys.push({ t: moveDurationMs(m), p: REST, strike: false })   // về nghỉ khi hết chiêu
  return keys
}

export class MeleeSwing {
  readonly fx: SwingFx = { yaw: 0, pitch: 0, ext: 0, wx: 0, wy: 0, wz: 0, grip: 0 }

  private readonly keys: Key[][] = KNIFE_SET.moves.map(m => buildKeys(m, SWING_STYLES[m.key] ?? { wind: REST, hit: REST }))
  private readonly durations: number[] = KNIFE_SET.moves.map(m => moveDurationMs(m))
  private readonly reverse: boolean[] = KNIFE_SET.moves.map(m => !!SWING_STYLES[m.key]?.reverse)
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
  /** Mức đỡ 0..1 (mượt), để tay phụ nhích theo */
  get guardAmount(): number { return this.guardW }
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
    this.move = -1; this.guardW = this.staggerW = 0; this.fx.grip = 0; this.guardOn = this.staggerOn = false
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

    // Cầm xuôi / ngược
    const rev = this.move >= 0 && this.reverse[this.move]! && this.t < this.durations[this.move]! - GRIP_BACK_MS
    f.grip += ((rev ? 1 : 0) - f.grip) * (1 - Math.exp(-dt / GRIP_TAU))

    f.yaw = c[0]!; f.pitch = c[1]!; f.ext = c[2]!; f.wx = c[3]!; f.wy = c[4]!; f.wz = c[5]!
  }

  private readonly tmp: number[] = [0, 0, 0, 0, 0, 0]
}
