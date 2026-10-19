export interface WeaponDef {
  id: number
  name: string
  auto: boolean
  damage: number
  headMult: number
  legMult: number
  fireIntervalMs: number
  magSize: number
  reloadMs: number
  range: number
  spreadDeg: { stand: number; move: number; air: number; crouch: number }
  recoilPitchDeg: number
  recoilYawDeg: number
  recoilRecoverDegPerSec: number
  ads?: AdsDef            // có = giữ chuột phải để ngắm
  recoilRecoverDelayMs?: number   // hồi recoil sau phát bắn bấy nhiêu ms (mặc định: sau fireIntervalMs). Súng chậm như sniper cần hồi sớm
  pellets?: number                // số tia mỗi phát (mặc định 1). Mỗi tia có spread riêng, seed theo shotSeq + chỉ số tia
  falloff?: DamageFalloff         // sát thương giảm theo khoảng cách (mặc định: không giảm)
  aimSpreadDeg?: number   // spread khi ngắm + đứng yên/ngồi trên mặt đất (thay các mức stand/crouch)
}

// Sát thương nhân hệ số 1 tới fullM, giảm tuyến tính còn minMult tại endM, giữ nguyên minMult sau đó
export interface DamageFalloff {
  fullM: number
  endM: number
  minMult: number
}

// Chế độ ngắm. fovs[0] = mức đầu, nếu có thêm thì lăn chuột để đổi (sâu dần). scope = che đen ngoài vòng tròn và ẩn súng
export interface AdsDef {
  fovs: number[]
  scope: boolean
}

export interface WeaponState {
  current: number
  ammo: number[]
  reloadEndMs: number
  nextFireMs: number
  shotSeq: number
  triggerHeld: boolean
}

// Thời gian khoá bắn sau khi đổi súng (khớp animation hạ/đưa súng 2×0.15s ở viewmodel)
export const SWITCH_MS = 300
// Tốc độ ngang (m/s) trên mức này thì dùng spread 'move'
export const MOVE_SPREAD_SPEED = 1

// Thông số theo súng thật (sát thương trên thang máu 100):
// - AK47: 7.62x39, ~600 phát/phút, 30 viên, giật mạnh, tản đạn lớn khi di chuyển.
// - M16: 5.56x45, ~750 phát/phút, 30 viên, chính xác và giật nhẹ hơn AK, tầm xa hơn.
// - COLT (M1911 .45): bán tự động, 7 viên, giật rõ.
// - ROULEAU (súng lục ổ xoay): bán tự động, 6 viên, sát thương lớn, nạp đạn lâu.
export const WEAPONS: WeaponDef[] = [
  {
    id: 0, name: 'AK47', auto: true, damage: 36, headMult: 3.5, legMult: 0.75,
    fireIntervalMs: 100, magSize: 30, reloadMs: 2500, range: 180,
    spreadDeg: { stand: 0.5, move: 2.5, air: 6, crouch: 0.3 },
    recoilPitchDeg: 0.9, recoilYawDeg: 0.45, recoilRecoverDegPerSec: 8,
    ads: { fovs: [65], scope: false }, aimSpreadDeg: 0.15,   // súng trường: ngắm qua đầu ruồi, zoom nhẹ, không che màn hình; ngắm đứng yên thì chụm
  },
  {
    id: 1, name: 'M16', auto: true, damage: 30, headMult: 4, legMult: 0.75,
    fireIntervalMs: 80, magSize: 30, reloadMs: 2200, range: 220,
    spreadDeg: { stand: 0.45, move: 2.3, air: 5, crouch: 0.25 },
    recoilPitchDeg: 0.55, recoilYawDeg: 0.25, recoilRecoverDegPerSec: 10,
    ads: { fovs: [65], scope: false }, aimSpreadDeg: 0.14,
  },
  {
    id: 2, name: 'COLT', auto: false, damage: 32, headMult: 3, legMult: 0.75,
    fireIntervalMs: 160, magSize: 7, reloadMs: 1600, range: 90,
    spreadDeg: { stand: 0.4, move: 1.5, air: 4, crouch: 0.25 },
    recoilPitchDeg: 1.5, recoilYawDeg: 0.3, recoilRecoverDegPerSec: 12,
  },
  {
    id: 3, name: 'ROULEAU', auto: false, damage: 55, headMult: 3, legMult: 0.75,
    fireIntervalMs: 400, magSize: 6, reloadMs: 3000, range: 110,
    spreadDeg: { stand: 0.3, move: 1.8, air: 5, crouch: 0.2 },
    recoilPitchDeg: 2.5, recoilYawDeg: 0.4, recoilRecoverDegPerSec: 10,
  },
  {
    // Sniper: 1 phát/1,2s, 90 sát thương (đầu ×2 = 180), tản đạn rất lớn khi không ngắm; scope 2 mức zoom
    id: 4, name: 'SNIPER', auto: false, damage: 90, headMult: 2, legMult: 0.75,
    fireIntervalMs: 1200, magSize: 5, reloadMs: 3200, range: 400,
    spreadDeg: { stand: 5, move: 9, air: 14, crouch: 4 },
    recoilPitchDeg: 3, recoilYawDeg: 0.5, recoilRecoverDegPerSec: 15, recoilRecoverDelayMs: 120,
    ads: { fovs: [30], scope: true }, aimSpreadDeg: 0.02,
  },
  {
    // Shotgun: 8 tia/phát, mỗi tia 16 sát thương (gần: 8 tia thân = 128, đủ hạ 1 phát), giảm dần theo khoảng cách
    id: 5, name: 'SHOTGUN', auto: false, damage: 16, headMult: 2, legMult: 0.75,
    fireIntervalMs: 900, magSize: 6, reloadMs: 3000, range: 60,
    spreadDeg: { stand: 4, move: 5, air: 7, crouch: 3.5 },
    recoilPitchDeg: 4, recoilYawDeg: 0.6, recoilRecoverDegPerSec: 12, recoilRecoverDelayMs: 120,
    pellets: 8, falloff: { fullM: 6, endM: 30, minMult: 0.2 },
  },
]

/** Số tia tối đa mỗi phát (mảng hướng bắn cấp phát sẵn theo số này; seed dành 6 bit cho chỉ số tia) */
export const MAX_PELLETS = 16


export function makeWeaponState(): WeaponState {
  return {
    current:     0,
    ammo:        WEAPONS.map(w => w.magSize),
    reloadEndMs: 0,
    nextFireMs:  0,
    shotSeq:     0,
    triggerHeld: false,
  }
}
