import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { TeamId } from '@fps/shared'
import { poses, type Vec3 } from './poses'
import { forcedTeam, type SkinId } from './characterRig'
import { SkeletonArm, type FingerBones } from './skeletonArm'

// Tay viewmodel bằng chính hai cánh tay của model nhân vật (plan 11, C.6): <team>_fparms.glb chỉ có bắp tay → bàn tay,
// vẫn đủ xương Mixamo nên dùng lại SkeletonArm (IK + ngón) y như góc 3. Mọi toạ độ trong không gian camera của viewmodel.
const FILES: Record<SkinId, Record<TeamId, string>> = {
  classic: { A: '/models/characters/cop_fparms.glb', B: '/models/characters/robber_fparms.glb' },
  saber: { A: '/models/characters/saber_ct_fparms.glb', B: '/models/characters/saber_t_fparms.glb' },
}
const DEG = Math.PI / 180

type FingerGrip = Record<'thumb' | 'index' | 'middle' | 'ring' | 'pinky', readonly number[]>

export interface FpSolveOpts {
  gripR?: FingerGrip
  gripL?: FingerGrip
  /** Hướng tay trái riêng (không theo súng) — tay phụ khi cầm dao */
  leftQuat?: THREE.Quaternion
}

interface Set { obj: THREE.Group; armR: SkeletonArm; armL: SkeletonArm; mats: THREE.Material[]; mid: THREE.Vector3 }

const _v = new THREE.Vector3(), _e = new THREE.Euler()
const _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _he = new THREE.Euler()
const _pole = new THREE.Vector3(), _sh = new THREE.Vector3()

export class FpArms {
  readonly root = new THREE.Group()
  sets = new Map<string, Set>()   // khoá `${skin}:${team}`
  private team: TeamId = forcedTeam() ?? 'A'
  private skin: SkinId = 'saber'
  private requested = new Set<SkinId>()
  private failed = false

  constructor() {
    this.root.visible = false
    if (import.meta.env?.DEV) (globalThis as { __fpArms?: FpArms }).__fpArms = this   // debug: script kiểm tra từ trình duyệt
  }

  load(skin: SkinId): void {
    if (this.requested.has(skin)) return
    this.requested.add(skin)
    const loader = new GLTFLoader()
    for (const team of ['A', 'B'] as TeamId[]) {
      loader.loadAsync(FILES[skin][team]).then(gltf => this.add(skin, team, gltf.scene)).catch(err => {
        this.failed = true
        console.warn(`fpArms: không load được ${FILES[skin][team]}, dùng tay khối`, err)
      })
    }
  }

