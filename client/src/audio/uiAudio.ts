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

/** Bắt đầu ván: còi ngắn (square 440Hz, 220ms) */
export function playRoundStart(): void {
  const g = getGraph()
  if (!g) return
  tone(g.ctx, g.master, { type: 'square', freq: 440, gainDb: -14, decayMs: 220, when: g.ctx.currentTime })
}

/** Thắng ván: 2 nốt đi lên */
export function playRoundWin(): void {
  const g = getGraph()
  if (!g) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.master, { type: 'triangle', freq: 660, gainDb: -12, decayMs: 180, when: t })
  tone(g.ctx, g.master, { type: 'triangle', freq: 990, gainDb: -12, decayMs: 260, when: t + 0.14 })
}

/** Thua ván: 2 nốt đi xuống */
export function playRoundLose(): void {
  const g = getGraph()
  if (!g) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.master, { type: 'triangle', freq: 520, gainDb: -12, decayMs: 180, when: t })
  tone(g.ctx, g.master, { type: 'triangle', freq: 330, gainDb: -12, decayMs: 300, when: t + 0.14 })
}

/** 10 giây cuối mỗi ván: mỗi giây một tiếng tích nhỏ */
export function playTick(): void {
  const g = getGraph()
  if (!g) return
  tone(g.ctx, g.master, { type: 'square', freq: 1200, gainDb: -22, decayMs: 40, when: g.ctx.currentTime })
}
