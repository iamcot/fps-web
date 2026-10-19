import { WEAPONS, SWITCH_MS, MOVE_SPREAD_SPEED } from './weapons'
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

export type WeaponEvent = 'none' | 'fired' | 'dry' | 'reloadStart' | 'reloadEnd' | 'switched'

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
  ws.nextFireMs = Math.max(ws.nextFireMs, nowMs + SWITCH_MS)
  return true
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
  if (ws.ammo[def.id]! <= 0) return false
  if (!def.auto && wasHeld) return false

  ws.ammo[def.id]!--
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

  if (triggerDown && ws.reloadEndMs === 0 && ws.ammo[def.id]! <= 0 && nowMs >= ws.nextFireMs) {
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

/** Recoil hồi về 0 khi không bắn (nowMs >= nextFireMs). */
export function recoverRecoil(rec: RecoilState, def: WeaponDef, ws: WeaponState, nowMs: number, dt: number): void {
  if (nowMs < ws.nextFireMs) return
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
  switchWeapon(ws, cmd.weapon, nowMs)
  return stepWeapon(ws, nowMs, !!(cmd.buttons & Btn.Fire), !!(cmd.buttons & Btn.Reload))
}

export function copyWeaponState(dst: WeaponState, src: WeaponState): void {
  dst.current = src.current
  for (let i = 0; i < src.ammo.length; i++) dst.ammo[i] = src.ammo[i]!
  dst.reloadEndMs = src.reloadEndMs
  dst.nextFireMs = src.nextFireMs
  dst.shotSeq = src.shotSeq
  dst.triggerHeld = src.triggerHeld
}

export function weaponStatesEqual(a: WeaponState, b: WeaponState): boolean {
  if (a.current !== b.current || a.reloadEndMs !== b.reloadEndMs || a.nextFireMs !== b.nextFireMs ||
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
  return spreadFor(def, state.grounded, moving ? Math.hypot(state.vel[0], state.vel[2]) : 0, state.crouching)
}
