import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { solveTwoBone } from './blockArm'

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

describe('solveTwoBone', () => {
  const a = 0.4, b = 0.5
  const shoulder = v(0.2, 1.4, 0)

  it('target trong tầm: đủ độ dài xương, tay chạm target', () => {
    const target = v(0.3, 1.2, -0.5), elbow = v(), hand = v()
    expect(solveTwoBone(a, b, shoulder, target, v(0.5, 0.8, 0.2), elbow, hand)).toBe(true)
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(a, 6)
    expect(hand.distanceTo(elbow)).toBeCloseTo(b, 6)
    expect(hand.distanceTo(target)).toBeLessThan(1e-6)
  })

  it('target quá xa: duỗi thẳng, reached = false', () => {
    const target = v(0.2, 1.4, -5), elbow = v(), hand = v()
    expect(solveTwoBone(a, b, shoulder, target, v(0.5, 0.8, 0.2), elbow, hand)).toBe(false)
    expect(hand.distanceTo(shoulder)).toBeCloseTo(a + b, 3)
    expect(Math.abs(hand.x - 0.2)).toBeLessThan(1e-3)
    expect(Math.abs(hand.y - 1.4)).toBeLessThan(1e-3)
    expect(hand.z).toBeLessThan(0)
  })

  it('khuỷu nằm cùng phía với pole', () => {
    const target = v(0.1, 1.3, -0.6), elbow = v(), hand = v()
    for (const pole of [v(0.5, 0.8, 0.2), v(-0.5, 0.8, 0.2), v(0.2, 2.5, 0)]) {
      solveTwoBone(a, b, shoulder, target, pole, elbow, hand)
      const dir = target.clone().sub(shoulder).normalize()
      const e = elbow.clone().sub(shoulder); e.addScaledVector(dir, -e.dot(dir))
      const p = pole.clone().sub(shoulder); p.addScaledVector(dir, -p.dot(dir))
      expect(e.dot(p)).toBeGreaterThan(0)
    }
  })

  it('pole nằm trên đường vai–tay: không NaN', () => {
    const elbow = v(), hand = v()
    solveTwoBone(a, b, shoulder, v(0.2, 1.4, -0.6), v(0.2, 1.4, -2), elbow, hand)
    expect(Number.isFinite(elbow.x + elbow.y + elbow.z)).toBe(true)
  })
})
