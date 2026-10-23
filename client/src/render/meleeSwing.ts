// Động tác vũ khí cận chiến theo chiêu (plan 19, P4/P6): keyframe cho từng chiêu của bộ chiêu, đỡ, choáng, phản ứng khi đỡ trúng.
// Dao có keyframe chỉnh tay (SWING_STYLES); vũ khí khác suy keyframe từ cung quét của chiêu (styleFromArc) nên luôn khớp vùng đánh của server.
// Quơ dao = quơ cả cánh tay quanh khớp vai (viewmodel xoay gunGroup quanh vai, tay IK đi theo), không bẻ cổ tay: dao luôn cứng theo cánh tay.
// Thuần hình ảnh (không import Three.js/DOM, không cấp phát trong update). Thời gian lấy từ dữ liệu chiêu (windup, strikeMs, hitIntervalMs...)
// nên khớp cửa sổ quét của server.
import { KNIFE_SET, moveDurationMs, type MeleeMove, type MeleeSet } from '@fps/shared'

/**
 * [yaw, pitch, ext, wx, wy, wz]
 * yaw / pitch (rad): xoay cả cánh tay quanh vai trong không gian camera. +yaw = quơ sang trái, +pitch = nâng lên.
 * ext (m): duỗi tay ra / co về dọc hướng vai → tay. Tay dài tối đa ~0,9 m, tư thế nghỉ đã ~0,77 m nên ext tối đa ~ +0,12.
 * wx, wy, wz (rad): góc cổ tay quanh bàn tay, theo trục CAMERA (wx âm = ngửa ra trước, wz dương = nghiêng lưỡi sang trái), cộng lên góc cầm nghỉ (dao đứng trong nắm tay). Thứ tự áp: z, rồi x, rồi y (Euler YXZ): chúc/ngóc trước, quay trái/phải sau.
 */
export type Pose = readonly [number, number, number, number, number, number]
const REST: Pose = [0, 0, 0, 0, 0, 0]

export interface SwingStyle { wind: Pose; hit: Pose; perHit?: Pose }

/** Dao đặt đứng trong nắm tay; khi ra đòn cổ tay ngửa ra trước (chưa tới mức chỉa thẳng) */
const FWD = -0.55
/** Đâm thẳng: cổ tay ngửa hẳn ra trước cho mũi chỉa vào mục tiêu */
const STAB = -0.9
/** Cầm xuôi khi ra đòn: mũi ngả sang trái về giữa màn hình (như dao CS2) */
const LEAN = 0.6
/** Tư thế cao điểm của từng chiêu: `wind` = lúc gồng (tới đúng giờ nhát đánh), `hit` = cuối cung quét */
export const SWING_STYLES: Record<string, SwingStyle> = {
  knife_l1:   { wind: [0.45, 0.05, 0, FWD, 0, LEAN], hit: [-0.4, 0, 0.12, FWD, 0, LEAN] },                                  // chém ngang trái → phải
  knife_l2:   { wind: [-0.4, -0.05, 0, FWD, 0, LEAN], hit: [0.45, 0.05, 0.12, FWD, 0, LEAN] },                              // chém ngược phải → trái
  knife_l3:   { wind: [0, 0.02, -0.2, FWD, 0, LEAN], hit: [0, 0, 0.12, FWD, 0, LEAN] },                                       // đâm liên hoàn: co tay rồi duỗi thẳng
  knife_llr:  { wind: [0.05, 0.28, -0.05, FWD, 0, 0], hit: [0, 0, 0.12, FWD, 0, 0] },                           // giơ cao rồi giáng xuống
  knife_spin: { wind: [0.6, 0.1, -0.05, FWD, 0, LEAN], hit: [-0.45, 0.05, 0.12, FWD, 0, LEAN] },                              // bão dao: quét hết tầm nhìn
  knife_lr:   { wind: [-0.05, 0.28, -0.05, FWD, 0, 0], hit: [0.05, 0, 0.12, FWD, 0, 0] },
  knife_rise: { wind: [0.05, -0.35, -0.05, FWD + 0.4, 0, 0], hit: [0, 0.3, 0.12, FWD + 0.4, 0, 0] },                           // khoét từ thấp lên cao
  knife_r1:   { wind: [0, 0, -0.12, STAB, 0, 0.3], hit: [0, 0, 0.12, STAB, 0, 0.3] },                                     // đâm thẳng mạnh
  knife_rr:   { wind: [0.03, 0, -0.1, STAB, 0, 0.3], hit: [0.03, 0, 0.12, STAB, 0, 0.3] },                               // đâm thẳng hai nhát liền
  knife_flip: { wind: [0.45, 0, 0, FWD, 0, LEAN], hit: [-0.4, 0.05, 0.12, FWD, 0, LEAN] },                                    // lật tay chém nhanh
}

