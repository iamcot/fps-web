import { WEAPONS, SWITCH_MS, MAX_PELLETS, GRENADE_ID, magSizeOf, GRENADE_SLOT, CLAW_ID, CLAW_HEAVY_ID } from './weapons'
import { onShotBloom } from './spread'
import { GRENADE } from './grenade'
import type { WeaponDef, WeaponState } from './weapons'
import { hashSeed, mulberry32 } from './math'
import { shootDir } from './hitbox'
import { Btn } from './movement'
import type { AdsMove, InputCmd } from './movement'
import { TICK_RATE } from './constants'
import { meleeMoveMul, meleeSetOf, resetMelee, stepMelee } from './melee'

const DEG = Math.PI / 180

// Recoil tích luỹ (rad), tách khỏi yaw/pitch của chuột
export interface RecoilState {
  pitch: number
  yaw: number
}

export function makeRecoilState(): RecoilState {
  return { pitch: 0, yaw: 0 }
}

export type WeaponEvent = 'none' | 'fired' | 'dry' | 'reloadStart' | 'reloadEnd' | 'switched' | 'pull' | 'cancel' | 'threw' | 'meleeStart'

/** Bắt đầu nạp đạn nếu cần. Trả true nếu thực sự bắt đầu. */
export function startReload(ws: WeaponState, def: WeaponDef, nowMs: number): boolean {
  if (ws.reloadEndMs > 0) return false
  if (ws.ammo[def.id]! >= magSizeOf(def, ws.magMult)) return false
  ws.reloadEndMs = nowMs + def.reloadMs
  return true
}

/** Đổi súng, huỷ reload đang chạy. Khoá bắn SWITCH_MS. */
export function switchWeapon(ws: WeaponState, id: number, nowMs: number): boolean {
  if (id === ws.current || id < 0 || id >= WEAPONS.length) return false
  ws.current = id
  ws.reloadEndMs = 0
  ws.switchEndMs = nowMs + SWITCH_MS
  if (id !== GRENADE_ID) ws.nextFireMs = Math.max(ws.nextFireMs, nowMs + SWITCH_MS)   // lựu đạn không khoá: rút chốt (0,35s) chạy song song với tay đưa lên
  ws.nade.phase = 'idle'   // đổi súng khi đang rút chốt: huỷ (chưa ném thì còn nguyên lựu đạn)
  ws.switchBackAtMs = 0
  resetMelee(ws)   // đổi vũ khí: huỷ chiêu đang chạy, hạ đỡ
  return true
}

/** Chuyển sang ô `slot` nếu có súng. Ô trống / đang cầm rồi → false. */
export function selectSlot(ws: WeaponState, slot: number, nowMs: number): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot >= ws.slots.length) return false
  const id = ws.slots[slot]!
  if (id < 0) return false
  if (slot === GRENADE_SLOT && ws.slot !== GRENADE_SLOT) ws.prevSlot = ws.slot   // nhớ ô súng để tự đổi về sau khi ném
  ws.slot = slot
  return switchWeapon(ws, id, nowMs)
}

/** Hệ số tốc độ chạy theo súng đang cầm (phần ngắm đi riêng qua adsMoveFor + adsT). Truyền nowMs (thang seq) để tính cả đánh / đỡ / choáng của cận chiến. */
export function moveSpeedMul(ws: WeaponState, nowMs = -1): number {
  const base = WEAPONS[ws.current]?.moveSpeedMul ?? 1
  return nowMs < 0 ? base : base * meleeMoveMul(ws, nowMs)   // nowMs: thêm hệ số đang đánh / đỡ / choáng
}

/** Tham số ngắm của súng đang cầm cho stepMovement (null = súng không ngắm được). Trả đối tượng dùng chung theo súng, không cấp phát. */
const ADS_MOVE: (AdsMove | null)[] = WEAPONS.map(w => (w.ads ? { inMs: w.ads.inMs, outMs: w.ads.outMs, moveMult: w.ads.moveMult } : null))
export function adsMoveFor(ws: WeaponState): AdsMove | null {
  return ADS_MOVE[ws.current] ?? null
}
/** Muốn ngắm ở cmd này: giữ Aim, không đang nạp, không đang khoá đổi súng. (Đứng đất/không trượt do stepMovement kiểm.) */
export function adsWanted(ws: WeaponState, buttons: number, nowMs: number): boolean {
  return (buttons & Btn.Aim) !== 0 && ws.reloadEndMs === 0 && nowMs >= ws.switchEndMs
}

