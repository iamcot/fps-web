import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { CHARACTER_SETS, defaultMovement, hitboxesFor, type TeamId } from '@fps/shared'
import { characterSetList, getCharacterSet } from './index'
import { makeAnimState, updateAnim, type AnimInput } from './animate'

const TEAMS_: TeamId[] = ['A', 'B']
const feet = { pos: [0, 0, 0] as [number, number, number], crouching: false } as never

describe('bộ nhân vật (module)', () => {
  it('mọi id trong shared đều có module; id lạ rơi về mặc định', () => {
    expect(characterSetList.map(s => s.id)).toEqual([...CHARACTER_SETS])
    expect(getCharacterSet('khong-co').id).toBe(CHARACTER_SETS[0])
  })

  for (const set of characterSetList) for (const team of TEAMS_) {
    it(`${set.id}/${team}: đầu khớp vùng head của hitbox, thân không vượt hitbox`, () => {
      const rig = set.build(team)
      rig.root.updateWorldMatrix(true, true)
      const head = new THREE.Box3().setFromObject(rig.headMesh)
      const hb = hitboxesFor(feet, defaultMovement).find(b => b.part === 'head')!
      expect(head.min.y).toBeCloseTo(hb.min[1], 3)
      expect(head.max.y).toBeCloseTo(hb.max[1], 3)
      expect(head.max.x - head.min.x).toBeCloseTo(hb.max[0] - hb.min[0], 3)
      expect(rig.parts.length).toBeGreaterThan(6)
      expect(rig.mats.length).toBe(rig.parts.length)
      expect(rig.team).toBe(team)
    })
  }

  it('hai đội của cùng một bộ nhìn khác nhau (màu thân)', () => {
    for (const set of characterSetList) {
      const col = (t: 'A' | 'B') => (set.build(t).mats[2] as unknown as { color: { getHex(): number } }).color.getHex()
      const a = col('A'), b = col('B')
      expect(a).not.toBe(b)
    }
  })
})

describe('animation thủ tục', () => {
  const base: AnimInput = { x: 0, z: 0, dt: 1 / 60, grounded: true, crouching: false, sliding: false, pitch: 0, crouchDrop: 0.6 }
  const run = (rig: ReturnType<typeof getCharacterSet>['build'] extends (t: TeamId) => infer R ? R : never, speed: number, frames: number, extra: Partial<AnimInput> = {}) => {
    const st = makeAnimState()
    let z = 0
    for (let i = 0; i < frames; i++) { z -= speed / 60; updateAnim(rig, st, { ...base, z, ...extra }) }
    return st
  }

  it('đứng yên: chân không đung đưa; chạy: chân đung đưa chéo nhau, theo quãng đường', () => {
    const idle = getCharacterSet('blocky').build('A')
    run(idle, 0, 60)
    expect(Math.abs(idle.legL.rotation.x)).toBeLessThan(1e-6)
    const moving = getCharacterSet('blocky').build('A')
    let peak = 0
    const st = makeAnimState()
    let z = 0
    for (let i = 0; i < 120; i++) {
      z -= 8.5 / 60
      updateAnim(moving, st, { ...base, z })
      peak = Math.max(peak, Math.abs(moving.legL.rotation.x))
      expect(moving.legL.rotation.x + moving.legR.rotation.x).toBeCloseTo(0, 5)   // đối xứng ngược pha
    }
    expect(peak).toBeGreaterThan(0.5)
    expect(st.phase).toBeGreaterThan(10)
  })

  it('chạy nhanh đung đưa mạnh hơn chạy chậm; robot đung đưa ít hơn blocky', () => {
    const peakOf = (id: string, speed: number) => {
      const rig = getCharacterSet(id).build('A'); const st = makeAnimState(); let z = 0, peak = 0
      for (let i = 0; i < 240; i++) { z -= speed / 60; updateAnim(rig, st, { ...base, z }); peak = Math.max(peak, Math.abs(rig.legL.rotation.x)) }
      return peak
    }
    expect(peakOf('blocky', 8.5)).toBeGreaterThan(peakOf('blocky', 2))
    expect(peakOf('robot', 8.5)).toBeLessThan(peakOf('blocky', 8.5))
  })

  it('teleport (hồi sinh) không bị tính là chạy', () => {
    const rig = getCharacterSet('blocky').build('A'); const st = makeAnimState()
    updateAnim(rig, st, base)
    updateAnim(rig, st, { ...base, x: 40 })
    expect(st.phase).toBe(0)
  })

  it('trượt: ngả ra sau, chân duỗi trước; nhảy: co chân; ngồi: cúi về trước', () => {
    const settle = (extra: Partial<AnimInput>) => { const rig = getCharacterSet('blocky').build('A'); const st = makeAnimState(); for (let i = 0; i < 60; i++) updateAnim(rig, st, { ...base, ...extra }); return rig }
    const slide = settle({ sliding: true })
    expect(slide.upper.rotation.x).toBeGreaterThan(0.4)
    expect(slide.legL.rotation.x).toBeGreaterThan(0.8)
    const air = settle({ grounded: false })
    expect(air.legL.rotation.x).toBeGreaterThan(0.5)
    expect(settle({ crouching: true }).upper.rotation.x).toBeLessThan(-0.1)
    // ngồi: chỉ chân ngắn lại + hông hạ, thân/đầu không bị scale
    const cr = settle({ crouching: true })
    expect(cr.legL.scale.y).toBeCloseTo(0.2 / 0.8, 2)
    expect(cr.upper.position.y).toBeCloseTo(0.2, 2)
    expect(cr.root.scale.y).toBe(1)
    expect(cr.upper.scale.y).toBe(1)
  })

  it('pitch: đầu và súng xoay theo, tổng nghiêng bằng pitch', () => {
    const rig = settle2(0.5)
    expect(rig.headPivot.rotation.x + rig.upper.rotation.x).toBeCloseTo(0.5, 2)
    // súng là con của tay: tổng xoay = upper + armR + gunAnchor = pitch (tay nghỉ đã bị gunAnchor bù)
    expect(rig.upper.rotation.x + rig.armR.rotation.x + rig.gunAnchor.rotation.x).toBeCloseTo(0.5, 2)
    function settle2(pitch: number) { const r = getCharacterSet('robot').build('B'); const st = makeAnimState(); for (let i = 0; i < 60; i++) updateAnim(r, st, { ...base, pitch }); return r }
  })
})
