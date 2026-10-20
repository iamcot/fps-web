import * as THREE from 'three'
import { hitboxesFor } from '@fps/shared'
import type { HitBox } from '@fps/shared'
import type { MovementConfig } from '@fps/shared'
import type { PlayerState } from '@fps/shared'

// ── Vị trí bia đặt khu giữa map ───────────────────────────────────────────────
const TARGET_POSITIONS: [number, number, number][] = [
  [-4, 0, -12],
  [ 0, 0, -8 ],
  [ 4, 0, -12],
  [-6, 0, -4 ],
  [ 6, 0, -4 ],
]

// Màu mặc định mỗi phần
const COLOR_LEGS  = 0x5a6a7a
const COLOR_BODY  = 0x8a7060
const COLOR_HEAD  = 0xddccaa

export interface Target {
  pos: [number, number, number]
  group: THREE.Group
  mats: THREE.MeshLambertMaterial[]
  defaultColors: number[]
  flashTimer: number
}

function buildTargetMesh(pos: [number, number, number]): { group: THREE.Group; mats: THREE.MeshLambertMaterial[] } {
  const group = new THREE.Group()
  group.position.set(...pos)
  const mats: THREE.MeshLambertMaterial[] = []

  const parts: { geo: THREE.BoxGeometry; color: number; y: number }[] = [
    { geo: new THREE.BoxGeometry(0.6, 0.80, 0.3), color: COLOR_LEGS, y: 0.40  },
    { geo: new THREE.BoxGeometry(0.6, 0.65, 0.3), color: COLOR_BODY, y: 1.125 },
    { geo: new THREE.BoxGeometry(0.35, 0.35, 0.3), color: COLOR_HEAD, y: 1.625 },
  ]

  for (const p of parts) {
    const mat  = new THREE.MeshLambertMaterial({ color: p.color })
    const mesh = new THREE.Mesh(p.geo, mat)
    mesh.position.y = p.y
    mesh.castShadow = true
    group.add(mesh)
    mats.push(mat)
  }

  return { group, mats }
}

export function createTargets(scene: THREE.Scene): Target[] {
  return TARGET_POSITIONS.map(pos => {
    const { group, mats } = buildTargetMesh(pos)
    scene.add(group)
    return {
      pos,
      group,
      mats,
      defaultColors: [COLOR_LEGS, COLOR_BODY, COLOR_HEAD],
      flashTimer: 0,
    }
  })
}

export function flashTarget(target: Target): void {
  for (const mat of target.mats) mat.color.setHex(0xff2222)
  target.flashTimer = 0.15
}

export function updateTargets(targets: Target[], dt: number): void {
  for (const t of targets) {
    if (t.flashTimer <= 0) continue
    t.flashTimer = Math.max(0, t.flashTimer - dt)
    if (t.flashTimer === 0) {
      t.mats.forEach((mat, i) => mat.color.setHex(t.defaultColors[i]!))
    }
  }
}

// Xây fake PlayerState để dùng với hitboxesFor
function targetState(t: Target): PlayerState {
  return {
    pos: t.pos, vel: [0,0,0], yaw: 0, pitch: 0,
    grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0, adsT: 0,
  }
}

export function targetHitboxes(t: Target, cfg: MovementConfig): HitBox[] {
  return hitboxesFor(targetState(t), cfg)
}
