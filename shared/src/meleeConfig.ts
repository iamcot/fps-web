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
  // Quét va chạm (P3)
  bladeRadius: 0.06,         // bán kính "lưỡi" cộng vào hộp trúng
  maxRewindMs: 250,          // tua đối thủ tối đa bấy nhiêu cho đòn cận chiến (súng: MAX_REWIND_MS)
  headMult: 2.5,             // đòn trúng đầu
  attackMoveMul: 0.8,
  staggerMoveMul: 0.3,
} as const

/** Ô trong mảng `next` của một chiêu: chuột trái, chuột phải */
export const MELEE_L = 0
export const MELEE_R = 1

/** Mã kết quả đòn gửi qua mạng (HitConfirmMsg.outcome) */
export const MELEE_OUTCOME = { hit: 0, blocked: 1, parried: 2, guardBreak: 3 } as const

/**
 * Cung quét của một nhát đánh, tham số hoá theo u ∈ [0,1] trong cửa sổ đánh (nội suy tuyến tính từng cặp [đầu, cuối]).
 * Hệ toạ độ gắn với mắt và hướng nhìn: x = phải, y = lên, z = trước. Góc theo độ: yaw + = sang phải, pitch + = ngẩng lên.
 * Đoạn quét = từ gốc (tay) tới mũi cách `reach` m theo hướng (yaw, pitch). Đây là vùng quét hiệu dụng cho gameplay, không phải lưỡi vẽ.
 */
export interface MeleeArc {
  yaw: readonly [number, number]
  pitch: readonly [number, number]
  reach: readonly [number, number]
  height: readonly [number, number]   // độ cao gốc so với mắt (m)
  fwd: readonly [number, number]      // gốc lệch ra trước mắt (m)
  side: readonly [number, number]     // gốc lệch sang phải (m)
}

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
  strikeMs: number          // độ dài cửa sổ quét của mỗi nhát (≤ hitIntervalMs khi nhiều nhát)
  arc: MeleeArc
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

type Pair = readonly [number, number]
const same = (v: number): Pair => [v, v]
interface ArcOpts { yaw?: Pair; pitch?: Pair; reach?: Pair; height?: Pair; fwd?: Pair; side?: Pair }
function arc(o: ArcOpts): MeleeArc {
  return { yaw: o.yaw ?? same(0), pitch: o.pitch ?? same(0), reach: o.reach ?? same(1.7), height: o.height ?? same(-0.2), fwd: o.fwd ?? same(0.2), side: o.side ?? same(0) }
}

function mv(key: string, windupMs: number, recoverMs: number, damage: number, poiseDmg: number, staminaCost: number, next: readonly [number, number], strikeMs: number, a: MeleeArc, hitCount = 1, hitIntervalMs = 0): MeleeMove {
  return { key, windupMs, hitCount, hitIntervalMs, recoverMs, chainMs: CHAIN, damage, poiseDmg, staminaCost, strikeMs, arc: a, next }
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
    mv('knife_l1',    110, 270, 40, 20, 15, [1, 5], 90,  arc({ yaw: [-55, 55] })),
    mv('knife_l2',     90, 230, 40, 20, 15, [2, 3], 80,  arc({ yaw: [55, -55] })),
    mv('knife_l3',    120, 330, 20,  8, 25, [-1, -1], 60, arc({ reach: [0.9, 2.0] }), 4, 70),
    mv('knife_llr',   200, 380, 65, 35, 25, [4, -1], 120, arc({ pitch: [50, -50], height: same(-0.1) })),
    mv('knife_spin',  150, 500, 60, 45, 30, [-1, -1], 280, arc({ yaw: [0, 360], reach: same(1.6) })),
    mv('knife_lr',    180, 360, 65, 35, 25, [6, -1], 120, arc({ pitch: [40, -40], height: same(-0.1) })),
    mv('knife_rise',  120, 450, 50, 30, 25, [-1, -1], 120, arc({ pitch: [-50, 60], height: same(-0.4) })),
    mv('knife_r1',    250, 450, 65, 35, 25, [9, 8], 140, arc({ pitch: [45, -30], reach: [1.0, 1.9], height: same(-0.1) })),
    mv('knife_rr',    120, 400, 30, 15, 25, [-1, -1], 100, arc({ pitch: [60, -60], height: same(-0.1) }), 2, 110),
    mv('knife_flip',   80, 340, 45, 25, 20, [-1, -1], 80,  arc({ yaw: [50, -50] })),
  ],
}

/** Bộ chiêu theo `WeaponDef.key`. Vũ khí không có ở đây thì dùng logic bắn cũ. */
export const MELEE_SETS: Readonly<Record<string, MeleeSet>> = { knife: KNIFE_SET }
