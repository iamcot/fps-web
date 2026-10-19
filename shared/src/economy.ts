// Luật mua/bán/thưởng (thuần). Server quyết định, client gọi để hiển thị. Không sửa object đầu vào.
import { CATEGORY_SLOT, SLOT_COUNT, weaponByKey } from './weapons'
import type { TeamId } from './teams'

export const ECONOMY = {
  startMoney: 2000,
  maxMoney: 16000,
  killReward: 500,
  bountyStreak: 3,          // nạn nhân có chuỗi hạ >= số này thì hạ được tiền thưởng truy nã
  bountyReward: 1000,
  sellRatio: 0.8,
  defaultResaleValue: 0,    // giá bán lại súng được cấp sẵn (0 = không bán được)
  keepLoadoutOnDeath: false,
  maxBuysPerSecond: 5,
}

export const DEFAULT_LOADOUT: Record<TeamId, string[]> = {
  A: ['knife', 'colt', 'm16'],   // Cớm
  B: ['knife', 'rulo', 'ak47'],  // Cướp
}

export interface OwnedWeapon { key: string; paid: number }   // paid = số tiền đã trả (súng cấp sẵn = 0)
export interface Loadout { slots: (OwnedWeapon | null)[] }    // luôn đúng SLOT_COUNT phần tử, theo CATEGORY_SLOT

export type BuyFailReason = 'not_buyable' | 'already_owned' | 'not_enough_money'
export type BuyQuote =
  | { ok: true; price: number; refund: number; net: number; slot: number }
  | { ok: false; reason: BuyFailReason; price: number; refund: number; net: number }

export function defaultLoadout(team: TeamId): Loadout {
  const slots: (OwnedWeapon | null)[] = new Array(SLOT_COUNT).fill(null)
  for (const key of DEFAULT_LOADOUT[team]) {
    const def = weaponByKey(key)
    if (def) slots[CATEGORY_SLOT[def.category]] = { key, paid: ECONOMY.defaultResaleValue }
  }
  return { slots }
}

/** Giá bán lại một súng đang có */
export function resaleValue(w: OwnedWeapon): number {
  return Math.floor(w.paid * ECONOMY.sellRatio)
}

export function quoteBuy(money: number, loadout: Loadout, key: string): BuyQuote {
  const def = weaponByKey(key)
  if (!def || !def.buyable) return { ok: false, reason: 'not_buyable', price: def?.price ?? 0, refund: 0, net: def?.price ?? 0 }
  const slot = CATEGORY_SLOT[def.category]
  const old = loadout.slots[slot] ?? null
  const refund = old ? resaleValue(old) : 0
  const net = def.price - refund
  if (old && old.key === key) return { ok: false, reason: 'already_owned', price: def.price, refund, net }
  if (money < net) return { ok: false, reason: 'not_enough_money', price: def.price, refund, net }
  return { ok: true, price: def.price, refund, net, slot }
}

export function applyBuy(money: number, loadout: Loadout, key: string): { money: number; loadout: Loadout } | null {
  const q = quoteBuy(money, loadout, key)
  if (!q.ok) return null
  const slots = loadout.slots.slice()
  slots[q.slot] = { key, paid: q.price }
  return { money: addMoney(money, -q.net), loadout: { slots } }
}

/** Tiền thưởng khi hạ người có chuỗi `victimStreak` */
export function killReward(victimStreak: number): number {
  return victimStreak >= ECONOMY.bountyStreak ? ECONOMY.bountyReward : ECONOMY.killReward
}

export function addMoney(money: number, delta: number): number {
  return Math.min(ECONOMY.maxMoney, Math.max(0, money + delta))
}

/** id súng ở từng ô (-1 = trống), để ghi vào WeaponState.slots */
export function loadoutWeaponIds(loadout: Loadout): number[] {
  return loadout.slots.map(w => (w ? weaponByKey(w.key)?.id ?? -1 : -1))
}