/**
 * Bắn nếu được. Không bắn khi: đang reload, chưa tới nextFireMs, hết đạn,
 * hoặc súng bán tự động mà cò đã giữ từ tick trước.
 * Luôn cập nhật triggerHeld theo triggerDown.
 */
export function tryFire(ws: WeaponState, def: WeaponDef, nowMs: number, triggerDown: boolean): boolean {
  const wasHeld = ws.triggerHeld
  ws.triggerHeld = triggerDown
  if (!triggerDown) return false
  if (ws.reloadEndMs > 0) return false
  if (nowMs < ws.nextFireMs) return false
  if (!def.melee && ws.ammo[def.id]! <= 0) return false
  if (!def.auto && wasHeld) return false

  if (!def.melee) ws.ammo[def.id]!--
  ws.nextFireMs = nowMs + def.fireIntervalMs
  ws.shotSeq++
  if (!def.melee) onShotBloom(ws, def, nowMs)   // lưu bloom đã dùng cho phát này (ws.shotBloomDeg) rồi cộng bloom mới
  return true
}

/**
 * Một tick logic súng. Thứ tự: hoàn tất reload → reload bằng R → bắn / bóp cò khi hết đạn.
 * Hết đạn mà bóp cò (cú bấm mới hoặc súng auto) → 'dry' + tự reload, đúng một lần.
 */
export function stepWeapon(
  ws: WeaponState,
  nowMs: number,
  triggerDown: boolean,
  reloadPressed: boolean,
): WeaponEvent {
  const def = WEAPONS[ws.current]!

  if (ws.reloadEndMs > 0 && nowMs >= ws.reloadEndMs) {
    ws.reloadEndMs = 0
    ws.ammo[def.id] = magSizeOf(def, ws.magMult)
    ws.triggerHeld = triggerDown   // giữ chuột qua lúc reload xong: súng bán tự động không tự bắn
    return 'reloadEnd'
  }

  if (reloadPressed && startReload(ws, def, nowMs)) return 'reloadStart'

  if (tryFire(ws, def, nowMs, triggerDown)) return 'fired'

  if (!def.melee && triggerDown && ws.reloadEndMs === 0 && ws.ammo[def.id]! <= 0 && nowMs >= ws.nextFireMs) {
    startReload(ws, def, nowMs)
    return 'dry'
  }
  return 'none'
}

/**
 * Hướng bắn = góc nhìn + recoil hiện tại + spread (random có seed theo playerId, shotSeq),
 * rồi cộng kick của phát này vào recoil. `shotSeq` là seq của phát vừa bắn (ws.shotSeq - 1).
 * Ghi kết quả vào `out`.
 */
export function computeShot(
  out: [number, number, number],
  rec: RecoilState,
  def: WeaponDef,
  playerId: number,
  shotSeq: number,
  yaw: number,
  pitch: number,
  spreadDeg: number,
): void {
  const rng = mulberry32(hashSeed(playerId, shotSeq))
  // Điểm đều trong đĩa tròn bán kính spread (hình nón)
  const r   = spreadDeg * DEG * Math.sqrt(rng())
  const phi = rng() * 2 * Math.PI
  const kickYaw = (rng() * 2 - 1) * def.recoilYawDeg * DEG

  const d = shootDir(yaw + rec.yaw + r * Math.cos(phi), pitch + rec.pitch + r * Math.sin(phi))
  out[0] = d[0]; out[1] = d[1]; out[2] = d[2]

  rec.pitch += def.recoilPitchDeg * DEG
  rec.yaw   += kickYaw
}

/**
 * Hướng bắn cho mọi tia của một phát (súng thường: 1 tia). Spread random có seed (playerId, shotSeq[, chỉ số tia]);
 * recoil chỉ cộng một lần, sau khi đã tính xong mọi tia. Trả số tia, ghi vào outs[0..n).
 */
