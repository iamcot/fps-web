// Bộ máy chiêu cận chiến (plan 19, P2): combo, thể lực, đỡ, parry, choáng. Thuần theo thời gian seq (nowMs),
// client dự đoán và server tính giống hệt nhau. Không import Three.js/DOM, không cấp phát trong vòng lặp tick.
import { MELEE, MELEE_L, MELEE_R, MELEE_SETS, moveDurationMs } from './meleeConfig'
import type { MeleeMove, MeleeSet } from './meleeConfig'
import { Btn } from './movement'
import { meleeInitFields } from './weapons'
import type { WeaponDef, WeaponState } from './weapons'

const DEG = Math.PI / 180

export type MeleeEvent = 'none' | 'meleeStart' | 'fired'

export function meleeSetOf(def: WeaponDef): MeleeSet | undefined { return MELEE_SETS[def.key] }

/** Đặt lại toàn bộ trạng thái cận chiến (hồi sinh): thể lực đầy, hết choáng */
export function initMeleeState(ws: WeaponState): void { Object.assign(ws, meleeInitFields()) }

/** Đổi vũ khí / chết: huỷ chiêu đang chạy, hạ đỡ, xoá bộ đệm. Thể lực, choáng giữ nguyên */
export function resetMelee(ws: WeaponState): void {
  ws.meleeMove = -1; ws.meleeHits = 0; ws.comboNode = -1; ws.chainEndMs = 0
  ws.meleeBuf = 0; ws.guardSinceMs = -1; ws.parryUntilMs = 0
}

// ── Thể lực / poise: hồi theo thời gian (không theo tick) nên server tính được tại thời điểm tuỳ ý ──
export function staminaAt(ws: WeaponState, nowMs: number): number {
  const t0 = Math.max(ws.staminaMs, ws.staminaRegenAtMs)
  const v = nowMs > t0 ? ws.stamina + (nowMs - t0) * MELEE.staminaRegenPerSec / 1000 : ws.stamina
  return v > MELEE.staminaMax ? MELEE.staminaMax : v
}

export function poiseAt(ws: WeaponState, nowMs: number): number {
  const t0 = Math.max(ws.poiseMs, ws.poiseRegenAtMs)
  const v = nowMs > t0 ? ws.poise + (nowMs - t0) * MELEE.poiseRegenPerSec / 1000 : ws.poise
  return v > MELEE.poiseMax ? MELEE.poiseMax : v
}

/** Tiêu thể lực (không âm), hoãn hồi. Trả thể lực còn lại */
export function spendStamina(ws: WeaponState, nowMs: number, cost: number): number {
  const v = staminaAt(ws, nowMs) - cost
  ws.stamina = v > 0 ? v : 0
  ws.staminaMs = nowMs
  ws.staminaRegenAtMs = nowMs + MELEE.staminaRegenDelayMs
  return ws.stamina
}

export function isStaggered(ws: WeaponState, nowMs: number): boolean { return nowMs < ws.staggerUntilMs }
export function isGuarding(ws: WeaponState): boolean { return ws.guardSinceMs >= 0 }

function startStagger(ws: WeaponState, nowMs: number, ms: number): void {
  const until = nowMs + ms
  if (until > ws.staggerUntilMs) ws.staggerUntilMs = until
  ws.meleeMove = -1; ws.meleeHits = 0; ws.comboNode = -1; ws.meleeBuf = 0; ws.guardSinceMs = -1; ws.parryUntilMs = 0
}

/** Hệ số tốc độ chạy theo trạng thái cận chiến tại nowMs (1 nếu không đánh / đỡ / choáng). Gọi khi đang cầm vũ khí cận chiến hoặc bị choáng. */
export function meleeMoveMul(ws: WeaponState, nowMs: number): number {
  if (nowMs < ws.staggerUntilMs) return MELEE.staggerMoveMul
  if (ws.meleeMove >= 0) return MELEE.attackMoveMul
  if (ws.guardSinceMs >= 0) return MELEE.guardMoveMul
  return 1
}

