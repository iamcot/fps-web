// Hiệu ứng viewmodel của dao (thuần hình ảnh, không import Three.js/DOM): thở, lắc cổ tay theo bước, tư thế chạy nước rút,
// quán tính theo chuột, nghiêng khi đi ngang, nhảy/tiếp đất, tung dao lúc rút, múa dao khi đứng yên lâu hoặc bấm phím xem dao.
// Kết quả là độ lệch `fx` (mét / radian) cộng lên vị trí và góc xoay của gunGroup. Không cấp phát trong update.

const TAU = Math.PI * 2

const BREATH_PERIOD = 4        // s mỗi nhịp thở
const BREATH_Y = 0.004
const BREATH_RX = 0.012
const BOB_ROLL = 0.05          // rad: nghiêng cổ tay theo nhịp bước (chạy hết tốc)
const BOB_TWIST = 0.04
const BOB_AMP_X = 0.012        // cộng thêm vào bob hình số 8 của viewmodel khi chạy nước rút
const BOB_AMP_Y = 0.008
const RUN_FROM = 0.7           // tỉ lệ tốc độ (0..1) bắt đầu tư thế chạy nước rút
const RUN_DROP = 0.035
const RUN_IN = 0.02
const RUN_PITCH = 0.22
const RUN_BOB_BOOST = 0.8
const SWAY_GAIN = 0.004        // rad cho mỗi rad/s tốc độ quay chuột
const SWAY_MAX = 0.07
const SWAY_TAU = 0.06
const LEAN_ROLL = 0.12
const STRAFE_REF = 6           // m/s ngang cho nghiêng tối đa
const JUMP_LIFT = 0.025
const JUMP_REF = 6             // m/s vận tốc Y cho nâng tối đa
const LAND_DIP = 0.06
const LAND_TAU = 0.12
const FALL_REF = 10            // m/s rơi cho nhún tối đa
const DRAW_S = 0.5
const IDLE_FLOURISH_S = 7      // đứng yên bấy nhiêu giây thì tự múa
const FLOURISH_S = [1.5, 1.3, 1.6] as const   // thời lượng từng kiểu múa
export const FLOURISH_KINDS = FLOURISH_S.length
const STILL_SPEED = 0.5        // m/s: dưới mức này tính là đứng yên
const STILL_TURN = 0.6         // rad/s: quay chuột chậm hơn mức này vẫn tính là đứng yên

export interface KnifeFx { px: number; py: number; pz: number; rx: number; ry: number; rz: number }

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v }
function smooth(t: number): number { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x) }

