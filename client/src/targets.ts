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

// ── Bảng tập bắn (?dummies=1): tấm 2×2m có vòng tròn đồng tâm ở 10 / 20 / 40m tính từ chỗ đứng (-28, 0, 0) nhìn về +X ──
export interface Board { pos: [number, number, number]; label: string }
const BOARDS: Board[] = [
  { pos: [-18, 1.5, -3], label: '10m' },
  { pos: [-8,  1.5,  0], label: '20m' },
  { pos: [12,  1.5,  3], label: '40m' },
]
const BOARD_HALF = 1

function boardTexture(label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, 256, 256)
  g.strokeStyle = '#222'; g.lineWidth = 2; g.fillStyle = '#222'
  for (let i = 1; i <= 5; i++) { g.beginPath(); g.arc(128, 128, i * 24, 0, Math.PI * 2); g.stroke() }   // mỗi vòng = 0,2m
  g.beginPath(); g.moveTo(0, 128); g.lineTo(256, 128); g.moveTo(128, 0); g.lineTo(128, 256); g.stroke()
  g.font = 'bold 22px monospace'; g.fillText(label, 8, 24)
  g.strokeRect(1, 1, 254, 254)
  return new THREE.CanvasTexture(c)
}

export function createBoards(scene: THREE.Scene): Board[] {
  for (const b of BOARDS) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_HALF * 2, BOARD_HALF * 2), new THREE.MeshBasicMaterial({ map: boardTexture(b.label), side: THREE.DoubleSide }))
    m.position.set(b.pos[0], b.pos[1], b.pos[2])
    m.rotation.y = Math.PI / 2   // mặt phẳng vuông góc trục X
    scene.add(m)
  }
  return BOARDS
}

/** Tia trúng tấm bảng nào (gần hơn maxDist) → điểm trúng + pháp tuyến hướng về phía người bắn */
export function rayBoards(origin: readonly number[], dir: readonly number[], boards: readonly Board[], maxDist: number):
  { dist: number; point: [number, number, number]; normal: [number, number, number] } | null {
  let best: { dist: number; point: [number, number, number]; normal: [number, number, number] } | null = null
  if (Math.abs(dir[0]!) < 1e-6) return null
  for (const b of boards) {
    const t = (b.pos[0] - origin[0]!) / dir[0]!
    if (t <= 0 || t >= maxDist || (best && t >= best.dist)) continue
    const y = origin[1]! + dir[1]! * t, z = origin[2]! + dir[2]! * t
    if (Math.abs(y - b.pos[1]) > BOARD_HALF || Math.abs(z - b.pos[2]) > BOARD_HALF) continue
    best = { dist: t, point: [b.pos[0], y, z], normal: [dir[0]! > 0 ? -1 : 1, 0, 0] }
  }
  return best
}
