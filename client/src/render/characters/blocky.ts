import { TEAMS } from '@fps/shared'
import { createKit } from './kit'
import type { CharacterSet } from './types'

// Cớm (xanh, mũ kê-pi) vs Cướp (đen sọc, khăn che mặt, túi tiền)
export const blocky: CharacterSet = {
  id: 'blocky',
  label: 'Cớm & Cướp (khối hộp)',
  build(team) {
    const cop = team === 'A'
    const cloth = cop ? TEAMS.A.color : 0x1c1c1c
    const { rig, box } = createKit(team, { torso: cloth, arms: cloth, legs: cop ? 0x1d2f55 : 0x2e2e2e, skin: 0xe0b090 })
    if (cop) {
      box(rig.headPivot, 0.38, 0.1, 0.34, 0x1b2748, 0, 0.4, 0)      // mũ kê-pi: hộp dẹt
      box(rig.headPivot, 0.38, 0.03, 0.14, 0x0e0e0e, 0, 0.36, -0.2) // vành
      box(rig.headPivot, 0.39, 0.03, 0.35, 0xd9b84a, 0, 0.34, 0)    // dải vàng
    } else {
      for (const y of [0.15, 0.32, 0.49]) box(rig.upper, 0.42, 0.05, 0.28, 0xe8e8e8, 0, y, 0)   // sọc trên thân
      box(rig.headPivot, 0.37, 0.16, 0.32, 0x111111, 0, 0.08, 0)    // khăn che nửa mặt dưới
      box(rig.headPivot, 0.37, 0.07, 0.32, 0x111111, 0, 0.31, 0)    // khăn buộc trán
      const sack = box(rig.upper, 0.32, 0.34, 0.16, 0x7a6a3a, 0, 0.3, 0.21)   // túi tiền sau lưng
      box(sack, 0.12, 0.08, 0.1, 0x4f4326, 0, 0.2, 0)
    }
    return rig
  },
}
