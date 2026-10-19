import { describe, it, expect } from 'vitest'
import { ECONOMY, addMoney, applyBuy, defaultLoadout, killReward, loadoutWeaponIds, quoteBuy, resaleValue, weaponByKey, type Loadout } from './index'

const owned = (l: Loadout, slot: number) => l.slots[slot]

describe('economy (H.2)', () => {
  it('bộ mặc định: Cớm Dao+Colt+M16, Cướp Dao+Rulô+AK47; ô vừa trống; súng cấp sẵn bán lại $0', () => {
    const a = defaultLoadout('A'), b = defaultLoadout('B')
    expect(a.slots.map(w => w?.key ?? null)).toEqual(['knife', 'colt', null, 'm16'])
    expect(b.slots.map(w => w?.key ?? null)).toEqual(['knife', 'rulo', null, 'ak47'])
    expect(resaleValue(a.slots[3]!)).toBe(0)
    expect(loadoutWeaponIds(a)).toEqual([weaponByKey('knife')!.id, weaponByKey('colt')!.id, -1, weaponByKey('m16')!.id])
  })

  it('Cớm $2000 mua SMG: còn $750, ô vừa = SMG (paid 1250); mua tiếp Shotgun: refund 1000, net 100, còn $650', () => {
    const l0 = defaultLoadout('A')
    const r1 = applyBuy(2000, l0, 'smg')!
    expect(r1.money).toBe(750)
    expect(owned(r1.loadout, 2)).toEqual({ key: 'smg', paid: 1250 })
    const q = quoteBuy(r1.money, r1.loadout, 'shotgun')
    expect(q).toMatchObject({ ok: true, price: 1100, refund: 1000, net: 100, slot: 2 })
    const r2 = applyBuy(r1.money, r1.loadout, 'shotgun')!
    expect(r2.money).toBe(650)
    expect(owned(r2.loadout, 2)).toEqual({ key: 'shotgun', paid: 1100 })
  })

  it('không sửa object đầu vào', () => {
    const l0 = defaultLoadout('A')
    applyBuy(2000, l0, 'smg')
    expect(owned(l0, 2)).toBeNull()
  })

  it('Cớm $2000 mua Sniper: not_enough_money (M16 cấp sẵn bán được $0, net 4750)', () => {
    expect(quoteBuy(2000, defaultLoadout('A'), 'sniper')).toMatchObject({ ok: false, reason: 'not_enough_money', net: 4750, refund: 0 })
    expect(applyBuy(2000, defaultLoadout('A'), 'sniper')).toBeNull()
  })

  it('Cướp mua AK47 khi đang có AK47: already_owned; mua dao: not_buyable; key lạ: not_buyable', () => {
    expect(quoteBuy(2000, defaultLoadout('B'), 'ak47')).toMatchObject({ ok: false, reason: 'already_owned' })
    expect(quoteBuy(2000, defaultLoadout('B'), 'knife')).toMatchObject({ ok: false, reason: 'not_buyable' })
    expect(quoteBuy(2000, defaultLoadout('B'), 'rpg')).toMatchObject({ ok: false, reason: 'not_buyable' })
  })

  it('$15800 + Sniper (paid 4750 → refund 3800), mua M16 ($3100): net −700, tiền kẹp ở $16000', () => {
    const l: Loadout = { slots: [{ key: 'knife', paid: 0 }, { key: 'colt', paid: 0 }, null, { key: 'sniper', paid: 4750 }] }
    const q = quoteBuy(15800, l, 'm16')
    expect(q).toMatchObject({ ok: true, refund: 3800, net: -700 })
    expect(applyBuy(15800, l, 'm16')!.money).toBe(ECONOMY.maxMoney)
  })

  it('đủ tiền khi tính cả tiền bán súng cũ', () => {
    const l: Loadout = { slots: [{ key: 'knife', paid: 0 }, { key: 'colt', paid: 0 }, { key: 'smg', paid: 1250 }, { key: 'm16', paid: 0 }] }
    expect(quoteBuy(100, l, 'shotgun').ok).toBe(true)    // net 100
    expect(quoteBuy(99, l, 'shotgun')).toMatchObject({ ok: false, reason: 'not_enough_money' })
  })

  it('killReward / addMoney', () => {
    expect(killReward(0)).toBe(500); expect(killReward(2)).toBe(500)
    expect(killReward(3)).toBe(1000); expect(killReward(7)).toBe(1000)
    expect(addMoney(15800, 500)).toBe(16000)
    expect(addMoney(100, -500)).toBe(0)
  })
})
