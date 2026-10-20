// Đánh hơi (plan 16, I.3): người trong bán kính hiện lớp đỏ mờ xuyên tường trên màn hình zombie. Dùng capsule trong suốt `depthTest: false`
// (không phải shader viền) nên rẻ: tối đa 10 capsule dùng lại.
import * as THREE from 'three'

const MAX = 12

export function createSniffFx(scene: THREE.Scene) {
  const geo = new THREE.CapsuleGeometry(0.42, 1.0, 4, 10)
  const mat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false, fog: false })
  const meshes: THREE.Mesh[] = []
  for (let i = 0; i < MAX; i++) {
    const m = new THREE.Mesh(geo, mat)
    m.visible = false; m.renderOrder = 20; m.frustumCulled = false
    scene.add(m); meshes.push(m)
  }
  return {
    /** targets = vị trí chân của người cần hiện; active=false ẩn hết */
    update(active: boolean, targets: readonly { pos: [number, number, number]; crouching?: boolean }[], t: number): void {
      mat.opacity = 0.3 + 0.1 * Math.sin(t / 120)
      for (let i = 0; i < MAX; i++) {
        const m = meshes[i]!
        const tg = active ? targets[i] : undefined
        if (!tg) { m.visible = false; continue }
        m.visible = true
        const h = tg.crouching ? 1.2 : 1.8
        m.scale.y = h / 1.84
        m.position.set(tg.pos[0], tg.pos[1] + h / 2, tg.pos[2])
      }
    },
    clear(): void { for (const m of meshes) m.visible = false },
  }
}
