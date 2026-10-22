import { describe, it, expect } from 'vitest'
import { makeWeaponState, WEAPONS } from './weapons'
import type { WeaponState } from './weapons'
import { stepWeaponCmd, copyWeaponState, weaponStatesEqual, moveSpeedMul, selectSlot } from './weaponLogic'
import { Btn } from './movement'
import type { InputCmd } from './movement'
import { MELEE, KNIFE_SET, moveDurationMs } from './meleeConfig'
import { TICK_RATE } from './constants'
import {
  comboDepth, staminaAt, poiseAt, resolveMeleeHit, makeMeleeHitResult, inGuardArc, meleeMoveMul, isStaggered, initMeleeState,
} from './melee'

const TICK_MS = 1000 / TICK_RATE
const KNIFE_ID = 6

/** Người cầm dao, đã qua khoá đổi súng. */
function knifeWs(): WeaponState {
  const ws = makeWeaponState([KNIFE_ID, 2, -1, 0, -1])
  ws.current = KNIFE_ID; ws.slot = 0; ws.wantSlot = 0
  return ws
}

class Sim {
  seq = 600   // 10 s: xa mọi khoá đổi súng
  events: { seq: number; ev: string }[] = []
  constructor(readonly ws: WeaponState) {}
  get ms(): number { return this.seq * TICK_MS }
  tick(buttons = 0): string {
    const cmd: InputCmd = { seq: this.seq++, buttons, yaw: 0, pitch: 0, weapon: this.ws.wantSlot }
    const ev = stepWeaponCmd(this.ws, cmd)
    if (ev !== 'none') this.events.push({ seq: cmd.seq, ev })
    return ev
  }
  /** Chạy ticks tick không bấm gì */
  idle(ticks: number): void { for (let i = 0; i < ticks; i++) this.tick(0) }
  idleMs(ms: number): void { this.idle(Math.round(ms / TICK_MS)) }
  /** Bấm một nhát (1 tick xuống, 1 tick thả) */
  click(btn: number): void { this.tick(btn); this.tick(0) }
  count(ev: string): number { return this.events.filter(e => e.ev === ev).length }
}

const L = Btn.Fire, R = Btn.Aim

