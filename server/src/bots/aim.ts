// Ngắm kiểu người (plan 15, B.4): không xoay thẳng tới mục tiêu.
//  - bám vị trí địch TRỄ trackingLagMs (không đoán trước hướng chạy)
//  - sai số ngắm ngẫu nhiên lúc bắt đầu, giảm dần theo thời gian nhưng không về 0; luôn còn rung nhẹ
//  - xoay có giới hạn tốc độ + quán tính (lò xo giảm chấn) nên vẩy xa sẽ hơi vượt rồi chỉnh lại
//  - chỉ bù một phần độ giật (recoilCompensation)
import { MAX_PITCH, type Vec3 } from '@fps/shared'
import { rand, type BotParams } from './params'

const DEG = Math.PI / 180
const SPRING_K = 11            // 1/s: vận tốc mong muốn = K × góc lệch (trước khi kẹp tốc độ)
const INERTIA_TAU = 0.06       // s: quán tính của "bàn tay" — nguồn của việc vượt quá nhẹ (ζ ≈ 0,6)
const HISTORY = 40             // số mẫu vị trí mục tiêu (1 mẫu/tick → ~0,66s)
const JITTER_EVERY_MS: [number, number] = [150, 300]
const PURSUIT_GAIN = 0.8       // người bám mục tiêu đang chạy bằng cách đi theo tốc độ góc của nó (smooth pursuit), không chỉ sửa lệch
const PURSUIT_TAU = 0.12       // s: lọc tốc độ góc ước lượng

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

/** yaw/pitch (quy ước dự án) nhìn từ `from` tới `to` */
export function anglesTo(from: Vec3, to: Vec3, out: [number, number]): [number, number] {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  out[0] = Math.atan2(-dx, -dz)
  out[1] = Math.atan2(dy, Math.hypot(dx, dz))
  return out
}

export class Aim {
  yaw = 0
  pitch = 0
  private vYaw = 0
  private vPitch = 0
  // sai số ngắm còn lại (rad, vector 2D trong không gian góc) + độ lớn
  private errYaw = 0
  private errPitch = 0
  private errMag = 0
  private errDirYaw = 0
  private errDirPitch = 0
  private jYaw = 0
  private jPitch = 0
  private jTargetYaw = 0
  private jTargetPitch = 0
  private jNextAt = 0
  private prevDesYaw = NaN
  private prevDesPitch = NaN
  private ffYaw = 0
  private ffPitch = 0
  headTarget = false
  // lịch sử vị trí mục tiêu (ngực) theo thời gian để lấy mẫu trễ
  private readonly hx = new Float64Array(HISTORY)
  private readonly hy = new Float64Array(HISTORY)
  private readonly hz = new Float64Array(HISTORY)
  private readonly ht = new Float64Array(HISTORY)
  private hn = 0
  private hi = 0
  trackedId = -1
  private readonly _a: [number, number] = [0, 0]
  private readonly _delayed: Vec3 = [0, 0, 0]

  constructor(private readonly rng: () => number) {}

  set(yaw: number, pitch: number): void { this.yaw = yaw; this.pitch = pitch; this.vYaw = 0; this.vPitch = 0 }

  /** Bắt đầu giao tranh với mục tiêu mới: chọn đầu/ngực, ném sai số ngắm ban đầu, xoá lịch sử */
  begin(id: number, params: BotParams): void {
    this.trackedId = id
    this.hn = 0; this.hi = 0
    this.headTarget = this.rng() < params.headChance
    this.errMag = rand(this.rng, params.aimErrorDeg) * DEG
    const a = this.rng() * 2 * Math.PI
    this.errDirYaw = Math.cos(a); this.errDirPitch = Math.sin(a)
  }

  /** Mỗi loạt/phát mới trong cùng một giao tranh: chọn lại đầu/ngực và dựng lại một phần sai số (người không ngắm hoàn hảo cả trận) */
  reroll(params: BotParams): void {
    this.headTarget = this.rng() < params.headChance
    this.errMag = Math.max(this.errMag, rand(this.rng, params.aimErrorDeg) * DEG * 0.5)
    const a = this.rng() * 2 * Math.PI
    this.errDirYaw = Math.cos(a); this.errDirPitch = Math.sin(a)
  }

  end(): void { this.trackedId = -1; this.hn = 0; this.prevDesYaw = NaN }

  /** Ghi vị trí mục tiêu ở tick này (mọi tick khi đang thấy) */
  record(x: number, y: number, z: number, nowMs: number): void {
    this.hx[this.hi] = x; this.hy[this.hi] = y; this.hz[this.hi] = z; this.ht[this.hi] = nowMs
    this.hi = (this.hi + 1) % HISTORY
    if (this.hn < HISTORY) this.hn++
  }