export const GUARD_POSE: Pose = [0.2, 0.1, -0.04, -0.2, 0, 1.2]             // cánh tay đưa chếch trái, lưỡi ngang trước mặt
export const STAGGER_POSE: Pose = [0, -0.25, -0.1, 0.35, 0, 0.2]             // tay hạ xuống, dao ngóc lên
/** Vũ khí hai tay: đỡ = cán nằm ngang chắn trước mặt (đặt nằm ngang bằng levelWx rồi quay sang trái), đẩy ra xa mặt */
function guardTwo(levelWx: number): Pose { return [0.12, 0.38, 0.1, levelWx - 0.38, 0.95, 0] }

/** Cách nhìn của từng vũ khí cận chiến (theo WeaponDef.key) */
export interface MeleeLook {
  inHandDeg: number   // xoay vũ khí trong nắm tay quanh điểm nắm (dao: 60 = lưỡi đứng lên từ phía ngón cái); vũ khí hai tay = 0
  twoHand: boolean    // tay trái nắm cán ở điểm neo hand_l (không phải tay phụ thả lỏng)
  guard: Pose
  /** Hai tay: góc cổ tay (wx, rad) đưa vũ khí từ tư thế nghỉ về nằm ngang chĩa trước (búa dựng đứng: âm nhiều; thương: 0) */
  levelWx?: number
  /** Góc nhìn thứ ba: thế thủ của tay phải (ghi đè poses.character.melee.restR / restRotDegR), hệ thân; góc xoay áp ngóc (x) trước rồi quay (y) */
  restR?: readonly [number, number, number]
  restRotDegR?: readonly [number, number, number]
}
export const MELEE_LOOK: Record<string, MeleeLook> = {
  knife:   { inHandDeg: 60, twoHand: false, guard: GUARD_POSE },
  machete: { inHandDeg: 60, twoHand: false, guard: GUARD_POSE },
  hammer:  { inHandDeg: 0, twoHand: true, guard: guardTwo(-1.0), levelWx: -1.0, restR: [-0.02, -0.34, -0.3], restRotDegR: [50, 65, 0] },   // cán chéo trước ngực, đầu búa chếch lên vai trái
  spear:   { inHandDeg: 0, twoHand: true, guard: guardTwo(-0.1), levelWx: -0.1, restR: [0.04, -0.42, -0.12], restRotDegR: [6, 10, 0] },   // ngang hông, mũi chĩa trước
  staff:   { inHandDeg: 0, twoHand: true, guard: guardTwo(-0.45), levelWx: -0.45, restR: [0.02, -0.38, -0.2], restRotDegR: [25, 55, 0] },
}
export function meleeLook(key: string | undefined): MeleeLook { return (key && MELEE_LOOK[key]) || MELEE_LOOK.knife! }

const ARM_K = 0.95     // góc cung quét (server) → góc quơ cánh tay (một tay)
const ARM_MAX = 1.3    // rad: xoáy 360° chỉ quơ tới đây (phần còn lại là thân xoay)
/**
 * Keyframe suy từ cung quét: gồng ở đầu cung, quét tới cuối cung. Cung: yaw + = phải, pitch + = lên (độ); tay: yaw + = trái.
 * Một tay: quơ cả cánh tay quanh vai, cổ tay ngửa FWD như dao (đâm: STAB), nghiêng lưỡi theo hướng quét ngang.
 * Hai tay: theo dạng đòn (giáng / quét ngang / đâm): hai tay kéo vào giữa, vũ khí xoay quanh chỗ nắm (wx chúc/ngóc, wy quay trái/phải)
 * từ tư thế nằm ngang (`levelWx`) để luôn nằm trong khung hình.
 */
