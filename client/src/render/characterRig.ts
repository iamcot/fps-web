import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { TeamId } from '@fps/shared'
import { DEFAULT_ANIM, type CharacterRig } from './characters/types'
import { poses } from './poses'
import { SkeletonArm, FINGER_NAMES, type FingerBones } from './skeletonArm'
import { CLIP_NAMES, SLOTS, clipRate, locoTargets, makeSlotWeights, slotClip, type Slot } from './locomotion'

// Nhân vật có xương (plan 11, C.4): cop.glb / robber.glb dùng chung bộ animation Mixamo.
// Chọn clip theo vận tốc nội suy, thân trên ngắm theo pitch (xoay các xương spine), súng nằm trong `aimPivot`.
// Model nhìn +Z (chuẩn glTF) nên xoay π để yaw = 0 nhìn −Z như quy ước dự án.
const FILES: Record<TeamId, string> = { A: '/models/characters/cop.glb', B: '/models/characters/robber.glb' }
const DEG = Math.PI / 180
const TELEPORT_M = 3

interface Loaded { scene: THREE.Object3D; clips: Map<string, THREE.AnimationClip> }
const loaded = new Map<TeamId, Loaded>()
const loading = new Set<TeamId>()
let failed = false

/** `?blocky=1` giữ nhân vật khối hộp cũ để so sánh khi debug */
export function skeletalEnabled(): boolean {
  if (failed) return false
  try { return !new URLSearchParams(location.search).has('blocky') } catch { return true }
}

// Debug: ?charTeam=B dựng model Cướp cho mọi người (offline chỉ có đội A) để xem/chỉnh tay áo, ngón của model kia
function forcedTeam(): TeamId | null {
  try { const t = new URLSearchParams(location.search).get('charTeam'); return t === 'A' || t === 'B' ? t : null } catch { return null }
}

export function requestCharacters(): void {
  const loader = new GLTFLoader()
  for (const team of ['A', 'B'] as TeamId[]) {
    if (loading.has(team) || loaded.has(team)) continue
    loading.add(team)
    loader.loadAsync(FILES[team]).then(gltf => {
      const clips = new Map<string, THREE.AnimationClip>()
      for (const c of gltf.animations) clips.set(c.name, c)
      for (const n of CLIP_NAMES) if (!clips.has(n)) console.warn(`characterRig: ${FILES[team]} thiếu clip ${n}`)
      loaded.set(team, { scene: gltf.scene, clips })
    }).catch(err => { failed = true; console.warn(`characterRig: không load được ${FILES[team]}, dùng nhân vật khối`, err) })
  }
}

// Debug (chỉ khi chạy vite dev): window.__skelChars cho script kiểm tra IK từ trình duyệt
const debugList: SkelCharacter[] = []
if (import.meta.env?.DEV) (globalThis as { __skelChars?: SkelCharacter[] }).__skelChars = debugList

export function skeletalReady(team: TeamId): boolean { return loaded.has(team) }

const _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion()
const _axis = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler()

// Xoay bone quanh trục thế giới (không phụ thuộc trục local lạ của xương Mixamo)
function rotateAboutWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  _dq.setFromAxisAngle(axis, angle)
  bone.getWorldQuaternion(_wq).premultiply(_dq)
  bone.parent!.getWorldQuaternion(_pq)
  bone.quaternion.copy(_pq.invert().multiply(_wq))
  bone.updateWorldMatrix(false, true)
}

export interface SkelFrame {
  dt: number; x: number; z: number; yaw: number
  grounded: boolean; crouching: boolean; sliding: boolean
  pitch: number
  pistol: boolean   // súng 1 tay / dao: dùng bộ pistol_*
}

export class SkelCharacter {
  readonly root = new THREE.Group()
  readonly model: THREE.Object3D
  readonly mats: THREE.Material[] = []
  readonly aimPivot = new THREE.Group()   // con của root, ở ngực, xoay theo pitch (hệ game: nòng −Z)
  readonly holder = new THREE.Group()     // súng 2 tay nằm ở đây
  readonly gunAnchor = new THREE.Group()  // súng 1 tay: con của xương bàn tay phải
  readonly armR: SkeletonArm
  readonly armL: SkeletonArm
  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private readonly target = new Map<string, number>()
  private readonly weight = new Map<string, number>()
  private readonly slotW = makeSlotWeights()
  private readonly spine: THREE.Object3D[]
  private readonly head: THREE.Object3D
  private readonly chest: THREE.Object3D
  private readonly rightHand: THREE.Bone
  lastTargetR = new THREE.Vector3(); lastTargetL = new THREE.Vector3()
  private lastX = 0; private lastZ = 0; private hasLast = false
  private lastTime = 0
  private speed = 0
  private jumpWasOn = false; private slideWasOn = false
  private skinned: THREE.SkinnedMesh[] = []
  private opaque = true
  ikWeight = 1