  /** Vị trí mục tiêu cách đây lagMs (nội suy giữa hai mẫu; thiếu lịch sử thì lấy mẫu cũ nhất) */
  delayed(nowMs: number, lagMs: number): Vec3 {
    const out = this._delayed
    if (this.hn === 0) { out[0] = out[1] = out[2] = 0; return out }
    const want = nowMs - lagMs
    let prev = -1
    for (let k = 0; k < this.hn; k++) {
      const idx = (this.hi - 1 - k + HISTORY) % HISTORY
      if (this.ht[idx]! <= want) {
        if (prev < 0) { out[0] = this.hx[idx]!; out[1] = this.hy[idx]!; out[2] = this.hz[idx]!; return out }
        const t0 = this.ht[idx]!, t1 = this.ht[prev]!
        const f = t1 > t0 ? (want - t0) / (t1 - t0) : 0
        out[0] = this.hx[idx]! + (this.hx[prev]! - this.hx[idx]!) * f
        out[1] = this.hy[idx]! + (this.hy[prev]! - this.hy[idx]!) * f
        out[2] = this.hz[idx]! + (this.hz[prev]! - this.hz[idx]!) * f
        return out
      }
      prev = idx
    }
    const old = (this.hi - this.hn + HISTORY) % HISTORY   // chưa đủ lịch sử: mẫu cũ nhất
    out[0] = this.hx[old]!; out[1] = this.hy[old]!; out[2] = this.hz[old]!
    return out
  }

  /**
   * Một tick: xoay tay về góc mong muốn (desiredYaw/Pitch, chưa gồm sai số) + sai số + rung − bù giật.
   * `withError` = false khi chỉ quay đầu nhìn (không giao tranh). speedMul làm chậm khi nhìn quanh.
   */
  step(dt: number, nowMs: number, desiredYaw: number, desiredPitch: number, recYaw: number, recPitch: number, params: BotParams, withError: boolean, speedMul = 1): void {
    if (withError) {
      this.errMag = Math.max(0, this.errMag - params.aimErrorDecayPerSec * DEG * dt)
      if (nowMs >= this.jNextAt) {
        // điểm đều trong đĩa bán kính 2·jitter → độ lệch chuẩn mỗi trục = aimJitterDeg
        const m = 2 * params.aimJitterDeg * DEG * Math.sqrt(this.rng()), a = this.rng() * 2 * Math.PI
        this.jTargetYaw = Math.cos(a) * m; this.jTargetPitch = Math.sin(a) * m
        this.jNextAt = nowMs + rand(this.rng, JITTER_EVERY_MS)
      }
      const f = 1 - Math.exp(-dt / 0.08)
      this.jYaw += (this.jTargetYaw - this.jYaw) * f
      this.jPitch += (this.jTargetPitch - this.jPitch) * f
      this.errYaw = this.errDirYaw * this.errMag
      this.errPitch = this.errDirPitch * this.errMag
    } else { this.errYaw = 0; this.errPitch = 0; this.jYaw = 0; this.jPitch = 0 }

    const comp = withError ? params.recoilCompensation : 1
    const goalYaw = desiredYaw + this.errYaw + this.jYaw - comp * recYaw
    const goalPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, desiredPitch + this.errPitch + this.jPitch - comp * recPitch))

    // tốc độ góc của mục tiêu (không tính sai số/rung) để bám theo khi nó chạy ngang
    if (withError && !Number.isNaN(this.prevDesYaw)) {
      const kf = 1 - Math.exp(-dt / PURSUIT_TAU)
      this.ffYaw += (wrapAngle(desiredYaw - this.prevDesYaw) / dt - this.ffYaw) * kf
      this.ffPitch += ((desiredPitch - this.prevDesPitch) / dt - this.ffPitch) * kf
    } else { this.ffYaw = 0; this.ffPitch = 0 }
    this.prevDesYaw = withError ? desiredYaw : NaN; this.prevDesPitch = desiredPitch

    const maxV = params.aimSpeedDegPerSec * DEG * speedMul
    const clampV = (v: number) => Math.max(-maxV, Math.min(maxV, v))
    const f = 1 - Math.exp(-dt / INERTIA_TAU)
    this.vYaw += (clampV(wrapAngle(goalYaw - this.yaw) * SPRING_K + PURSUIT_GAIN * this.ffYaw) - this.vYaw) * f
    this.vPitch += (clampV((goalPitch - this.pitch) * SPRING_K + PURSUIT_GAIN * this.ffPitch) - this.vPitch) * f
    this.yaw = wrapAngle(this.yaw + this.vYaw * dt)
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.vPitch * dt))
  }

  /** Góc (rad) giữa hướng nhìn hiện tại và hướng tới (yaw, pitch) */
  angleTo(yaw: number, pitch: number): number {
    const dy = wrapAngle(yaw - this.yaw) * Math.cos((pitch + this.pitch) / 2), dp = pitch - this.pitch
    return Math.hypot(dy, dp)
  }

  anglesToward(from: Vec3, to: Vec3): [number, number] { return anglesTo(from, to, this._a) }
}
