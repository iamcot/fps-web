import type { BotDifficulty } from '@fps/shared'
import { BOT_TAG } from '@fps/shared'

export const BOT_NAMES = ['Tèo', 'Tí', 'Tủn', 'Bin', 'Bon', 'Mít', 'Xoài', 'Bơ', 'Sữa', 'Cốm', 'Bắp', 'Gạo'] as const

/** Tên hiển thị `[BOT] Tèo TB`: lấy ngẫu nhiên không trùng với tên đang dùng (thiếu tên thì thêm số) */
export function pickBotName(taken: Iterable<string>, difficulty: BotDifficulty, rng: () => number = Math.random): string {
  const used = new Set<string>()
  for (const n of taken) used.add(n)
  const free = BOT_NAMES.filter(n => ![...used].some(u => u.startsWith(`[BOT] ${n} `)))
  let base: string = free.length > 0 ? free[Math.floor(rng() * free.length)]! : `${BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)]!}${used.size}`
  if (free.length === 0) base = base.slice(0, 8)
  return `[BOT] ${base} ${BOT_TAG[difficulty]}`
}
