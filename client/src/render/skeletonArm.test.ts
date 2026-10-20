import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { SkeletonArm, type FingerBones } from './skeletonArm'

// Khung xương tay giả: vai ở gốc, tay duỗi theo +X (T-pose), bàn tay có 5 ngón mỗi ngón 3 đốt
function makeArm(side: 'L' | 'R') {
  const dir = side === 'R' ? 1 : -1
  const root = new THREE.Group()
  const mk = (parent: THREE.Object3D, x: number) => { const b = new THREE.Bone(); b.position.set(x * dir, 0, 0); parent.add(b); return b }
  const upper = mk(root, 0), fore = mk(upper, 0.3), hand = mk(fore, 0.28)
  const chain = (z: number) => { let p: THREE.Object3D = hand; const out: THREE.Bone[] = []
    for (let i = 0; i < 3; i++) { const b = new THREE.Bone(); b.position.set((i === 0 ? 0.09 : 0.03) * dir, 0, z); p.add(b); out.push(b); p = b }
    return out }
  const fingers: FingerBones = { thumb: chain(0.03), index: chain(0.02), middle: chain(0), ring: chain(-0.02), pinky: chain(-0.04) }
  root.updateMatrixWorld(true)
  return { root, arm: new SkeletonArm(upper, fore, hand, fingers, side), upper, fore, hand }
}

describe('SkeletonArm', () => {
  it('đo độ dài xương lúc dựng', () => {
    const { arm } = makeArm('R')
    expect(arm.lenA).toBeCloseTo(0.3); expect(arm.lenB).toBeCloseTo(0.28)
  })
  for (const side of ['R', 'L'] as const) {
    it(`tay ${side} với tới điểm trong tầm: tâm bàn tay trùng target`, () => {
      const { root, arm, hand } = makeArm(side)
      const target = new THREE.Vector3(side === 'R' ? 0.25 : -0.25, -0.2, -0.3)
      const pole = new THREE.Vector3(side === 'R' ? 0.35 : -0.35, -0.6, 0.3)
      const r = arm.solve(target, new THREE.Quaternion(), pole, 1)
      root.updateMatrixWorld(true)
      expect(r.reached).toBe(true)
      // cổ tay = target lùi palmLen dọc hướng ngón (−Z)
      const wrist = hand.getWorldPosition(new THREE.Vector3())
      expect(wrist.x).toBeCloseTo(target.x, 2); expect(wrist.y).toBeCloseTo(target.y, 2); expect(wrist.z).toBeCloseTo(target.z + arm.palmLen, 2)
    })
    it(`tay ${side}: khuỷu nằm phía pole (không gập ngược)`, () => {
      const { root, arm, fore } = makeArm(side)
      const target = new THREE.Vector3(side === 'R' ? 0.1 : -0.1, 0, -0.4)
      arm.solve(target, new THREE.Quaternion(), new THREE.Vector3(side === 'R' ? 0.4 : -0.4, -0.6, 0.3), 1)
      root.updateMatrixWorld(true)
      const elbow = fore.getWorldPosition(new THREE.Vector3())
      expect(elbow.y).toBeLessThan(0)   // pole ở dưới
    })
  }
  it('ngoài tầm với: duỗi thẳng về phía target, reached=false', () => {
    const { arm } = makeArm('R')
    expect(arm.solve(new THREE.Vector3(3, 0, -3), new THREE.Quaternion(), new THREE.Vector3(0, -1, 0), 1).reached).toBe(false)
  })
  it('weight 0: không đổi gì', () => {
    const { arm, upper } = makeArm('R')
    const q = upper.quaternion.clone()
    arm.solve(new THREE.Vector3(0.2, 0, -0.3), new THREE.Quaternion(), new THREE.Vector3(0.3, -0.6, 0.3), 0)
    expect(upper.quaternion.angleTo(q)).toBe(0)
  })
  it('weight 0.5: xoay một nửa so với weight 1', () => {
    const a = makeArm('R'), b = makeArm('R')
    const t = new THREE.Vector3(0.2, -0.1, -0.35), pole = new THREE.Vector3(0.35, -0.6, 0.3)
    a.arm.solve(t, new THREE.Quaternion(), pole, 1)
    b.arm.solve(t, new THREE.Quaternion(), pole, 0.5)
    expect(b.upper.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(a.upper.quaternion.angleTo(new THREE.Quaternion()) / 2, 2)
  })
  it('không có mixer: reset + solve + grip lặp lại nhiều frame cho kết quả y hệt (không cộng dồn)', () => {
    const { root, arm, upper, fore, hand } = makeArm('R')
    const t = new THREE.Vector3(0.2, -0.1, -0.35), pole = new THREE.Vector3(0.35, -0.6, 0.3), gq = new THREE.Quaternion()
    const snap = () => [upper, fore, hand, arm.fingers.middle[0]!, arm.fingers.index[2]!].map(b => b.quaternion.clone())
    const frame = () => { arm.resetPose(); arm.solve(t, gq, pole, 1); arm.applyGrip(1); root.updateMatrixWorld(true) }
    frame(); const first = snap()
    for (let i = 0; i < 50; i++) frame()
    snap().forEach((q, i) => expect(q.angleTo(first[i]!)).toBeLessThan(1e-6))
  })
  it('ngón gập: đốt xoay đúng góc theo grip', () => {
    const { arm, fingers } = Object.assign(makeArm('R'), { fingers: null as unknown as FingerBones })
    const mid = arm.fingers.middle[0]!
    arm.applyGrip(1)
    expect(mid.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(55 * Math.PI / 180, 3)
    void fingers
  })
})