describe('stepMelee: combo', () => {
  it('L đầu tiên: bắt đầu chiêu 0, nhát đánh tới sau windup, shotSeq tăng 1', () => {
    const s = new Sim(knifeWs())
    expect(s.tick(L)).toBe('meleeStart')
    expect(s.ws.meleeMove).toBe(KNIFE_SET.roots[0])
    expect(s.ws.shotSeq).toBe(0)
    const t0 = s.ms
    s.tick(0)
    while (s.ws.shotSeq === 0) s.tick(0)
    const hitAt = s.events.find(e => e.ev === 'fired')!.seq * TICK_MS - t0 + TICK_MS
    expect(hitAt).toBeGreaterThanOrEqual(KNIFE_SET.moves[0]!.windupMs)
    expect(hitAt).toBeLessThan(KNIFE_SET.moves[0]!.windupMs + 2 * TICK_MS)
    expect(s.ws.shotSeq).toBe(1)
  })

  it('giữ chuột không tự lặp: chỉ cạnh lên mới ra chiêu', () => {
    const s = new Sim(knifeWs())
    for (let i = 0; i < 120; i++) s.tick(L)
    expect(s.count('meleeStart')).toBe(1)
  })

  it('L L L (bấm lúc chiêu trước vừa xong): chuỗi 0 → 1 → 2, chiêu cuối đánh 4 nhát', () => {
    const s = new Sim(knifeWs())
    const seen: number[] = []
    for (let i = 0; i < 3; i++) {
      s.tick(L); seen.push(s.ws.meleeMove)
      s.tick(0)
      while (s.ws.meleeMove >= 0) s.tick(0)   // chờ chiêu xong
    }
    expect(seen).toEqual([0, 1, 2])
    expect(s.ws.shotSeq).toBe(1 + 1 + 4)
  })

  it('L R → 5; R → 7; R R → 8 (2 nhát); R L → 9; L L R L → 4', () => {
    const run = (keys: number[]): number[] => {
      const s = new Sim(knifeWs()); const out: number[] = []
      for (const k of keys) { s.tick(k); out.push(s.ws.meleeMove); s.tick(0); while (s.ws.meleeMove >= 0) s.tick(0) }
      return out
    }
    expect(run([L, R])).toEqual([0, 5])
    expect(run([R])).toEqual([7])
    expect(run([R, R])).toEqual([7, 8])
    expect(run([R, L])).toEqual([7, 9])
    expect(run([L, L, R, L])).toEqual([0, 1, 3, 4])
    expect(run([L, R, L])).toEqual([0, 5, 6])
  })

  it('RR: chiêu 8 đánh đúng 2 nhát', () => {
    const s = new Sim(knifeWs())
    s.tick(R); s.idle(46); s.tick(R); s.idle(60)
    expect(s.ws.shotSeq).toBe(1 + 2)
  })

  it('bấm muộn quá cửa sổ nối thì về chiêu cơ bản; sai nhánh (không có nhánh) cũng về gốc', () => {
    const s = new Sim(knifeWs())
    s.tick(L); s.tick(0)
    while (s.ws.meleeMove >= 0) s.tick(0)
    s.idleMs(KNIFE_SET.moves[0]!.chainMs + 100)
    s.tick(R)
    expect(s.ws.meleeMove).toBe(KNIFE_SET.roots[1])   // R gốc (7), không phải nhánh L→R (5)

    // chiêu kết (không có nhánh) → bấm tiếp quay về chiêu gốc
    const t = new Sim(knifeWs())
    for (const k of [L, L, L]) { t.tick(k); t.tick(0); while (t.ws.meleeMove >= 0) t.tick(0) }
    t.tick(L)
    expect(t.ws.meleeMove).toBe(KNIFE_SET.roots[0])
  })

  it('đệm input: bấm sớm 100 ms trước khi chiêu xong thì vẫn nối, sớm 400 ms thì mất', () => {
    const m0 = KNIFE_SET.moves[0]!
    const dur = moveDurationMs(m0)
    const attempt = (early: number): number => {
      const s = new Sim(knifeWs())
      s.tick(L); const t0 = s.ms - TICK_MS
      while (s.ms - t0 < dur - early) s.tick(0)
      s.tick(L); s.tick(0)
      s.idleMs(early + 120)
      return s.count('meleeStart')
    }
    expect(attempt(100)).toBe(2)
    expect(attempt(400)).toBe(1)
  })

  it('tín hiệu "fired" chỉ ở tick có nhát đánh; chiêu nhiều nhát phát nhiều lần', () => {
    const s = new Sim(knifeWs())
    for (const k of [L, L, L]) { s.tick(k); s.tick(0); while (s.ws.meleeMove >= 0) s.tick(0) }
    expect(s.count('fired')).toBe(6)
    expect(s.count('meleeStart')).toBe(3)
  })
})

describe('stepMelee: thể lực', () => {
  it('mỗi chiêu tiêu thể lực theo staminaCost; không âm', () => {
    const s = new Sim(knifeWs())
    s.tick(L)
    expect(s.ws.stamina).toBe(MELEE.staminaMax - KNIFE_SET.moves[0]!.staminaCost)
  })

  it('hết thể lực thì không ra chiêu; hồi sau staminaRegenDelayMs rồi lại ra được', () => {
    const s = new Sim(knifeWs())
    s.ws.stamina = 0; s.ws.staminaMs = s.ms; s.ws.staminaRegenAtMs = s.ms + MELEE.staminaRegenDelayMs
    s.tick(L); s.idle(10)
    expect(s.count('meleeStart')).toBe(0)
    s.idleMs(MELEE.staminaRegenDelayMs + 100)
    s.tick(L)
    expect(s.count('meleeStart')).toBe(1)
  })

  it('staminaAt: không hồi trong thời gian chờ, rồi hồi staminaRegenPerSec mỗi giây, tối đa staminaMax', () => {
    const ws = knifeWs()
    ws.stamina = 40; ws.staminaMs = 1000; ws.staminaRegenAtMs = 1800
    expect(staminaAt(ws, 1500)).toBe(40)
    expect(staminaAt(ws, 2800)).toBeCloseTo(40 + MELEE.staminaRegenPerSec, 6)
    expect(staminaAt(ws, 99999)).toBe(MELEE.staminaMax)
  })
})

