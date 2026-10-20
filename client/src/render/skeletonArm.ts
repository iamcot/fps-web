import * as THREE from 'three'
import { solveTwoBone } from './blockArm'
import { poses, type FingerName, type Vec3 } from './poses'

// Tay bằng xương thật của model (plan 11, C.5): IK 2 khớp xoay upper/fore, đặt hướng bàn tay theo súng,
// gập ngón theo poses.json:grip. Mọi toạ độ/quaternion của solve() là thế giới. Không cấp phát trong solve().
export interface FingerBones { thumb: THREE.Bone[]; index: THREE.Bone[]; middle: THREE.Bone[]; ring: THREE.Bone[]; pinky: THREE.Bone[] }
export const FINGER_NAMES: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky']
const DEG = Math.PI / 180

const _sh = new THREE.Vector3(), _el0 = new THREE.Vector3(), _wr0 = new THREE.Vector3()
const _elN = new THREE.Vector3(), _wrN = new THREE.Vector3(), _wrist = new THREE.Vector3()
const _dirCur = new THREE.Vector3(), _dirNew = new THREE.Vector3(), _fing = new THREE.Vector3()
const _qd = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _tq = new THREE.Quaternion()
const _hq = new THREE.Quaternion(), _off = new THREE.Quaternion(), _eul = new THREE.Euler(), _grip = new THREE.Quaternion()
const _m = new THREE.Matrix4(), _axis = new THREE.Vector3()
const E1C = new THREE.Vector3(0, 0, -1)   // ngón tay chĩa −Z của súng

/** Quaternion thế giới mới của bone sao cho vector `from` (thế giới) quay tới `to`, trả về dạng local của bone (blend theo weight). */
function rotateBoneTo(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number): void {
  _qd.setFromUnitVectors(from, to)
  bone.getWorldQuaternion(_wq).premultiply(_qd)
  bone.parent!.getWorldQuaternion(_pq)
  _tq.copy(_pq).invert().multiply(_wq)
  if (weight < 1) bone.quaternion.slerp(_tq, weight); else bone.quaternion.copy(_tq)
  bone.updateWorldMatrix(false, true)
}

export class SkeletonArm {
  readonly lenA: number
  readonly lenB: number
  readonly palmLen: number
  reached = true
  // khung bàn tay: trục X = hướng ngón, Z = pháp tuyến lòng bàn tay, Y = Z × X
  private readonly basisInHandInv = new THREE.Quaternion()
  private readonly qCanon = new THREE.Quaternion()
  private readonly offsetDeg: () => Vec3

