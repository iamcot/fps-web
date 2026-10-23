import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { clipTimeAt, MOVE_CLIP } from './meleeClips'
import { KNIFE_SET } from '@fps/shared'

const c = { name: 'x', clip: new THREE.AnimationClip('x', 2, []), win0: 0.2, hit: 0.6, win1: 1.4 }
describe('meleeClips', () => {
  it('đúng đầu / lúc đánh / cuối chiêu', () => {
    expect(clipTimeAt(c, 0, 200, 800)).toBeCloseTo(0.2)
    expect(clipTimeAt(c, 200, 200, 800)).toBeCloseTo(0.6)
    expect(clipTimeAt(c, 800, 200, 800)).toBeCloseTo(1.4)
    expect(clipTimeAt(c, 1200, 200, 800)).toBeCloseTo(1.4)
  })
  it('mọi chiêu trỏ tới chiêu có thật của dao', () => {
    const keys = new Set(KNIFE_SET.moves.map(m => m.key))
    for (const k of Object.keys(MOVE_CLIP)) expect(keys.has(k)).toBe(true)
  })
})
