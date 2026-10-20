// Luật mua/bán/thưởng (thuần). Server quyết định, client gọi để hiển thị. Không sửa object đầu vào.
import { CATEGORY_SLOT, SLOT_COUNT, weaponByKey } from './weapons'
import type { TeamId } from './teams'
import type { GameMode } from './roomConfig'
import { GRENADE } from './grenade'
import { INFECTION } from './infection'

export interface EconomyConfig {
  startMoney: number
  maxMoney: number
  killReward: number
  bountyStreak: number      // nạn nhân có chuỗi hạ >= số này thì hạ được tiền thưởng truy nã
  bountyReward: number
  sellRatio: number
  defaultResaleValue: number   // giá bán lại súng được cấp sẵn (0 = không bán được)
  keepLoadoutOnDeath: boolean
  maxBuysPerSecond: number
  infiniteReserve?: boolean   // thể thức zombie: đạn dự trữ vô hạn (chỉ phải nạp băng) – HUD hiện `25 / ∞`
}

/** Hỗn Chiến (task 09) */
export const ECONOMY: EconomyConfig = {
  startMoney: 2000,
  maxMoney: 16000,
  killReward: 500,
  bountyStreak: 3,
  bountyReward: 1000,
  sellRatio: 0.8,
  defaultResaleValue: 0,
  keepLoadoutOnDeath: false,
  maxBuysPerSecond: 5,
}
export const ECONOMY_TDM: EconomyConfig = ECONOMY

/** Sinh Tử (task 13): tiền theo ván */
export const ECONOMY_ELIM = {
  ...ECONOMY,
  startMoney: 800,
  killReward: 300,
  bountyReward: 600,
  keepLoadoutIfSurvived: true,   // sống sót qua ván: giữ súng, lựu đạn
  roundWin: 3000,
  roundLossBase: 1500,
  roundLossStep: 400,            // thua liên tiếp: 1500, 1900, 2300, 2700, 3000
  roundLossMax: 3000,
  roundDraw: 1500,               // ván hoà: mỗi người +1500, chuỗi thua giữ nguyên
  resetAtHalftime: true,         // đổi bên: tiền về startMoney, súng về mặc định
}
export type EliminationEconomy = typeof ECONOMY_ELIM

/** Lây Nhiễm (plan 16): tiền đầu mỗi ván (không mang sang ván sau), mua ở pha chuẩn bị, đạn dự trữ vô hạn */
export const ECONOMY_INFECTION: EconomyConfig = {
  ...ECONOMY,
  startMoney: INFECTION.startMoney,
  keepLoadoutOnDeath: true,
  infiniteReserve: true,
}

/** Bộ kinh tế theo thể thức (server: mode.economy(); client dùng để hiển thị giá bán lại, tiền tối đa...) */
export function economyFor(mode: GameMode): EconomyConfig {
  switch (mode) {
    case 'elimination': return ECONOMY_ELIM
    case 'infection': return ECONOMY_INFECTION
    default: return ECONOMY_TDM
  }
}

export const DEFAULT_LOADOUT: Record<TeamId, string[]> = {
  A: ['knife', 'colt', 'm16'],   // Cớm
  B: ['knife', 'rulo', 'ak47'],  // Cướp
}

export interface OwnedWeapon { key: string; paid: number; count?: number }   // paid = số tiền đã trả (súng cấp sẵn = 0); count chỉ có ở hàng tiêu hao (lựu đạn)
export interface Loadout { slots: (OwnedWeapon | null)[] }    // luôn đúng SLOT_COUNT phần tử, theo CATEGORY_SLOT

export type BuyFailReason = 'not_buyable' | 'already_owned' | 'not_enough_money' | 'max_carry'
export type BuyQuote =
  | { ok: true; price: number; refund: number; net: number; slot: number }
  | { ok: false; reason: BuyFailReason; price: number; refund: number; net: number }

export function defaultLoadout(team: TeamId, eco: EconomyConfig = ECONOMY): Loadout {
  const slots: (OwnedWeapon | null)[] = new Array(SLOT_COUNT).fill(null)
  for (const key of DEFAULT_LOADOUT[team]) {
    const def = weaponByKey(key)
    if (def) slots[CATEGORY_SLOT[def.category]] = { key, paid: eco.defaultResaleValue }
  }
  return { slots }
}

