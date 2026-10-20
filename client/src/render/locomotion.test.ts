import { describe, it, expect } from 'vitest'
import { locoTargets, makeSlotWeights, SLOTS, slotClip } from './locomotion'
import { poses } from './poses'

const cfg = poses.character.anim
const base = { vx: 0, vz: 0, yaw: 0, grounded: true, crouching: false, sliding: false }
const sum = (w: Record<string, number>) => SLOTS.reduce((a, s) => a + w[s]!, 0)

describe('locoTargets', () => {
  it('đứng yên → idle, tổng trọng số 1', () => {
    const w = makeSlotWeights(); locoTargets(base, cfg, w)
    expect(w.idle).toBe(1); expect(sum(w)).toBeCloseTo(1)
  })
  it('yaw 0: đi về −Z là đi tới, +Z là lùi, +X là sang phải, −X sang trái', () => {
    const w = makeSlotWeights()
    locoTargets({ ...base, vz: -2 }, cfg, w); expect(w.walkF).toBeCloseTo(1)
    locoTargets({ ...base, vz: 2 }, cfg, w); expect(w.walkB).toBeCloseTo(1)
    locoTargets({ ...base, vx: 2 }, cfg, w); expect(w.walkR).toBeCloseTo(1)
    locoTargets({ ...base, vx: -2 }, cfg, w); expect(w.walkL).toBeCloseTo(1)
  })
  it('hướng theo yaw: quay trái 90° (yaw = π/2) thì tiến về −X', () => {
    const w = makeSlotWeights(); locoTargets({ ...base, yaw: Math.PI / 2, vx: -2 }, cfg, w)
    expect(w.walkF).toBeCloseTo(1)
  })
  it('đi chéo chia đều hai hướng, tổng = 1', () => {
    const w = makeSlotWeights(); locoTargets({ ...base, vx: 1.5, vz: -1.5 }, cfg, w)
    expect(w.walkF).toBeCloseTo(w.walkR); expect(sum(w)).toBeCloseTo(1)
  })
  it('chạy nhanh về trước dùng run', () => {
    const w = makeSlotWeights(); locoTargets({ ...base, vz: -8 }, cfg, w)
    expect(w.run).toBeCloseTo(1); expect(sum(w)).toBeCloseTo(1)
  })
  it('chạy nhanh lùi không dùng run', () => {
    const w = makeSlotWeights(); locoTargets({ ...base, vz: 8 }, cfg, w)
    expect(w.run).toBe(0); expect(w.walkB).toBeCloseTo(1)
  })
  it('trên không / trượt / ngồi', () => {
    const w = makeSlotWeights()
    locoTargets({ ...base, grounded: false, vz: -5 }, cfg, w); expect(w.jump).toBe(1)
    locoTargets({ ...base, sliding: true, vz: -9 }, cfg, w); expect(w.slide).toBe(1)
    locoTargets({ ...base, crouching: true }, cfg, w); expect(w.crouchIdle).toBe(1)
    locoTargets({ ...base, crouching: true, vz: -3 }, cfg, w); expect(w.crouchWalk).toBe(1)
  })
  it('súng ngắn dùng bộ pistol cho idle/đi/chạy, mượn rifle cho lùi/ngang', () => {
    expect(slotClip('idle', true)).toBe('pistol_idle')
    expect(slotClip('walkB', true)).toBe('rifle_walk_b')
    expect(slotClip('run', false)).toBe('rifle_run_f')
  })
})