export function computeShotDirs(
  outs: [number, number, number][],
  rec: RecoilState,
  def: WeaponDef,
  playerId: number,
  shotSeq: number,
  yaw: number,
  pitch: number,
  spreadDeg: number,
): number {
  const n = def.pellets ?? 1
  if (n === 1) { computeShot(outs[0]!, rec, def, playerId, shotSeq, yaw, pitch, spreadDeg); return 1 }
  // Nhiều tia: spread di chuyển/trên không DỊCH TÂM chùm (một điểm ngẫu nhiên, seed riêng ở chỉ số tia cuối),
  // còn các viên chì rải trong nón cố định pelletConeDeg quanh tâm đó
  const cone = def.spread.pelletConeDeg ?? spreadDeg
  let cYaw = yaw, cPitch = pitch
  if (def.spread.pelletConeDeg !== undefined && spreadDeg > 0) {
    const rng = mulberry32(hashSeed(playerId, shotSeq * MAX_PELLETS + (MAX_PELLETS - 1)))
    const r = spreadDeg * DEG * Math.sqrt(rng()), phi = rng() * 2 * Math.PI
    cYaw += r * Math.cos(phi); cPitch += r * Math.sin(phi)
  }
  const recPitch = rec.pitch, recYaw = rec.yaw
  for (let i = 0; i < n; i++) {
    rec.pitch = recPitch; rec.yaw = recYaw   // mọi tia dùng recoil trước phát bắn
    computeShot(outs[i]!, rec, def, playerId, shotSeq * MAX_PELLETS + i, cYaw, cPitch, cone)
  }
  // rec đã được đặt lại trước tia cuối rồi mới cộng kick, nên kick chỉ cộng đúng một lần cho cả phát
  return n
}

/** Hệ số sát thương theo khoảng cách (1 nếu súng không có falloff). */
export function damageFalloff(def: WeaponDef, dist: number): number {
  const f = def.falloff
  if (!f || dist <= f.fullM) return 1
  if (dist >= f.endM) return f.minMult
  return 1 + (f.minMult - 1) * (dist - f.fullM) / (f.endM - f.fullM)
}

/** Recoil hồi về 0 khi không bắn (nowMs >= nextFireMs, hoặc sớm hơn nếu súng có recoilRecoverDelayMs). */
export function recoverRecoil(rec: RecoilState, def: WeaponDef, ws: WeaponState, nowMs: number, dt: number): void {
  const resumeMs = def.recoilRecoverDelayMs === undefined ? ws.nextFireMs : ws.nextFireMs - def.fireIntervalMs + def.recoilRecoverDelayMs
  if (nowMs < resumeMs) return
  const step = def.recoilRecoverDegPerSec * DEG * dt
  rec.pitch = rec.pitch > 0 ? Math.max(0, rec.pitch - step) : Math.min(0, rec.pitch + step)
  rec.yaw   = rec.yaw   > 0 ? Math.max(0, rec.yaw   - step) : Math.min(0, rec.yaw   + step)
}

/**
 * Một tick logic súng theo cmd: đổi súng (cmd.weapon) rồi stepWeapon. Thời gian = seq * 1000 / TICK_RATE
 * (không dùng tick server) nên client và server tính fire rate/reload giống hệt nhau.
 */
export function stepWeaponCmd(ws: WeaponState, cmd: InputCmd): WeaponEvent {
  const nowMs = cmd.seq * 1000 / TICK_RATE
  // cmd.weapon = ô 0–4. Chỉ đổi khi giá trị ĐỔI so với cmd trước: mua súng làm server đổi ô trước, cmd cũ còn bay trên đường
  // vẫn mang ô cũ nhưng không được kéo ngược lại.
  if (cmd.weapon !== ws.wantSlot) {
    ws.wantSlot = cmd.weapon
    selectSlot(ws, cmd.weapon, nowMs)
  }
  // Sau khi ném (G hoặc quả cuối): tự đổi về súng trước đó
  let autoSwitched = false
  if (ws.switchBackAtMs > 0 && nowMs >= ws.switchBackAtMs) {
    ws.switchBackAtMs = 0
    if (ws.current === GRENADE_ID && ws.nade.phase === 'idle') {
      const back = (ws.slots[ws.prevSlot] ?? -1) >= 0 ? ws.prevSlot : ws.slots.findIndex((id, i) => id >= 0 && i !== GRENADE_SLOT)
      // KHÔNG đặt wantSlot: đây là đổi súng do logic (giống mua súng), cmd còn bay mang ô cũ không được kéo ngược; client tự nhận ws.slot khi thấy 'switched'
      if (back >= 0) { selectSlot(ws, back, nowMs); autoSwitched = true }
    }
  }
  const quickDown = !!(cmd.buttons & Btn.QuickNade)
  const ev = stepGrenade(ws, cmd, nowMs, quickDown)
  if (ev !== null) return ev === 'none' && autoSwitched ? 'switched' : ev   // đang cầm lựu đạn (hoặc vừa bấm G): không chạy logic súng
  const cur = WEAPONS[ws.current]!
  const mset = cur.melee ? meleeSetOf(cur) : undefined
  if (mset) {   // vũ khí cận chiến có bộ chiêu (plan 19): combo / đỡ thay cho logic bắn
    const mev = stepMelee(ws, mset, cmd.buttons, nowMs)
    return autoSwitched ? 'switched' : mev
  }
  let trigger = !!(cmd.buttons & Btn.Fire)
  if (WEAPONS[ws.current]!.category === 'claw') {
    // Zombie: chuột trái = cào thường, chuột phải (Aim) = cào mạnh; hai kiểu dùng chung nhịp bắn (nextFireMs)
    const heavy = !!(cmd.buttons & Btn.Aim)
    ws.current = heavy ? CLAW_HEAVY_ID : CLAW_ID
    trigger = trigger || heavy
  }
  if (autoSwitched) { stepWeapon(ws, nowMs, trigger, !!(cmd.buttons & Btn.Reload)); return 'switched' }
  return stepWeapon(ws, nowMs, trigger, !!(cmd.buttons & Btn.Reload))
}

