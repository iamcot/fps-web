// Thể thức Lây Nhiễm (plan 16, phần I): thông số cân bằng. Chỉnh số ở đây, không hardcode trong logic.
import type { ZombieStats } from './zombie'

export interface InfectionZombieDef { hpBase: number; hpPerHuman: number; runSpeed: number; clawDamage: number; knockbackResist: number; regenPerSec: number }

export const INFECTION = {
  minPlayers: 3,
  startMoney: 6000,            // mỗi ván, không mang sang ván sau
  buyAnywhereDuringPrep: true, // trong pha chuẩn bị mua ở đâu cũng được
  motherCount: (players: number) => (players >= 8 ? 2 : 1),
  mother: { hpBase: 3000, hpPerHuman: 400, runSpeed: 7.5, clawDamage: 60, knockbackResist: 0.3, regenPerSec: 80 } as InfectionZombieDef,
  normal: { hpBase: 1500, hpPerHuman: 150, runSpeed: 7.0, clawDamage: 45, knockbackResist: 0.0, regenPerSec: 50 } as InfectionZombieDef,
  zombieRespawnMs: 5000,       // zombie bị hạ thì hồi sinh lại (vẫn là zombie)
  transformMs: 1500,
  pickMs: 2000,                // từ lúc chọn zombie mẹ tới lúc hết bất tử (mẹ biến hình tại chỗ)
  hero: { hp: 200, damageMult: 1.5, speedMult: 1.1 },
  points: { surviveRound: 3, infect: 1, killZombie: 2, killAsHero: 3, mother: 1 },
  sniff: { cooldownMs: 15000, radius: 18, durationMs: 2500 }, // chiêu "đánh hơi" của zombie (I.3)
  towerDecay: { enabled: false, afterSec: 40, dps: 2 },       // luật "tháp sập" (I.2): chỉ bật khi người dùng đồng ý
} as const

export type InfectionZombieType = 'mother' | 'normal'

/** Thông số một zombie lúc có `humans` người còn sống: hpMax = hpBase + hpPerHuman × humans */
export function infectionStats(type: InfectionZombieType, humans: number): ZombieStats {
  const d = INFECTION[type]
  return { type, hpMax: d.hpBase + d.hpPerHuman * humans, runSpeed: d.runSpeed, clawDamage: d.clawDamage, knockbackResist: d.knockbackResist, regenPerSec: d.regenPerSec }
}