  constructor(team: TeamId) {
    const src = loaded.get(forcedTeam() ?? team)!
    this.model = cloneSkinned(src.scene)
    this.model.rotation.y = Math.PI
    this.root.add(this.model)
    this.model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.frustumCulled = false   // bbox lúc T-pose sai khi đang làm animation
      o.castShadow = false; o.receiveShadow = false
      // Lambert như các khối còn lại của game (rẻ hơn Standard, cùng kiểu ánh sáng hemi + mặt trời)
      const old = o.material as THREE.MeshStandardMaterial
      o.material = new THREE.MeshLambertMaterial({ map: old.map, color: old.color })
      this.mats.push(o.material)
      if (o instanceof THREE.SkinnedMesh) this.skinned.push(o)
    })
    this.root.updateMatrixWorld(true)
    const bone = (n: string) => this.model.getObjectByName(n) as THREE.Bone
    const fingers = (side: 'Left' | 'Right'): FingerBones => {
      const f = (n: string) => [1, 2, 3].map(i => bone(`mixamorig${side}Hand${n}${i}`))
      return { thumb: f('Thumb'), index: f('Index'), middle: f('Middle'), ring: f('Ring'), pinky: f('Pinky') }
    }
    this.armR = new SkeletonArm(bone('mixamorigRightArm'), bone('mixamorigRightForeArm'), bone('mixamorigRightHand'), fingers('Right'), 'R')
    this.armL = new SkeletonArm(bone('mixamorigLeftArm'), bone('mixamorigLeftForeArm'), bone('mixamorigLeftHand'), fingers('Left'), 'L')
    this.rightHand = bone('mixamorigRightHand')
    this.rightHand.add(this.gunAnchor)
    this.spine = poses.character.spinePitchBones.map(n => bone(n))
    this.head = bone('mixamorigHead')
    this.chest = bone(poses.character.aimPivotBone)
    this.aimPivot.add(this.holder)
    this.root.add(this.aimPivot)

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const n of CLIP_NAMES) {
      const clip = src.clips.get(n)
      if (!clip) continue
      const a = this.mixer.clipAction(clip)
      if (n === 'jump' || n === 'slide') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      a.play(); a.setEffectiveWeight(0)
      this.actions.set(n, a); this.weight.set(n, 0); this.target.set(n, 0)
    }
    this.refreshGunAnchor()
    debugList.push(this)
  }

  // ── Animation ────────────────────────────────────────────────────────────────
  /** mixer → pitch spine/đầu → cập nhật ma trận. Gọi trước placeGun/solve. */
  animate(f: SkelFrame): void {
    const cfg = poses.character.anim
    let vx = 0, vz = 0
    if (this.hasLast && f.dt > 0) {
      vx = f.x - this.lastX; vz = f.z - this.lastZ
      if (Math.hypot(vx, vz) > TELEPORT_M) { vx = 0; vz = 0 }
      vx /= f.dt; vz /= f.dt
    }
    this.lastX = f.x; this.lastZ = f.z; this.hasLast = true
    const spd = Math.hypot(vx, vz)
    this.speed += (spd - this.speed) * Math.min(1, f.dt * 12)
    const k = this.speed > 1e-4 && spd > 1e-4 ? this.speed / spd : 0   // hướng lấy từ vận tốc tức thời, độ lớn làm mượt
    locoTargets({ vx: vx * k, vz: vz * k, yaw: f.yaw, grounded: f.grounded, crouching: f.crouching, sliding: f.sliding }, cfg, this.slotW)

    for (const n of this.target.keys()) this.target.set(n, 0)
    for (const s of SLOTS) {
      const w = this.slotW[s]
      if (w <= 0) continue
      const n = slotClip(s, f.pistol)
      this.target.set(n, this.target.get(n)! + w)
    }
    const jumpOn = this.slotW.jump > 0.5, slideOn = this.slotW.slide > 0.5
    if (jumpOn && !this.jumpWasOn) this.restart('jump')
    if (slideOn && !this.slideWasOn) this.restart('slide')
    this.jumpWasOn = jumpOn; this.slideWasOn = slideOn
    const jump = this.actions.get('jump')
    if (jump && jumpOn && jump.time > cfg.jumpHoldS) jump.time = cfg.jumpHoldS   // trên không: giữ frame giữa
    const blend = 1 - Math.exp(-f.dt / (cfg.blendTime / 3))
    for (const [n, a] of this.actions) {
      const w = this.weight.get(n)! + (this.target.get(n)! - this.weight.get(n)!) * blend
      this.weight.set(n, w)
      a.setEffectiveWeight(w)
    }
    for (const s of SLOTS) {
      if (this.slotW[s] <= 0) continue
      const a = this.actions.get(slotClip(s, f.pistol))
      if (a) a.timeScale = clipRate(s, this.speed, cfg)
    }
    // Ngồi: hạ cả model thêm crouchDrop khi animation ngồi vẫn cao hơn hitbox
    this.model.position.y = -(poses.character.crouchDrop * (this.weight.get('rifle_crouch_idle') ?? 0) + poses.character.crouchWalkDrop * (this.weight.get('rifle_crouch_walk') ?? 0))
    this.mixer.update(f.dt)
    this.root.updateMatrixWorld(true)

    // Ngắm theo pitch: xoay quanh trục "phải" của nhân vật (root +X). Spine chia đều, đầu thêm một phần.
    const c = poses.character
    const lim = c.spinePitchLimitDeg * DEG
    _axis.set(1, 0, 0).transformDirection(this.root.matrixWorld)
    const spineTotal = Math.max(-lim, Math.min(lim, f.pitch * (1 - c.headPitchShare)))
    for (const b of this.spine) rotateAboutWorld(b, _axis, spineTotal / this.spine.length)
    rotateAboutWorld(this.head, _axis, f.pitch * c.headPitchShare)
    this.root.updateMatrixWorld(true)
    this.pitch = f.pitch
  }
  private pitch = 0

  private restart(name: string): void {
    const a = this.actions.get(name)
    if (!a) return
    a.reset(); a.play(); a.setEffectiveWeight(this.weight.get(name) ?? 0)
  }

  setOpacity(op: number): void {
    const solid = op >= 1
    for (const m of this.mats) { m.opacity = op; if (m.transparent === solid) { m.transparent = !solid; m.needsUpdate = true } }
    this.opaque = solid
  }

  // ── Súng ─────────────────────────────────────────────────────────────────────
  /** Đặt aimPivot ở ngực, xoay theo pitch (hệ root). Gọi sau animate(). */
  placeAim(): void {
    this.chest.getWorldPosition(_v)
    this.root.worldToLocal(_v)
    const o = poses.character.aimPivotOffset
    this.aimPivot.position.set(_v.x + o[0], _v.y + o[1], _v.z + o[2])
    this.aimPivot.rotation.set(this.pitch, 0, 0)
    this.aimPivot.updateMatrix()
  }

  /** Súng 1 tay: gắn vào xương bàn tay phải, ngón chĩa −Z của súng, đặt ở tâm lòng bàn tay */
  refreshGunAnchor(): void {
    this.armR.gunFrameInHand(_q)
    this.armR.palmCenterInHand(this.gunAnchor.position)
    const c = poses.character
    _e.set(c.oneHandGunRotDeg[0] * DEG, c.oneHandGunRotDeg[1] * DEG, c.oneHandGunRotDeg[2] * DEG, 'XYZ')
    this.gunAnchor.quaternion.copy(_q).multiply(_dq.setFromEuler(_e))
    _v.set(c.oneHandGunPos[0], c.oneHandGunPos[1], c.oneHandGunPos[2]).applyQuaternion(_q)
    this.gunAnchor.position.add(_v)
  }

  dispose(): void {
    const i = debugList.indexOf(this); if (i >= 0) debugList.splice(i, 1)
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.model)
    for (const m of this.mats) m.dispose()   // texture dùng chung với bản gốc nên không dispose
    for (const s of this.skinned) s.skeleton.dispose()
  }
}

/** Vỏ CharacterRig cho nhân vật có xương: players.ts dùng chung luồng root/mats/gunAnchor, phần khối hộp là Group rỗng. */
export function makeSkeletalRig(team: TeamId): CharacterRig {
  const sk = new SkelCharacter(team)
  const g = () => new THREE.Group()
  return {
    root: sk.root, legL: g(), legR: g(), upper: g(), headPivot: g(), armL: g(), armR: g(),
    gunAnchor: sk.gunAnchor, headMesh: new THREE.Mesh(), parts: [], mats: sk.mats, team,
    armRestR: 0, armRestL: 0, anim: DEFAULT_ANIM, skel: sk,
  }
}

export { FINGER_NAMES }
export type { Slot }
