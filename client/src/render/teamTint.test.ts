import { describe, expect, it } from 'vitest'
import { liftedLuma, teamTintDef } from './teamTint'

describe('teamTint', () => {
  it('texel tối nhất vẫn sáng hơn sàn lift, texel sáng đầy → 1, đơn điệu tăng', () => {
    const d = teamTintDef('saber', 'B')!
    expect(liftedLuma(0, d)).toBeCloseTo(d.lift)
    expect(liftedLuma(d.lumRef * 5, d)).toBeCloseTo(1)
    expect(liftedLuma(d.lumRef * 0.3, d)).toBeGreaterThan(liftedLuma(d.lumRef * 0.1, d))
  })
  it('cớm và cướp khác màu ở mọi skin có xương', () => {
    for (const skin of ['saber', 'classic']) expect(teamTintDef(skin, 'A')!.color).not.toBe(teamTintDef(skin, 'B')!.color)
  })
})
