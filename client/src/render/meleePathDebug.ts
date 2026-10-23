import * as THREE from 'three'
import paths from '../../../shared/src/meleePaths.json'

// Overlay debug cung quét bake (bật bằng ?meleeDebug=1): đường mũi vũ khí bake của chiêu đang chạy (xanh lá, đoạn đang trong cửa sổ đánh màu đỏ)
// và điểm bake tại thời điểm hiện tại. Phải trùng với lưỡi vũ khí trên nhân vật; lệch = clip / mốc `hit` / độ dài vũ khí chưa đúng.
interface Baked { tickCount: number; windows: number[][]; tip: number[] }
const baked = paths as unknown as Record<string, Baked>
const MAX_PTS = 200

export function meleeDebugEnabled(): boolean {
  try { return new URLSearchParams(location.search).has('meleeDebug') } catch { return false }
}

export class MeleePathDebug {
  private readonly line: THREE.Line
  private readonly hot: THREE.Line
  private readonly dot: THREE.Mesh
  private readonly pos = new Float32Array(MAX_PTS * 3)
  private readonly hotPos = new Float32Array(MAX_PTS * 3)
  private readonly dotPos = new Float32Array(3)

  constructor(scene: THREE.Scene) {
    const mk = (arr: Float32Array, color: number): THREE.Line => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); g.setDrawRange(0, 0)
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false })); l.frustumCulled = false; l.renderOrder = 999; scene.add(l); return l
    }
    this.line = mk(this.pos, 0x44ff66)
    this.hot = mk(this.hotPos, 0xff3344)
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.05), new THREE.MeshBasicMaterial({ color: 0xffee33, depthTest: false }))
    this.dot.renderOrder = 999; this.dot.visible = false; scene.add(this.dot)
  }

  /** `key`: khoá chiêu (null = không có chiêu); `tick`: tiến độ chiêu theo tick 60 Hz */
  update(key: string | null, tick: number, x: number, y: number, z: number, yaw: number): void {
    const b = key ? baked[key] : undefined
    if (!b) { this.line.visible = this.hot.visible = this.dot.visible = false; return }
    const n = Math.min(b.tickCount, MAX_PTS)
    const c = Math.cos(yaw), s = Math.sin(yaw)
    // xoay quanh Y theo yaw (yaw = 0 nhìn -Z, tăng = quay trái)
    const put = (arr: Float32Array, o: number, i: number): void => {
      const px = b.tip[i * 3]! / 1000, py = b.tip[i * 3 + 1]! / 1000, pz = b.tip[i * 3 + 2]! / 1000
      arr[o] = x + px * c + pz * s; arr[o + 1] = y + py; arr[o + 2] = z - px * s + pz * c
    }
    for (let i = 0; i < n; i++) put(this.pos, i * 3, i)
    this.line.geometry.setDrawRange(0, n); (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    let h = 0
    for (const [a, z2] of b.windows) for (let i = a!; i < Math.min(z2!, n); i++) put(this.hotPos, h++ * 3, i)
    this.hot.geometry.setDrawRange(0, h); (this.hot.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    const k = Math.max(0, Math.min(n - 1, Math.round(tick)))
    put(this.dotPos, 0, k); this.dot.position.set(this.dotPos[0]!, this.dotPos[1]!, this.dotPos[2]!)
    this.line.visible = this.hot.visible = this.dot.visible = true
  }
}
