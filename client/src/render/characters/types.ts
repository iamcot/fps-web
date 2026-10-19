import type * as THREE from 'three'
import type { CharacterSetId, TeamId } from '@fps/shared'

/**
 * Khung xương chuẩn mà mọi bộ nhân vật phải dựng ra. Animation (animate.ts) và hiệu ứng chết (deathFx.ts)
 * chỉ làm việc trên khung này nên không biết gì về hình dáng cụ thể từng bộ.
 *
 * Hệ toạ độ: gốc ở chân, nhìn −Z (yaw 0), lưng +Z. Kích thước phải khớp hitbox (shared/hitbox.ts):
 * chân 0–0.8, thân 0.8–1.45, đầu 1.45–1.8 (rộng 0.35, sâu 0.3) — kit.ts đảm bảo điều đó.
 */
export interface CharacterRig {
  root: THREE.Group
  legL: THREE.Group      // pivot ở hông, xoay quanh X để đung đưa
  legR: THREE.Group
  upper: THREE.Group     // pivot ở hông: thân + đầu + tay + súng (nghiêng khi trượt / theo pitch)
  headPivot: THREE.Group // pivot ở cổ
  armL: THREE.Group      // pivot ở vai
  armR: THREE.Group
  gunAnchor: THREE.Group // trong `upper`, chĩa −Z
  headMesh: THREE.Mesh   // để test khớp hitbox
  parts: THREE.Mesh[]    // mọi khối (hiệu ứng chết tách ra từ đây)
  mats: THREE.MeshLambertMaterial[]
  team: TeamId
  armRestR: number       // góc X nghỉ của tay (đang cầm súng)
  armRestL: number
  anim: AnimTuning
}

// Hệ số animation riêng từng bộ (nhân vật nặng nề / nhẹ nhàng)
export interface AnimTuning {
  strideRadPerM: number  // pha bước theo quãng đường (rad/m)
  legSwing: number       // biên độ chân khi chạy hết tốc độ (rad)
  armSwing: number       // biên độ tay trái
  bobAmp: number         // nhún thân (m)
}

export const DEFAULT_ANIM: AnimTuning = { strideRadPerM: 3.6, legSwing: 0.75, armSwing: 0.35, bobAmp: 0.03 }

export interface CharacterSet {
  id: CharacterSetId
  label: string
  build(team: TeamId): CharacterRig
}
