// Cấu hình cận chiến (plan 19, P2): hằng số thể lực / đỡ / parry / choáng và cây combo của từng vũ khí.
// Mọi con số là ĐỀ XUẤT, chỉnh khi playtest. Không import Three.js/DOM.

export const MELEE = {
  inputBufferMs: 150,        // bấm sớm hơn lúc được ra chiêu tối đa bấy nhiêu thì vẫn nhận
  // Thể lực
  staminaMax: 100,
  staminaRegenPerSec: 25,
  staminaRegenDelayMs: 800,  // sau khi tiêu thể lực, chờ bấy nhiêu mới hồi
  // Đỡ
  guardArcDeg: 90,           // nửa góc nón chắn phía trước (90 = cả nửa mặt phẳng phía trước; bot đi vòng không đánh lọt bên hông)
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
 * Chỉ số chiêu: 0 L1 chém ngang, 1 L2 chém ngược, 2 L3 đâm liên hoàn 2 nhát, 3 LLR đâm thẳng từ ngực, 4 LLRL xoay 360,
 *               5 LR đâm thẳng từ ngực, 6 LRL hất lên, 7 R1 đâm thẳng, 8 RR đâm thẳng 2 nhát, 9 RL lật tay chém nhanh
 */
const KNIFE_SLOW = 1.3   // playtest 23/10: chiêu dao quá nhanh, mắt không kịp thấy → kéo dài mọi pha thêm 30%
const RAW_KNIFE_SET: MeleeSet = {
  roots: [0, 7],
  moves: [
    mv('knife_l1',    110, 270, 40, 20, 15, [1, 5], 200,  arc({ yaw: [-70, 70] })),
    mv('knife_l2',     90, 230, 40, 20, 15, [2, 3], 200,  arc({ yaw: [70, -70] })),
    mv('knife_l3',    150, 330, 35, 14, 25, [-1, -1], 90, arc({ reach: [0.8, 2.2] }), 2, 200),
    mv('knife_llr',   200, 380, 65, 35, 25, [4, -1], 120, arc({ pitch: same(-3), reach: [0.8, 2.2], height: same(-0.1) })),
    mv('knife_spin',  150, 500, 60, 45, 30, [-1, -1], 280, arc({ yaw: [0, 360], reach: same(1.6) })),
    mv('knife_lr',    180, 360, 65, 35, 25, [6, -1], 120, arc({ pitch: same(-3), reach: [0.8, 2.2], height: same(-0.1) })),
    mv('knife_rise',  120, 450, 50, 30, 25, [-1, -1], 120, arc({ pitch: [-50, 60], height: same(-0.4) })),
    mv('knife_r1',    250, 450, 65, 35, 25, [9, 8], 140, arc({ pitch: same(-3), reach: [0.8, 2.2], height: same(-0.15) })),
    mv('knife_rr',    120, 400, 30, 15, 25, [-1, -1], 100, arc({ pitch: same(-3), reach: [0.8, 2.1], height: same(-0.15) }), 2, 170),
    mv('knife_flip',   80, 340, 45, 25, 20, [-1, -1], 170,  arc({ yaw: [65, -65] })),
  ],
}

function slowed(set: MeleeSet, k: number): MeleeSet {
  const r = (v: number) => Math.round(v * k)
  return { roots: set.roots, moves: set.moves.map(m => ({ ...m, windupMs: r(m.windupMs), recoverMs: r(m.recoverMs), strikeMs: r(m.strikeMs), hitIntervalMs: r(m.hitIntervalMs) })) }
}
export const KNIFE_SET: MeleeSet = slowed(RAW_KNIFE_SET, KNIFE_SLOW)

/**
 * Búa (plan 19 mục 6): chậm, nặng, hai tay.  L giáng, R quét ngang.
 *   L→L giáng kép     R→L quét rồi giáng     R→R→R xoáy búa (vòng cuối 360°)
 * Chỉ số: 0 L1 giáng, 1 LL giáng lần hai, 2 R1 quét trái→phải, 3 RR quét phải→trái, 4 RL giáng sau quét, 5 RRR xoáy 360
 */
export const HAMMER_SET: MeleeSet = {
  roots: [0, 2],
  moves: [
    mv('hammer_l1',  450, 550, 70, 60, 30, [1, -1], 160, arc({ pitch: [60, -45], reach: same(2.3), height: same(-0.1) })),
    mv('hammer_ll',  380, 650, 80, 70, 35, [-1, -1], 160, arc({ pitch: [70, -50], reach: same(2.4), height: same(-0.1) })),
    mv('hammer_r1',  350, 450, 45, 45, 25, [4, 3], 180, arc({ yaw: [-70, 70], reach: same(2.3) })),
    mv('hammer_rr',  300, 450, 45, 40, 25, [-1, 5], 180, arc({ yaw: [70, -70], reach: same(2.3) })),
    mv('hammer_rl',  380, 600, 85, 70, 35, [-1, -1], 160, arc({ pitch: [60, -45], reach: same(2.4), height: same(-0.1) })),
    mv('hammer_rrr', 300, 700, 60, 60, 40, [-1, -1], 380, arc({ yaw: [0, 360], reach: same(2.2) })),
  ],
}

/**
 * Mã tấu: nhanh vừa, chém chéo, một tay.  L chém chéo xuống, R chém chéo ngược lên.
 *   L→R→L chữ X     L→L→R chặt ngang tầm đầu     L→R→L→R bão chém 4 nhát
 * Chỉ số: 0 L1, 1 LL chéo ngược, 2 LR chéo lên, 3 LLR chặt đầu, 4 LRL nhát cuối chữ X, 5 LRLR bão chém, 6 R1 chéo ngược lên
 */
export const MACHETE_SET: MeleeSet = {
  roots: [0, 6],
  moves: [
    mv('machete_l1',   180, 300, 45, 25, 18, [1, 2], 110, arc({ yaw: [45, -45], pitch: [35, -30], reach: same(2.2) })),
    mv('machete_ll',   160, 300, 45, 25, 18, [-1, 3], 110, arc({ yaw: [-45, 45], pitch: [30, -25], reach: same(2.2) })),
    mv('machete_lr',   150, 300, 45, 25, 18, [4, -1], 110, arc({ yaw: [-45, 45], pitch: [-30, 35], reach: same(2.2) })),
    mv('machete_llr',  260, 450, 55, 35, 25, [-1, -1], 120, arc({ yaw: [60, -60], pitch: same(8), reach: same(2.3), height: same(0) })),
    mv('machete_lrl',  200, 380, 60, 40, 22, [-1, 5], 120, arc({ yaw: [45, -45], pitch: [35, -30], reach: same(2.3) })),
    mv('machete_lrlr', 150, 500, 35, 15, 35, [-1, -1], 90, arc({ yaw: [50, -50], reach: same(2.2) }), 4, 140),
    mv('machete_r1',   180, 300, 45, 25, 18, [-1, -1], 110, arc({ yaw: [-45, 45], pitch: [-30, 35], reach: same(2.2) })),
  ],
}

/**
 * Thương: tầm xa, đâm, hai tay. Khởi động dài.  L đâm thẳng, R quét ngang ~100°.
 *   L→L→L ba đâm (nhát cuối xa 3,6 m)     L→R đâm rồi quét     R→L hất rồi đâm
 * Chỉ số: 0 L1, 1 LL, 2 LLL, 3 LR quét, 4 R1 quét, 5 RL đâm
 */
export const SPEAR_SET: MeleeSet = {
  roots: [0, 4],
  moves: [
    mv('spear_l1',  300, 400, 50, 30, 22, [1, 3], 130, arc({ pitch: same(-2), reach: [1.4, 3.2], height: same(-0.2) })),
    mv('spear_ll',  260, 400, 50, 30, 22, [2, -1], 130, arc({ pitch: same(-2), reach: [1.4, 3.2], height: same(-0.2) })),
    mv('spear_lll', 320, 600, 70, 45, 30, [-1, -1], 140, arc({ pitch: same(-2), reach: [1.6, 3.6], height: same(-0.2) })),
    mv('spear_lr',  260, 450, 40, 30, 22, [-1, -1], 160, arc({ yaw: [-50, 50], reach: same(3.0) })),
    mv('spear_r1',  280, 450, 40, 30, 22, [5, -1], 160, arc({ yaw: [-50, 50], reach: same(3.0) })),
    mv('spear_rl',  300, 500, 60, 40, 28, [-1, -1], 140, arc({ pitch: [-12, 0], reach: [1.4, 3.4], height: same(-0.2) })),
  ],
}

/**
 * Gậy: rẻ, nhiều đòn nhẹ, hai tay.  L quật chéo, R đảo hai đầu (2 nhát).
 *   L→L→L→L mưa gậy (nhát cuối giáng mạnh)     R→L quật đầu     L→R→L ba tầng đầu / thân / chân
 * Chỉ số: 0 L1, 1 LL, 2 LLL, 3 LLLL giáng, 4 R1 đảo hai đầu, 5 LR quét thân, 6 RL quật đầu, 7 LRL quét chân
 */
export const STAFF_SET: MeleeSet = {
  roots: [0, 4],
  moves: [
    mv('staff_l1',   120, 180, 30, 15, 12, [1, 5], 100, arc({ yaw: [40, -40], pitch: [30, -20], reach: same(2.5) })),
    mv('staff_ll',   100, 180, 25, 12, 12, [2, -1], 100, arc({ yaw: [-40, 40], pitch: [25, -20], reach: same(2.5) })),
    mv('staff_lll',  100, 200, 25, 12, 12, [3, -1], 100, arc({ yaw: [40, -40], pitch: [25, -20], reach: same(2.5) })),
    mv('staff_llll', 200, 450, 50, 35, 20, [-1, -1], 130, arc({ pitch: [60, -45], reach: same(2.6), height: same(-0.1) })),
    mv('staff_r1',   120, 300, 20, 12, 15, [6, -1], 100, arc({ yaw: [-45, 45], reach: same(2.4) }), 2, 180),
    mv('staff_lr',   140, 250, 25, 15, 12, [7, -1], 100, arc({ yaw: [-50, 50], pitch: same(-12), reach: same(2.5), height: same(-0.3) })),
    mv('staff_rl',   160, 350, 30, 20, 15, [-1, -1], 110, arc({ pitch: [50, -10], reach: same(2.6), height: same(0) })),
    mv('staff_lrl',  140, 350, 25, 15, 12, [-1, -1], 100, arc({ yaw: [50, -50], pitch: same(-35), reach: same(2.4), height: same(-0.4) })),
  ],
}

/** Bộ chiêu theo `WeaponDef.key`. Vũ khí không có ở đây thì dùng logic bắn cũ. */
export const MELEE_SETS: Readonly<Record<string, MeleeSet>> = { knife: KNIFE_SET, hammer: HAMMER_SET, machete: MACHETE_SET, spear: SPEAR_SET, staff: STAFF_SET }
