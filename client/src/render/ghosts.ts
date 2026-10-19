import * as THREE from 'three'
import { defaultMovement, NetFlag, type NetPlayer } from '@fps/shared'

// F5: "bóng ma" wireframe ở vị trí server thật (snapshot mới nhất, không nội suy) của mọi người,
// kể cả mình. Của mình đi sau nhân vật đúng khoảng trễ ping.
export function createGhosts(scene: THREE.Scene) {
  const { radius, standHeight, crouchHeight } = defaultMovement
  const geo = new THREE.CapsuleGeometry(radius, standHeight - 2 * radius, 4, 8)
  const selfMat = new THREE.MeshBasicMaterial({ color: 0xffee00, wireframe: true })
  const otherMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true })
  const meshes = new Map<number, THREE.Mesh>()
  const lastSeen = new Map<number, number>()
  let frame = 0
  let visible = false

  document.addEventListener('keydown', e => {
    if (e.code !== 'F5') return
    visible = !visible
    for (const m of meshes.values()) m.visible = visible
    e.preventDefault()
  })

  function remove(id: number) {
    const m = meshes.get(id)
    if (m) scene.remove(m)
    meshes.delete(id)
    lastSeen.delete(id)
  }

  return {
    get visible() { return visible },
    update(players: NetPlayer[], selfId: number) {
      if (!visible) return
      frame++
      for (const p of players) {
        let m = meshes.get(p.id)
        if (!m) {
          m = new THREE.Mesh(geo, p.id === selfId ? selfMat : otherMat)
          scene.add(m)
          meshes.set(p.id, m)
        }
        m.visible = true
        lastSeen.set(p.id, frame)
        const h = (p.flags & NetFlag.Crouching) ? crouchHeight : standHeight
        m.scale.y = h / standHeight
        m.position.set(p.pos[0], p.pos[1] + h / 2, p.pos[2])
        m.rotation.y = p.yaw
      }
      for (const id of meshes.keys()) if (lastSeen.get(id) !== frame) remove(id)
    },
    clear() { for (const id of [...meshes.keys()]) remove(id) },
  }
}