export function styleFromArc(m: MeleeMove, twoHand: boolean, levelWx = 0): SwingStyle {
  const a = m.arc, D = Math.PI / 180
  const cl = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v))
  const thrust = a.reach[1] - a.reach[0] > 0.3
  const e0 = thrust ? -0.2 : -0.06, e1 = thrust ? 0.2 : 0.14   // đâm vươn xa hơn (playtest 23/10: đâm quá ngắn)
  if (twoHand) {
    const dy = a.yaw[1] - a.yaw[0], dp = a.pitch[1] - a.pitch[0]
    // Cánh tay nâng lên (pitch) cũng ngóc vũ khí lên theo: cổ tay trừ lại để vũ khí nằm đúng hướng mong muốn
    if (thrust) return { wind: [0.12, 0.12, -0.16, levelWx - 0.12, 0.12, 0], hit: [0.15, 0.15, 0.16, levelWx - 0.15, 0.12, 0] }
    if (Math.abs(dp) >= Math.abs(dy)) {
      if (dp < 0) return { wind: [0.2, 0.45, -0.1, 0.35, 0.1, 0], hit: [0.35, 0.28, 0.12, levelWx - 0.28 - 0.15, 0.15, 0] }   // giáng: giơ qua vai rồi bổ xuống giữa
      return { wind: [0.3, 0.1, -0.05, levelWx - 0.1 - 0.5, 0.15, 0], hit: [0.25, 0.4, 0.1, levelWx - 0.4 + 0.6, 0.1, 0] }     // hất từ dưới lên
    }
    const sgn = dy > 0 ? 1 : -1   // quét trái → phải (cung yaw tăng) hay ngược lại
    const sweep = cl(Math.abs(dy) * D * 0.45, 1.0)
    return { wind: [0.3 * sgn, 0.3, -0.04, levelWx - 0.3, sweep * sgn, 0], hit: [-0.2 * sgn, 0.28, 0.1, levelWx - 0.28, -sweep * sgn, 0] }
  }
  const y0 = cl(-a.yaw[0] * D * ARM_K, ARM_MAX), y1 = cl(-a.yaw[1] * D * ARM_K, ARM_MAX)
  const p0 = cl(a.pitch[0] * D * ARM_K, ARM_MAX), p1 = cl(a.pitch[1] * D * ARM_K, ARM_MAX)
  const wx = thrust ? STAB : FWD
  const wz = Math.abs(a.yaw[1] - a.yaw[0]) > Math.abs(a.pitch[1] - a.pitch[0]) ? LEAN : 0
  return { wind: [y0, p0, e0, wx, 0, wz], hit: [y1, p1, e1, wx, 0, wz] }
}
const BLOCK_KICK: Pose = [0, 0.05, -0.06, 0, 0, 0]                           // giật lại khi đỡ trúng
const PARRY_KICK: Pose = [0.25, 0.08, 0.05, 0, 0.2, 0]                       // gạt ra khi parry thành công

const CANCEL_TAU = 0.07   // s: về tư thế nghỉ khi chiêu bị huỷ
const STATE_TAU = 0.06    // s: vào/ra tư thế đỡ, choáng
const KICK_TAU = 0.09

export interface SwingFx { yaw: number; pitch: number; ext: number; wx: number; wy: number; wz: number }

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

/** Keyframe dựng sẵn theo bộ chiêu (dùng chung cho mọi MeleeSwing) */
const keyCache = new Map<MeleeSet, { keys: Key[][]; durations: number[] }>()
function keysOf(set: MeleeSet, look: MeleeLook): { keys: Key[][]; durations: number[] } {
  let k = keyCache.get(set)
  if (!k) {
    k = { keys: set.moves.map(m => buildKeys(m, SWING_STYLES[m.key] ?? styleFromArc(m, look.twoHand, look.levelWx))), durations: set.moves.map(m => moveDurationMs(m)) }
    keyCache.set(set, k)
  }
  return k
}

export class MeleeSwing {
  readonly fx: SwingFx = { yaw: 0, pitch: 0, ext: 0, wx: 0, wy: 0, wz: 0 }

  private keys: Key[][] = keysOf(KNIFE_SET, MELEE_LOOK.knife!).keys
  private durations: number[] = keysOf(KNIFE_SET, MELEE_LOOK.knife!).durations
  private set: MeleeSet = KNIFE_SET
  private guardPose: Pose = GUARD_POSE

  /** Đổi vũ khí: dùng bộ chiêu + cách nhìn của vũ khí đó (huỷ hết động tác đang chạy) */
  useSet(set: MeleeSet, look: MeleeLook): void {
    if (set === this.set && look.guard === this.guardPose) return
    const k = keysOf(set, look)
    this.set = set; this.keys = k.keys; this.durations = k.durations; this.guardPose = look.guard
    this.reset()
  }
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
  /** Mức choáng 0..1 (mượt), để thân người ngả theo (góc nhìn thứ ba) */
  get staggerAmount(): number { return this.staggerW }
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
    for (let i = 0; i < 6; i++) c[i]! += this.guardPose[i]! * this.guardW + STAGGER_POSE[i]! * this.staggerW

    // Giật phản ứng
    const kK = Math.exp(-dt / KICK_TAU)
    for (let i = 0; i < 6; i++) { this.kick[i]! *= kK; c[i]! += this.kick[i]! }

    f.yaw = c[0]!; f.pitch = c[1]!; f.ext = c[2]!; f.wx = c[3]!; f.wy = c[4]!; f.wz = c[5]!
  }

  private readonly tmp: number[] = [0, 0, 0, 0, 0, 0]
}
