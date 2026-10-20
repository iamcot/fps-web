import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { TeamId } from '@fps/shared'
import { poses } from './poses'
import { forcedTeam } from './characterRig'
import { SkeletonArm, type FingerBones } from './skeletonArm'

// Tay viewmodel bằng chính hai cánh tay của model nhân vật (plan 11, C.6): <team>_fparms.glb chỉ có bắp tay → bàn tay,
// vẫn đủ xương Mixamo nên dùng lại SkeletonArm (IK + ngón) y như góc 3. Mọi toạ độ trong không gian camera của viewmodel.
const FILES: Record<TeamId, string> = { A: '/models/characters/cop_fparms.glb', B: '/models/characters/robber_fparms.glb' }
const DEG = Math.PI / 180

interface Set { obj: THREE.Group; armR: SkeletonArm; armL: SkeletonArm; mats: THREE.Material[]; mid: THREE.Vector3 }

const _v = new THREE.Vector3(), _e = new THREE.Euler()
const _pole = new THREE.Vector3(), _sh = new THREE.Vector3()

export class FpArms {
  readonly root = new THREE.Group()
  sets = new Map<TeamId, Set>()
  private team: TeamId = forcedTeam() ?? 'A'
  private failed = false

  constructor() {
    this.root.visible = false
    if (import.meta.env?.DEV) (globalThis as { __fpArms?: FpArms }).__fpArms = this   // debug: script kiểm tra từ trình duyệt
  }

  load(): void {
    const loader = new GLTFLoader()
    for (const team of ['A', 'B'] as TeamId[]) {
      loader.loadAsync(FILES[team]).then(gltf => this.add(team, gltf.scene)).catch(err => {
        this.failed = true
        console.warn(`fpArms: không load được ${FILES[team]}, dùng tay khối`, err)
      })
    }
  }

  private add(team: TeamId, scene: THREE.Object3D): void {
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
    this.sets.set(team, { obj, armR, armL, mats, mid })
  }

  /** Dùng được khi model của đội hiện tại đã load; chưa thì viewmodel vẫn vẽ tay khối. */
  get ready(): boolean { return this.sets.has(this.team) }
  get hasFailed(): boolean { return this.failed }

  setTeam(team: TeamId): void {
    this.team = forcedTeam() ?? team
    for (const [t, s] of this.sets) s.obj.visible = t === team && this.root.visible
  }

  setVisible(v: boolean): void {
    this.root.visible = v
    const s = this.sets.get(this.team)
    for (const [t, set] of this.sets) set.obj.visible = v && t === this.team && !!s
  }

  /** Đặt cả hai cánh tay: trung điểm hai vai nằm ở armsRootOffset, xoay armsRootRotDeg, scale armsScale. */
  place(): void {
    const s = this.sets.get(this.team)
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
  solve(targetR: THREE.Vector3, targetL: THREE.Vector3 | null, gunQuat: THREE.Quaternion): void {
    const s = this.sets.get(this.team)
    if (!s) return
    const f = poses.first
    for (const [arm, target, pole] of [[s.armR, targetR, f.armsPoleR], [s.armL, targetL, f.armsPoleL]] as const) {
      if (!target) continue
      arm.upper.getWorldPosition(_sh)
      _pole.set(pole[0], pole[1], pole[2]).add(_sh)
      arm.solve(target, gunQuat, _pole, 1)
      arm.applyGrip(1)
    }
  }

  /** Bàn tay trái (để băng đạn đi theo khi nạp) */
  leftHand(): THREE.Object3D | null { return this.sets.get(this.team)?.armL.hand ?? null }

  /** Ẩn tay trái khi súng 1 tay (xương T-pose duỗi ngang trông rất lạ) */
  setLeftVisible(v: boolean): void {
    const s = this.sets.get(this.team)
    if (!s) return
    s.armL.upper.scale.setScalar(v ? 1 : 1e-4)   // thu nhỏ xương → mesh tay trái co lại thành điểm
  }
}
