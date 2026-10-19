import { describe, it, expect } from 'vitest'
import { TICK_RATE, DT } from './index'

describe('placeholder', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2)
  })

  it('DT = 1/TICK_RATE', () => {
    expect(DT).toBeCloseTo(1 / TICK_RATE)
  })
})

import { phaseButtonMask, MatchPhase, Btn, winnerOf } from './index'
describe('teams', () => {
  it('phaseButtonMask: chết/đếm ngược = 0; ENDED bỏ Fire+Reload nhưng còn di chuyển', () => {
    expect(phaseButtonMask(MatchPhase.Playing, false)).toBe(0)
    expect(phaseButtonMask(MatchPhase.Countdown, true)).toBe(0)
    const ended = phaseButtonMask(MatchPhase.Ended, true)
    expect(ended & Btn.Fire).toBe(0); expect(ended & Btn.Reload).toBe(0); expect(ended & Btn.Forward).toBe(Btn.Forward)
    expect(phaseButtonMask(MatchPhase.Waiting, true) & Btn.Fire).toBe(Btn.Fire)
  })
  it('winnerOf', () => {
    expect(winnerOf(3, 2)).toBe('A'); expect(winnerOf(1, 2)).toBe('B'); expect(winnerOf(2, 2)).toBeNull()
  })
})