/**
 * Một tick cận chiến. Trái = Btn.Fire (cạnh lên), phải = Btn.Aim (cạnh lên), đỡ = Btn.Guard (giữ).
 * 'meleeStart' khi bắt đầu chiêu; 'fired' ở mỗi nhát đánh (shotSeq++ để đường hitscan cũ vẫn chạy tới P3).
 */
export function stepMelee(ws: WeaponState, set: MeleeSet, buttons: number, nowMs: number): MeleeEvent {
  const fireDown = (buttons & Btn.Fire) !== 0, aimDown = (buttons & Btn.Aim) !== 0, guardDown = (buttons & Btn.Guard) !== 0
  const fireEdge = fireDown && !ws.triggerHeld, aimEdge = aimDown && !ws.aimHeld, guardEdge = guardDown && !ws.guardKey
  ws.triggerHeld = fireDown; ws.aimHeld = aimDown; ws.guardKey = guardDown

  if (nowMs < ws.staggerUntilMs) {   // choáng: không làm gì, bỏ bộ đệm
    ws.meleeMove = -1; ws.meleeHits = 0; ws.meleeBuf = 0; ws.guardSinceMs = -1; ws.parryUntilMs = 0
    return 'none'
  }

  let ev: MeleeEvent = 'none'

  // Bộ đệm input: bấm sớm trong inputBufferMs vẫn tính. Đang đỡ thì không nhận chiêu
  const input = fireEdge ? 1 : aimEdge ? 2 : 0
  if (input !== 0 && ws.guardSinceMs < 0) { ws.meleeBuf = input; ws.meleeBufMs = nowMs }
  if (ws.meleeBuf !== 0 && nowMs - ws.meleeBufMs > MELEE.inputBufferMs) ws.meleeBuf = 0

  // Chiêu đang chạy: hết giờ thì mở cửa sổ nối
  if (ws.meleeMove >= 0) {
    const m = set.moves[ws.meleeMove]!
    const end = ws.meleeStartMs + moveDurationMs(m)
    if (nowMs >= end && ws.meleeHits >= m.hitCount) {
      ws.comboNode = ws.meleeMove
      ws.chainEndMs = end + m.chainMs
      ws.meleeMove = -1
    }
  }

  // Ra chiêu mới từ bộ đệm
  if (ws.meleeMove < 0 && ws.meleeBuf !== 0 && nowMs >= ws.nextFireMs && staminaAt(ws, nowMs) > 0) {
    const side = ws.meleeBuf === 1 ? MELEE_L : MELEE_R
    let idx = -1
    if (ws.comboNode >= 0 && nowMs <= ws.chainEndMs) idx = set.moves[ws.comboNode]!.next[side]!
    if (idx < 0) idx = set.roots[side]!   // sai nhánh hoặc muộn: về chiêu cơ bản
    const m = set.moves[idx]!
    spendStamina(ws, nowMs, m.staminaCost)
    ws.meleeMove = idx; ws.meleeStartMs = nowMs; ws.meleeHits = 0
    ws.meleeBuf = 0; ws.guardSinceMs = -1; ws.parryUntilMs = 0
    ev = 'meleeStart'
  }

  // Các nhát đánh đã tới giờ
  if (ws.meleeMove >= 0) {
    const m = set.moves[ws.meleeMove]!
    while (ws.meleeHits < m.hitCount && nowMs - ws.meleeStartMs >= m.windupMs + ws.meleeHits * m.hitIntervalMs) {
      ws.meleeHits++
      ws.shotSeq++
      ev = 'fired'
    }
  }

  // Đỡ: chỉ khi rảnh tay. Cạnh lên của phím mới mở cửa sổ parry (và chưa trong thời gian khoá)
  if (ws.meleeMove < 0 && guardDown) {
    if (ws.guardSinceMs < 0) {
      ws.guardSinceMs = nowMs
      if (guardEdge && nowMs >= ws.parryLockMs) { ws.parryUntilMs = nowMs + MELEE.parryMs; ws.parryLockMs = nowMs + MELEE.parryLockMs }
      else ws.parryUntilMs = 0
      ws.meleeBuf = 0
    }
  } else if (ws.guardSinceMs >= 0) { ws.guardSinceMs = -1; ws.parryUntilMs = 0 }

  return ev
}