/** Giá bán lại một súng đang có (hàng tiêu hao không bán lại) */
export function resaleValue(w: OwnedWeapon, eco: EconomyConfig = ECONOMY): number {
  if (weaponByKey(w.key)?.consumable) return 0
  return Math.floor(w.paid * eco.sellRatio)
}

/** Số lựu đạn đang mang */
export function grenadeCount(loadout: Loadout): number {
  return loadout.slots[CATEGORY_SLOT.grenade]?.count ?? 0
}

/** Dùng một quả: count − 1, về 0 thì ô trống. Không sửa đầu vào; hết lựu đạn → trả nguyên loadout. */
export function consumeGrenade(loadout: Loadout): Loadout {
  const slot = CATEGORY_SLOT.grenade
  const g = loadout.slots[slot]
  if (!g || (g.count ?? 0) <= 0) return loadout
  const slots = loadout.slots.slice()
  slots[slot] = g.count! - 1 > 0 ? { ...g, count: g.count! - 1 } : null
  return { slots }
}

export function quoteBuy(money: number, loadout: Loadout, key: string, eco: EconomyConfig = ECONOMY): BuyQuote {
  const def = weaponByKey(key)
  if (!def || !def.buyable) return { ok: false, reason: 'not_buyable', price: def?.price ?? 0, refund: 0, net: def?.price ?? 0 }
  const slot = CATEGORY_SLOT[def.category]
  const old = loadout.slots[slot] ?? null
  if (def.consumable) {   // hàng tiêu hao: cộng dồn tới maxCarry, không bán đổi
    const net = def.price
    if ((old?.count ?? 0) >= GRENADE.maxCarry) return { ok: false, reason: 'max_carry', price: def.price, refund: 0, net }
    if (money < net) return { ok: false, reason: 'not_enough_money', price: def.price, refund: 0, net }
    return { ok: true, price: def.price, refund: 0, net, slot }
  }
  const refund = old ? resaleValue(old, eco) : 0
  const net = def.price - refund
  if (old && old.key === key) return { ok: false, reason: 'already_owned', price: def.price, refund, net }
  if (money < net) return { ok: false, reason: 'not_enough_money', price: def.price, refund, net }
  return { ok: true, price: def.price, refund, net, slot }
}

export function applyBuy(money: number, loadout: Loadout, key: string, eco: EconomyConfig = ECONOMY): { money: number; loadout: Loadout } | null {
  const q = quoteBuy(money, loadout, key, eco)
  if (!q.ok) return null
  const slots = loadout.slots.slice()
  const old = slots[q.slot]
  const consumable = !!weaponByKey(key)?.consumable
  slots[q.slot] = consumable ? { key, paid: (old?.paid ?? 0) + q.price, count: (old?.count ?? 0) + 1 } : { key, paid: q.price }
  return { money: addMoney(money, -q.net, eco), loadout: { slots } }
}

/** Tiền thưởng khi hạ người có chuỗi `victimStreak` */
export function killReward(victimStreak: number, eco: EconomyConfig = ECONOMY): number {
  return victimStreak >= eco.bountyStreak ? eco.bountyReward : eco.killReward
}

export function addMoney(money: number, delta: number, eco: EconomyConfig = ECONOMY): number {
  return Math.min(eco.maxMoney, Math.max(0, money + delta))
}

export type RoundOutcome = 'win' | 'loss' | 'draw'

/**
 * Tiền cuối ván (Sinh Tử) cho một người của đội có chuỗi thua `lossStreak` (trước ván này).
 * Thắng: +roundWin, chuỗi về 0. Thua: chuỗi + 1, +min(base + (chuỗi mới − 1)·step, max). Hoà: +roundDraw, chuỗi giữ nguyên.
 */
export function roundIncome(outcome: RoundOutcome, lossStreak: number, eco: EliminationEconomy = ECONOMY_ELIM): { amount: number; lossStreak: number } {
  if (outcome === 'win') return { amount: eco.roundWin, lossStreak: 0 }
  if (outcome === 'draw') return { amount: eco.roundDraw, lossStreak }
  const next = lossStreak + 1
  return { amount: Math.min(eco.roundLossBase + (next - 1) * eco.roundLossStep, eco.roundLossMax), lossStreak: next }
}

/** id súng ở từng ô (-1 = trống), để ghi vào WeaponState.slots */
export function loadoutWeaponIds(loadout: Loadout): number[] {
  return loadout.slots.map(w => (w ? weaponByKey(w.key)?.id ?? -1 : -1))
}