/**
 * Lựu đạn (plan 12): G = cầm + rút chốt luôn (ném mạnh), cầm ô 5 thì Fire = ném mạnh, Aim = ném thấp.
 * Giữ ≥ pinPullMs mới "ready"; thả khi ready = ném; thả trước đó = huỷ. Không "nướng": ngòi chỉ cháy khi rời tay.
 * Trả null nếu tick này không có việc gì của lựu đạn (để chạy logic súng bình thường).
 */
function stepGrenade(ws: WeaponState, cmd: InputCmd, nowMs: number, quickDown: boolean): WeaponEvent | null {
  const n = ws.nade
  const fireD = !!(cmd.buttons & Btn.Fire), aimD = !!(cmd.buttons & Btn.Aim)
  let ev: WeaponEvent | null = null

  // G khi đang cầm thứ khác: sang ô lựu đạn + rút chốt ngay
  if (quickDown && ws.current !== GRENADE_ID && !ws.quickHeld && (ws.slots[GRENADE_SLOT] ?? -1) >= 0 && (ws.ammo[GRENADE_ID] ?? 0) > 0) {
    selectSlot(ws, GRENADE_SLOT, nowMs)   // đổi do logic (không đụng wantSlot): client không gửi ô 5 khi bấm G
    n.phase = 'pulling'; n.mode = 'strong'; n.pressSeq = cmd.seq; n.quick = true
    ev = 'pull'
  }
  ws.quickHeld = quickDown
  if (ws.current !== GRENADE_ID) return null

  const anyDown = fireD || aimD || quickDown
  const wasDown = ws.triggerHeld
  if (ev === null) {
    if (n.phase === 'idle') {
      if (anyDown && !wasDown && nowMs >= ws.nextFireMs && (ws.ammo[GRENADE_ID] ?? 0) > 0) {
        n.phase = 'pulling'; n.mode = aimD && !fireD && !quickDown ? 'lob' : 'strong'; n.pressSeq = cmd.seq; n.quick = quickDown
        ev = 'pull'
      }
    } else {
      const held = n.mode === 'lob' ? aimD : (fireD || quickDown)
      if (n.phase === 'pulling') {
        if (!held) {
          n.phase = 'idle'
          ev = 'cancel'
          if (n.quick) ws.switchBackAtMs = nowMs   // G thả sớm: về súng cũ ngay
          n.quick = false
        } else if ((cmd.seq - n.pressSeq) * 1000 / TICK_RATE >= GRENADE.pinPullMs) n.phase = 'ready'
      } else if (!held) {   // ready + thả = ném
        n.phase = 'idle'
        ws.ammo[GRENADE_ID]!--
        ws.throwSeq++
        ws.nextFireMs = nowMs + GRENADE.throwCooldownMs
        if (ws.ammo[GRENADE_ID]! <= 0) ws.slots[GRENADE_SLOT] = -1   // hết quả: ô trống
        if (ws.ammo[GRENADE_ID]! <= 0 || n.quick) ws.switchBackAtMs = nowMs + GRENADE.autoSwitchBackMs
        n.quick = false
        ev = 'threw'
      }
    }
  } else if (n.phase === 'pulling' && (cmd.seq - n.pressSeq) * 1000 / TICK_RATE >= GRENADE.pinPullMs) n.phase = 'ready'
  ws.triggerHeld = anyDown
  return ev ?? 'none'
}