export type MeleeOutcome = 'hit' | 'blocked' | 'parried' | 'guardBreak'

export interface MeleeHitResult {
  outcome: MeleeOutcome
  damage: number         // sát thương cuối cùng vào thân (chưa nhân hệ số đầu / chân)
  staggered: boolean     // nạn nhân vừa bị choáng (hết poise)
}

export function makeMeleeHitResult(): MeleeHitResult { return { outcome: 'hit', damage: 0, staggered: false } }

/** Điểm (dx, dz) tính từ nạn nhân có nằm trong nón chắn phía trước theo yaw của nạn nhân không (yaw 0 nhìn -Z) */
export function inGuardArc(victimYaw: number, dx: number, dz: number): boolean {
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) return true
  const fx = -Math.sin(victimYaw), fz = -Math.cos(victimYaw)
  return (dx * fx + dz * fz) / len >= Math.cos(MELEE.guardArcDeg * DEG)
}

/**
 * Một nhát của `attacker` (đang chạy chiêu `move`) trúng `victim` tại nowMs. Cập nhật thể lực / choáng / đòn nặng của hai bên.
 * `front` = đòn tới từ phía trước nạn nhân (xem inGuardArc). `victimMelee` = nạn nhân đang cầm vũ khí cận chiến (mới đỡ được).
 * Ghi kết quả vào `out`. Chưa gồm hệ số vùng (đầu ×2,5...) và việc trừ máu: phần của server (P3).
 */
export function resolveMeleeHit(out: MeleeHitResult, victim: WeaponState, attacker: WeaponState, move: MeleeMove, front: boolean, victimMelee: boolean, nowMs: number): MeleeHitResult {
  out.staggered = false
  const guarding = front && victimMelee && victim.guardSinceMs >= 0 && nowMs >= victim.staggerUntilMs

  if (guarding && victim.parryUntilMs > 0 && nowMs < victim.parryUntilMs + MELEE.parryGraceMs) {
    out.outcome = 'parried'; out.damage = 0
    startStagger(attacker, nowMs, MELEE.parryStaggerMs)
    attacker.vulnerableUntilMs = nowMs + MELEE.vulnerableMs
    return out
  }

  if (guarding) {
    const before = staminaAt(victim, nowMs)
    const cost = move.damage * MELEE.guardStaminaMult
    spendStamina(victim, nowMs, cost)
    // Người đánh khựng: chiêu đang chạy kéo dài thêm blockRecoilMs (các nhát còn lại cũng trễ theo)
    if (attacker.meleeMove >= 0) attacker.meleeStartMs += MELEE.blockRecoilMs
    else attacker.nextFireMs = Math.max(attacker.nextFireMs, nowMs + MELEE.blockRecoilMs)
    out.damage = move.damage * MELEE.guardDamageMult
    if (before < cost) {   // hết thể lực giữa chừng: vỡ thế thủ
      out.outcome = 'guardBreak'; out.staggered = true
      startStagger(victim, nowMs, MELEE.guardBreakStaggerMs)
      victim.vulnerableUntilMs = nowMs + MELEE.vulnerableMs
    } else out.outcome = 'blocked'
    return out
  }

  // Đòn trúng thân
  out.outcome = 'hit'
  out.damage = nowMs < victim.vulnerableUntilMs ? move.damage * MELEE.vulnerableMult : move.damage
  const poise = poiseAt(victim, nowMs) - move.poiseDmg
  victim.poiseMs = nowMs
  victim.poiseRegenAtMs = nowMs + MELEE.poiseRegenDelayMs
  if (poise <= 0) {
    victim.poise = MELEE.poiseMax
    out.staggered = true
    startStagger(victim, nowMs, MELEE.poiseStaggerMs)
  } else {
    victim.poise = poise
    // Bị trúng lúc khởi động: chiêu bị huỷ (chưa có siêu giáp)
    if (victim.meleeMove >= 0 && victim.meleeHits === 0) { victim.meleeMove = -1; victim.comboNode = -1; victim.meleeBuf = 0 }
  }
  return out
}
