// Thể thức Thủ Thành (plan 17): loại zombie, đợt, kinh tế, hệ số độ khó. Chỉnh số trong zombieTypes.json / waves.json, không hardcode trong logic.
import typesRaw from './zombieTypes.json'
import wavesRaw from './waves.json'
import type { DefenseDifficulty } from './roomConfig'
import type { ZombieStats } from './zombie'

export type ZombieAbility = 'crawl_holes' | 'leap' | 'shove' | 'rally' | 'slam' | 'summon' | 'charge'
export interface ZombieTypeDef {
  name: string; hp: number; runSpeed: number; clawDamage: number; attackMs: number
  knockbackResist: number; reward: number; regenPerSec: number
  scale: number; tintOverride: string | null; modelOverride: string | null
  abilities: ZombieAbility[]
  headMult?: number
}
export const ZOMBIE_TYPES = typesRaw as unknown as Record<string, ZombieTypeDef>
export type ZombieTypeId = keyof typeof typesRaw

export type SpawnLane = 'baseB' | 'laneLeft' | 'laneRight'
export interface WaveGroup { type: string; count: number; from: SpawnLane[]; everyMs?: number; delayMs?: number }
export interface WaveDef { title: string; hint: string; groups: WaveGroup[] }
export interface WavesFile {
  scaling: { countPerExtraPlayer: number; hpPerExtraPlayer: number; difficulty: Record<DefenseDifficulty, { count: number; hp: number; damage: number }> }
  maxAlive: number
  waves: WaveDef[]
}
export const WAVES = wavesRaw as unknown as WavesFile

/** Kinh tế Thủ Thành (plan 17 T.1): thưởng hết đợt n = waveClearBonus + waveClearPerWave × n */
export const DEFENSE = {
  startMoney: 1500,
  waveClearBonus: 800,
  waveClearPerWave: 100,
  prepReviveHp: 100,
  // Gục và cứu (T.6)
  down: { dieAfterMs: 30_000, crawlSpeed: 1.0, reviveRangeM: 1.5, reviveMs: 3000, reviveHp: 40 },
  // Dọn xác (T.8)
  corpseMs: 4000, corpseSinkMs: 800, maxCorpses: 30,
  // Zombie cào: báo trước 0,25s rồi mới trúng (người lùi ra khỏi tầm thì hụt)
  attackWindupMs: 250,
  shoveSpeed: 4,                 // brute: cào trúng đẩy người lùi (m/s)
  rally: { everyMs: 10_000, radius: 12, speedMult: 1.25, durationMs: 5000 },
  stuckTeleportMs: 6000,
  voidKillY: -5,
} as const

export function waveClearBonus(wave: number): number { return DEFENSE.waveClearBonus + DEFENSE.waveClearPerWave * wave }

/** Số lượng thực = round(count × difficulty.count × (1 + countPerExtraPlayer × (số người − 1))) */
export function scaledCount(count: number, difficulty: DefenseDifficulty, players: number): number {
  const s = WAVES.scaling
  return Math.max(1, Math.round(count * s.difficulty[difficulty].count * (1 + s.countPerExtraPlayer * (Math.max(1, players) - 1))))
}

/** Thông số một zombie loại `type` ở độ khó/số người cho trước (máu nhân hệ số, sát thương nhân hệ số độ khó) */
export function zombieStatsFor(type: string, difficulty: DefenseDifficulty, players: number): ZombieStats & { attackMs: number } {
  const d = ZOMBIE_TYPES[type]
  if (!d) throw new Error(`loại zombie không có: ${type}`)
  const s = WAVES.scaling
  const hp = Math.round(d.hp * s.difficulty[difficulty].hp * (1 + s.hpPerExtraPlayer * (Math.max(1, players) - 1)))
  return {
    type, hpMax: hp, runSpeed: d.runSpeed,
    clawDamage: Math.max(1, Math.round(d.clawDamage * s.difficulty[difficulty].damage)),
    knockbackResist: d.knockbackResist, regenPerSec: d.regenPerSec,
    attackMs: d.attackMs, windupMs: DEFENSE.attackWindupMs,
    headMult: d.headMult ?? 2, scale: d.scale,
    ...(d.abilities.includes('shove') ? { shoveSpeed: DEFENSE.shoveSpeed } : null),
  }
}

/** Boss "Đại Ca Zombie" (T.5) */
export const BOSS = {
  slam: { triggerM: 7, windupMs: 1000, radiusM: 6, damage: 35, knockHoriz: 9, knockUp: 5, cooldownMs: 8000 },
  summon: { thresholds: [0.75, 0.5, 0.25], type: 'runner', count: 6, radiusM: 4 },
  charge: { minM: 10, maxM: 25, windupMs: 800, speed: 14, durationMs: 1200, damage: 50, knockHoriz: 9, knockUp: 5, stunMs: 2000, stunDamageMult: 1.5, cooldownMs: 12000 },
} as const