  /** Phải dựng khi model đang ở T-pose (chưa chạy mixer): đo độ dài xương + khung bàn tay lúc nghỉ. */
  constructor(
    readonly upper: THREE.Bone, readonly fore: THREE.Bone, readonly hand: THREE.Bone,
    readonly fingers: FingerBones, readonly side: 'L' | 'R',
  ) {
    upper.updateWorldMatrix(true, true)
    upper.getWorldPosition(_sh); fore.getWorldPosition(_el0); hand.getWorldPosition(_wr0)
    this.lenA = _sh.distanceTo(_el0)
    this.lenB = _el0.distanceTo(_wr0)
    const knuckle = fingers.middle[0]!.getWorldPosition(_elN)
    const f = _dirCur.subVectors(knuckle, _wr0)
    const handLen = f.length()
    this.palmLen = handLen * poses.character.palmCenterFrac
    f.normalize()
    // T-pose: lòng bàn tay úp xuống
    const n = _dirNew.set(0, -1, 0)
    n.addScaledVector(f, -n.dot(f)).normalize()
    const u = _fing.crossVectors(n, f)
    const qRest = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(f, u, n))
    const handQ = hand.getWorldQuaternion(new THREE.Quaternion())
    const basisInHand = handQ.invert().multiply(qRest)
    this.basisInHandInv.copy(basisInHand).invert()
    const nc = new THREE.Vector3(side === 'R' ? -1 : 1, 0, 0)
    const uc = new THREE.Vector3().crossVectors(nc, E1C)
    this.qCanon.setFromRotationMatrix(_m.makeBasis(E1C, uc, nc))
    this.offsetDeg = () => (side === 'R' ? poses.character.handRotOffsetDegR : poses.character.handRotOffsetDegL)
  }

  /** Quaternion bone-local của "bàn tay chuẩn" (ngón −Z, ngón cái +Y): dùng gắn súng 1 tay vào xương bàn tay. */
  gunFrameInHand(out: THREE.Quaternion): THREE.Quaternion { return out.copy(this.qCanon).multiply(this.basisInHandInv).invert() }
  /** Vị trí tâm lòng bàn tay trong hệ bone bàn tay (dọc hướng ngón). */
  palmCenterInHand(out: THREE.Vector3): THREE.Vector3 {
    _tq.copy(this.basisInHandInv).invert()   // khung chuẩn → bone: trục X của khung (hướng ngón) trong hệ bone
    return out.set(1, 0, 0).applyQuaternion(_tq).multiplyScalar(this.palmLen)
  }

  /**
   * target = vị trí tâm lòng bàn tay mong muốn (thế giới); targetQuat = hướng của điểm neo/súng; pole = điểm khuỷu hướng tới.
   * weight 0..1 trộn giữa tư thế animation và IK. Gọi sau khi mixer/spine/súng đã cập nhật matrixWorld.
   */
  solve(target: THREE.Vector3, targetQuat: THREE.Quaternion, pole: THREE.Vector3, weight: number): { reached: boolean } {
    if (weight <= 0) return { reached: true }
    const o = this.offsetDeg()
    _off.setFromEuler(_eul.set(o[0] * DEG, o[1] * DEG, o[2] * DEG, 'XYZ'))
    const gunHandQ = _hq.copy(targetQuat).multiply(_off)               // khung bàn tay chuẩn trong thế giới
    _fing.copy(E1C).applyQuaternion(gunHandQ)                          // hướng ngón thế giới
    _wrist.copy(target).addScaledVector(_fing, -this.palmLen)          // cổ tay = tâm bàn tay lùi dọc ngón
    // 1) upper: vai → khuỷu
    this.upper.updateWorldMatrix(true, true)
    this.upper.getWorldPosition(_sh); this.fore.getWorldPosition(_el0)
    solveTwoBone(this.lenA, this.lenB, _sh, _wrist, pole, _elN, _wrN)
    _dirCur.subVectors(_el0, _sh).normalize()
    _dirNew.subVectors(_elN, _sh).normalize()
    rotateBoneTo(this.upper, _dirCur, _dirNew, weight)
    // 2) fore: khuỷu → cổ tay
    this.fore.getWorldPosition(_el0); this.hand.getWorldPosition(_wr0)
    _dirCur.subVectors(_wr0, _el0).normalize()
    _dirNew.subVectors(_wrist, _el0).normalize()
    rotateBoneTo(this.fore, _dirCur, _dirNew, weight)
    // 3) hand: hướng thế giới = khung chuẩn × (khung chuẩn → xương bàn tay)
    _wq.copy(gunHandQ).multiply(this.qCanon).multiply(this.basisInHandInv)
    this.fore.getWorldQuaternion(_pq)
    _tq.copy(_pq).invert().multiply(_wq)
    if (weight < 1) _tq.copy(this.hand.quaternion).slerp(_tq, weight)
    this.hand.quaternion.copy(_tq)
    this.hand.updateWorldMatrix(false, true)
    this.hand.getWorldPosition(_wr0)
    this.reached = _wr0.distanceTo(_wrist) < 0.03
    return { reached: this.reached }
  }

  /** Gập ngón theo grip (độ, 3 đốt mỗi ngón) nhân với weight, cộng lên tư thế hiện tại của xương. */
  applyGrip(weight: number): void {
    if (weight <= 0) return
    const g = poses.grip, set = this.side === 'R' ? g.R : g.L
    _axis.set(g.axis === 'x' ? 1 : 0, g.axis === 'y' ? 1 : 0, g.axis === 'z' ? 1 : 0)
    for (const name of FINGER_NAMES) {
      const bones = this.fingers[name], deg = set[name]
      for (let i = 0; i < bones.length && i < 3; i++) {
        _grip.setFromAxisAngle(_axis, deg[i]! * DEG * weight)
        bones[i]!.quaternion.multiply(_grip)
      }
    }
  }
}
