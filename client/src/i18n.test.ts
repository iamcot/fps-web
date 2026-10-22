import { describe, expect, it } from 'vitest'
import { getLang, saveLang, statusText, t, teamName, modeLabel } from './i18n'

describe('i18n', () => {
  it('mặc định tiếng Anh: trả nguyên khoá, thay tham số', () => {
    expect(getLang()).toBe('en')
    expect(t('Killed by {name}', { name: 'Tèo' })).toBe('Killed by Tèo')
    expect(teamName('A')).toBe('Cops')
    expect(modeLabel('tdm')).toBe('Team Deathmatch')
  })
  it('tiếng Việt: dịch, thiếu bản dịch thì giữ tiếng Anh, trạng thái phòng khớp khuôn', () => {
    saveLang('vi')
    try {
      expect(t('Killed by {name}', { name: 'Tèo' })).toBe('Bị Tèo hạ')
      expect(t('Some untranslated text')).toBe('Some untranslated text')
      expect(teamName('B')).toBe('Cướp')
      expect(modeLabel('defense')).toBe('Thủ Thành')
      expect(statusText('Round 5/19 · 3–2')).toBe('Ván 5/19 · 3–2')
      expect(statusText('Round 2/5 · 3 humans – 4 zombies')).toBe('Ván 2/5 · 3 người – 4 zombie')
      expect(statusText('06:12 left · 23–18')).toBe('Còn 06:12 · 23–18')
      expect(statusText('Wave 3/10 · 2 players')).toBe('Đợt 3/10 · 2 người')
      expect(statusText('Waiting')).toBe('Đang chờ')
    } finally { saveLang('en') }
  })
})
