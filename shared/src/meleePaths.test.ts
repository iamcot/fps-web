import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { MELEE_SETS, moveDurationMs } from './meleeConfig'
import paths from './meleePaths.json'

// Dữ liệu sinh bởi tools/melee/bake-paths.mjs (node --import tsx tools/melee/bake-paths.mjs)
interface Baked { clip: string; clipHash: string; tickCount: number; windows: number[][]; windupMs: number; activeMs: number; recoveryMs: number; maxReach: number; wrist: number[]; tip: number[] }
const baked = paths as unknown as Record<string, Baked>
const clips = JSON.parse(readFileSync(new URL('../../client/public/anims/combat.json', import.meta.url), 'utf8')) as Record<string, unknown>
const moves = Object.values(MELEE_SETS).flatMap(s => s.moves)

describe('meleePaths (cung quét bake từ clip)', () => {
  it('mọi chiêu có file bake khớp thời lượng chiêu', () => {
    for (const m of moves) {
      const b = baked[m.key]
      expect(b, m.key).toBeTruthy()
      expect(b!.tickCount, m.key).toBe(Math.ceil(moveDurationMs(m) / 1000 * 60) + 1)
      expect(b!.tip.length).toBe(b!.tickCount * 3)
      expect(b!.wrist.length).toBe(b!.tickCount * 3)
      expect(b!.windupMs).toBe(m.windupMs)
    }
  })
  it('clipHash khớp clip hiện tại (clip đổi thì phải bake lại)', () => {
    for (const [k, b] of Object.entries(baked)) {
      const h = createHash('sha1').update(JSON.stringify(clips[b.clip])).digest('hex').slice(0, 12)
      expect(h, k).toBe(b.clipHash)
    }
  })
  it('có ít nhất một cửa sổ đánh, đúng trong khoảng thời gian chiêu', () => {
    for (const m of moves) {
      const b = baked[m.key]!
      expect(b.windows.length, m.key).toBeGreaterThan(0)
      for (const [a, z] of b.windows) { expect(a).toBeGreaterThanOrEqual(0); expect(z).toBeLessThanOrEqual(b.tickCount); expect(z).toBeGreaterThan(a!) }
    }
  })
  it('tầm mũi vũ khí không vượt tầm cung server quá 10%', () => {
    for (const m of moves) expect(baked[m.key]!.maxReach, m.key).toBeLessThanOrEqual(Math.max(...m.arc.reach) * 1.1)
  })
})
