import { describe, it, expect } from 'vitest'
import { applyDrop, applyPickUp, canDrop, canPickUp, isWorldWeapon, pickupSlot } from './worldWeapons'
import { weaponByKey } from './weapons'
import { defaultLoadout } from './economy'

const W = (k: string) => weaponByKey(k)!

describe('nhặt / vứt vũ khí (P8)', () => {
  it('dao gốc, lựu đạn, vuốt không nằm dưới đất được; súng và vũ khí cận chiến thì được', () => {
    for (const k of ['knife', 'm67', 'claw', 'claw_heavy']) expect(isWorldWeapon(W(k)), k).toBe(false)
    for (const k of ['ak47', 'colt', 'smg', 'sniper', 'hammer', 'staff']) expect(isWorldWeapon(W(k)), k).toBe(true)
    expect(pickupSlot(W('hammer'))).toBe(0)
    expect(pickupSlot(W('colt'))).toBe(1)
    expect(pickupSlot(W('ak47'))).toBe(3)
  })

  it('cầm dao gốc: không vứt được; nhặt vũ khí cận chiến thì thay vào ô 1, vứt thì về dao', () => {
    const lo = defaultLoadout('A')
    expect(canDrop(lo, 0)).toBe(false)
    expect(applyDrop(lo, 0)).toBeNull()
    expect(canPickUp(lo, W('hammer'))).toBe(true)
    const withHammer = applyPickUp(lo, W('hammer'))
    expect(withHammer.slots[0]).toEqual({ key: 'hammer', paid: 0 })
    expect(canPickUp(withHammer, W('staff'))).toBe(false)   // đang cầm búa: ô 1 đầy
    const dropped = applyDrop(withHammer, 0)!
    expect(dropped.weapon.key).toBe('hammer')
    expect(dropped.loadout.slots[0]).toEqual({ key: 'knife', paid: 0 })
  })

  it('súng: ô đầy thì không nhặt, vứt rồi ô trống nhặt được; không đụng ô khác', () => {
    const lo = defaultLoadout('A')   // Cớm: dao, colt, m16
    expect(canPickUp(lo, W('rulo'))).toBe(false)
    expect(canPickUp(lo, W('ak47'))).toBe(false)
    expect(canPickUp(lo, W('smg'))).toBe(true)       // ô 3 (vừa) trống
    const d = applyDrop(lo, 3)!
    expect(d.weapon.key).toBe('m16')
    expect(d.loadout.slots[3]).toBeNull()
    expect(d.loadout.slots[1]).toEqual(lo.slots[1])
    expect(canPickUp(d.loadout, W('ak47'))).toBe(true)
    expect(applyPickUp(d.loadout, W('ak47')).slots[3]).toEqual({ key: 'ak47', paid: 0 })
    expect(applyDrop(lo, 4)).toBeNull()               // ô lựu đạn
  })
})
