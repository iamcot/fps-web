import * as THREE from 'three'
import { defaultMovement, NetFlag, type NetPlayer } from '@fps/shared'

const COLORS = [0x3377ff, 0xff4433, 0x33cc66, 0xffcc22, 0xcc44ff, 0x22cccc, 0xff8833, 0xaaaaaa]

// Người chơi = capsule màu; pos là vị trí chân. Cao đứng/ngồi lấy từ MovementConfig.
export function createPlayersRenderer(scene: THREE.Scene) {
  const { radius, standHeight, crouchHeight } = defaultMovement
  const geo = new THREE.CapsuleGeometry(radius, standHeight - 2 * radius, 4, 12)
  const meshes = new Map<number, THREE.Mesh>()

  function ensure(id: number): THREE.Mesh {
    let m = meshes.get(id)
    if (!m) {
      m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COLORS[id % COLORS.length]! }))
      m.castShadow = true
      scene.add(m)
      meshes.set(id, m)
    }
    return m
  }

  function place(m: THREE.Mesh, p: NetPlayer) {
    const h = (p.flags & NetFlag.Crouching) ? crouchHeight : standHeight
    m.scale.y = h / standHeight
    m.position.set(p.pos[0], p.pos[1] + h / 2, p.pos[2])
    m.rotation.y = p.yaw
  }

  return {
    // Vẽ đúng danh sách người chơi trong snapshot; ai không còn trong danh sách thì xoá.
    // Không vẽ chính mình: camera nằm trong capsule, lệch quá bán kính vài frame (jitter) là lộ ra.
    update(players: NetPlayer[], selfId = -1) {
      const seen = new Set<number>()
      for (const p of players) {
        if (p.id === selfId) continue
        seen.add(p.id); place(ensure(p.id), p)
      }
      for (const [id, m] of meshes) {
        if (seen.has(id)) continue
        scene.remove(m)
        ;(m.material as THREE.Material).dispose()
        meshes.delete(id)
      }
    },
    clear() { this.update([]) },
  }
}
