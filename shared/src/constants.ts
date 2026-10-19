export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3;   // 20 snapshot/giây
export const INTERP_DELAY_MS = 100;
export const MAX_REWIND_MS = 500;   // rewind thật = trễ gửi lên + INTERP_DELAY + trễ nhận về (≈ 2×oneWay+100) → 250 chỉ đủ tới lat≈75ms/chiều
export const HITBOX_HISTORY_MS = 1000;
export const MAX_INPUT_QUEUE = 10;
export const MAX_INPUTS_PER_TICK = 2;
export const RESPAWN_DELAY_MS = 3000;
export const SPAWN_INVULN_MS = 2000;
export const INPUT_STARVE_GRACE_TICKS = 6;   // hàng đợi input trống ≤ ngần này tick: đứng chờ cmd, không chạy bước 'idle'
export const SEQ_AHEAD_SLACK_MS = 1000;   // seq của cmd được chạy trước thời gian thực tối đa ngần này (chống seq nhảy cóc để bắn nhanh)
export const PLAYER_MAX_HP = 100;
