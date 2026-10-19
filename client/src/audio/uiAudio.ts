// Âm giao diện cửa hàng (tổng hợp): "ka-ching" khi mua được, "bíp" thấp khi bị từ chối.
import { getGraph } from './context'
import { tone } from './synth'

/** 2 tone triangle 1320Hz rồi 1760Hz cách 60ms, decay 150ms, −12dB */
export function playBuyOk(): void {
  const g = getGraph()
  if (!g) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.master, { type: 'triangle', freq: 1320, gainDb: -12, decayMs: 150, when: t })
  tone(g.ctx, g.master, { type: 'triangle', freq: 1760, gainDb: -12, decayMs: 150, when: t + 0.06 })
}

/** tone square 220Hz, 120ms, −16dB */
export function playBuyFail(): void {
  const g = getGraph()
  if (!g) return
  tone(g.ctx, g.master, { type: 'square', freq: 220, gainDb: -16, decayMs: 120, when: g.ctx.currentTime })
}
