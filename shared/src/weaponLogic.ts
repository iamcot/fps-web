import { WEAPONS, SWITCH_MS, MOVE_SPREAD_SPEED, MAX_PELLETS, GRENADE_ID, GRENADE_SLOT } from './weapons'
import { GRENADE } from './grenade'
import type { WeaponDef, WeaponState } from './weapons'
import { hashSeed, mulberry32 } from './math'
import { shootDir } from './hitbox'
import { Btn } from './movement'
import type { InputCmd, PlayerState } from './movement'
import { TICK_RATE } from './constants'

const DEG = Math.PI / 180

// Recoil tích luỹ (rad), tách khỏi yaw/pitch của chuột
export interface RecoilState {
  pitch: number
  yaw: number
}

export function makeRecoilState(): RecoilState {
  return { pitch: 0, yaw: 0 }
}

export type WeaponEvent = 'none' | 'fired' | 'dry' | 'reloadStart' | 'reloadEnd' | 'switched' | 'pull' | 'cancel' | 'threw'

/** Bắt đầu nạp đạn nếu cần. Trả true nếu thực sự bắt đầu. */
export function startReload(ws: WeaponState, def: WeaponDef, nowMs: number): boolean {
  if (ws.reloadEndMs > 0) return false
  if (ws.ammo[def.id]! >= def.magSize) return false
  ws.reloadEndMs = nowMs + def.reloadMs
  return true
}

/** Đổi súng, huỷ reload đang chạy. Khoá bắn SWITCH_MS. */
export function switchWeapon(ws: WeaponState, id: number, nowMs: number): boolean {
  if (id === ws.current || id < 0 || id >= WEAPONS.length) return false
  ws.current = id
  ws.reloadEndMs = 0
  if (id !== GRENADE_ID) ws.nextFireMs = Math.max(ws.nextFireMs, nowMs + SWITCH_MS)   // lựu đạn không khoá: rút chốt (0,35s) chạy song song với tay đưa lên
  ws.nade.phase = 'idle'   // đổi súng khi đang rút chốt: huỷ (chưa ném thì còn nguyên lựu đạn)
  ws.switchBackAtMs = 0
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

/** Hệ số tốc độ chạy theo súng đang cầm (+ ngắm scope: chậm thêm một nửa). `buttons` = nút của cmd sắp chạy. */
export function moveSpeedMul(ws: WeaponState, buttons: number): number {
  const def = WEAPONS[ws.current]
  if (!def) return 1
  return def.moveSpeedMul * (def.ads?.scope && (buttons & Btn.Aim) ? SCOPE_MOVE_MUL : 1)
}
export const SCOPE_MOVE_MUL = 0.5

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
    ws.ammo[def.id] = def.magSize
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

/** Spread (độ) theo trạng thái: air > move > crouch > stand. */
export function spreadFor(def: WeaponDef, grounded: boolean, speedXZ: number, crouching: boolean): number {
  if (!grounded) return def.spreadDeg.air
  if (speedXZ > MOVE_SPREAD_SPEED) return def.spreadDeg.move
  if (crouching) return def.spreadDeg.crouch
  return def.spreadDeg.stand
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
  const recPitch = rec.pitch, recYaw = rec.yaw
  for (let i = 0; i < n; i++) {
    rec.pitch = recPitch; rec.yaw = recYaw   // mọi tia dùng recoil trước phát bắn
    computeShot(outs[i]!, rec, def, playerId, shotSeq * MAX_PELLETS + i, yaw, pitch, spreadDeg)
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
  if (autoSwitched) { stepWeapon(ws, nowMs, !!(cmd.buttons & Btn.Fire), !!(cmd.buttons & Btn.Reload)); return 'switched' }
  return stepWeapon(ws, nowMs, !!(cmd.buttons & Btn.Fire), !!(cmd.buttons & Btn.Reload))
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
}

export function weaponStatesEqual(a: WeaponState, b: WeaponState): boolean {
  for (let i = 0; i < a.slots.length; i++) if (a.slots[i] !== b.slots[i]) return false
  if (a.nade.phase !== b.nade.phase || a.nade.mode !== b.nade.mode || a.nade.pressSeq !== b.nade.pressSeq || a.nade.quick !== b.nade.quick ||
      a.throwSeq !== b.throwSeq || a.prevSlot !== b.prevSlot || a.switchBackAtMs !== b.switchBackAtMs || a.quickHeld !== b.quickHeld) return false
  if (a.current !== b.current || a.slot !== b.slot || a.wantSlot !== b.wantSlot || a.reloadEndMs !== b.reloadEndMs || a.nextFireMs !== b.nextFireMs ||
      a.shotSeq !== b.shotSeq || a.triggerHeld !== b.triggerHeld) return false
  for (let i = 0; i < a.ammo.length; i++) if (a.ammo[i] !== b.ammo[i]) return false
  return true
}

const MOVE_KEYS = Btn.Forward | Btn.Back | Btn.Left | Btn.Right

/**
 * Spread khi bắn, tính từ state SAU cmd và buttons của cmd đó (client và server dùng chung).
 * Nhả hết phím di chuyển thì tính là đứng yên dù quán tính còn; đang trượt vẫn tính là di chuyển.
 */
export function shotSpread(def: WeaponDef, state: PlayerState, buttons: number): number {
  const moving = (buttons & MOVE_KEYS) !== 0 || state.slideTimer > 0
  if (def.aimSpreadDeg !== undefined && (buttons & Btn.Aim) && state.grounded && !moving) return def.aimSpreadDeg
  return spreadFor(def, state.grounded, moving ? Math.hypot(state.vel[0], state.vel[2]) : 0, state.crouching)
}
