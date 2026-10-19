import * as THREE from 'three'
import type { CharacterRig } from './types'

// Chết (6.2): các khối tách ra, bay nhẹ rồi mờ dần. Rẻ hơn ragdoll, hợp phong cách khối hộp.
const GRAVITY = 9.8
const LIFE_S = 1.4
const FADE_S = 0.7
const FLOOR_Y = 0.06

interface Debris {
  mesh: THREE.Mesh
  vx: number; vy: number; vz: number
  wx: number; wy: number; wz: number   // tốc độ xoay (rad/s)
  age: number
}

const _pos = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _quat = new THREE.Quaternion()

export function createDeathFx(scene: THREE.Scene) {
  const live: Debris[] = []

  function remove(i: number): void {
    const d = live[i]!
    scene.remove(d.mesh)
    ;(d.mesh.material as THREE.Material).dispose()   // geometry dùng chung với rig nên không dispose ở đây
    live[i] = live[live.length - 1]!
    live.pop()
  }

  return {
    // Gọi một lần khi rig vừa chết; rig phải đang ở tư thế cuối (matrixWorld cập nhật tại đây)
    burst(rig: CharacterRig): void {
      rig.root.updateWorldMatrix(true, true)
      const cx = rig.root.position.x, cy = rig.root.position.y + 0.9, cz = rig.root.position.z
      for (const part of rig.parts) {
        part.matrixWorld.decompose(_pos, _quat, _scale)
        const mat = (part.material as THREE.MeshLambertMaterial).clone()
        mat.transparent = true
        mat.opacity = 1
        const mesh = new THREE.Mesh(part.geometry, mat)
        mesh.position.copy(_pos); mesh.quaternion.copy(_quat); mesh.scale.copy(_scale)
        scene.add(mesh)
        let dx = _pos.x - cx, dy = _pos.y - cy, dz = _pos.z - cz
        const len = Math.hypot(dx, dy, dz) || 1
        dx /= len; dy /= len; dz /= len
        live.push({
          mesh,
          vx: dx * 1.6 + (Math.random() - 0.5) * 0.8,
          vy: 1.5 + dy * 1.0 + Math.random() * 1.5,
          vz: dz * 1.6 + (Math.random() - 0.5) * 0.8,
          wx: (Math.random() - 0.5) * 8, wy: (Math.random() - 0.5) * 8, wz: (Math.random() - 0.5) * 8,
          age: 0,
        })
      }
    },
    update(dt: number): void {
      for (let i = live.length - 1; i >= 0; i--) {
        const d = live[i]!
        d.age += dt
        if (d.age >= LIFE_S) { remove(i); continue }
        d.vy -= GRAVITY * dt
        const m = d.mesh
        m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt
        m.rotation.x += d.wx * dt; m.rotation.y += d.wy * dt; m.rotation.z += d.wz * dt
        if (m.position.y < FLOOR_Y) {   // chạm đất: trượt/xoay chậm dần
          m.position.y = FLOOR_Y
          d.vy = 0; d.vx *= 0.8; d.vz *= 0.8; d.wx *= 0.7; d.wy *= 0.7; d.wz *= 0.7
        }
        const left = LIFE_S - d.age
        if (left < FADE_S) (m.material as THREE.MeshLambertMaterial).opacity = left / FADE_S
      }
    },
    get count(): number { return live.length },
    clear(): void { while (live.length) remove(live.length - 1) },
  }
}
