import type { CharacterCfg } from './poses'

// Chọn animation thân dưới (plan 11, C.4). Thuần số học, không cấp phát: tính trọng số mục tiêu cho từng "ô"
// (idle, đi 4 hướng, chạy, ngồi, nhảy, trượt) từ vận tốc nội suy trong hệ của nhân vật. Tổng trọng số luôn = 1.
export type Slot = 'idle' | 'walkF' | 'walkB' | 'walkL' | 'walkR' | 'run' | 'crouchIdle' | 'crouchWalk' | 'jump' | 'slide'
export const SLOTS: Slot[] = ['idle', 'walkF', 'walkB', 'walkL', 'walkR', 'run', 'crouchIdle', 'crouchWalk', 'jump', 'slide']
export type SlotWeights = Record<Slot, number>

export function makeSlotWeights(): SlotWeights {
  return { idle: 0, walkF: 0, walkB: 0, walkL: 0, walkR: 0, run: 0, crouchIdle: 0, crouchWalk: 0, jump: 0, slide: 0 }
}

export interface LocoInput {
  vx: number; vz: number      // vận tốc ngang thế giới (m/s)
  yaw: number
  grounded: boolean; crouching: boolean; sliding: boolean
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Ghi trọng số mục tiêu vào `out`; trả về tốc độ ngang (m/s). */
export function locoTargets(inp: LocoInput, cfg: CharacterCfg['anim'], out: SlotWeights): number {
  for (const s of SLOTS) out[s] = 0
  const speed = Math.hypot(inp.vx, inp.vz)
  if (inp.sliding) { out.slide = 1; return speed }
  if (!inp.grounded) { out.jump = 1; return speed }
  const moving = clamp01((speed - cfg.idleSpeed) / (cfg.idleSpeed * 2))
  if (inp.crouching) { out.crouchWalk = moving; out.crouchIdle = 1 - moving; return speed }
  // vận tốc trong hệ nhân vật: forward = (−sin yaw, −cos yaw), right = (cos yaw, −sin yaw)
  const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw)
  const vf = speed > 1e-6 ? (-inp.vx * sy - inp.vz * cy) : 0
  const vr = speed > 1e-6 ? (inp.vx * cy - inp.vz * sy) : 0
  const runK = clamp01((speed - cfg.runStartSpeed) / cfg.runBlendLen) * (speed > 1e-6 ? Math.max(0, vf) / speed : 0)
  const wf = Math.max(0, vf), wb = Math.max(0, -vf), wl = Math.max(0, -vr), wr = Math.max(0, vr)
  const sum = wf + wb + wl + wr
  const walk = moving * (1 - runK)
  if (sum < 1e-6) out.walkF = walk
  else { out.walkF = walk * wf / sum; out.walkB = walk * wb / sum; out.walkL = walk * wl / sum; out.walkR = walk * wr / sum }
  out.run = moving * runK
  out.idle = 1 - moving
  return speed
}

/** Tên clip cho mỗi ô. Súng ngắn/dao: bộ pistol_*; pistol không có đi lùi/ngang nên mượn clip rifle. */
export function slotClip(slot: Slot, pistol: boolean): string {
  switch (slot) {
    case 'idle': return pistol ? 'pistol_idle' : 'rifle_idle'
    case 'walkF': return pistol ? 'pistol_walk_f' : 'rifle_walk_f'
    case 'walkB': return 'rifle_walk_b'
    case 'walkL': return 'rifle_walk_l'
    case 'walkR': return 'rifle_walk_r'
    case 'run': return pistol ? 'pistol_run_f' : 'rifle_run_f'
    case 'crouchIdle': return 'rifle_crouch_idle'
    case 'crouchWalk': return 'rifle_crouch_walk'
    case 'jump': return 'jump'
    case 'slide': return 'slide'
  }
}

export const CLIP_NAMES = [
  'rifle_idle', 'rifle_walk_f', 'rifle_walk_b', 'rifle_walk_l', 'rifle_walk_r', 'rifle_run_f', 'rifle_crouch_idle', 'rifle_crouch_walk',
  'pistol_idle', 'pistol_walk_f', 'pistol_run_f', 'jump', 'slide', 'death_1', 'death_2',
] as const

/** Tốc độ phát (timeScale) của clip theo tốc độ thực để chân không trượt. */
export function clipRate(slot: Slot, speed: number, cfg: CharacterCfg['anim']): number {
  switch (slot) {
    case 'walkF': case 'walkB': case 'walkL': case 'walkR': return Math.min(cfg.maxRate, Math.max(0.3, speed / cfg.walkRefSpeed))
    case 'run': return Math.min(cfg.maxRate, Math.max(0.5, speed / cfg.runRefSpeed))
    case 'crouchWalk': return Math.min(cfg.maxRate, Math.max(0.3, speed / cfg.crouchRefSpeed))
    default: return 1
  }
}
