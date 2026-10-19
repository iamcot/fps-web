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

export const WEAPONS: WeaponDef[] = [
  {
    id: 0, name: 'AK47', auto: true, damage: 38, headMult: 3.5, legMult: 0.75,
    fireIntervalMs: 90, magSize: 30, reloadMs: 2200, range: 180,
    spreadDeg: { stand: 0.6, move: 2.0, air: 5, crouch: 0.3 },
    recoilPitchDeg: 0.8, recoilYawDeg: 0.4, recoilRecoverDegPerSec: 7,
  },
  {
    id: 1, name: 'M16', auto: true, damage: 35, headMult: 4, legMult: 0.75,
    fireIntervalMs: 200, magSize: 20, reloadMs: 1800, range: 220,
    spreadDeg: { stand: 0.3, move: 1.2, air: 3.5, crouch: 0.15 },
    recoilPitchDeg: 0.5, recoilYawDeg: 0.2, recoilRecoverDegPerSec: 10,
  },
  {
    id: 2, name: 'COLT', auto: false, damage: 15, headMult: 4, legMult: 0.75,
    fireIntervalMs: 200, magSize: 20, reloadMs: 1800, range: 220,
    spreadDeg: { stand: 0.3, move: 1.2, air: 3.5, crouch: 0.15 },
    recoilPitchDeg: 0.5, recoilYawDeg: 0.2, recoilRecoverDegPerSec: 10,
  },
  {
    id: 3, name: 'ROULEAU', auto: false, damage: 16, headMult: 4, legMult: 0.75,
    fireIntervalMs: 200, magSize: 20, reloadMs: 1800, range: 220,
    spreadDeg: { stand: 0.3, move: 1.2, air: 3.5, crouch: 0.15 },
    recoilPitchDeg: 0.5, recoilYawDeg: 0.2, recoilRecoverDegPerSec: 10,
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
