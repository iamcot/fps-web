import { describe, it, expect, vi } from 'vitest'
import raw from './poses.json'
import { loadPoses, WEAPON_KEYS } from './poses'

describe('loadPoses', () => {
  it('poses.json hợp lệ: đủ 8 súng, súng dài cầm 2 tay, súng ngắn/dao 1 tay ở góc 3', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = loadPoses(raw)
    expect(warn).not.toHaveBeenCalled()
    expect(Object.keys(p.weapons).sort()).toEqual(WEAPON_KEYS.filter(k => k !== null).sort())
    for (const k of ['ak47', 'm16', 'sniper', 'shotgun', 'smg']) expect(p.weapons[k]!.third.hold).toBe('twoHand')
    for (const k of ['colt', 'rulo', 'knife']) expect(p.weapons[k]!.third.hold).toBe('oneHand')
    warn.mockRestore()
  })

  it('file rỗng/thiếu trường: dùng mặc định, không văng lỗi', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = loadPoses({ first: { fov: 70 } })
    expect(p.first.fov).toBe(70)
    expect(p.first.shoulderR).toHaveLength(3)
    expect(p.weapons.ak47!.third.hold).toBe('oneHand')
    expect(() => loadPoses(null)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
