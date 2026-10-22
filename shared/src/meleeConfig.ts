// Cấu hình cận chiến (plan 19, P2): hằng số thể lực / đỡ / parry / choáng và cây combo của từng vũ khí.
// Mọi con số là ĐỀ XUẤT, chỉnh khi playtest. Không import Three.js/DOM.

export const MELEE = {
  inputBufferMs: 150,        // bấm sớm hơn lúc được ra chiêu tối đa bấy nhiêu thì vẫn nhận
  // Thể lực
  staminaMax: 100,
  staminaRegenPerSec: 25,
  staminaRegenDelayMs: 800,  // sau khi tiêu thể lực, chờ bấy nhiêu mới hồi
  // Đỡ
  guardArcDeg: 60,           // nửa góc nón chắn phía trước
  guardDamageMult: 0.15,     // sát thương lọt qua khi đỡ (đỡ 85%)
  guardStaminaMult: 0.5,     // đỡ trúng tốn thể lực = hệ số × damage gốc
  guardMoveMul: 0.6,
  // Parry: đòn trúng trong parryMs đầu sau khi bấm đỡ
  parryMs: 180,
  parryGraceMs: 80,          // ân hạn cho bên thủ (độ trễ mạng)
  parryLockMs: 600,          // bấm đỡ lại trong khoảng này kể từ lần bấm trước thì không có cửa sổ parry
  parryStaggerMs: 900,       // kẻ bị parry choáng
  vulnerableMs: 1200,        // kẻ bị parry / vỡ thế thủ nhận đòn nặng hơn trong khoảng này
  vulnerableMult: 1.8,
  blockRecoilMs: 150,        // người đánh bị đỡ: khựng thêm
  // Vỡ thế thủ
  guardBreakStaggerMs: 1200,
  // Choáng (poise)
  poiseMax: 100,
  poiseRegenPerSec: 30,
  poiseRegenDelayMs: 2000,
  poiseStaggerMs: 700,
  // Hệ số tốc độ chạy
  attackMoveMul: 0.8,
  staggerMoveMul: 0.3,
} as const

/** Ô trong mảng `next` của một chiêu: chuột trái, chuột phải */
export const MELEE_L = 0
export const MELEE_R = 1

export interface MeleeMove {
  key: string
  windupMs: number          // từ lúc bắt đầu tới nhát đánh đầu tiên
  hitCount: number          // số nhát đánh (đâm liên hoàn = 4)
  hitIntervalMs: number     // khoảng cách giữa các nhát (hitCount > 1)
  recoverMs: number         // từ nhát cuối tới lúc ra chiêu kế được
  chainMs: number           // sau khi chiêu kết thúc, bấm trong khoảng này thì nối sang `next`
  damage: number            // mỗi nhát, vào thân
  poiseDmg: number          // sát thương choáng mỗi nhát
  staminaCost: number       // trừ lúc bắt đầu chiêu
  next: readonly [number, number]   // chỉ số chiêu kế khi bấm L / R trong cửa sổ nối; -1 = hết nhánh
}

export interface MeleeSet {
  moves: readonly MeleeMove[]
  roots: readonly [number, number]  // chiêu đầu khi bấm L / R lúc không đang nối combo
}

/** Tổng thời lượng một chiêu (ms) */
export function moveDurationMs(m: MeleeMove): number {
  return m.windupMs + (m.hitCount - 1) * m.hitIntervalMs + m.recoverMs
}

const CHAIN = 300

function mv(key: string, windupMs: number, recoverMs: number, damage: number, poiseDmg: number, staminaCost: number, next: readonly [number, number], hitCount = 1, hitIntervalMs = 0): MeleeMove {
  return { key, windupMs, hitCount, hitIntervalMs, recoverMs, chainMs: CHAIN, damage, poiseDmg, staminaCost, next }
}

/**
 * Dao (plan 19 mục 3). Cây combo:
 *   L→L→L  K1 Ba nhịp      L→R(→L)  K2/K4     R→R  K3 Xoáy kép
 *   R→L    K5 Lật tay      L→L→R→L  K6 Bão dao
 * Chỉ số chiêu: 0 L1 chém ngang, 1 L2 chém ngược, 2 L3 đâm liên hoàn 4 nhát, 3 LLR đâm xuống, 4 LLRL xoay 360,
 *               5 LR đâm xuống, 6 LRL hất lên, 7 R1 đâm cầm ngược, 8 RR xoáy kép (2 nhát), 9 RL lật tay chém nhanh
 */
export const KNIFE_SET: MeleeSet = {
  roots: [0, 7],
  moves: [
    mv('knife_l1',    110, 270, 40, 20, 15, [1, 5]),
    mv('knife_l2',     90, 230, 40, 20, 15, [2, 3]),
    mv('knife_l3',    120, 330, 20,  8, 25, [-1, -1], 4, 70),
    mv('knife_llr',   200, 380, 65, 35, 25, [4, -1]),
    mv('knife_spin',  150, 500, 60, 45, 30, [-1, -1]),
    mv('knife_lr',    180, 360, 65, 35, 25, [6, -1]),
    mv('knife_rise',  120, 450, 50, 30, 25, [-1, -1]),
    mv('knife_r1',    250, 450, 65, 35, 25, [9, 8]),
    mv('knife_rr',    120, 400, 30, 15, 25, [-1, -1], 2, 110),
    mv('knife_flip',   80, 340, 45, 25, 20, [-1, -1]),
  ],
}

/** Bộ chiêu theo `WeaponDef.key`. Vũ khí không có ở đây thì dùng logic bắn cũ. */
export const MELEE_SETS: Readonly<Record<string, MeleeSet>> = { knife: KNIFE_SET }
