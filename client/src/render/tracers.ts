import * as THREE from 'three'

const POOL = 24
const LIFE_MS = 90
const START_OFFSET = 0.6   // bắt đầu cách mắt một chút, như đầu nòng
const STREAK = 3           // chiều dài vệt (m)

// Vệt đạn của người khác (ShotFx): một đoạn ngắn lao dọc tia bắn rồi biến mất, không phải đường dài liên tục.
// Pool cố định, không cấp phát mỗi phát.
export function createTracers(scene: THREE.Scene) {
  const lines: THREE.Line[] = []
  const age: number[] = []
  const org = new Float32Array(POOL * 3)
  const dir = new Float32Array(POOL * 3)
  const dst = new Float32Array(POOL)
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
    add(origin: readonly number[], d: readonly number[], dist: number): void {
      const i = next; next = (next + 1) % POOL
      for (let k = 0; k < 3; k++) { org[i * 3 + k] = origin[k]!; dir[i * 3 + k] = d[k]! }
      dst[i] = dist
      age[i] = 0
      lines[i]!.visible = true
    },
    update(dtMs: number): void {
      for (let i = 0; i < POOL; i++) {
        if (age[i]! >= LIFE_MS) continue
        age[i]! += dtMs
        const l = lines[i]!
        if (age[i]! >= LIFE_MS) { l.visible = false; continue }
        // Đầu vệt chạy từ nòng tới điểm trúng; đuôi cách đầu STREAK mét (không lùi quá nòng)
        const dist = dst[i]!
        const head = START_OFFSET + (dist - START_OFFSET) * (age[i]! / LIFE_MS)
        const tail = Math.max(Math.min(START_OFFSET, dist), head - STREAK)
        const attr = l.geometry.getAttribute('position') as THREE.BufferAttribute
        const a = attr.array as Float32Array
        for (let k = 0; k < 3; k++) {
          a[k] = org[i * 3 + k]! + dir[i * 3 + k]! * tail
          a[3 + k] = org[i * 3 + k]! + dir[i * 3 + k]! * Math.min(head, dist)
        }
        attr.needsUpdate = true
        ;(l.material as THREE.LineBasicMaterial).opacity = 1 - 0.5 * (age[i]! / LIFE_MS)
      }
    },
  }
}
