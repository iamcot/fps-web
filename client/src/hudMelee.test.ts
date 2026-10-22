import { describe, it, expect } from 'vitest'
import { KNIFE_SET, MELEE, makeWeaponState } from '@fps/shared'
import { makeMeleeHudModel, meleeHudModel } from './hudMelee'

describe('meleeHudModel', () => {
  const ws = () => { const w = makeWeaponState([6, 2, -1, 0, -1]); w.current = 6; return w }
  const m = makeMeleeHudModel()

  it('thể lực đầy, không combo', () => {
    meleeHudModel(m, ws(), KNIFE_SET, 1000)
    expect(m).toMatchObject({ stamina: 1, guarding: false, staggered: false, combo: 0, lowStamina: false })
  })

  it('đếm combo theo chiêu đang chạy và theo cửa sổ nối sau khi xong', () => {
    const w = ws()
    w.meleeMove = 2   // L3 = nhát thứ 3 của L L L
    expect(meleeHudModel(m, w, KNIFE_SET, 1000).combo).toBe(3)
    w.meleeMove = -1; w.comboNode = 1; w.chainEndMs = 2000
    expect(meleeHudModel(m, w, KNIFE_SET, 1500).combo).toBe(2)
    expect(meleeHudModel(m, w, KNIFE_SET, 2500).combo).toBe(0)   // hết cửa sổ nối
  })

  it('thể lực thấp, đỡ, choáng', () => {
    const w = ws()
    w.stamina = 10; w.staminaMs = 0; w.staminaRegenAtMs = 1e9
    w.guardSinceMs = 5; w.staggerUntilMs = 3000
    meleeHudModel(m, w, KNIFE_SET, 1000)
    expect(m.stamina).toBeCloseTo(10 / MELEE.staminaMax, 6)
    expect(m).toMatchObject({ lowStamina: true, guarding: true, staggered: true })
  })
})