  private add(skin: SkinId, team: TeamId, scene: THREE.Object3D): void {
    const obj = new THREE.Group()
    const model = scene
    model.rotation.y = Math.PI   // model nhìn +Z; camera viewmodel nhìn −Z
    obj.add(model)
    const mats: THREE.Material[] = []
    model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false
      const old = o.material as THREE.MeshStandardMaterial
      o.material = new THREE.MeshLambertMaterial({ map: old.map, color: old.color })
      mats.push(o.material)
    })
    obj.visible = false
    // Đo xương (độ dài, khung bàn tay, trung điểm vai) phải làm khi root ở trạng thái gốc: model của phe thứ hai có thể tải xong
    // sau khi place() đã xoay/scale root cho phe đầu → đo lệch → tay phình to, khuỷu chĩa lên (thứ tự tải đổi theo cache trình duyệt)
    const keepP = this.root.position.clone(), keepQ = this.root.quaternion.clone(), keepS = this.root.scale.clone()
    this.root.position.set(0, 0, 0); this.root.quaternion.identity(); this.root.scale.set(1, 1, 1)
    this.root.add(obj)
    obj.updateMatrixWorld(true)
    const bone = (n: string) => model.getObjectByName(n) as THREE.Bone
    const fingers = (side: 'Left' | 'Right'): FingerBones => {
      const f = (n: string) => [1, 2, 3].map(i => bone(`mixamorig${side}Hand${n}${i}`))
      return { thumb: f('Thumb'), index: f('Index'), middle: f('Middle'), ring: f('Ring'), pinky: f('Pinky') }
    }
    const armR = new SkeletonArm(bone('mixamorigRightArm'), bone('mixamorigRightForeArm'), bone('mixamorigRightHand'), fingers('Right'), 'R')
    const armL = new SkeletonArm(bone('mixamorigLeftArm'), bone('mixamorigLeftForeArm'), bone('mixamorigLeftHand'), fingers('Left'), 'L')
    const mid = armR.upper.getWorldPosition(new THREE.Vector3()).add(armL.upper.getWorldPosition(_v)).multiplyScalar(0.5)
    this.sets.set(`${skin}:${team}`, { obj, armR, armL, mats, mid })
    this.root.position.copy(keepP); this.root.quaternion.copy(keepQ); this.root.scale.copy(keepS)
    this.root.updateMatrixWorld(true)
  }

  /** Dùng được khi model của đội hiện tại đã load; chưa thì viewmodel vẫn vẽ tay khối. */
  get ready(): boolean { return this.sets.has(this.key) }
  private get key(): string { return `${this.skin}:${this.team}` }
  get hasFailed(): boolean { return this.failed }

  /** Đổi skin tay (theo bộ nhân vật của phòng) và tải nếu chưa có */
  setSkin(skin: SkinId): void {
    if (skin === this.skin && this.requested.has(skin)) return
    this.skin = skin
    this.load(skin)
    for (const [k, s] of this.sets) s.obj.visible = k === this.key && this.root.visible
  }

  setTeam(team: TeamId): void {
    this.team = forcedTeam() ?? team
    for (const [k, s] of this.sets) s.obj.visible = k === this.key && this.root.visible
  }

  setVisible(v: boolean): void {
    this.root.visible = v
    const s = this.sets.get(this.key)
    for (const [k, set] of this.sets) set.obj.visible = v && k === this.key && !!s
  }

  /** Đặt cả hai cánh tay: trung điểm hai vai nằm ở armsRootOffset, xoay armsRootRotDeg, scale armsScale. */
  place(): void {
    const s = this.sets.get(this.key)
    if (!s) return
    const f = poses.first
    this.root.scale.setScalar(f.armsScale)
    this.root.quaternion.setFromEuler(_e.set(f.armsRootRotDeg[0] * DEG, f.armsRootRotDeg[1] * DEG, f.armsRootRotDeg[2] * DEG, 'XYZ'))
    // trung điểm vai trong hệ root (model xoay π quanh Y) rồi nhân scale + xoay, lùi root cho trùng offset
    _v.set(-s.mid.x, s.mid.y, -s.mid.z).multiplyScalar(f.armsScale).applyQuaternion(this.root.quaternion)
    this.root.position.set(f.armsRootOffset[0] - _v.x, f.armsRootOffset[1] - _v.y, f.armsRootOffset[2] - _v.z)
    this.root.updateMatrixWorld(true)
  }

  /**
   * Giải IK sau khi súng đã đặt. gunQuat = hướng súng trong không gian camera; targetL null = tay trái không giải
   * (súng 1 tay): tay đó giữ tư thế T-pose nên được ẩn.
   */
  solve(targetR: THREE.Vector3, targetL: THREE.Vector3 | null, gunQuat: THREE.Quaternion, rotDegR?: Vec3, rotDegL?: Vec3, opts?: FpSolveOpts): void {
    const s = this.sets.get(this.key)
    if (!s) return
    const f = poses.first
    for (const [arm, target, pole, rot] of [[s.armR, targetR, f.armsPoleR, rotDegR], [s.armL, targetL, f.armsPoleL, rotDegL]] as const) {
      if (!target) continue
      // lựu đạn: mỗi tay có thể xoay riêng so với hướng quả (poses: first.grenade.handRotDegR/L)
      const isL = arm === s.armL
      const q = isL && opts?.leftQuat ? opts.leftQuat : rot ? _hq.copy(gunQuat).multiply(_hq2.setFromEuler(_he.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'))) : gunQuat
      arm.resetPose()   // không có mixer: tự reset để IK/ngón không cộng dồn qua các frame
      arm.slideToReach(target, f.armsMaxExtension)
      arm.upper.getWorldPosition(_sh)
      _pole.set(pole[0], pole[1], pole[2]).add(_sh)
      arm.solve(target, q, _pole, 1)
      arm.applyGrip(1, isL ? opts?.gripL : opts?.gripR)
    }
  }

  /** Bàn tay trái (để băng đạn đi theo khi nạp) */
  leftHand(): THREE.Object3D | null { return this.sets.get(this.key)?.armL.hand ?? null }

  /** Ẩn tay trái khi súng 1 tay (xương T-pose duỗi ngang trông rất lạ) */
  setLeftVisible(v: boolean): void {
    const s = this.sets.get(this.key)
    if (!s) return
    s.armL.upper.scale.setScalar(v ? 1 : 1e-4)   // thu nhỏ xương → mesh tay trái co lại thành điểm
  }
}
