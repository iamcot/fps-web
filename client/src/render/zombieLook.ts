// Hình dáng zombie (plan 16, ZF.1): tint ngả màu (giữ texture gốc), cỡ lệch nhẹ, mắt đỏ phát sáng (sprite cộng sáng, không bị ánh sáng ảnh hưởng).
// Chưa có model zombie riêng thì dùng chính model của người đó (Lây Nhiễm) hoặc Cướp (Thủ Thành) cộng tint.
import * as THREE from 'three'
import { ZOMBIE_LOOK, zombieVariation } from '@fps/shared'
import type { CharacterRig } from './characters/types'

let glowTex: THREE.CanvasTexture | null = null
function glow(): THREE.CanvasTexture {
  if (!glowTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 32
    const g = c.getContext('2d')!
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, ZOMBIE_LOOK.variation.eyeGlow); grd.addColorStop(1, 'rgba(255,40,20,0)')
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32)
    glowTex = new THREE.CanvasTexture(c)
  }
  return glowTex
}

export interface ZombieFx {
  eyes: [THREE.Sprite, THREE.Sprite]
  scale: number
  orig: Map<THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, number>
}

const _head = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()

function headNode(rig: CharacterRig): THREE.Object3D { return rig.skel?.headBone ?? rig.headPivot }

/** Biến rig thành zombie: tint + cỡ + mắt. `opts` như zombieVariation (Thủ Thành: tint theo loại). */
export function makeZombieFx(scene: THREE.Scene, rig: CharacterRig, id: number, opts: Parameters<typeof zombieVariation>[1], sizeMul = 1, eyeScale = 1): ZombieFx {
  const v = zombieVariation(id, opts)
  const orig = new Map<THREE.MeshBasicMaterial | THREE.MeshLambertMaterial, number>()
  const tint = new THREE.Color(v.tint)
  const white = new THREE.Color(0xffffff)
  for (const m of rig.mats) {
    const mm = m as THREE.MeshLambertMaterial
    if (!mm.color) continue
    orig.set(mm, mm.color.getHex())
    mm.color.copy(white).lerp(tint, v.tintStrength)
  }
  rig.root.scale.setScalar(v.scale * sizeMul)
  const mk = (): THREE.Sprite => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }))
    s.scale.setScalar(0.09 * eyeScale * Math.sqrt(sizeMul))
    s.renderOrder = 9
    scene.add(s)
    return s
  }
  return { eyes: [mk(), mk()], scale: v.scale * sizeMul, orig }
}

/** Đặt mắt theo đầu mỗi frame (đầu cúi theo pitch, nên lấy vị trí/hướng thế giới của xương) */
export function updateZombieFx(fx: ZombieFx, rig: CharacterRig, visible: boolean, far = false): void {
  const on = visible && !far   // ngoài 40m tắt mắt (ZF.7)
  fx.eyes[0].visible = fx.eyes[1].visible = on
  if (!on) return
  const h = headNode(rig)
  h.getWorldPosition(_head)
  // Mặt hướng theo yaw của root (model đã xoay π nên mặt quay về −Z của root)
  const yaw = rig.root.rotation.y
  _fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw))
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw))
  const s = fx.scale
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1
    fx.eyes[i]!.position.set(
      _head.x + _fwd.x * 0.10 * s + _right.x * 0.035 * s * side,
      _head.y + 0.09 * s,
      _head.z + _fwd.z * 0.10 * s + _right.z * 0.035 * s * side)
  }
}

export function removeZombieFx(scene: THREE.Scene, fx: ZombieFx, rig: CharacterRig): void {
  for (const e of fx.eyes) { scene.remove(e); e.material.dispose() }
  for (const [m, hex] of fx.orig) m.color.setHex(hex)
  rig.root.scale.setScalar(1)
}
