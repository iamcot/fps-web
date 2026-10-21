import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { TeamId } from '@fps/shared'
import { DEFAULT_ANIM, type CharacterRig } from './characters/types'
import { poses } from './poses'
import { SkeletonArm, FINGER_NAMES, type FingerBones } from './skeletonArm'
import { CLIP_NAMES, SLOTS, clipRate, locoTargets, makeSlotWeights, slotClip, type Slot } from './locomotion'
import { TEAM_TINT_STRENGTH, applyTeamTint, teamTintDef, type TeamTintHandle } from './teamTint'
import { Z_CLIPS, Z_DEATH, ZOMBIE_ATTACK, ZOMBIE_JUMP_HOLD, ZOMBIE_RUN_BLEND, ZOMBIE_RUN_START, fitRate, zombieClipRate, zombieSlotClip, type ZombieAttackKind } from './zombieAnim'

// Nhân vật có xương (plan 11, C.4): cop.glb / robber.glb dùng chung bộ animation Mixamo.
// Chọn clip theo vận tốc nội suy, thân trên ngắm theo pitch (xoay các xương spine), súng nằm trong `aimPivot`.
// Model nhìn +Z (chuẩn glTF) nên xoay π để yaw = 0 nhìn −Z như quy ước dự án.
// Mỗi bộ nhân vật có xương = một "skin" (cùng bộ xương + animation, khác model/texture); bộ không có ở đây dùng nhân vật khối.
export type SkinId = 'classic' | 'saber'
const FILES: Record<SkinId, Record<TeamId, string>> = {
  classic: { A: '/models/characters/cop.glb', B: '/models/characters/robber.glb' },
  saber: { A: '/models/characters/saber_ct.glb', B: '/models/characters/saber_t.glb' },
}
const SKIN_OF_SET: Record<string, SkinId> = { copRobber: 'classic', saberDesert: 'saber' }
export function skinOfSet(setId: string): SkinId | null { return SKIN_OF_SET[setId] ?? null }
const DEG = Math.PI / 180
const TELEPORT_M = 3
// Ném lựu đạn (G.6)
export const THROW_CLIPS = ['grenade_throw', 'grenade_toss'] as const
const THROW_FADE_IN_S = 0.08, THROW_FADE_OUT_S = 0.15
const PULL_S = 0.3                   // tay trái chạm vòng chốt từng ấy giây rồi buông
const PULL_RAMP_S = 0.1
const LOWER_BODY = /^mixamorig(Hips|(Left|Right)(UpLeg|Leg|Foot|ToeBase|Toe_End))\./
const IK_FADE_S = 0.15       // tắt/bật IK khi chết/hồi sinh
const CORPSE_HOLD_S = 3      // xác nằm yên từng ấy giây rồi mờ dần
const CORPSE_FADE_S = 0.7
const DEATH_SWAP_S = 0.5     // tin Kill (có cờ headshot) đến muộn hơn snapshot chết trong khoảng này vẫn đổi được kiểu chết

interface Loaded { scene: THREE.Object3D; clips: Map<string, THREE.AnimationClip>; upper: Map<string, THREE.AnimationClip> }
const loaded = new Map<string, Loaded>()   // khoá `${skin}:${team}`
const loading = new Set<string>()
let failed = false

/** `?blocky=1` giữ nhân vật khối hộp cũ để so sánh khi debug */
export function skeletalEnabled(): boolean {
  if (failed) return false
  try { return !new URLSearchParams(location.search).has('blocky') } catch { return true }
}

// Debug: ?charTeam=B dựng model Cướp cho mọi người (offline chỉ có đội A) để xem/chỉnh tay áo, ngón của model kia
export function forcedTeam(): TeamId | null {
  try { const t = new URLSearchParams(location.search).get('charTeam'); return t === 'A' || t === 'B' ? t : null } catch { return null }
}

