import { describe, it, expect } from 'vitest'
import { KNIFE_SET, moveDurationMs } from '@fps/shared'
import { MeleeSwing, SWING_STYLES, GUARD_POSE, buildKeys } from './meleeSwing'

const DT = 1 / 60
const TAU = Math.PI * 2
function run(s: MeleeSwing, ms: number): void { for (let i = 0; i < Math.round(ms / (DT * 1000)); i++) s.update(DT) }
const vec = (s: MeleeSwing): number[] => [s.fx.px, s.fx.py, s.fx.pz, s.fx.rx, s.fx.ry, s.fx.rz]
/** Độ lệch so với tư thế nghỉ, bỏ qua bội 2π của góc lăn */
const offRest = (s: MeleeSwing): number => {
  const v = vec(s); v[5] = v[5]! - Math.round(v[5]! / TAU) * TAU
  return Math.max(...v.map(Math.abs))
}

describe('MeleeSwing', () => {
  it('mọi chiêu của KNIFE_SET đều có tư thế riêng', () => {
    for (const m of KNIFE_SET.moves) expect(SWING_STYLES[m.key], m.key).toBeDefined()
  })

  it('keyframe: bắt đầu ở nghỉ, tới tư thế gồng đúng giờ nhát đánh, kết thúc ở nghỉ đúng hết chiêu', () => {
    KNIFE_SET.moves.forEach((m, i) => {
      const keys = buildKeys(m, SWING_STYLES[m.key]!)
      expect(keys[0]!.t).toBe(0)
      expect(keys[1]!.t).toBe(m.windupMs)
      expect(keys[keys.length - 1]!.t).toBe(moveDurationMs(m))
      for (let k = 1; k < keys.length; k++) expect(keys[k]!.t, `${m.key}#${i}`).toBeGreaterThanOrEqual(keys[k - 1]!.t)
      expect(keys.filter(k => k.strike).length).toBe(m.hitCount)
    })
  })

  it('chạy hết từng chiêu: không NaN, không đứng yên, về nghỉ khi xong', () => {
    KNIFE_SET.moves.forEach((m, i) => {
      const s = new MeleeSwing()
      s.start(i)
      let moved = 0
      const n = Math.ceil(moveDurationMs(m) / (DT * 1000)) + 3
      for (let f = 0; f < n; f++) { s.update(DT); for (const v of vec(s)) { expect(Number.isFinite(v)).toBe(true); moved = Math.max(moved, Math.abs(v)) } }
      expect(moved, m.key).toBeGreaterThan(0.1)
      expect(s.active).toBe(false)
      expect(offRest(s), m.key).toBeLessThan(1e-6)
    })
  })

  it('đúng giờ nhát đánh dao đang ở tư thế gồng (chưa quét), cuối cửa sổ quét ở tư thế đánh', () => {
    const m = KNIFE_SET.moves[0]!, st = SWING_STYLES[m.key]!
    const s = new MeleeSwing()
    s.start(0)
    run(s, m.windupMs - 10)                               // sát giờ nhát đánh (khung 16,7 ms nên chừa một khung)
    expect(s.fx.ry).toBeGreaterThan(st.wind[4] * 0.8)    // đã gồng sang trái
    run(s, m.strikeMs + 10)
    expect(s.fx.ry).toBeLessThan(st.hit[4] * 0.8)        // đã quét sang phải
  })

  it('huỷ giữa chừng: mờ về nghỉ rất nhanh, không nhảy', () => {
    const s = new MeleeSwing()
    s.start(7)
    run(s, 260)
    const before = offRest(s)
    expect(before).toBeGreaterThan(0.2)
    s.cancel()
    s.update(DT)
    expect(offRest(s)).toBeGreaterThan(before * 0.5)    // không bật về 0 ngay
    run(s, 400)
    expect(offRest(s)).toBeLessThan(0.01)
  })

  it('sync: logic báo chiêu đã dừng giữa chừng thì tự huỷ; dừng đúng lúc hết chiêu thì để chạy nốt', () => {
    const a = new MeleeSwing(); a.start(7); run(a, 300); a.sync(false, false, false)
    expect(a.active).toBe(false)
    const b = new MeleeSwing(); b.start(0); run(b, moveDurationMs(KNIFE_SET.moves[0]!) - 20); b.sync(false, false, false)
    expect(b.active).toBe(true)
  })

  it('đỡ: vào tư thế đỡ khi rảnh tay, ra khỏi thì về nghỉ; đang ra chiêu thì không đỡ', () => {
    const s = new MeleeSwing()
    s.sync(true, false, false); run(s, 400)
    expect(s.fx.ry).toBeCloseTo(GUARD_POSE[4], 1)
    s.sync(false, false, false); run(s, 400)
    expect(offRest(s)).toBeLessThan(0.01)
    const t = new MeleeSwing()
    t.sync(true, false, true); t.start(0); run(t, 10)
    expect(Math.abs(t.fx.ry)).toBeLessThan(0.5)   // chưa kịp kéo về tư thế đỡ giữa lúc đánh
  })

  it('choáng: dao tụt xuống; hết choáng thì hồi', () => {
    const s = new MeleeSwing()
    s.sync(false, true, false); run(s, 400)
    expect(s.fx.py).toBeLessThan(-0.04)
    s.sync(false, false, false); run(s, 400)
    expect(offRest(s)).toBeLessThan(0.01)
  })

  it('phản ứng đỡ / parry: giật rồi tắt dần', () => {
    const s = new MeleeSwing()
    s.react('parry'); s.update(DT)
    expect(offRest(s)).toBeGreaterThan(0.05)
    run(s, 600)
    expect(offRest(s)).toBeLessThan(0.005)
  })

  it('reset tắt mọi thứ ngay', () => {
    const s = new MeleeSwing()
    s.start(4); s.sync(true, true, true); run(s, 200); s.reset(); s.update(0)
    expect(offRest(s)).toBe(0)
    expect(s.active).toBe(false)
  })

  it('chiêu mới đè chiêu cũ: chuyển mượt (không nhảy)', () => {
    const s = new MeleeSwing()
    s.start(0); run(s, 300)
    const p = vec(s)
    s.start(1); s.update(DT)
    const q = vec(s)
    expect(Math.max(...q.map((v, i) => Math.abs(v - p[i]!)))).toBeLessThan(0.6)
  })
})
