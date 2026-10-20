// Lựu đạn M67 (plan 12). Mọi số về luật chơi / vật lý / sát thương nằm ở đây, không hardcode trong logic.
export const GRENADE = {
  key: 'm67',
  price: 300,
  maxCarry: 2,
  pinPullMs: 350,          // giữ chuột tối thiểu để rút chốt
  fuseMs: 3000,            // tính từ lúc rời tay
  throwSpeed: { strong: 32, lob: 12 },   // m/s
  throwUpDeg: { strong: 10, lob: 3 },    // cộng thêm vào pitch
  inheritVelocity: 0.5,    // cộng 50% vận tốc người ném
  radius: 0.045,           // m, va chạm hình cầu
  gravity: 22,             // cùng gravity của MovementConfig
  restitution: 0.35,       // độ nảy
  friction: 0.6,           // ma sát tiếp tuyến mỗi lần chạm
  rollDrag: 2.5,           // m/s² giảm tốc khi lăn trên sàn
  restSpeed: 0.25,         // dưới tốc độ này thì nằm yên
  bounceMinSpeed: 1.0,     // m/s: va chạm nhanh hơn mức này mới tính là nảy (phát sự kiện 'bounce'); chậm hơn trên sàn = lăn
  damageMax: 98,
  innerRadius: 1.0,        // trong bán kính này: full damage
  outerRadius: 7.0,
  selfDamageMult: 0.5,
  knockback: 3.0,          // m/s đẩy ra xa tâm nổ (0 = tắt)
  shakeRadius: 15,
  warnRadius: 8,           // hiện cảnh báo lựu đạn gần
  autoSwitchBackMs: 450,   // ném quả cuối xong tự đổi về súng trước đó
  throwCooldownMs: 500,    // sau một lần ném: chưa rút chốt quả mới ngay (khớp animation vung tay + đưa quả mới lên)
}

export type ThrowMode = 'strong' | 'lob'

// Trạng thái ném của người chơi: nằm trong WeaponState, server và client chạy cùng stepWeaponCmd nên dự đoán khớp nhau
export interface ThrowState {
  phase: 'idle' | 'pulling' | 'ready'
  mode: ThrowMode
  pressSeq: number   // seq cmd lúc nhấn nút (rút chốt xong sau pinPullMs)
  quick: boolean     // vào bằng phím G: ném xong tự đổi về súng trước
}

export function makeThrowState(): ThrowState {
  return { phase: 'idle', mode: 'strong', pressSeq: 0, quick: false }
}