export function requestCharacters(skin: SkinId): void {
  const loader = new GLTFLoader()
  for (const team of ['A', 'B'] as TeamId[]) {
    const key = `${skin}:${team}`, file = FILES[skin][team]
    if (loading.has(key) || loaded.has(key)) continue
    loading.add(key)
    loader.loadAsync(file).then(gltf => {
      const clips = new Map<string, THREE.AnimationClip>()
      for (const c of gltf.animations) clips.set(c.name, c)
      for (const n of CLIP_NAMES) if (!clips.has(n)) console.warn(`characterRig: ${file} thiếu clip ${n}`)
      // Clip ném chỉ áp cho thân trên (từ Spine trở lên, gồm hai tay) để chân vẫn chạy
      const upper = new Map<string, THREE.AnimationClip>()
      for (const n of THROW_CLIPS) { const c = clips.get(n); if (c) upper.set(n, upperBodyClip(c)) }
      loaded.set(key, { scene: gltf.scene, clips, upper })
    }).catch(err => { failed = true; console.warn(`characterRig: không load được ${file}, dùng nhân vật khối`, err) })
  }
}

// ── Model zombie (plan 16, ZF.1): mỗi file zombies/*.glb có sẵn 12 clip z_*. Clip z_* dùng chung cho mọi model và cho cả
// người bị lây (cùng bộ xương Mixamo 65 xương, track gọi xương theo tên) nên chỉ cần lấy từ file nào tải xong đầu tiên.
const loadedZ = new Map<string, Loaded>()   // khoá = đường dẫn file
const loadingZ = new Set<string>()
let zombieClips: THREE.AnimationClip[] | null = null
const zombieUpper = new Map<string, THREE.AnimationClip>()   // clip đòn cào chỉ thân trên

export function requestZombieModels(files: string[]): void {
  const loader = new GLTFLoader()
  for (const file of files) {
    if (loadingZ.has(file) || loadedZ.has(file)) continue
    loadingZ.add(file)
    loader.loadAsync(file).then(gltf => {
      const clips = new Map<string, THREE.AnimationClip>()
      for (const c of gltf.animations) clips.set(c.name, c)
      loadedZ.set(file, { scene: gltf.scene, clips, upper: new Map() })
      if (!zombieClips) {
        zombieClips = gltf.animations.filter(c => c.name.startsWith('z_'))
        for (const k of ['light', 'heavy'] as const) { const c = clips.get(ZOMBIE_ATTACK[k].clip); if (c) zombieUpper.set(k, upperBodyClip(c)) }
      }
    }).catch(err => console.warn(`characterRig: không load được ${file}`, err))
  }
}
export function zombieModelReady(file: string): boolean { return loadedZ.has(file) }
export function zombieClipsReady(): boolean { return zombieClips !== null }

// Debug (chỉ khi chạy vite dev): window.__skelChars cho script kiểm tra IK từ trình duyệt
const debugList: SkelCharacter[] = []
if (import.meta.env?.DEV) (globalThis as { __skelChars?: SkelCharacter[] }).__skelChars = debugList

/** Giữ lại track của thân trên: bỏ Hips (chuyển động gốc) và hai chân */
function upperBodyClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter(t => !LOWER_BODY.test(t.name))
  return new THREE.AnimationClip(`${clip.name}_upper`, clip.duration, tracks)
}

let _zcfg: { src: typeof poses.character.anim; cfg: typeof poses.character.anim } | null = null
/** Cấu hình loco của zombie: chuyển sang z_run sớm hơn người (cache, không cấp phát mỗi frame) */
function zombieLocoCfg(cfg: typeof poses.character.anim): typeof poses.character.anim {
  if (!_zcfg || _zcfg.src !== cfg) _zcfg = { src: cfg, cfg: { ...cfg, runStartSpeed: ZOMBIE_RUN_START, runBlendLen: ZOMBIE_RUN_BLEND } }
  return _zcfg.cfg
}

export function skeletalReady(skin: SkinId, team: TeamId): boolean { return loaded.has(`${skin}:${team}`) }

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
  dead?: boolean    // xác: chỉ phát clip chết, không ngắm theo pitch
}

