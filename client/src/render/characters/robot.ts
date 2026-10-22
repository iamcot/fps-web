import { createKit } from './kit'
import type { CharacterSet } from './types'

// Robot: đội A thép xanh có ăng-ten, đội B gỉ cam có sừng + bình nhiên liệu. Bước chân nặng, ít đung đưa.
export const robot: CharacterSet = {
  id: 'robot',
  label: 'Robot (blocky)',
  build(team) {
    const a = team === 'A'
    const body = a ? 0x5f86b8 : 0xc2652b
    const dark = a ? 0x2a3a52 : 0x5a2d14
    const { rig, box } = createKit(team, { torso: body, arms: dark, legs: dark, skin: a ? 0xbfd3e6 : 0xe8c28a },
      { legSwing: 0.55, armSwing: 0.2, bobAmp: 0.015, strideRadPerM: 3.0 })
    box(rig.headPivot, 0.37, 0.08, 0.02, a ? 0x66e0ff : 0xffd24a, 0, 0.2, -0.16)   // kính mắt phát sáng
    box(rig.upper, 0.14, 0.14, 0.02, a ? 0x66e0ff : 0xffd24a, 0, 0.42, -0.14)       // đèn ngực
    if (a) {
      box(rig.headPivot, 0.03, 0.22, 0.03, dark, 0.1, 0.46, 0)                      // ăng-ten
      box(rig.headPivot, 0.07, 0.07, 0.07, 0xff4a4a, 0.1, 0.6, 0)
    } else {
      box(rig.headPivot, 0.06, 0.18, 0.06, dark, -0.13, 0.43, 0)                    // sừng
      box(rig.headPivot, 0.06, 0.18, 0.06, dark, 0.13, 0.43, 0)
      box(rig.upper, 0.26, 0.36, 0.16, dark, 0, 0.3, 0.21)                          // bình nhiên liệu
    }
    return rig
  },
}
