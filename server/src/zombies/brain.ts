// Bộ não zombie (plan 17, T.4): chọn đường tới mục tiêu trên nav, sinh phím + yaw mỗi tick. Dùng chung cho zombie-thực-thể (Thủ Thành)
// và bot đóng vai zombie (Lây Nhiễm). Không đụng vào state: chỉ đọc vị trí rồi ghi vào `InputCmd`.
//
//  - Đi theo waypoint, nhìn thẳng hướng đi (zombie luôn nhìn trước mặt).
//  - Cạnh Hole: chạy thẳng tới mặt tường, còn ~HOLE_JUMP_DIST thì ngồi + nhảy.
//  - Cạnh Leap: tới đúng quãng bay (leapFlight) bằng cách nhích từng tick tới khi đứng yên, rồi bấm E.
//  - Chống kẹt: không tiến được thì nhảy rồi tìm đường lại; kẹt lâu → báo `stuckMs` cho nơi gọi quyết định (dịch chuyển, bỏ đích).
import { Btn, DT, ZOMBIE, leapFlight, type InputCmd, type PlayerState, type Vec3 } from '@fps/shared'
import { EdgeKind, type NavAbility, type NavGrid, type Waypoint } from '../bots/nav'

export const ZOMBIE_AI = {
  arriveM: 0.6,            // tới waypoint đi bộ
  repathMs: 400,           // tìm lại đường tối đa mỗi chừng này
  retargetM: 3,            // mục tiêu đi xa đường cũ hơn ngần này thì tìm lại
  holeJumpDist: 1.7,       // còn ngần này tới mặt tường thì ngồi + nhảy (đo bằng mô phỏng: cửa sổ nhảy ≈ 0,2s)
  leapTolM: 0.18,          // sai số quãng đứng bật chấp nhận
  leapRestSpeed: 0.45,     // phải gần như đứng yên mới bật (đà ngang cộng vào quãng bay)
  leapNudgeSpeed: 1.1,     // nhích từng tick chừng nào tốc độ còn dưới mức này
  leapFarM: 3.0,           // cách điểm bật hơn ngần này thì cứ chạy bình thường
  stuckProgressM: 0.5,     // 2s mà tiến được ít hơn ngần này = kẹt
  stuckCheckMs: 2000,
  attackRange: 1.6,
}

export interface BrainAbilities extends NavAbility { hole: boolean; leap: boolean }

export type BrainStep = { attack: boolean; stuckMs: number; repathed: boolean }

const _p: Vec3 = [0, 0, 0]
const _to: Vec3 = [0, 0, 0]

export class ZombieBrain {
  private path: Waypoint[] | null = null
  private idx = 0
  private pathEnd: Vec3 = [1e9, 0, 1e9]
  private nextRepathAt = 0
  private progressPos: Vec3 = [0, 0, 0]
  private progressAt = 0
  private stuckSince = -1
  private leaping = false          // đã bấm E, đang bay
  private leapT = 0
  private holePhase = 0            // 0 = chạy tới, 1 = đã ngồi + nhảy
  private holeT = 0
  private wasGrounded = true
  private tick = 0
  readonly out: BrainStep = { attack: false, stuckMs: 0, repathed: false }

  constructor(private readonly nav: NavGrid, readonly ability: BrainAbilities, private readonly rng: () => number = Math.random) {}

  reset(): void { this.path = null; this.idx = 0; this.leaping = false; this.holePhase = 0; this.stuckSince = -1; this.progressAt = 0 }
  get waypoint(): Waypoint | null { return this.path?.[this.idx] ?? null }

  /**
   * Sinh phím cho tick này. `target` = vị trí mục tiêu (null: đứng yên). `leapReady` = hồi chiêu E đã xong.
   * Ghi buttons/yaw/pitch vào `cmd` (không đụng seq/weapon). Trả thông tin tấn công/kẹt.
   */
  step(cmd: InputCmd, s: PlayerState, target: Vec3 | null, nowMs: number, leapReady: boolean): BrainStep {
    const out = this.out
    this.tick++
    out.attack = false; out.repathed = false
    cmd.buttons = 0
    cmd.pitch = 0
    if (!target) { out.stuckMs = 0; return out }
    const px = s.pos[0], py = s.pos[1], pz = s.pos[2]
    const hd = Math.hypot(target[0] - px, target[2] - pz)

    // tấn công khi tới gần: quay mặt vào mục tiêu, dừng lại (nơi gọi quyết định có nhìn thấy không)
    if (hd <= ZOMBIE_AI.attackRange && Math.abs(target[1] - py) < 1.6) {
      cmd.yaw = Math.atan2(-(target[0] - px), -(target[2] - pz))
      out.attack = true
      out.stuckMs = 0
      this.progressAt = 0
      return out
    }

    // tìm đường
    const far = Math.hypot(target[0] - this.pathEnd[0], target[2] - this.pathEnd[2]) > ZOMBIE_AI.retargetM
    if (!this.path || far || (nowMs >= this.nextRepathAt && this.idx >= this.path.length)) {
      if (nowMs >= this.nextRepathAt || !this.path) this.repath(s, target, nowMs)
    }

    // kẹt
    if (this.progressAt === 0) { this.progressPos[0] = px; this.progressPos[1] = py; this.progressPos[2] = pz; this.progressAt = nowMs }
    else if (nowMs - this.progressAt >= ZOMBIE_AI.stuckCheckMs) {
      const moved = Math.hypot(px - this.progressPos[0], pz - this.progressPos[2])
      this.progressPos[0] = px; this.progressPos[1] = py; this.progressPos[2] = pz; this.progressAt = nowMs
      if (moved < ZOMBIE_AI.stuckProgressM && !this.leaping) { if (this.stuckSince < 0) this.stuckSince = nowMs; this.repath(s, target, nowMs); cmd.buttons |= Btn.Jump }
      else this.stuckSince = -1
    }
    out.stuckMs = this.stuckSince < 0 ? 0 : nowMs - this.stuckSince

    const wp = this.path?.[this.idx]
    if (!wp) {   // không có đường: lao thẳng vào mục tiêu
      cmd.yaw = Math.atan2(-(target[0] - px), -(target[2] - pz))
      cmd.buttons |= Btn.Forward
      return out
    }
    this.follow(cmd, s, wp, nowMs, leapReady)
    this.wasGrounded = s.grounded
    return out
  }