export function copyWeaponState(dst: WeaponState, src: WeaponState): void {
  dst.current = src.current
  dst.slot = src.slot
  dst.wantSlot = src.wantSlot
  for (let i = 0; i < src.slots.length; i++) dst.slots[i] = src.slots[i]!
  for (let i = 0; i < src.ammo.length; i++) dst.ammo[i] = src.ammo[i]!
  dst.nade.phase = src.nade.phase; dst.nade.mode = src.nade.mode; dst.nade.pressSeq = src.nade.pressSeq; dst.nade.quick = src.nade.quick
  dst.throwSeq = src.throwSeq
  dst.prevSlot = src.prevSlot
  dst.switchBackAtMs = src.switchBackAtMs
  dst.quickHeld = src.quickHeld
  dst.reloadEndMs = src.reloadEndMs
  dst.nextFireMs = src.nextFireMs
  dst.shotSeq = src.shotSeq
  dst.triggerHeld = src.triggerHeld
  for (let i = 0; i < src.bloomDeg.length; i++) { dst.bloomDeg[i] = src.bloomDeg[i]!; dst.lastShotMs[i] = src.lastShotMs[i]! }
  dst.shotBloomDeg = src.shotBloomDeg
  dst.switchEndMs = src.switchEndMs
  dst.magMult = src.magMult
  dst.meleeMove = src.meleeMove; dst.meleeStartMs = src.meleeStartMs; dst.meleeHits = src.meleeHits
  dst.comboNode = src.comboNode; dst.chainEndMs = src.chainEndMs; dst.meleeBuf = src.meleeBuf; dst.meleeBufMs = src.meleeBufMs
  dst.aimHeld = src.aimHeld; dst.guardKey = src.guardKey
  dst.guardSinceMs = src.guardSinceMs; dst.parryUntilMs = src.parryUntilMs; dst.parryLockMs = src.parryLockMs
  dst.stamina = src.stamina; dst.staminaMs = src.staminaMs; dst.staminaRegenAtMs = src.staminaRegenAtMs
  dst.poise = src.poise; dst.poiseMs = src.poiseMs; dst.poiseRegenAtMs = src.poiseRegenAtMs
  dst.staggerUntilMs = src.staggerUntilMs; dst.vulnerableUntilMs = src.vulnerableUntilMs
}

export function weaponStatesEqual(a: WeaponState, b: WeaponState): boolean {
  for (let i = 0; i < a.slots.length; i++) if (a.slots[i] !== b.slots[i]) return false
  if (a.nade.phase !== b.nade.phase || a.nade.mode !== b.nade.mode || a.nade.pressSeq !== b.nade.pressSeq || a.nade.quick !== b.nade.quick ||
      a.throwSeq !== b.throwSeq || a.prevSlot !== b.prevSlot || a.switchBackAtMs !== b.switchBackAtMs || a.quickHeld !== b.quickHeld) return false
  if (a.current !== b.current || a.slot !== b.slot || a.wantSlot !== b.wantSlot || a.reloadEndMs !== b.reloadEndMs || a.nextFireMs !== b.nextFireMs ||
      a.shotSeq !== b.shotSeq || a.triggerHeld !== b.triggerHeld || a.shotBloomDeg !== b.shotBloomDeg || a.switchEndMs !== b.switchEndMs) return false
  if (a.meleeMove !== b.meleeMove || a.meleeStartMs !== b.meleeStartMs || a.meleeHits !== b.meleeHits || a.comboNode !== b.comboNode || a.chainEndMs !== b.chainEndMs ||
      a.meleeBuf !== b.meleeBuf || a.meleeBufMs !== b.meleeBufMs || a.aimHeld !== b.aimHeld || a.guardKey !== b.guardKey ||
      a.guardSinceMs !== b.guardSinceMs || a.parryUntilMs !== b.parryUntilMs || a.parryLockMs !== b.parryLockMs ||
      a.stamina !== b.stamina || a.staminaMs !== b.staminaMs || a.staminaRegenAtMs !== b.staminaRegenAtMs ||
      a.poise !== b.poise || a.poiseMs !== b.poiseMs || a.poiseRegenAtMs !== b.poiseRegenAtMs ||
      a.staggerUntilMs !== b.staggerUntilMs || a.vulnerableUntilMs !== b.vulnerableUntilMs) return false
  for (let i = 0; i < a.bloomDeg.length; i++) if (a.bloomDeg[i] !== b.bloomDeg[i] || a.lastShotMs[i] !== b.lastShotMs[i]) return false
  for (let i = 0; i < a.ammo.length; i++) if (a.ammo[i] !== b.ammo[i]) return false
  return true
}
