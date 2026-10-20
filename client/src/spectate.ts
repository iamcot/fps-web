// Chế độ xem đồng đội khi chết (Sinh Tử, task M.5): camera góc 3 sau lưng đồng đội còn sống; không xem được địch.
import * as THREE from 'three'

export interface SpecCandidate { id: number; pos: readonly [number, number, number]; yaw: number; pitch: number }
type Raycast = (o: [number, number, number], d: [number, number, number], maxDist: number) => { dist: number } | null

const BACK_M = 3.0          // lùi sau lưng
const UP_M = 0.35           // cao hơn mắt một chút
const SIDE_M = 0.6          // lệch phải (qua vai)
const EYE_M = 1.6
const WALL_PAD_M = 0.25     // chống xuyên tường: dừng cách tường chừng này
const LOST_DELAY_MS = 1500  // đồng đội đang xem bị hạ → chờ rồi tự chuyển người khác
const SMOOTH = 14           // 1/giây: độ mượt camera

export function createSpectator(raycast: () => Raycast | null) {
  let targetId = -1
  let lostAt = 0
  let have = false
  let orbit = 0
  const pos = new THREE.Vector3()
  const want = new THREE.Vector3()
  const eye: [number, number, number] = [0, 0, 0]
  const dir: [number, number, number] = [0, 0, 0]

  function pick(cands: readonly SpecCandidate[], nowMs: number): SpecCandidate | null {
    if (cands.length === 0) { targetId = -1; return null }
    const cur = cands.find(c => c.id === targetId)
    if (cur) { lostAt = 0; return cur }
    if (targetId !== -1) {   // đang xem mà người đó bị hạ / rời: chờ một lúc rồi mới chuyển
      if (lostAt === 0) lostAt = nowMs
      if (nowMs - lostAt < LOST_DELAY_MS) return null
    }
    targetId = cands[0]!.id; lostAt = 0; have = false
    return cands[0]!
  }

  return {
    /** Chuyển sang đồng đội kế tiếp (chuột trái / Space) */
    next(cands: readonly SpecCandidate[]): void {
      if (cands.length === 0) return
      const i = cands.findIndex(c => c.id === targetId)
      targetId = cands[(i + 1) % cands.length]!.id
      lostAt = 0; have = false
    },
    get targetId(): number { return targetId },
    reset(): void { targetId = -1; lostAt = 0; have = false },
    /** Đặt camera. Trả id người đang xem (-1 = camera bay trên cao) */
    apply(camera: THREE.PerspectiveCamera, cands: readonly SpecCandidate[], dt: number, nowMs: number): number {
      const t = pick(cands, nowMs)
      if (!t) {
        if (targetId === -1) {   // không còn ai để xem: bay vòng trên cao nhìn xuống toàn map
          orbit += dt * 0.15
          camera.position.set(Math.cos(orbit) * 42, 30, Math.sin(orbit) * 28)
          camera.lookAt(0, 0, 0)
          have = false
        }
        return -1
      }
      const cp = Math.cos(t.pitch)
      dir[0] = -Math.sin(t.yaw) * cp; dir[1] = Math.sin(t.pitch); dir[2] = -Math.cos(t.yaw) * cp
      eye[0] = t.pos[0]; eye[1] = t.pos[1] + EYE_M; eye[2] = t.pos[2]
      want.set(eye[0] - dir[0] * BACK_M + Math.cos(t.yaw) * SIDE_M, eye[1] - dir[1] * BACK_M + UP_M, eye[2] - dir[2] * BACK_M - Math.sin(t.yaw) * SIDE_M)
      // Chống xuyên tường: bắn tia từ mắt tới vị trí muốn, dừng trước chỗ chạm
      const rc = raycast()
      const dx = want.x - eye[0], dy = want.y - eye[1], dz = want.z - eye[2]
      const len = Math.hypot(dx, dy, dz)
      if (rc && len > 1e-4) {
        const hit = rc(eye, [dx / len, dy / len, dz / len], len + WALL_PAD_M)
        if (hit && hit.dist < len + WALL_PAD_M) {
          const k = Math.max(0, hit.dist - WALL_PAD_M) / len
          want.set(eye[0] + dx * k, eye[1] + dy * k, eye[2] + dz * k)
        }
      }
      if (!have) { pos.copy(want); have = true } else pos.lerp(want, 1 - Math.exp(-dt * SMOOTH))
      camera.position.copy(pos)
      camera.rotation.order = 'YXZ'
      camera.rotation.set(t.pitch, t.yaw, 0)
      return t.id
    },
  }
}
