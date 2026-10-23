import * as THREE from 'three'
import type { HitBox } from '@fps/shared'

const LIFE_MS = 2000
const RAY_LEN = 60

// F7: wireframe hitbox (đã tua) + tia của phát bắn gần nhất, từ DebugShot của server. Dùng để kiểm tra
// hitbox tua về có trùng hình capsule đã thấy lúc bắn không. Chỉ debug nên cho phép cấp phát mỗi phát.
export function createDebugShots(scene: THREE.Scene) {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
  const boxMat = new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false })
  const rayMat = new THREE.LineBasicMaterial({ color: 0x33ff66, depthTest: false })
  const bladeMat = new THREE.LineBasicMaterial({ color: 0xffdd33, depthTest: false })
  const live: { g: THREE.Group; age: number }[] = []

  return {
    add(origin: readonly number[], dir: readonly number[], boxes: readonly HitBox[], blade?: readonly number[]): void {
      const g = new THREE.Group()
      for (const b of boxes) {
        const m = new THREE.LineSegments(edges, boxMat)
        m.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
        m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
        g.add(m)
      }
      if (blade) {   // cận chiến: các đoạn quét (gốc → mũi) của tick này thay cho tia dài
        for (let i = 0; i + 5 < blade.length; i += 6) {
          const bg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(blade[i], blade[i + 1], blade[i + 2]), new THREE.Vector3(blade[i + 3], blade[i + 4], blade[i + 5])])
          g.add(new THREE.Line(bg, bladeMat))
        }
      } else {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(origin[0], origin[1], origin[2]),
          new THREE.Vector3(origin[0]! + dir[0]! * RAY_LEN, origin[1]! + dir[1]! * RAY_LEN, origin[2]! + dir[2]! * RAY_LEN),
        ])
        g.add(new THREE.Line(geo, rayMat))
      }
      scene.add(g)
      live.push({ g, age: 0 })
    },
    update(dtMs: number): void {
      for (let i = live.length - 1; i >= 0; i--) {
        const l = live[i]!
        l.age += dtMs
        if (l.age < LIFE_MS) continue
        scene.remove(l.g)
        l.g.traverse(o => { if (o instanceof THREE.Line) { if (o.geometry !== edges) o.geometry.dispose() } })
        live.splice(i, 1)
      }
    },
  }
}
