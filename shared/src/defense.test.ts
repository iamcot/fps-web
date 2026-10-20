import { describe, it, expect } from 'vitest'
import { BOSS, DEFENSE, WAVES, ZOMBIE_TYPES, scaledCount, waveClearBonus, zombieStatsFor } from './defense'
import { ECONOMY_DEFENSE, economyFor } from './economy'

describe('Thủ Thành – dữ liệu (T.2/T.3)', () => {
  it('7 loại zombie như plan, boss là loại duy nhất có headMult 3', () => {
    expect(Object.keys(ZOMBIE_TYPES).sort()).toEqual(['boss', 'brute', 'crawler', 'leaper', 'runner', 'screamer', 'walker'])
    expect(ZOMBIE_TYPES.boss!.headMult).toBe(3)
    expect(ZOMBIE_TYPES.crawler!.abilities).toContain('crawl_holes')
    expect(ZOMBIE_TYPES.leaper!.abilities).toContain('leap')
    expect(ZOMBIE_TYPES.brute!.abilities).toContain('shove')
    expect(ZOMBIE_TYPES.screamer!.abilities).toContain('rally')
    expect(ZOMBIE_TYPES.boss!.abilities).toEqual(['slam', 'summon', 'charge'])
  })
  it('10 đợt, mọi nhóm dùng loại có thật; đợt 10 có boss', () => {
    expect(WAVES.waves.length).toBe(10)
    for (const w of WAVES.waves) for (const g of w.groups) { expect(ZOMBIE_TYPES[g.type], g.type).toBeDefined(); expect(g.count).toBeGreaterThan(0) }
    expect(WAVES.waves[9]!.groups.some(g => g.type === 'boss')).toBe(true)
    expect(WAVES.maxAlive).toBe(28)
  })
  it('số lượng và máu theo độ khó + số người', () => {
    expect(scaledCount(10, 'normal', 1)).toBe(10)
    expect(scaledCount(10, 'normal', 4)).toBe(Math.round(10 * (1 + 0.6 * 3)))
    expect(scaledCount(10, 'easy', 1)).toBe(7)
    expect(scaledCount(10, 'hard', 1)).toBe(13)
    expect(zombieStatsFor('walker', 'normal', 1).hpMax).toBe(150)
    expect(zombieStatsFor('walker', 'normal', 3).hpMax).toBe(Math.round(150 * 1.7))
    expect(zombieStatsFor('walker', 'hard', 1).clawDamage).toBe(Math.round(15 * 1.25))
  })
  it('kinh tế: thưởng hết đợt = 800 + 100×n; không truy nã', () => {
    expect(waveClearBonus(1)).toBe(900)
    expect(waveClearBonus(10)).toBe(1800)
    expect(economyFor('defense')).toBe(ECONOMY_DEFENSE)
    expect(ECONOMY_DEFENSE.startMoney).toBe(DEFENSE.startMoney)
    expect(ECONOMY_DEFENSE.infiniteReserve).toBe(true)
    expect(BOSS.summon.thresholds).toEqual([0.75, 0.5, 0.25])
  })
})
