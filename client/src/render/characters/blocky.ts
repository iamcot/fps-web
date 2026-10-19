import { TEAMS } from '@fps/shared'
import { createKit } from './kit'
import type { CharacterSet } from './types'

// Cớm (xanh, mũ kê-pi) vs Cướp (áo xám đậm, quần đen, mặt nạ xám, tóc nâu)
export const blocky: CharacterSet = {
  id: 'blocky',
  label: 'Cớm & Cướp (khối hộp)',
  build(team) {
    const cop = team === 'A'
    const cloth = cop ? TEAMS.A.color : 0x3a3a3a
    const { rig, box } = createKit(team, { torso: cloth, arms: cloth, legs: cop ? 0x1d2f55 : 0x111111, skin: 0xe0b090 })
    if (cop) {
      box(rig.headPivot, 0.38, 0.1, 0.34, 0x1b2748, 0, 0.4, 0)      // mũ kê-pi: hộp dẹt
      box(rig.headPivot, 0.38, 0.03, 0.14, 0x0e0e0e, 0, 0.36, -0.2) // vành
      box(rig.headPivot, 0.39, 0.03, 0.35, 0xd9b84a, 0, 0.34, 0)    // dải vàng
    } else {
      box(rig.headPivot, 0.37, 0.2, 0.32, 0x3a3a3a, 0, 0.1, 0)      // mặt nạ xám đậm che nửa mặt dưới
      box(rig.headPivot, 0.37, 0.1, 0.32, 0x5a3a20, 0, 0.32, 0)     // tóc nâu
      box(rig.headPivot, 0.37, 0.2, 0.06, 0x5a3a20, 0, 0.25, 0.13)  // tóc gáy
    }
    return rig
  },
}
