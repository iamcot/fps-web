import type { CollisionWorld } from './physics/world'
import type { PlayerState } from './movement'
import { defaultMovement, type MovementConfig } from './movement'
import { forwardFromYaw, rightFromYaw, type Vec3 } from './math'
import { shootDir } from './hitbox'
import { GRENADE, type ThrowMode } from './grenade'
import type { TeamId } from './teams'

// Vật lý lựu đạn (plan 12, G.2): thuần, tất định, chỉ va chạm với collider map (không chạm người chơi).
// Client mô phỏng lại mọi quả từ GrenadeSpawn nên server/client phải chạy đúng cùng một hàm với cùng dt.
export interface GrenadeState {
  id: number
  ownerId: number
  team: TeamId
  pos: Vec3
  vel: Vec3
  spawnTick: number        // tick server lúc rời tay
  resting: boolean
}

export interface GrenadeEvent { type: 'bounce'; speed: number }

const MAX_ITER = 3            // số lần va chạm xử lý trong một tick
const SKIN = 0.001            // lùi 1mm theo pháp tuyến sau va chạm để không kẹt trong collider
const EPS = 1e-9
const FLOOR_NORMAL_Y = 0.7    // pháp tuyến y trên mức này = sàn (đi bộ được)

const _fwd: Vec3 = [0, 0, 0]
const _right: Vec3 = [0, 0, 0]

/** Điểm xuất phát + vận tốc ban đầu khi ném. Xuất phát lệch tay phải/trước mắt; bị tường chắn thì xuất phát ngay tại mắt. */
export function throwInitial(
  owner: Pick<PlayerState, 'pos' | 'vel' | 'yaw' | 'pitch' | 'crouching'>,
  mode: ThrowMode,
  world: CollisionWorld,
  cfg: MovementConfig = defaultMovement,
): { pos: Vec3; vel: Vec3 } {
  const eyeY = owner.pos[1] + (owner.crouching ? cfg.eyeCrouch : cfg.eyeStand)
  const eye: Vec3 = [owner.pos[0], eyeY, owner.pos[2]]
  forwardFromYaw(owner.yaw, _fwd); rightFromYaw(owner.yaw, _right)
  const start: Vec3 = [
    eye[0] + _right[0] * 0.15 + _fwd[0] * 0.3,
    eye[1] - 0.05,
    eye[2] + _right[2] * 0.15 + _fwd[2] * 0.3,
  ]
  // tia từ mắt tới điểm xuất phát: chạm tường thì không để lựu đạn chui qua tường khi đứng sát tường
  const dx = start[0] - eye[0], dy = start[1] - eye[1], dz = start[2] - eye[2]
  const len = Math.hypot(dx, dy, dz)
  const hit = world.castRay(eye, [dx / len, dy / len, dz / len], len)
  const pos: Vec3 = hit ? [eye[0], eye[1], eye[2]] : start
  const dir = shootDir(owner.yaw, owner.pitch + GRENADE.throwUpDeg[mode] * Math.PI / 180)
  const sp = GRENADE.throwSpeed[mode], inh = GRENADE.inheritVelocity
  return { pos, vel: [dir[0] * sp + owner.vel[0] * inh, dir[1] * sp + owner.vel[1] * inh, dir[2] * sp + owner.vel[2] * inh] }
}

/**
 * Một tick vật lý. Trả về sự kiện 'bounce' (tốc độ va chạm theo pháp tuyến, lần mạnh nhất trong tick) hoặc null.
 * Dùng castSphere theo quãng đường của tick (liên tục): lựu đạn nhỏ + nhanh không xuyên tường.
 */
export function stepGrenade(g: GrenadeState, world: CollisionWorld, dt: number): GrenadeEvent | null {
  if (g.resting) return null
  const pos = g.pos, vel = g.vel
  vel[1] -= GRENADE.gravity * dt
  let remaining = dt
  let strongest = 0
  let onFloor = false
  let iter = 0
  while (remaining > 1e-7 && iter < MAX_ITER) {
    const speed = Math.hypot(vel[0], vel[1], vel[2])
    const move = speed * remaining
    if (move < EPS) break
    const inv = 1 / speed
    const dir: Vec3 = [vel[0] * inv, vel[1] * inv, vel[2] * inv]
    const hit = world.castSphere(pos, dir, move, GRENADE.radius)
    if (!hit) {
      pos[0] += vel[0] * remaining; pos[1] += vel[1] * remaining; pos[2] += vel[2] * remaining
      remaining = 0
      break
    }
    const n = hit.normal
    const d = Math.min(hit.dist, move)
    pos[0] += dir[0] * d + n[0] * SKIN; pos[1] += dir[1] * d + n[1] * SKIN; pos[2] += dir[2] * d + n[2] * SKIN
    remaining *= 1 - d / move
    const vn = vel[0] * n[0] + vel[1] * n[1] + vel[2] * n[2]   // < 0: đang lao vào bề mặt
    if (vn < 0) {
      const into = -vn
      const floor = n[1] > FLOOR_NORMAL_Y
      const tx = vel[0] - n[0] * vn, ty = vel[1] - n[1] * vn, tz = vel[2] - n[2] * vn
      if (floor && into <= GRENADE.bounceMinSpeed) {
        // chạm sàn chậm = lăn: không nảy, giữ vận tốc tiếp tuyến (ma sát lăn ở dưới)
        vel[0] = tx; vel[1] = ty; vel[2] = tz
        onFloor = true
      } else {
        const k = 1 - GRENADE.friction
        vel[0] = -vn * n[0] * GRENADE.restitution + tx * k
        vel[1] = -vn * n[1] * GRENADE.restitution + ty * k
        vel[2] = -vn * n[2] * GRENADE.restitution + tz * k
        if (into > GRENADE.bounceMinSpeed && into > strongest) strongest = into
        if (floor) onFloor = true
      }
    }
    iter++
  }
  if (remaining > 1e-7 && iter >= MAX_ITER) { vel[0] = 0; vel[1] = 0; vel[2] = 0 }   // kẹt rung trong góc: đứng yên tick này
  if (onFloor) {
    // lăn trên sàn: giảm tốc tiếp tuyến; đủ chậm thì nằm yên
    const hs = Math.hypot(vel[0], vel[2])
    const ns = Math.max(0, hs - GRENADE.rollDrag * dt)
    if (hs > EPS) { const k = ns / hs; vel[0] *= k; vel[2] *= k }
    if (Math.hypot(vel[0], vel[1], vel[2]) < GRENADE.restSpeed) { g.resting = true; vel[0] = 0; vel[1] = 0; vel[2] = 0 }
  }
  return strongest > 0 ? { type: 'bounce', speed: strongest } : null
}