describe('đỡ, parry, vỡ thế thủ', () => {
  function pair(): { a: Sim; v: Sim; res: ReturnType<typeof makeMeleeHitResult> } {
    return { a: new Sim(knifeWs()), v: new Sim(knifeWs()), res: makeMeleeHitResult() }
  }
  const move = KNIFE_SET.moves[0]!   // 40 damage, poise 20

  it('đang đỡ thì không ra chiêu, tốc độ ×guardMoveMul', () => {
    const s = new Sim(knifeWs())
    s.tick(Btn.Guard)
    expect(s.ws.guardSinceMs).toBeGreaterThanOrEqual(0)
    s.tick(Btn.Guard | L); s.tick(Btn.Guard)
    expect(s.count('meleeStart')).toBe(0)
    expect(meleeMoveMul(s.ws, s.ms)).toBe(MELEE.guardMoveMul)
    expect(moveSpeedMul(s.ws, s.ms)).toBeCloseTo(WEAPONS[KNIFE_ID]!.moveSpeedMul * MELEE.guardMoveMul, 6)
    s.tick(0)
    expect(s.ws.guardSinceMs).toBe(-1)
  })

  it('đang đánh thì không đỡ, tốc độ ×attackMoveMul', () => {
    const s = new Sim(knifeWs())
    s.tick(L); s.tick(Btn.Guard)
    expect(s.ws.guardSinceMs).toBe(-1)
    expect(meleeMoveMul(s.ws, s.ms)).toBe(MELEE.attackMoveMul)
  })

  it('đòn tới từ phía sau không đỡ được; đỡ phía trước giảm 85%, tốn thể lực = 0,5 × damage', () => {
    const { a, v, res } = pair()
    v.tick(Btn.Guard); v.idleMs(MELEE.parryMs + 60)   // qua cửa sổ parry nhưng vẫn giữ đỡ
    v.tick(Btn.Guard)
    const before = staminaAt(v.ws, v.ms)
    resolveMeleeHit(res, v.ws, a.ws, move, false, true, v.ms)
    expect(res.outcome).toBe('hit'); expect(res.damage).toBe(move.damage)
    resolveMeleeHit(res, v.ws, a.ws, move, true, true, v.ms)
    expect(res.outcome).toBe('blocked')
    expect(res.damage).toBeCloseTo(move.damage * MELEE.guardDamageMult, 6)
    expect(before - staminaAt(v.ws, v.ms)).toBeCloseTo(move.damage * MELEE.guardStaminaMult, 6)
  })

  it('parry: trúng trong parryMs đầu → không mất máu, không mất thể lực, kẻ đánh choáng và nhận đòn ×1,8', () => {
    const { a, v, res } = pair()
    a.tick(L)   // kẻ đánh đang trong chiêu
    v.tick(Btn.Guard)
    const before = staminaAt(v.ws, v.ms)
    resolveMeleeHit(res, v.ws, a.ws, move, true, true, v.ms + 50)
    expect(res.outcome).toBe('parried'); expect(res.damage).toBe(0)
    expect(staminaAt(v.ws, v.ms + 50)).toBe(before)
    expect(isStaggered(a.ws, v.ms + 100)).toBe(true)
    expect(a.ws.meleeMove).toBe(-1)
    expect(a.ws.vulnerableUntilMs).toBeGreaterThan(v.ms + 1000)
    // đòn tiếp theo vào kẻ bị parry: ×1,8
    const b = new Sim(knifeWs())
    resolveMeleeHit(res, a.ws, b.ws, move, false, true, v.ms + 200)
    expect(res.damage).toBeCloseTo(move.damage * MELEE.vulnerableMult, 6)
  })

  it('parry có ân hạn 80 ms, quá thì chỉ là đỡ thường', () => {
    const { a, v, res } = pair()
    v.tick(Btn.Guard)
    const t = v.ms
    resolveMeleeHit(res, v.ws, a.ws, move, true, true, t - TICK_MS + MELEE.parryMs + MELEE.parryGraceMs - 5)
    expect(res.outcome).toBe('parried')
    const p2 = pair(); p2.v.tick(Btn.Guard)
    resolveMeleeHit(p2.res, p2.v.ws, p2.a.ws, move, true, true, p2.v.ms + MELEE.parryMs + MELEE.parryGraceMs + 20)
    expect(p2.res.outcome).toBe('blocked')
  })

  it('bấm đỡ lại trong parryLockMs không có cửa sổ parry (chống spam)', () => {
    const { a, v, res } = pair()
    v.tick(Btn.Guard); v.tick(0)
    v.idleMs(200)
    v.tick(Btn.Guard)   // ~250 ms sau lần bấm trước < 600
    resolveMeleeHit(res, v.ws, a.ws, move, true, true, v.ms)
    expect(res.outcome).toBe('blocked')
    v.tick(0); v.idleMs(MELEE.parryLockMs)
    v.tick(Btn.Guard)
    resolveMeleeHit(res, v.ws, a.ws, move, true, true, v.ms)
    expect(res.outcome).toBe('parried')
  })

  it('đỡ mà hết thể lực: vỡ thế thủ, choáng 1,2 s, nhận đòn ×1,8', () => {
    const { a, v, res } = pair()
    v.tick(Btn.Guard); v.idleMs(MELEE.parryMs + 100); v.tick(Btn.Guard)
    v.ws.stamina = 5; v.ws.staminaMs = v.ms; v.ws.staminaRegenAtMs = v.ms + 5000
    resolveMeleeHit(res, v.ws, a.ws, move, true, true, v.ms)
    expect(res.outcome).toBe('guardBreak'); expect(res.staggered).toBe(true)
    expect(isStaggered(v.ws, v.ms + 1000)).toBe(true)
    expect(isStaggered(v.ws, v.ms + MELEE.guardBreakStaggerMs + 10)).toBe(false)
    expect(v.ws.guardSinceMs).toBe(-1)
    expect(v.ws.vulnerableUntilMs).toBeGreaterThan(v.ms)
  })

  it('đòn bị đỡ làm kẻ đánh khựng thêm blockRecoilMs', () => {
    const { a, v, res } = pair()
    a.tick(L)
    const start = a.ws.meleeStartMs
    v.tick(Btn.Guard); v.idleMs(MELEE.parryMs + 100); v.tick(Btn.Guard)
    resolveMeleeHit(res, v.ws, a.ws, move, true, true, v.ms)
    expect(a.ws.meleeStartMs).toBe(start + MELEE.blockRecoilMs)
  })

  it('hai bên đếm seq riêng: hiệu ứng lên người đánh tính theo giờ của người đánh', () => {
    const { a, v, res } = pair()
    v.tick(Btn.Guard)
    resolveMeleeHit(res, v.ws, a.ws, move, true, true, v.ms + 50, 9000)
    expect(res.outcome).toBe('parried')
    expect(a.ws.staggerUntilMs).toBe(9000 + MELEE.parryStaggerMs)
    expect(a.ws.vulnerableUntilMs).toBe(9000 + MELEE.vulnerableMs)
  })

  it('inGuardArc: yaw 0 nhìn -Z; ±60° trước mặt thì đỡ được', () => {
    expect(inGuardArc(0, 0, -3)).toBe(true)
    expect(inGuardArc(0, 0, 3)).toBe(false)
    expect(inGuardArc(0, 2, -2)).toBe(true)     // 45°
    expect(inGuardArc(0, 3, -1)).toBe(false)    // ~71°
    expect(inGuardArc(Math.PI / 2, -3, 0)).toBe(true)   // quay trái 90° → nhìn -X
  })
})

