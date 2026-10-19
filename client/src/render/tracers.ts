import * as THREE from 'three'

const POOL = 24
const LIFE_MS = 150
const START_OFFSET = 0.6   // bắt đầu cách mắt một chút, như đầu nòng

// Vệt đạn của người khác (ShotFx): pool cố định, không cấp phát mỗi phát.
export function createTracers(scene: THREE.Scene) {
  const lines: THREE.Line[] = []
  const age: number[] = []
  for (let i = 0; i < POOL; i++) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true }))
    l.visible = false
    l.frustumCulled = false
    scene.add(l)
    lines.push(l)
    age.push(LIFE_MS)
  }
  let next = 0

  return {
    add(origin: readonly number[], dir: readonly number[], dist: number): void {
      const i = next; next = (next + 1) % POOL
      const l = lines[i]!
      const a = (l.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array
      const s = Math.min(START_OFFSET, dist)
      a[0] = origin[0]! + dir[0]! * s; a[1] = origin[1]! + dir[1]! * s; a[2] = origin[2]! + dir[2]! * s
      a[3] = origin[0]! + dir[0]! * dist; a[4] = origin[1]! + dir[1]! * dist; a[5] = origin[2]! + dir[2]! * dist
      ;(l.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      ;(l.material as THREE.LineBasicMaterial).opacity = 1
      l.visible = true
      age[i] = 0
    },
    update(dtMs: number): void {
      for (let i = 0; i < POOL; i++) {
        if (age[i]! >= LIFE_MS) continue
        age[i]! += dtMs
        const l = lines[i]!
        if (age[i]! >= LIFE_MS) { l.visible = false; continue }
        ;(l.material as THREE.LineBasicMaterial).opacity = 1 - age[i]! / LIFE_MS
      }
    },
  }
}
