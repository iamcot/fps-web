import { DT, TICK_RATE, adsMoveFor, adsWanted, copyWeaponState, makeWeaponState, moveSpeedMul, stepMovement, stepWeaponCmd, type AdsMove, type InputCmd, type MovementConfig, type PlayerState, type WeaponState } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'

const MAX_PENDING = 240          // 4 giây cmd chưa được ack; quá thì bỏ cái cũ nhất
const TELEPORT_DIST = 1          // lệch ≥ 1m: nhảy thẳng, không làm mượt
const OFFSET_DECAY = 0.85        // mỗi frame
const OFFSET_EPS = 1e-4
const ERROR_WINDOW_MS = 5000

interface Pending { cmd: InputCmd; stateAfter: PlayerState }

// Dự đoán phía client + reconcile (input replay):
//  - mỗi tick: chạy stepMovement ngay, nhớ {cmd, stateAfter}
//  - có snapshot: bỏ cmd đã ack, đặt state = state server, chạy lại các cmd còn lại
export class Prediction {
  predicted: PlayerState
  pending: Pending[] = []
  ready = false                   // đã nhận snapshot đầu tiên
  lastError = 0                   // sai số vị trí (m) ở lần reconcile gần nhất
  reconciles = 0
  private errors: { t: number; e: number }[] = []
  private wsScratch = makeWeaponState()   // replay súng song song với replay vị trí (tốc độ chạy phụ thuộc súng đang cầm)
  // Làm mượt hiển thị: vị trí vẽ = predicted.pos + visualOffset
  readonly visualOffset: [number, number, number] = [0, 0, 0]

  constructor(
    private world: CollisionWorld,
    private cfg: MovementConfig,   // đổi được khi vai trò đổi (người ↔ zombie): setConfig
    initial: PlayerState,
    private now: () => number = () => performance.now(),
  ) {
    this.predicted = initial
  }

  /** Đổi cấu hình di chuyển (người ↔ zombie). Gọi trước onSnapshot của snapshot báo vai mới để replay dùng đúng cấu hình. */
  setConfig(cfg: MovementConfig): void { this.cfg = cfg }

  // Chạy một tick dự đoán. Gọi sau khi cmd được tạo; trả về state mới.
  // speedMul = hệ số tốc độ theo súng đang cầm TRƯỚC cmd này (moveSpeedMul của WeaponState hiện tại)
  step(cmd: InputCmd, speedMul = 1, ads: AdsMove | null = null, adsWant = false): PlayerState {
    const next = stepMovement(this.predicted, cmd, this.world, this.cfg, DT, speedMul, ads, adsWant)
    this.predicted = next
    this.pending.push({ cmd, stateAfter: next })
    if (this.pending.length > MAX_PENDING) this.pending.shift()
    return next
  }

  // Hồi sinh: đặt state mới, bỏ cmd chưa ack, không làm mượt
  teleport(state: PlayerState): void {
    this.predicted = state
    this.pending.length = 0
    this.visualOffset[0] = 0; this.visualOffset[1] = 0; this.visualOffset[2] = 0
  }

  // wpn = WeaponState của server sau cmd `ack`: replay súng cùng lúc để biết tốc độ chạy đúng ở từng cmd chưa ack
  onSnapshot(ack: number, serverState: PlayerState, wpn?: WeaponState | null): void {
    // So với stateAfter đã lưu cho cmd seq = ack (nếu còn)
    let error = -1
    for (const p of this.pending) {
      if (p.cmd.seq === ack) { error = dist(p.stateAfter.pos, serverState.pos); break }
    }
    let drop = 0
    while (drop < this.pending.length && this.pending[drop]!.cmd.seq <= ack) drop++
    if (drop > 0) this.pending.splice(0, drop)

    // Vị trí đang vẽ trước khi sửa
    const ox = this.predicted.pos[0] + this.visualOffset[0]
    const oy = this.predicted.pos[1] + this.visualOffset[1]
    const oz = this.predicted.pos[2] + this.visualOffset[2]

    // Luôn đặt lại = state server rồi chạy lại cmd chưa ack. stepMovement truyền vị trí vào
    // world mỗi lần nên collider của mình tự được đặt lại theo state.
    let s = serverState
    const ws = this.wsScratch
    if (wpn) copyWeaponState(ws, wpn)
    for (const p of this.pending) {
      s = wpn
        ? stepMovement(s, p.cmd, this.world, this.cfg, DT, moveSpeedMul(ws, p.cmd.seq * 1000 / TICK_RATE), adsMoveFor(ws), adsWanted(ws, p.cmd.buttons, p.cmd.seq * 1000 / TICK_RATE))
        : stepMovement(s, p.cmd, this.world, this.cfg, DT, 1)
      if (wpn) stepWeaponCmd(ws, p.cmd)
      p.stateAfter = s
    }
    this.predicted = s

    const dx = ox - s.pos[0], dy = oy - s.pos[1], dz = oz - s.pos[2]
    if (this.ready && Math.hypot(dx, dy, dz) < TELEPORT_DIST) {
      this.visualOffset[0] = dx; this.visualOffset[1] = dy; this.visualOffset[2] = dz
    } else {
      this.visualOffset[0] = 0; this.visualOffset[1] = 0; this.visualOffset[2] = 0   // teleport
    }
    this.ready = true

    if (error >= 0) {
      this.lastError = error
      this.reconciles++
      const t = this.now()
      this.errors.push({ t, e: error })
      while (this.errors.length > 0 && this.errors[0]!.t < t - ERROR_WINDOW_MS) this.errors.shift()
    }
  }

  // Gọi mỗi frame hiển thị
  decayOffset(): readonly [number, number, number] {
    const o = this.visualOffset
    o[0] *= OFFSET_DECAY; o[1] *= OFFSET_DECAY; o[2] *= OFFSET_DECAY
    if (Math.hypot(o[0], o[1], o[2]) < OFFSET_EPS) { o[0] = 0; o[1] = 0; o[2] = 0 }
    return o
  }

  // Sai số lớn nhất trong 5 giây gần nhất
  maxError(): number {
    const t = this.now() - ERROR_WINDOW_MS
    let m = 0
    for (const r of this.errors) if (r.t >= t && r.e > m) m = r.e
    return m
  }
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}