describe('choáng (poise)', () => {
  const move = KNIFE_SET.moves[1]!   // poise 20
  it('đủ nhát làm poise về 0 thì choáng poiseStaggerMs, huỷ chiêu, hồi lại đầy poise', () => {
    const a = new Sim(knifeWs()), v = new Sim(knifeWs()), res = makeMeleeHitResult()
    let staggeredAt = -1
    for (let i = 0; i < 6; i++) {
      resolveMeleeHit(res, v.ws, a.ws, move, false, true, v.ms + i * 10)
      if (res.staggered) { staggeredAt = i; break }
    }
    expect(staggeredAt).toBe(4)   // 5 nhát × 20 = 100
    expect(isStaggered(v.ws, v.ms + 100)).toBe(true)
    expect(isStaggered(v.ws, v.ms + 40 + MELEE.poiseStaggerMs + 5)).toBe(false)
    expect(v.ws.poise).toBe(MELEE.poiseMax)
  })

  it('poise hồi sau poiseRegenDelayMs', () => {
    const ws = knifeWs()
    ws.poise = 40; ws.poiseMs = 0; ws.poiseRegenAtMs = MELEE.poiseRegenDelayMs
    expect(poiseAt(ws, 1500)).toBe(40)
    expect(poiseAt(ws, MELEE.poiseRegenDelayMs + 1000)).toBeCloseTo(40 + MELEE.poiseRegenPerSec, 6)
  })

  it('bị trúng lúc khởi động thì chiêu bị huỷ; trúng sau nhát đánh thì không', () => {
    const a = new Sim(knifeWs()), v = new Sim(knifeWs()), res = makeMeleeHitResult()
    v.tick(R)   // R1: windup 250 ms
    expect(v.ws.meleeMove).toBe(7)
    resolveMeleeHit(res, v.ws, a.ws, move, false, true, v.ms)
    expect(v.ws.meleeMove).toBe(-1)

    const w = new Sim(knifeWs())
    w.tick(L); w.idle(15)
    expect(w.ws.meleeHits).toBe(1)
    resolveMeleeHit(res, w.ws, a.ws, move, false, true, w.ms)
    expect(w.ws.meleeMove).toBe(0)
  })

  it('đang choáng: không ra chiêu, không đỡ, chạy ×0,3', () => {
    const s = new Sim(knifeWs())
    s.ws.staggerUntilMs = s.ms + 700
    s.tick(L); s.tick(Btn.Guard)
    expect(s.count('meleeStart')).toBe(0)
    expect(s.ws.guardSinceMs).toBe(-1)
    expect(meleeMoveMul(s.ws, s.ms)).toBe(MELEE.staggerMoveMul)
    s.idleMs(800)
    s.tick(L)
    expect(s.count('meleeStart')).toBe(1)   // hết choáng thì đánh lại được
  })
})

