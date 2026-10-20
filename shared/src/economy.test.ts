import { describe, it, expect } from 'vitest'
import { ECONOMY, ECONOMY_ELIM, GRENADE, roundIncome, addMoney, applyBuy, consumeGrenade, defaultLoadout, grenadeCount, killReward, loadoutWeaponIds, quoteBuy, resaleValue, weaponByKey, type Loadout } from './index'

const owned = (l: Loadout, slot: number) => l.slots[slot]

describe('economy (H.2)', () => {
  it('bộ mặc định: Cớm Dao+Colt+M16, Cướp Dao+Rulô+AK47; ô vừa trống; súng cấp sẵn bán lại $0', () => {
    const a = defaultLoadout('A'), b = defaultLoadout('B')
    expect(a.slots.map(w => w?.key ?? null)).toEqual(['knife', 'colt', null, 'm16', null])
    expect(b.slots.map(w => w?.key ?? null)).toEqual(['knife', 'rulo', null, 'ak47', null])
    expect(resaleValue(a.slots[3]!)).toBe(0)
    expect(loadoutWeaponIds(a)).toEqual([weaponByKey('knife')!.id, weaponByKey('colt')!.id, -1, weaponByKey('m16')!.id, -1])
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

describe('lựu đạn M67 (G.1)', () => {
  const m67 = () => weaponByKey('m67')!
  it('m67: ô 5 (index 4), $300, mua được, không phải súng', () => {
    expect(m67().category).toBe('grenade'); expect(m67().price).toBe(GRENADE.price); expect(m67().buyable).toBe(true)
    expect(defaultLoadout('A').slots).toHaveLength(5)
    expect(defaultLoadout('A').slots[4]).toBeNull(); expect(defaultLoadout('B').slots[4]).toBeNull()
  })

  it('$2000 mua lựu đạn: $1700, count 1; mua tiếp: $1400, count 2; lần 3: max_carry', () => {
    const r1 = applyBuy(2000, defaultLoadout('A'), 'm67')!
    expect(r1.money).toBe(1700); expect(r1.loadout.slots[4]).toEqual({ key: 'm67', paid: 300, count: 1 })
    expect(grenadeCount(r1.loadout)).toBe(1)
    const r2 = applyBuy(r1.money, r1.loadout, 'm67')!
    expect(r2.money).toBe(1400); expect(grenadeCount(r2.loadout)).toBe(2)
    const q = quoteBuy(r2.money, r2.loadout, 'm67')
    expect(q.ok).toBe(false); if (!q.ok) { expect(q.reason).toBe('max_carry'); expect(q.refund).toBe(0) }
    expect(applyBuy(r2.money, r2.loadout, 'm67')).toBeNull()
  })

  it('không đủ tiền → not_enough_money; không bán lại (refund luôn 0, resale 0)', () => {
    const q = quoteBuy(299, defaultLoadout('A'), 'm67')
    expect(q.ok).toBe(false); if (!q.ok) expect(q.reason).toBe('not_enough_money')
    const r = applyBuy(2000, defaultLoadout('A'), 'm67')!
    expect(resaleValue(r.loadout.slots[4]!)).toBe(0)
    const q2 = quoteBuy(2000, r.loadout, 'm67'); expect(q2.ok && q2.refund).toBe(0)
  })

  it('mua lựu đạn không đụng tới 4 ô súng', () => {
    const l0 = defaultLoadout('B')
    const r = applyBuy(2000, l0, 'm67')!
    expect(r.loadout.slots.slice(0, 4)).toEqual(l0.slots.slice(0, 4))
    expect(loadoutWeaponIds(r.loadout)).toEqual([weaponByKey('knife')!.id, weaponByKey('rulo')!.id, -1, weaponByKey('ak47')!.id, m67().id])
  })

  it('consumeGrenade 2 lần → ô trống; không sửa đầu vào; hết rồi thì không đổi', () => {
    const r2 = applyBuy(applyBuy(2000, defaultLoadout('A'), 'm67')!.money, applyBuy(2000, defaultLoadout('A'), 'm67')!.loadout, 'm67')!
    const a = consumeGrenade(r2.loadout)
    expect(grenadeCount(a)).toBe(1); expect(grenadeCount(r2.loadout)).toBe(2)
    const b = consumeGrenade(a)
    expect(b.slots[4]).toBeNull(); expect(grenadeCount(b)).toBe(0)
    expect(consumeGrenade(b)).toBe(b)
  })
})

describe('roundIncome (Sinh Tử)', () => {
  const lossRun = (n: number) => { let st = 0; const out: number[] = []; for (let i = 0; i < n; i++) { const r = roundIncome('loss', st); st = r.lossStreak; out.push(r.amount) } return out }
  it('thua 1..6 ván liên tiếp: 1500, 1900, 2300, 2700, 3000, 3000', () => {
    expect(lossRun(6)).toEqual([1500, 1900, 2300, 2700, 3000, 3000])
  })
  it('thua 2, thắng 1, thua 1: lần thua cuối nhận 1500', () => {
    let st = roundIncome('loss', 0).lossStreak
    st = roundIncome('loss', st).lossStreak
    const w = roundIncome('win', st)
    expect(w.amount).toBe(3000)
    expect(roundIncome('loss', w.lossStreak).amount).toBe(1500)
  })
  it('hoà giữa chuỗi thua 2: nhận 1500, ván thua kế nhận 2300', () => {
    const d = roundIncome('draw', 2)
    expect(d).toEqual({ amount: 1500, lossStreak: 2 })
    expect(roundIncome('loss', d.lossStreak).amount).toBe(2300)
  })
  it('tiền không vượt 16000', () => {
    expect(addMoney(15000, 3000, ECONOMY_ELIM)).toBe(16000)
  })
})
