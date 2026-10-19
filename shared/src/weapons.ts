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
  },
  {
    id: 1, name: 'M16', auto: true, damage: 30, headMult: 4, legMult: 0.75,
    fireIntervalMs: 80, magSize: 30, reloadMs: 2200, range: 220,
    spreadDeg: { stand: 0.3, move: 1.8, air: 5, crouch: 0.15 },
    recoilPitchDeg: 0.55, recoilYawDeg: 0.25, recoilRecoverDegPerSec: 10,
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
]

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
