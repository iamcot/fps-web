import * as THREE from 'three'
import { DT, GRENADE, stepGrenade, throwInitial, type GrenadeState, type PlayerState, type ThrowMode } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { poses } from './poses'

// Đường bay dự kiến (plan 12, G.5): khi giữ ở trạng thái ready, vẽ chuỗi chấm trắng mờ theo đúng throwInitial + stepGrenade
// (tối đa trajectoryMaxS giây, dừng ở lần nảy đầu tiên), chấm cuối là vòng tròn nhỏ trên mặt chạm. Không cấp phát mỗi frame.
const MAX_DOTS = 80
const DOT_R = 0.014
const RING_R0 = 0.07, RING_R1 = 0.095

const sim: GrenadeState = { id: 0, ownerId: 0, team: 'A', pos: [0, 0, 0], vel: [0, 0, 0], spawnTick: 0, resting: false }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3()
const _up = new THREE.Vector3(0, 0, 1), _n = new THREE.Vector3()

export function createGrenadeTrajectory(scene: THREE.Scene) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(DOT_R, 6, 4), mat, MAX_DOTS)
  dots.frustumCulled = false; dots.visible = false; dots.renderOrder = 5
  const ring = new THREE.Mesh(new THREE.RingGeometry(RING_R0, RING_R1, 20), mat)
  ring.frustumCulled = false; ring.visible = false; ring.renderOrder = 5
  scene.add(dots, ring)
  return {
    /** Vẽ nếu `on`; state = vị trí/vận tốc người ném, yaw/pitch = hướng nhìn hiện tại (gồm cả recoil nếu có) */
    update(on: boolean, world: CollisionWorld | null, player: PlayerState, mode: ThrowMode): void {
      if (!on || !world || !poses.grenade.trajectory) { dots.visible = false; ring.visible = false; return }
      const t = throwInitial(player, mode, world)
      sim.pos[0] = t.pos[0]; sim.pos[1] = t.pos[1]; sim.pos[2] = t.pos[2]
      sim.vel[0] = t.vel[0]; sim.vel[1] = t.vel[1]; sim.vel[2] = t.vel[2]
      sim.resting = false
      const every = Math.max(1, Math.round(poses.grenade.dotEveryS / DT))
      const steps = Math.round(poses.grenade.trajectoryMaxS / DT)
      let n = 0, hit = false
      for (let i = 1; i <= steps && n < MAX_DOTS; i++) {
        const ev = stepGrenade(sim, world, DT)
        if (i % every === 0 && !ev) { _p.set(sim.pos[0], sim.pos[1], sim.pos[2]); dots.setMatrixAt(n++, _m.compose(_p, _q.identity(), _s)) }
        if (ev || sim.resting) { hit = true; break }
      }
      dots.count = n
      dots.instanceMatrix.needsUpdate = true
      dots.visible = n > 0
      ring.visible = hit
      if (hit) {
        // pháp tuyến mặt chạm: quét một đoạn ngắn theo vận tốc còn lại (quả vừa nảy: vận tốc đã đổi hướng ra khỏi mặt → quét ngược)
        const sp = Math.hypot(sim.vel[0], sim.vel[1], sim.vel[2])
        _n.set(0, 1, 0)
        if (sp > 1e-3) {
          const h = world.castSphere(sim.pos, [-sim.vel[0] / sp, -sim.vel[1] / sp, -sim.vel[2] / sp], 0.3, GRENADE.radius)
          if (h) _n.set(-h.normal[0], -h.normal[1], -h.normal[2]).normalize()
          else _n.set(0, 1, 0)
        }
        ring.position.set(sim.pos[0], sim.pos[1], sim.pos[2]).addScaledVector(_n, 0.01 - GRENADE.radius)
        ring.quaternion.setFromUnitVectors(_up, _n)
      }
    },
    /** Số chấm đang vẽ (test/debug) */
    get dotCount(): number { return dots.visible ? dots.count : 0 },
    get ringVisible(): boolean { return ring.visible },
    dispose(): void { scene.remove(dots, ring); dots.geometry.dispose(); ring.geometry.dispose(); mat.dispose() },
  }
}
