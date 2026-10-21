import { describe, expect, it } from 'vitest'
import { SLOTS } from './locomotion'
import { Z_CLIPS, Z_DEATH, ZOMBIE_ATTACK, ZOMBIE_RATE_MAX, ZOMBIE_RATE_MIN, fitRate, zombieClipRate, zombieSlotClip } from './zombieAnim'

describe('animation zombie (ZF.4)', () => {
  it('mọi ô di chuyển đều có clip z_* hợp lệ', () => {
    for (const s of SLOTS) expect(Z_CLIPS as readonly string[]).toContain(zombieSlotClip(s))
    expect(zombieSlotClip('crouchWalk')).toBe('z_crawl')
    expect(zombieSlotClip('walkB')).toBe('z_walk')
  })
  it('timeScale theo tốc độ, kẹp trong khoảng; clip không theo tốc độ = 1', () => {
    expect(zombieClipRate('z_run', 0)).toBe(ZOMBIE_RATE_MIN)
    expect(zombieClipRate('z_run', 100)).toBe(ZOMBIE_RATE_MAX)
    expect(zombieClipRate('z_walk', 0.6)).toBeCloseTo(1, 5)
    expect(zombieClipRate('z_idle', 5)).toBe(1)
    expect(zombieClipRate('z_jump', 5)).toBe(1)
  })
  it('đòn cào nằm trong clip và vừa thời gian vung; fitRate co đoạn clip vào đúng số giây', () => {
    for (const a of Object.values(ZOMBIE_ATTACK)) {
      expect(a.from).toBeGreaterThanOrEqual(0)
      expect(a.to).toBeLessThanOrEqual(1)
      expect(a.to).toBeGreaterThan(a.from)
    }
    // clip 4s, đoạn 50% trong 0,5s → phát nhanh ×4
    expect(fitRate(4, 0.1, 0.6, 0.5)).toBeCloseTo(4, 5)
    expect(Z_DEATH).toEqual(['z_death_1', 'z_death_2'])
  })
})
