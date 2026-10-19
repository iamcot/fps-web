import * as THREE from 'three'
import type { TeamId } from '@fps/shared'
import { DEFAULT_ANIM, type AnimTuning, type CharacterRig } from './types'

export interface Palette {
  torso: number
  arms: number
  legs: number
  skin: number
}

export interface Kit {
  rig: CharacterRig
  // Thêm khối vào `parent` (mặc định root); tự đăng ký vào parts/mats
  box(parent: THREE.Object3D, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh
}

/**
 * Dựng khung xương chuẩn khớp hitbox. Bộ nhân vật chỉ chọn màu và gắn thêm chi tiết (mũ, túi, ăng-ten…)
 * vào rig.upper / rig.headPivot / rig.root bằng kit.box — không tự đặt lại kích thước thân/đầu/chân.
 */
export function createKit(team: TeamId, pal: Palette, anim: Partial<AnimTuning> = {}): Kit {
  const root = new THREE.Group()
  const parts: THREE.Mesh[] = []
  const mats: THREE.MeshLambertMaterial[] = []
  const box: Kit['box'] = (parent, w, h, d, color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, transparent: true }))
    mats.push(m.material as THREE.MeshLambertMaterial)
    m.position.set(x, y, z)
    m.castShadow = false   // nhân vật không đổ bóng thật: dùng bóng tròn giả (render/blobShadow.ts)
    parent.add(m)
    parts.push(m)
    return m
  }
  const pivot = (parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group => {
    const g = new THREE.Group()
    g.position.set(x, y, z)
    parent.add(g)
    return g
  }

  // Chân: pivot ở hông (y 0.8), khối rủ xuống
  const legL = pivot(root, -0.1, 0.8)
  const legR = pivot(root, 0.1, 0.8)
  box(legL, 0.22, 0.8, 0.26, pal.legs, 0, -0.4, 0)
  box(legR, 0.22, 0.8, 0.26, pal.legs, 0, -0.4, 0)

  // Thân trên: pivot ở hông
  const upper = pivot(root, 0, 0.8)
  box(upper, 0.4, 0.65, 0.26, pal.torso, 0, 0.325, 0)
  const headPivot = pivot(upper, 0, 0.65)   // cổ ở y 1.45
  const headMesh = box(headPivot, 0.35, 0.35, 0.3, pal.skin, 0, 0.175, 0)   // 1.45–1.8

  // Tay: pivot ở vai (y 1.4), đưa ra trước như cầm súng
  const armRestR = 1.35, armRestL = 1.15
  const arm = (x: number, rotX: number, rotZ: number) => {
    const p = pivot(upper, x, 0.6)
    p.rotation.set(rotX, 0, rotZ)
    box(p, 0.1, 0.6, 0.14, pal.arms, 0, -0.3, 0)
    box(p, 0.1, 0.1, 0.14, pal.skin, 0, -0.62, 0)   // bàn tay
    return p
  }
  const armR = arm(0.25, armRestR, 0)
  const armL = arm(-0.25, armRestL, -0.35)

  // Súng gắn vào bàn tay phải (con của armR nên bám theo tay). Xoay ngược armRestR để súng vẫn chĩa −Z khi tay ở tư thế nghỉ
  const gunAnchor = pivot(armR, 0, -0.62)
  gunAnchor.rotation.x = -armRestR

  const rig: CharacterRig = {
    root, legL, legR, upper, headPivot, armL, armR, gunAnchor, headMesh, parts, mats, team,
    armRestR, armRestL, anim: { ...DEFAULT_ANIM, ...anim },
  }
  return { rig, box }
}

export function disposeRig(r: CharacterRig): void {
  for (const p of r.parts) p.geometry.dispose()
  for (const m of r.mats) m.dispose()
}