export class KnifeAnim {
  readonly fx: KnifeFx = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }

  private time = 0
  private lookYaw = 0
  private lookPitch = 0
  private prevYaw = 0
  private prevPitch = 0
  private lookInit = false
  private swayX = 0
  private swayY = 0
  private strafe = 0
  private velY = 0
  private speed = 0
  private grounded = true
  private fallPeak = 0
  private landDip = 0
  private jumpLift = 0
  private runBlend = 0
  private idleT = 0
  private drawT = -1
  private flKind = -1
  private flT = 0
  private nextKind = 0

  setLook(yaw: number, pitch: number): void { this.lookYaw = yaw; this.lookPitch = pitch }

  /** strafe = vận tốc ngang theo trục phải (m/s, + = sang phải), vy = vận tốc Y. Gọi trước setMotion. */
  setMove(strafe: number, vy: number): void { this.strafe = strafe; this.velY = vy }

  setMotion(speed: number, grounded: boolean): void {
    this.speed = speed
    if (!grounded) this.fallPeak = Math.max(this.fallPeak, -this.velY)
    else if (!this.grounded) {   // vừa chạm đất
      this.landDip = clamp(this.fallPeak / FALL_REF, 0, 1) * LAND_DIP
      this.fallPeak = 0
    }
    this.grounded = grounded
  }

  /** Vừa rút dao ra: tung xoay một vòng */
  startDraw(): void { this.drawT = 0; this.flKind = -1; this.idleT = 0 }

  /** Bấm phím xem dao: múa kiểu kế tiếp (lần lượt các kiểu) */
  inspect(): void {
    this.flKind = this.nextKind
    this.nextKind = (this.nextKind + 1) % FLOURISH_KINDS
    this.flT = 0
  }

  /** Ra đòn / có thao tác khác: dừng múa, đếm lại thời gian chờ */
  interrupt(): void { this.flKind = -1; this.idleT = 0 }

  get flourishing(): boolean { return this.flKind >= 0 }
  get drawing(): boolean { return this.drawT >= 0 }

  /** on = đang cầm dao; idle = không đang đổi súng (chỉ lúc đó mới được tự múa); speedN = tốc độ chạy 0..1; bobPhase/bobAmp = lắc của viewmodel */
  update(dt: number, on: boolean, idle: boolean, speedN: number, bobPhase: number, bobAmp: number): void {
    const f = this.fx
    f.px = f.py = f.pz = f.rx = f.ry = f.rz = 0
    if (!on) { this.flKind = -1; this.drawT = -1; this.lookInit = false; return }
    if (dt <= 0) return
    this.time += dt

    // Quán tính theo chuột: dao trễ so với camera rồi hồi về
    let yawRate = 0, pitchRate = 0
    if (this.lookInit) {
      let dy = this.lookYaw - this.prevYaw
      dy -= Math.round(dy / TAU) * TAU
      yawRate = dy / dt
      pitchRate = (this.lookPitch - this.prevPitch) / dt
    }
    this.prevYaw = this.lookYaw; this.prevPitch = this.lookPitch; this.lookInit = true
    const kS = 1 - Math.exp(-dt / SWAY_TAU)
    this.swayX += (clamp(yawRate * SWAY_GAIN, -SWAY_MAX, SWAY_MAX) - this.swayX) * kS
    this.swayY += (clamp(pitchRate * SWAY_GAIN, -SWAY_MAX, SWAY_MAX) - this.swayY) * kS
    f.px += this.swayX * 0.3; f.ry -= this.swayX      // quay trái → dao trễ sang phải
    f.py -= this.swayY * 0.2; f.rx -= this.swayY      // ngước lên → mũi dao trễ chúc xuống

    // Đi / chạy: cổ tay nghiêng theo nhịp bước, chạy nước rút thì hạ thấp, chúc mũi, lắc rộng hơn
    const runT = this.grounded ? smooth((speedN - RUN_FROM) / (1 - RUN_FROM)) : 0
    this.runBlend += (runT - this.runBlend) * Math.min(1, dt * 8)
    const s = Math.sin(bobPhase)
    f.rz += s * BOB_ROLL * bobAmp * (1 + this.runBlend)
    f.ry += Math.cos(bobPhase) * BOB_TWIST * bobAmp
    f.px += s * BOB_AMP_X * bobAmp * RUN_BOB_BOOST * this.runBlend - RUN_IN * this.runBlend
    f.py += Math.sin(bobPhase * 2) * BOB_AMP_Y * bobAmp * RUN_BOB_BOOST * this.runBlend - RUN_DROP * this.runBlend
    f.rx -= RUN_PITCH * this.runBlend

    // Thở khi đứng yên
    const still = 1 - bobAmp
    const bp = this.time * TAU / BREATH_PERIOD
    f.py += Math.sin(bp) * BREATH_Y * still
    f.rx += Math.sin(bp + 1) * BREATH_RX * still

    // Đi ngang: nghiêng dao theo chiều đi
    const sN = clamp(this.strafe / STRAFE_REF, -1, 1)
    f.rz += sN * LEAN_ROLL; f.px -= sN * 0.01

    // Nhảy: nhấc lên; tiếp đất: nhún xuống rồi hồi
    const liftT = this.grounded ? 0 : clamp(this.velY / JUMP_REF, -1, 1) * JUMP_LIFT
    this.jumpLift += (liftT - this.jumpLift) * Math.min(1, dt * 10)
    f.py += this.jumpLift
    this.landDip *= Math.exp(-dt / LAND_TAU)
    f.py -= this.landDip; f.rx -= this.landDip * 3

    // Rút dao: tung lên và xoay đúng một vòng (kết thúc ở góc ban đầu)
    if (this.drawT >= 0) {
      this.drawT += dt
      const u = clamp(this.drawT / DRAW_S, 0, 1)
      const e = 1 - (1 - u) * (1 - u) * (1 - u)
      f.rx += TAU * (1 - e)
      f.py += 0.05 * Math.sin(Math.PI * u)
      if (u >= 1) this.drawT = -1
    }

    // Múa dao: tự động khi đứng yên lâu, hoặc do phím
    const quiet = this.speed < STILL_SPEED && Math.abs(yawRate) < STILL_TURN && this.grounded
    if (this.flKind >= 0 && (!idle || this.speed > 2.5)) this.interrupt()
    if (this.flKind < 0) {
      this.idleT = quiet && idle && this.drawT < 0 ? this.idleT + dt : 0
      if (this.idleT >= IDLE_FLOURISH_S) this.inspect()
    } else {
      this.flT += dt / FLOURISH_S[this.flKind]!
      const u = clamp(this.flT, 0, 1)
      this.applyFlourish(this.flKind, u)
      if (this.flT >= 1) this.interrupt()
    }
  }

  private applyFlourish(kind: number, u: number): void {
    const f = this.fx
    if (kind === 0) {          // xoay lưỡi ra cho ngắm: đưa gần mắt, lật ngang
      const b = Math.sin(Math.PI * u)
      f.py += 0.05 * b; f.pz += 0.05 * b; f.rz -= 0.9 * b; f.ry += 0.35 * b
    } else if (kind === 1) {   // tung xoay: hạ nhẹ lấy đà, rồi lật nguyên vòng theo trục ngang
      const w = clamp((u - 0.15) / 0.65, 0, 1)
      f.rx -= TAU * smooth(w)
      f.py += 0.07 * Math.sin(Math.PI * w) - 0.02 * Math.sin(Math.PI * clamp(u / 0.15, 0, 1))
    } else {                   // xoay dao quanh trục dọc của nó
      const w = clamp((u - 0.2) / 0.6, 0, 1)
      f.rz += TAU * smooth(w)
      f.py += 0.03 * Math.sin(Math.PI * u); f.px -= 0.03 * Math.sin(Math.PI * u)
    }
  }
}
