export const Btn = {
  Forward: 1 << 0,
  Back:    1 << 1,
  Left:    1 << 2,
  Right:   1 << 3,
  Jump:    1 << 4,
  Crouch:  1 << 5,
  Fire:    1 << 6,
  Reload:  1 << 7,
  Aim:     1 << 8,   // giữ chuột phải: ngắm (ADS / scope)
} as const

export interface InputCmd {
  seq: number
  buttons: number
  yaw: number
  pitch: number
  weapon: number
  fireRenderTime?: number
}

export interface PlayerState {
  pos: [number, number, number]
  vel: [number, number, number]
  yaw: number
  pitch: number
  grounded: boolean
  crouching: boolean
  slideTimer: number
  slideCooldown: number
}

export interface MovementConfig {
  runSpeed: number
  crouchSpeed: number
  groundAccel: number
  airAccel: number
  airWishCap: number
  friction: number
  stopSpeed: number
  gravity: number
  jumpVelocity: number
  standHeight: number
  crouchHeight: number
  radius: number
  eyeStand: number
  eyeCrouch: number
  slideBoost: number
  slideDuration: number
  slideFriction: number
  slideCooldown: number
  slideMinSpeed: number
}

export const defaultMovement: MovementConfig = {
  runSpeed:      8.5,
  crouchSpeed:   4.0,
  groundAccel:   10,
  airAccel:      12,
  airWishCap:    1.0,
  friction:      6,
  stopSpeed:     2.0,
  gravity:       22,
  jumpVelocity:  7.0,
  standHeight:   1.8,
  crouchHeight:  1.2,
  radius:        0.4,
  eyeStand:      1.6,
  eyeCrouch:     1.0,
  slideBoost:    3.0,
  slideDuration: 0.6,
  slideFriction: 0.8,
  slideCooldown: 1.0,
  slideMinSpeed: 6.0,
}

import type { CollisionWorld } from './physics/world'
import { lerp } from './math'

// Reusable scratch to avoid per-tick allocation
const _wd: [number, number, number] = [0, 0, 0]

function _applyFriction(vel: [number, number, number], friction: number, stopSpeed: number, dt: number): void {
  const speed = Math.hypot(vel[0], vel[2])
  if (speed < 1e-4) { vel[0] = 0; vel[2] = 0; return }
  const control  = Math.max(speed, stopSpeed)
  const newSpeed = Math.max(speed - control * friction * dt, 0)
  const k        = newSpeed / speed
  vel[0] *= k; vel[2] *= k
}

function _accelerate(vel: [number, number, number], wishDir: [number, number, number], wishSpeed: number, accel: number, dt: number): void {
  const current = vel[0] * wishDir[0] + vel[2] * wishDir[2]
  const add     = wishSpeed - current
  if (add <= 0) return
  const a = Math.min(accel * wishSpeed * dt, add)
  vel[0] += a * wishDir[0]
  vel[2] += a * wishDir[2]
}

export function stepMovement(
  state: PlayerState,
  input: InputCmd,
  world: CollisionWorld,
  cfg: MovementConfig,
  dt: number,
): PlayerState {
  const pos: [number, number, number] = [state.pos[0], state.pos[1], state.pos[2]]
  const vel: [number, number, number] = [state.vel[0], state.vel[1], state.vel[2]]
  let grounded      = state.grounded
  let crouching     = state.crouching
  let slideTimer    = state.slideTimer
  let slideCooldown = state.slideCooldown

  const yaw     = input.yaw
  const jumping = !!(input.buttons & Btn.Jump)
  const wantCrouch = !!(input.buttons & Btn.Crouch)

  // Bắt đầu trượt: vừa bấm Crouch (cạnh lên) khi chạm đất, đủ nhanh, hết cooldown
  const hSpeed = Math.hypot(vel[0], vel[2])
  if (wantCrouch && !crouching && grounded && !jumping && hSpeed >= cfg.slideMinSpeed && slideCooldown <= 0) {
    vel[0] += vel[0] / hSpeed * cfg.slideBoost
    vel[2] += vel[2] / hSpeed * cfg.slideBoost
    slideTimer    = cfg.slideDuration
    slideCooldown = cfg.slideCooldown
  }

  // Crouching state: stay crouched if button held or no room to stand
  if (wantCrouch) {
    crouching = true
  } else if (crouching) {
    crouching = !world.canStand(pos)
  }

  // wishDir from WASD + yaw (horizontal only)
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw)
  let wx = 0, wz = 0
  if (input.buttons & Btn.Forward) { wx -= sinY; wz -= cosY }
  if (input.buttons & Btn.Back)    { wx += sinY; wz += cosY }
  if (input.buttons & Btn.Left)    { wx -= cosY; wz += sinY }
  if (input.buttons & Btn.Right)   { wx += cosY; wz -= sinY }
  const wlen = Math.hypot(wx, wz)
  _wd[0] = wlen > 1e-6 ? wx / wlen : 0
  _wd[1] = 0
  _wd[2] = wlen > 1e-6 ? wz / wlen : 0

  const wishSpeed = crouching ? cfg.crouchSpeed : cfg.runSpeed

  // Nhả Crouch (và đứng dậy được) thì kết thúc trượt
  if (!crouching) slideTimer = 0
  const sliding = slideTimer > 0 && grounded

  if (grounded) {
    if (jumping) {
      vel[1]   = cfg.jumpVelocity
      grounded = false
      slideTimer = 0
      // skip friction on jump tick
    } else if (sliding) {
      // Đang trượt: ma sát thấp, không lái được
      _applyFriction(vel, cfg.slideFriction, cfg.stopSpeed, dt)
    } else {
      _applyFriction(vel, cfg.friction, cfg.stopSpeed, dt)
      _accelerate(vel, _wd, wishSpeed, cfg.groundAccel, dt)
    }
  } else {
    _accelerate(vel, _wd, Math.min(wishSpeed, cfg.airWishCap), cfg.airAccel, dt)
  }

  vel[1] -= cfg.gravity * dt

  const res = world.moveCharacter(pos, [vel[0] * dt, vel[1] * dt, vel[2] * dt], crouching)
  pos[0] = res.pos[0]; pos[1] = res.pos[1]; pos[2] = res.pos[2]
  grounded = res.grounded

  if (grounded && vel[1] < 0)      vel[1] = 0
  if (res.hitCeiling && vel[1] > 0) vel[1] = 0

  slideTimer    = Math.max(0, slideTimer    - dt)
  slideCooldown = Math.max(0, slideCooldown - dt)

  return { pos, vel, yaw: input.yaw, pitch: input.pitch, grounded, crouching, slideTimer, slideCooldown }
}

export function lerpState(a: PlayerState, b: PlayerState, t: number): PlayerState {
  return {
    pos: [lerp(a.pos[0], b.pos[0], t), lerp(a.pos[1], b.pos[1], t), lerp(a.pos[2], b.pos[2], t)],
    vel: b.vel,
    yaw: b.yaw,
    pitch: b.pitch,
    grounded: b.grounded,
    crouching: b.crouching,
    slideTimer: b.slideTimer,
    slideCooldown: b.slideCooldown,
  }
}

