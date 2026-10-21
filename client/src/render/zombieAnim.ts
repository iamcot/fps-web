import type { Slot } from './locomotion'

// Animation zombie (plan 16, ZF.4): bộ z_* của Mixamo dùng chung mọi model (cùng bộ xương 65), kể cả người bị lây.
// Thuần số học để test; characterRig.ts áp vào mixer.
export const Z_CLIPS = ['z_idle', 'z_walk', 'z_run', 'z_crawl', 'z_jump'] as const
export const Z_DEATH = ['z_death_1', 'z_death_2'] as const

/** Ô di chuyển → clip. Zombie không đi lùi/ngang riêng: mượn z_walk; ngồi = bò. */
export function zombieSlotClip(slot: Slot): string {
  switch (slot) {
    case 'idle': return 'z_idle'
    case 'run': return 'z_run'
    case 'crouchIdle': case 'crouchWalk': return 'z_crawl'
    case 'jump': case 'slide': return 'z_jump'
    default: return 'z_walk'
  }
}

// Tốc độ (m/s) mà clip trông khớp chân; timeScale = speed / ref, kẹp để khỏi đứng hình / hoạt hình nhanh quá
// (đo từ chân trong chính clip: z_walk rất chậm ~0,5 m/s, z_run ~2,5 m/s, z_crawl ~0,5 m/s)
export const ZOMBIE_REF_SPEED = { walk: 0.6, run: 2.6, crawl: 0.5 }
export const ZOMBIE_RATE_MIN = 0.5
export const ZOMBIE_RATE_MAX = 2.6

/** Ngưỡng chuyển z_walk → z_run của zombie (z_walk quá chậm để theo kịp tốc độ đi của zombie) */
export const ZOMBIE_RUN_START = 1.5
export const ZOMBIE_RUN_BLEND = 1

export function zombieClipRate(clip: string, speed: number): number {
  const ref = clip === 'z_walk' ? ZOMBIE_REF_SPEED.walk : clip === 'z_run' ? ZOMBIE_REF_SPEED.run : clip === 'z_crawl' ? ZOMBIE_REF_SPEED.crawl : 0
  if (ref <= 0) return 1
  return Math.min(ZOMBIE_RATE_MAX, Math.max(ZOMBIE_RATE_MIN, speed / ref))
}

/** z_jump: giữ ở khung giữa lúc còn trên không (tỉ lệ độ dài clip) */
export const ZOMBIE_JUMP_HOLD = 0.4

/**
 * Đòn cào: chỉ phát một đoạn [from, to] (tỉ lệ độ dài clip, quanh lúc tay vung nhanh nhất) trong `sec` giây.
 * Cào thường = z_attack_2 (tay vung ở ~42% clip); cào mạnh = z_attack_1 (hai nhịp ở ~19% và ~32%).
 */
export const ZOMBIE_ATTACK = {
  light: { clip: 'z_attack_2', from: 0.12, to: 0.62, sec: 0.5 },
  heavy: { clip: 'z_attack_1', from: 0.08, to: 0.45, sec: 0.65 },
} as const
export type ZombieAttackKind = keyof typeof ZOMBIE_ATTACK

/** Biến hình: z_transform co lại vừa `sec` giây (thời gian bất tử + đứng yên của server) */
export function fitRate(clipDur: number, from: number, to: number, sec: number): number {
  return Math.max(0.1, ((to - from) * clipDur) / Math.max(0.05, sec))
}