export class SkelCharacter {
  readonly root = new THREE.Group()
  readonly model: THREE.Object3D
  readonly mats: THREE.Material[] = []
  private readonly tints: TeamTintHandle[] = []   // zombie (Lây Nhiễm) dùng lại model người: tắt màu đội để giữ tint zombie
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
  /** Xương đầu (mắt zombie bám theo) */
  get headBone(): THREE.Object3D { return this.head }
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
  // Ném lựu đạn (người khác thấy)
  private throwing: { act: THREE.AnimationAction; t: number; dur: number; releaseAt: number } | null = null
  private throwActions = new Map<string, THREE.AnimationAction>()
  pullT = 0                       // > 0: giây còn lại của động tác tay trái chạm vòng chốt
  private dead = false
  private deathClip = 'death_1'
  private deathT = 0
  // Zombie: dùng clip z_* (xem requestZombieModels). Đòn cào/gào là clip phủ lên (thân trên / cả người) như động tác ném.
  private zombie = false
  private zov: { act: THREE.AnimationAction; t: number; dur: number } | null = null
  private zovActions = new Map<string, THREE.AnimationAction>()

  /** `zombieFile`: dựng từ model zombie riêng (zombies/*.glb) thay vì model người của đội */
  constructor(skin: SkinId, team: TeamId, zombieFile?: string) {
    const src = (zombieFile ? loadedZ.get(zombieFile) : loaded.get(`${skin}:${forcedTeam() ?? team}`))!
    this.model = cloneSkinned(src.scene)
    this.model.rotation.y = Math.PI
    this.root.add(this.model)
    this.model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.frustumCulled = false   // bbox lúc T-pose sai khi đang làm animation
      o.castShadow = false; o.receiveShadow = false
      // Lambert như các khối còn lại của game (rẻ hơn Standard, cùng kiểu ánh sáng hemi + mặt trời)
      const old = o.material as THREE.MeshStandardMaterial
      const mat = new THREE.MeshLambertMaterial({ map: old.map, color: old.color })
      const td = zombieFile ? null : teamTintDef(skin, forcedTeam() ?? team)   // texture gốc quá tối: tô màu theo đội (cớm xanh, cướp trắng kem)
      if (td) this.tints.push(applyTeamTint(mat, td))
      o.material = mat
      this.mats.push(mat)
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
      if (n === 'jump' || n === 'slide' || n.startsWith('death_')) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      a.play(); a.setEffectiveWeight(0)
      this.actions.set(n, a); this.weight.set(n, 0); this.target.set(n, 0)
    }
    for (const [n, clip] of src.upper) {
      const a = this.mixer.clipAction(clip)
      a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false
      this.throwActions.set(n, a)
    }
    this.refreshGunAnchor()
    debugList.push(this)
    if (zombieFile) this.setZombie(true)
  }

  // ── Zombie ───────────────────────────────────────────────────────────────────
  get isZombie(): boolean { return this.zombie }
  /** Bật/tắt bộ clip zombie. Trả về false nếu chưa có clip z_* (chưa tải xong): gọi lại frame sau. */
  setZombie(on: boolean): boolean {
    if (on === this.zombie) return true
    if (!on) {
      this.zombie = false
      for (const t of this.tints) t.strength.value = TEAM_TINT_STRENGTH
      this.zov?.act.stop(); this.zov = null
      for (const [n, a] of this.actions) if (n.startsWith('z_')) { a.stop(); this.weight.set(n, 0); this.target.set(n, 0) }
      for (const a of this.zovActions.values()) a.stop()
      return true
    }
    if (!zombieClips) return false
    for (const t of this.tints) t.strength.value = 0
    for (const clip of zombieClips) {
      const had = this.actions.get(clip.name)
      if (had) {   // đã có từ lần làm zombie trước: setZombie(false) đã stop() nên phải chạy lại, không thì bộ xương đứng ở T-pose
        had.play(); had.paused = false; had.setEffectiveWeight(0)
        continue
      }
      const isOnce = clip.name === 'z_jump' || clip.name.startsWith('z_death_')
      const looped = (Z_CLIPS as readonly string[]).includes(clip.name) && clip.name !== 'z_jump'
      if (!isOnce && !looped) {   // z_attack_*, z_scream, z_hit, z_transform: phát theo sự kiện (xem playZombie)
        if (clip.name === 'z_scream') {
          const a = this.mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false
          this.zovActions.set('scream', a)
        }
        continue
      }
      const a = this.mixer.clipAction(clip)
      if (isOnce) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      a.play(); a.setEffectiveWeight(0)
      this.actions.set(clip.name, a); this.weight.set(clip.name, 0); this.target.set(clip.name, 0)
    }
    for (const [k, clip] of zombieUpper) {
      if (this.zovActions.has(k)) continue
      const a = this.mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false
      this.zovActions.set(k, a)
    }
    this.zombie = true
    this.cancelThrow()
    for (const n of this.target.keys()) { if (!n.startsWith('z_')) { this.target.set(n, 0); this.weight.set(n, 0); this.actions.get(n)?.setEffectiveWeight(0) } }
    this.weight.set('z_idle', 1); this.actions.get('z_idle')?.setEffectiveWeight(1)
    return true
  }

  /** Cào (thân trên) hoặc gào (cả người, `sec` giây: biến hình) */
  playZombie(kind: ZombieAttackKind | 'scream', sec = 0): void {
    if (!this.zombie || this.dead) return
    const act = this.zovActions.get(kind)
    if (!act) return
    this.zov?.act.stop()
    const dur0 = act.getClip().duration
    const w = kind === 'scream' ? { from: 0, to: 1, sec } : ZOMBIE_ATTACK[kind]
    const rate = fitRate(dur0, w.from, w.to, w.sec)
    act.reset(); act.setEffectiveWeight(0); act.play()
    act.time = w.from * dur0; act.timeScale = rate
    this.zov = { act, t: 0, dur: w.sec }
  }

  // ── Animation ────────────────────────────────────────────────────────────────
  /** mixer → pitch spine/đầu → cập nhật ma trận. Gọi trước placeGun/solve. */
  animate(f: SkelFrame): void {
    const cfg = poses.character.anim
    this.ikWeight = this.dead ? Math.max(0, this.ikWeight - f.dt / IK_FADE_S) : Math.min(1, this.ikWeight + f.dt / IK_FADE_S)
    if (this.dead) { this.animateDead(f.dt); return }
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
    locoTargets({ vx: vx * k, vz: vz * k, yaw: f.yaw, grounded: f.grounded, crouching: f.crouching, sliding: f.sliding }, this.zombie ? zombieLocoCfg(cfg) : cfg, this.slotW)

    for (const n of this.target.keys()) this.target.set(n, 0)
    for (const s of SLOTS) {
      const w = this.slotW[s]
      if (w <= 0) continue
      const n = this.zombie ? zombieSlotClip(s) : slotClip(s, f.pistol)
      this.target.set(n, (this.target.get(n) ?? 0) + w)
    }
    const jumpOn = this.slotW.jump > 0.5, slideOn = this.slotW.slide > 0.5
    const jumpName = this.zombie ? 'z_jump' : 'jump'
    if (jumpOn && !this.jumpWasOn) this.restart(jumpName)
    if (slideOn && !this.slideWasOn && !this.zombie) this.restart('slide')
    this.jumpWasOn = jumpOn; this.slideWasOn = slideOn
    const jump = this.actions.get(jumpName)
    const holdS = this.zombie && jump ? jump.getClip().duration * ZOMBIE_JUMP_HOLD : cfg.jumpHoldS
    if (jump && jumpOn && jump.time > holdS) jump.time = holdS   // trên không: giữ frame giữa
    const blend = 1 - Math.exp(-f.dt / (cfg.blendTime / 3))
    for (const [n, a] of this.actions) {
      const w = this.weight.get(n)! + (this.target.get(n)! - this.weight.get(n)!) * blend
      this.weight.set(n, w)
      a.setEffectiveWeight(w)
    }
    for (const s of SLOTS) {
      if (this.slotW[s] <= 0) continue
      const zn = zombieSlotClip(s)
      const a = this.actions.get(this.zombie ? zn : slotClip(s, f.pistol))
      if (a) a.timeScale = this.zombie ? zombieClipRate(zn, this.speed) : clipRate(s, this.speed, cfg)
    }
    // Ngồi: hạ cả model thêm crouchDrop khi animation ngồi vẫn cao hơn hitbox
    if (this.throwing) {
      const th = this.throwing
      th.t += f.dt
      if (th.t >= th.dur) { th.act.stop(); this.throwing = null }
      else {
        // clip thân trên chỉ có track của các xương trên: three trộn trung bình có trọng số với clip chạy (tổng trọng số 1),
        // nên muốn "ghi đè" một phần e thì trọng số = e / (1 − e)
        const e = Math.min(0.98, Math.min(1, th.t / THROW_FADE_IN_S), Math.min(1, (th.dur - th.t) / THROW_FADE_OUT_S))
        th.act.setEffectiveWeight(e / (1 - e))
      }
    }
    if (this.zov) {
      const z = this.zov
      z.t += f.dt
      if (z.t >= z.dur) { z.act.stop(); this.zov = null }
      else {   // cùng cách ghi đè như clip ném: trọng số e / (1 − e)
        const e = Math.min(0.98, Math.min(1, z.t / 0.08), Math.min(1, (z.dur - z.t) / 0.12))
        z.act.setEffectiveWeight(e / (1 - e))
      }
    }
    if (this.pullT > 0) this.pullT = Math.max(0, this.pullT - f.dt)
    this.model.position.y = this.zombie ? 0 : -(poses.character.crouchDrop * (this.weight.get('rifle_crouch_idle') ?? 0) + poses.character.crouchWalkDrop * (this.weight.get('rifle_crouch_walk') ?? 0))
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

  // ── Chết / hồi sinh ───────────────────────────────────────────────────────────
  /** Vừa chết: phát clip ngã (death_2 nếu headshot), IK mờ về 0 trong IK_FADE_S, sau CORPSE_HOLD_S xác mờ dần. */
  die(headshot: boolean): void {
    this.dead = true
    this.deathT = 0
    this.zov?.act.stop(); this.zov = null
    this.deathClip = this.deathName(headshot)
    for (const n of ['death_1', 'death_2', ...Z_DEATH]) this.actions.get(n)?.stop()
    const a = this.actions.get(this.deathClip)
    if (a) { a.reset(); a.play(); a.setEffectiveWeight(this.weight.get(this.deathClip) ?? 0) }
  }

  // ── Ném lựu đạn (người khác) ────────────────────────────────────────────────
  /** Bắt đầu rút chốt: tay trái chạm vòng chốt PULL_S giây (IK do players.ts áp) */
  startPull(): void { this.pullT = PULL_S }
  /** Trọng số IK tay trái lúc chạm chốt: 0 → 1 → 0 */
  get pullWeight(): number {
    if (this.pullT <= 0) return 0
    const t = PULL_S - this.pullT
    return Math.min(1, t / PULL_RAMP_S, this.pullT / PULL_RAMP_S)
  }
  /** Phát clip ném (thân trên). Ném thấp dùng grenade_toss nếu có, không thì dùng chung grenade_throw. */
  playThrow(mode: 'strong' | 'lob'): void {
    const name = mode === 'lob' && this.throwActions.has('grenade_toss') ? 'grenade_toss' : 'grenade_throw'
    const act = this.throwActions.get(name)
    if (!act) return
    if (this.throwing) this.throwing.act.stop()
    const tm = this.throwTiming(act)
    act.reset(); act.setEffectiveWeight(0); act.play()
    act.time = tm.startS; act.timeScale = tm.rate   // bỏ đoạn chuẩn bị dài đầu clip Mixamo, phát nhanh hơn một chút
    this.throwing = { act, t: 0, dur: tm.dur, releaseAt: tm.releaseAt }
    this.pullT = 0
  }
  /** Huỷ động tác ném đang chạy (về tư thế cầm) */
  cancelThrow(): void { if (this.throwing) { this.throwing.act.stop(); this.throwing = null } this.pullT = 0 }
  /** Đang ném và đã tới lúc thả: quả trong tay phải ẩn */
  get throwReleased(): boolean { return !!this.throwing && this.throwing.t >= this.throwing.releaseAt }
  get throwActive(): boolean { return !!this.throwing }
  /** Độ trễ (ms) từ lúc nhận tin ném tới lúc quả rời tay trong animation, để quả thật xuất hiện khớp */
  releaseDelayMs(mode: 'strong' | 'lob'): number {
    const name = mode === 'lob' && this.throwActions.has('grenade_toss') ? 'grenade_toss' : 'grenade_throw'
    const a = this.throwActions.get(name)
    return a ? this.throwTiming(a).releaseAt * 1000 : 0
  }
  /** Thời gian (giây thực) của clip ném: từ throwStartS tới hết clip, tay thả ở releaseS, phát với throwRate */
  private throwTiming(act: THREE.AnimationAction): { startS: number; rate: number; dur: number; releaseAt: number } {
    const t = poses.weapons.m67?.third, clip = act.getClip().duration
    const startS = Math.min(t?.throwStartS ?? 0, clip * 0.9), rate = t?.throwRate ?? 1
    const releaseS = Math.min(Math.max(t?.releaseS ?? clip * 0.5, startS), clip)
    return { startS, rate, dur: (clip - startS) / rate, releaseAt: (releaseS - startS) / rate }
  }

  /** Tin Kill báo headshot đến sau snapshot chết một chút: đổi sang đúng kiểu chết (giữ tiến độ). */
  setDeathVariant(headshot: boolean): void {
    const want = this.deathName(headshot)
    if (!this.dead || this.deathT > DEATH_SWAP_S || want === this.deathClip) return
    const old = this.actions.get(this.deathClip), a = this.actions.get(want)
    if (!a) return
    old?.stop(); this.weight.set(this.deathClip, 0)
    this.deathClip = want
    a.reset(); a.play(); a.time = this.deathT; a.setEffectiveWeight(this.weight.get(want) ?? 0)
  }

  private deathName(headshot: boolean): string {
    return this.zombie ? Z_DEATH[headshot ? 1 : 0] : headshot ? 'death_2' : 'death_1'
  }

  get isDead(): boolean { return this.dead }
  /** Xác còn vẽ không (false sau khi mờ hết) */
  get corpseVisible(): boolean { return !this.dead || this.deathT < CORPSE_HOLD_S + CORPSE_FADE_S }

  /** Hồi sinh: reset mixer về idle, IK trở lại 1 trong IK_FADE_S */
  revive(): void {
    this.dead = false
    for (const n of ['death_1', 'death_2', ...Z_DEATH]) { const a = this.actions.get(n); a?.stop(); this.weight.set(n, 0); this.target.set(n, 0) }
    for (const [n, a] of this.actions) { if (n.includes('death_')) continue; a.play(); a.paused = false; a.setEffectiveWeight(0); this.weight.set(n, 0) }
    const idle = this.zombie ? 'z_idle' : 'rifle_idle'
    this.weight.set(idle, 1); this.actions.get(idle)?.setEffectiveWeight(1)
    this.hasLast = false; this.speed = 0; this.jumpWasOn = false; this.slideWasOn = false
    this.model.position.y = 0
    this.ikWeight = 0
    this.setOpacity(1)
    this.root.visible = true
  }

  private animateDead(dt: number): void {
    this.deathT += dt
    for (const n of this.target.keys()) this.target.set(n, n === this.deathClip ? 1 : 0)
    const blend = 1 - Math.exp(-dt / (poses.character.anim.blendTime / 3))
    for (const [n, a] of this.actions) {
      const w = this.weight.get(n)! + (this.target.get(n)! - this.weight.get(n)!) * blend
      this.weight.set(n, w)
      a.setEffectiveWeight(w)
    }
    this.model.position.y = 0
    this.mixer.update(dt)
    this.root.updateMatrixWorld(true)
    const fade = Math.min(1, Math.max(0, (this.deathT - CORPSE_HOLD_S) / CORPSE_FADE_S))
    this.setOpacity(1 - fade)
    this.root.visible = fade < 1
  }

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
export function makeSkeletalRig(skin: SkinId, team: TeamId, zombieFile?: string): CharacterRig {
  const sk = new SkelCharacter(skin, team, zombieFile)
  const g = () => new THREE.Group()
  return {
    root: sk.root, legL: g(), legR: g(), upper: g(), headPivot: g(), armL: g(), armR: g(),
    gunAnchor: sk.gunAnchor, headMesh: new THREE.Mesh(), parts: [], mats: sk.mats, team,
    armRestR: 0, armRestL: 0, anim: DEFAULT_ANIM, skel: sk,
  }
}

export { FINGER_NAMES }
export type { Slot }