describe('trạng thái', () => {
  it('đổi vũ khí huỷ chiêu đang chạy và hạ đỡ', () => {
    const s = new Sim(knifeWs())
    s.tick(L)
    expect(s.ws.meleeMove).toBe(0)
    selectSlot(s.ws, 1, s.ms)
    expect(s.ws.meleeMove).toBe(-1)
    expect(s.ws.comboNode).toBe(-1)
  })

  it('copyWeaponState / weaponStatesEqual phủ mọi trường cận chiến', () => {
    const a = knifeWs(), b = makeWeaponState([KNIFE_ID, 2, -1, 0, -1])
    const keys = ['meleeMove', 'meleeStartMs', 'meleeHits', 'comboNode', 'chainEndMs', 'meleeBuf', 'meleeBufMs', 'aimHeld', 'guardKey', 'guardSinceMs',
      'parryUntilMs', 'parryLockMs', 'stamina', 'staminaMs', 'staminaRegenAtMs', 'poise', 'poiseMs', 'poiseRegenAtMs', 'staggerUntilMs', 'vulnerableUntilMs'] as const
    for (const k of keys) {
      copyWeaponState(b, a)
      expect(weaponStatesEqual(a, b)).toBe(true)
      const v = a[k]
      ;(b as unknown as Record<string, number | boolean>)[k] = typeof v === 'boolean' ? !v : (v as number) + 7
      expect(weaponStatesEqual(a, b), k).toBe(false)
      copyWeaponState(b, a)
      expect(weaponStatesEqual(a, b), k).toBe(true)
    }
  })

  it('tất định: cùng chuỗi cmd cho cùng trạng thái, kể cả sau copy giữa chừng (như reconcile)', () => {
    const script = [L, 0, 0, 0, 0, 0, 0, 0, 0, R, 0, 0, Btn.Guard, Btn.Guard, 0, L, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const x = new Sim(knifeWs()), y = new Sim(knifeWs()), z = knifeWs()
    script.forEach((b, i) => {
      x.tick(b); y.tick(b)
      if (i === 12) copyWeaponState(z, y.ws)   // z bắt kịp từ giữa chừng
      else if (i > 12) stepWeaponCmd(z, { seq: y.seq - 1, buttons: b, yaw: 0, pitch: 0, weapon: z.wantSlot })
    })
    expect(weaponStatesEqual(x.ws, y.ws)).toBe(true)
    expect(weaponStatesEqual(z, y.ws)).toBe(true)
  })

  it('initMeleeState đặt lại thể lực đầy và hết choáng', () => {
    const ws = knifeWs()
    ws.stamina = 3; ws.staggerUntilMs = 99999; ws.poise = 1
    initMeleeState(ws)
    expect(ws.stamina).toBe(MELEE.staminaMax); expect(ws.staggerUntilMs).toBe(0); expect(ws.poise).toBe(MELEE.poiseMax)
  })

  it('comboDepth: độ sâu của từng chiêu trong cây', () => {
    expect([0, 7].map(i => comboDepth(KNIFE_SET, i))).toEqual([1, 1])
    expect([1, 5, 8, 9].map(i => comboDepth(KNIFE_SET, i))).toEqual([2, 2, 2, 2])
    expect([2, 3, 6].map(i => comboDepth(KNIFE_SET, i))).toEqual([3, 3, 3])
    expect(comboDepth(KNIFE_SET, 4)).toBe(4)
    expect(comboDepth(KNIFE_SET, -1)).toBe(0)
  })

  it('cây combo hợp lệ: chỉ số next trỏ tới chiêu có thật, không có vòng lặp vô hạn', () => {
    const n = KNIFE_SET.moves.length
    for (const m of KNIFE_SET.moves) for (const nx of m.next) expect(nx === -1 || (nx >= 0 && nx < n)).toBe(true)
    for (const r of KNIFE_SET.roots) expect(r >= 0 && r < n).toBe(true)
    const seen = new Set<number>()
    const walk = (i: number, depth: number): void => {
      expect(depth).toBeLessThan(8)
      seen.add(i)
      for (const nx of KNIFE_SET.moves[i]!.next) if (nx >= 0) walk(nx, depth + 1)
    }
    for (const r of KNIFE_SET.roots) walk(r, 0)
    expect(seen.size).toBe(n)   // mọi chiêu đều với tới được từ gốc
  })
})
