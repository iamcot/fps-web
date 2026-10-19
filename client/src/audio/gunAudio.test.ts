import { describe, it, expect } from 'vitest'
import { reloadSchedule } from './gunAudio'
import { GUN_SOUNDS, allGunSoundKeys } from './gunProfiles'
import { gunKey, commonKey } from './loader'

describe('reloadSchedule', () => {
  it('AK47 nạp khi còn đạn: tháo + lắp băng, KHÔNG kéo khoá nòng', () => {
    const s = reloadSchedule(GUN_SOUNDS[0]!, 30, 20)
    expect(s.map(x => x.file)).toEqual(['reload_magout', 'reload_magin'])
  })

  it('AK47 nạp khi hết đạn: có kéo khoá nòng ở cuối', () => {
    const s = reloadSchedule(GUN_SOUNDS[0]!, 30, 0)
    expect(s.map(x => x.file)).toEqual(['reload_magout', 'reload_magin', 'reload_bolt'])
    expect(s[2]!.atFrac).toBeGreaterThan(s[1]!.atFrac)
  })

  it('Rulô nhét đúng số viên đã bắn', () => {
    const count = (ammo: number) => reloadSchedule(GUN_SOUNDS[3]!, 6, ammo).filter(x => x.file === 'reload_insert').length
    expect(count(4)).toBe(2)
    expect(count(5)).toBe(1)
    expect(count(0)).toBe(6)
    const s = reloadSchedule(GUN_SOUNDS[3]!, 6, 4)
    expect(s[0]!.file).toBe('reload_open')
    expect(s[s.length - 1]!.file).toBe('reload_close')
  })

  it('lịch tăng dần theo thời gian', () => {
    for (const id of [0, 1, 2, 3]) {
      const s = reloadSchedule(GUN_SOUNDS[id]!, 6, 0)
      for (let i = 1; i < s.length; i++) expect(s[i]!.atFrac).toBeGreaterThanOrEqual(s[i - 1]!.atFrac)
    }
  })
})

describe('allGunSoundKeys', () => {
  it('liệt kê file theo quy ước thư mục', () => {
    const keys = allGunSoundKeys(gunKey, commonKey)
    expect(keys).toContain('guns/ak47/shot_01')
    expect(keys).toContain('guns/colt/reload_slide')
    expect(keys).toContain('common/shell_pistol_03')
    expect(keys).toContain('common/lowammo')
  })
})
