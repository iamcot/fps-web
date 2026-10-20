import { describe, it, expect } from 'vitest'
import { sanitizeRoomConfig, clampMaxPlayers, DEFAULT_SETTINGS } from './roomConfig'

describe('sanitizeRoomConfig', () => {
  it('rác → Hỗn Chiến mặc định', () => {
    const c = sanitizeRoomConfig('r', 'm', null)
    expect(c.settings).toEqual(DEFAULT_SETTINGS.tdm)
    expect(c.maxPlayers).toBe(10)
  })
  it('kẹp giá trị ngoài giới hạn', () => {
    const c = sanitizeRoomConfig('r', 'm', { mode: 'elimination', maxPlayers: 99, settings: { roundsToWin: 999, roundTimeSec: 1 } })
    expect(c.settings.mode === 'elimination' && c.settings.roundsToWin).toBe(16)
    expect(c.settings.mode === 'elimination' && c.settings.roundTimeSec).toBe(60)
    expect(c.maxPlayers).toBe(10)
    const t = sanitizeRoomConfig('r', 'm', { mode: 'tdm', settings: { killLimit: 1, timeLimitMin: 999 } })
    expect(t.settings.mode === 'tdm' && t.settings.killLimit).toBe(10)
    expect(t.settings.mode === 'tdm' && t.settings.timeLimitMin).toBe(30)
  })
  it('không nhận NaN / chuỗi', () => {
    const c = sanitizeRoomConfig('r', 'm', { mode: 'elimination', settings: { roundsToWin: NaN, roundTimeSec: '9' as unknown as number } })
    expect(c.settings.mode === 'elimination' && c.settings.roundsToWin).toBe(10)
    expect(c.settings.mode === 'elimination' && c.settings.roundTimeSec).toBe(105)
  })
  it('maxPlayers chẵn, 2–10', () => {
    expect(clampMaxPlayers(7)).toBe(6)
    expect(clampMaxPlayers(1)).toBe(2)
    expect(clampMaxPlayers(undefined)).toBe(10)
  })
})