  private repath(s: PlayerState, target: Vec3, nowMs: number): void {
    this.nextRepathAt = nowMs + ZOMBIE_AI.repathMs
    _p[0] = s.pos[0]; _p[1] = s.pos[1]; _p[2] = s.pos[2]
    _to[0] = target[0]; _to[1] = target[1]; _to[2] = target[2]
    this.path = this.nav.findPath(_p, _to, undefined, this.ability)
    this.idx = 0
    this.holePhase = 0
    this.pathEnd[0] = target[0]; this.pathEnd[1] = target[1]; this.pathEnd[2] = target[2]
    this.out.repathed = true
  }

  private follow(cmd: InputCmd, s: PlayerState, wp: Waypoint, nowMs: number, leapReady: boolean): void {
    const px = s.pos[0], py = s.pos[1], pz = s.pos[2]
    const dx = wp.x - px, dz = wp.z - pz
    const d = Math.hypot(dx, dz)
    const speed = Math.hypot(s.vel[0], s.vel[2])
    const yawTo = (x: number, z: number) => Math.atan2(-(x - px), -(z - pz))

    if (wp.kind === EdgeKind.Hole && wp.face) {
      const fd = Math.hypot(wp.face[0] - px, wp.face[1] - pz)
      cmd.yaw = yawTo(wp.x, wp.z)
      cmd.buttons |= Btn.Forward
      if (this.holePhase === 0 && fd <= ZOMBIE_AI.holeJumpDist && s.grounded) { this.holePhase = 1; this.holeT = nowMs; cmd.buttons |= Btn.Crouch | Btn.Jump }
      else if (this.holePhase === 1) {
        cmd.buttons |= Btn.Crouch                                     // giữ ngồi cho tới khi qua khỏi tường
        if (s.grounded && nowMs - this.holeT > 200 && d < 2.5) cmd.buttons &= ~Btn.Crouch
      }
      if (d < ZOMBIE_AI.arriveM + 0.3 || (this.holePhase === 1 && s.grounded && nowMs - this.holeT > 400 && fd > 0.3 && this.passedFace(wp, px, pz))) this.advance()
      return
    }

    if (wp.kind === EdgeKind.Leap) {
      cmd.yaw = yawTo(wp.x, wp.z)
      const dy = wp.y - py
      const fl = leapFlight(dy)
      if (this.leaping) {
        // đang bay: không bấm gì (đà ngang đã định sẵn). Hạ cánh → xong hoặc hỏng
        this.leapT += DT
        if (s.grounded && this.leapT > 0.15) {
          this.leaping = false
          if (Math.hypot(wp.x - px, wp.z - pz) < 1.3 && Math.abs(wp.y - py) < 1.0) this.advance()
          else this.nextRepathAt = 0   // hỏng: tìm đường lại
        }
        return
      }
      if (!fl) { this.advance(); return }
      const L = fl.dist
      if (d > L + ZOMBIE_AI.leapFarM) { cmd.buttons |= Btn.Forward; if (d < 2.5 && wp.jump) cmd.buttons |= Btn.Jump; return }
      // đứng tại quãng bay: nhích tới/lui từng tick tới khi đúng quãng và đứng yên
      const err = d - L
      if (Math.abs(err) <= ZOMBIE_AI.leapTolM && speed <= ZOMBIE_AI.leapRestSpeed && s.grounded && leapReady) {
        cmd.buttons |= Btn.Ability; this.leaping = true; this.leapT = 0
        return
      }
      if (speed < ZOMBIE_AI.leapNudgeSpeed) {
        if (err > ZOMBIE_AI.leapTolM && d > L + 0.9) cmd.buttons |= Btn.Forward            // còn xa: chạy tiếp (sẽ trượt phanh)
        else if (err > ZOMBIE_AI.leapTolM && this.tick % 6 === 0) cmd.buttons |= Btn.Forward   // gần: chạm nhẹ từng nhịp
        else if (err < -ZOMBIE_AI.leapTolM && this.tick % 6 === 0) cmd.buttons |= Btn.Back
      }
      return
    }

    // đi bộ / nhảy gờ / nhảy xuống
    cmd.yaw = yawTo(wp.x, wp.z)
    cmd.buttons |= Btn.Forward
    if (wp.jump && d < 1.6 && s.grounded) cmd.buttons |= Btn.Jump
    const dyAbs = Math.abs(wp.y - py)
    if (d < ZOMBIE_AI.arriveM && dyAbs < 1.2) this.advance()
  }

  private passedFace(wp: Waypoint, px: number, pz: number): boolean {
    const f = wp.face!
    // đã qua mặt tường: mặt tường nằm sau lưng so với hướng tới waypoint
    return (wp.x - f[0]) * (wp.x - px) + (wp.z - f[1]) * (wp.z - pz) < (wp.x - f[0]) ** 2 + (wp.z - f[1]) ** 2 - 1.6
  }

  private advance(): void { this.idx++; this.holePhase = 0; this.leaping = false }
}
