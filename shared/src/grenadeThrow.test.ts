import { describe, it, expect } from 'vitest'
import { Btn, GRENADE, GRENADE_ID, GRENADE_SLOT, makeWeaponState, stepWeaponCmd, type InputCmd, type WeaponState, type WeaponEvent } from './index'

// Người chơi có Dao (ô 0), Colt (ô 1), M16 (ô 3) + `n` lựu đạn (ô 4)
function player(n: number): WeaponState {
  const ws = makeWeaponState([6, 2, -1, 1, n > 0 ? GRENADE_ID : -1])
  ws.ammo[GRENADE_ID] = n
  return ws
}
let seq = 0
let wanted = 3   // ô client đang xin trong cmd.weapon (G / auto-switch không đổi giá trị này)
const ms = (t: number) => Math.round(t * 60 / 1000)   // ms → số tick
function run(ws: WeaponState, buttons: number, ticks: number, weapon?: number): WeaponEvent[] {
  if (weapon !== undefined) wanted = weapon
  const evs: WeaponEvent[] = []
  for (let i = 0; i < ticks; i++) {
    const cmd: InputCmd = { seq: seq++, buttons, yaw: 0, pitch: 0, weapon: wanted }
    const e = stepWeaponCmd(ws, cmd)
    if (e !== 'none') evs.push(e)
  }
  return evs
}
const pull = ms(GRENADE.pinPullMs) + 2   // đủ để rút chốt xong

describe('ném lựu đạn (G.3): máy trạng thái dùng chung client/server', () => {
  it('phím 5 cầm lựu đạn; Fire giữ ≥ 0,35s rồi thả = ném mạnh, còn lại giảm 1', () => {
    wanted = 3; seq = 1000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    expect(ws.current).toBe(GRENADE_ID)
    const a = run(ws, Btn.Fire, 1); expect(a).toEqual(['pull']); expect(ws.nade.phase).toBe('pulling'); expect(ws.nade.mode).toBe('strong')
    run(ws, Btn.Fire, pull); expect(ws.nade.phase).toBe('ready')
    const b = run(ws, 0, 1); expect(b).toEqual(['threw'])
    expect(ws.ammo[GRENADE_ID]).toBe(1); expect(ws.throwSeq).toBe(1); expect(ws.nade.phase).toBe('idle')
    expect(ws.current).toBe(GRENADE_ID)   // còn quả: vẫn cầm
  })

  it('chuột phải = ném thấp (lob)', () => {
    wanted = 3; seq = 2000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    run(ws, Btn.Aim, 1); expect(ws.nade.mode).toBe('lob')
    run(ws, Btn.Aim, pull)
    expect(run(ws, 0, 1)).toEqual(['threw']); expect(ws.nade.mode).toBe('lob')
  })

  it('giữ 0,2s rồi thả: không ném, còn đủ lựu đạn', () => {
    wanted = 3; seq = 3000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    run(ws, Btn.Fire, ms(200))
    expect(run(ws, 0, 1)).toEqual(['cancel'])
    expect(ws.ammo[GRENADE_ID]).toBe(2); expect(ws.nade.phase).toBe('idle'); expect(ws.throwSeq).toBe(0)
  })

  it('spam Fire liên tục (giữ không nhả): chỉ một lần rút chốt, không ném quá số đang có', () => {
    wanted = 3; seq = 4000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    const evs = run(ws, Btn.Fire, 600)   // giữ chuột 10 giây
    expect(evs.filter(e => e === 'pull')).toHaveLength(1); expect(evs).not.toContain('threw')
    expect(ws.ammo[GRENADE_ID]).toBe(2)
    // nhấn-nhả liên tục (mỗi 2 tick): vẫn tối đa 2 quả
    let threw = 0
    for (let i = 0; i < 200; i++) { threw += run(ws, Btn.Fire, pull).filter(e => e === 'threw').length; threw += run(ws, 0, 1).filter(e => e === 'threw').length }
    expect(threw).toBe(2); expect(ws.ammo[GRENADE_ID]).toBe(0)
  })

  it('đang cooldown sau khi ném: nhấn ngay chưa rút chốt', () => {
    wanted = 3; seq = 5000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    run(ws, Btn.Fire, pull); run(ws, 0, 1)
    expect(run(ws, Btn.Fire, 1)).toEqual([])          // < throwCooldownMs
    run(ws, 0, 1)
    run(ws, 0, ms(GRENADE.throwCooldownMs))
    expect(run(ws, Btn.Fire, 1)).toEqual(['pull'])
  })

  it('quả cuối: ô trống, sau autoSwitchBackMs tự đổi về súng trước đó', () => {
    wanted = 3; seq = 6000
    const ws = player(1)
    run(ws, 0, 1, 3)   // M16
    run(ws, 0, 1, GRENADE_SLOT)
    expect(ws.prevSlot).toBe(3)
    run(ws, Btn.Fire, pull); run(ws, 0, 1)
    expect(ws.ammo[GRENADE_ID]).toBe(0); expect(ws.slots[GRENADE_SLOT]).toBe(-1)
    run(ws, 0, ms(GRENADE.autoSwitchBackMs) + 2, GRENADE_SLOT)
    expect(ws.current).toBe(1); expect(ws.slot).toBe(3)
  })

  it('đổi súng khi đang rút chốt: huỷ, không mất quả', () => {
    wanted = 3; seq = 7000
    const ws = player(2)
    run(ws, 0, 1, GRENADE_SLOT)
    run(ws, Btn.Fire, ms(100))
    expect(ws.nade.phase).toBe('pulling')
    run(ws, Btn.Fire, 1, 3)   // bấm phím 4 (M16)
    expect(ws.current).toBe(1); expect(ws.nade.phase).toBe('idle'); expect(ws.ammo[GRENADE_ID]).toBe(2)
  })

  it('G: cầm + rút chốt luôn; giữ đủ rồi thả = ném mạnh, sau đó tự về súng trước', () => {
    wanted = 3; seq = 8000
    const ws = player(2)
    run(ws, 0, 1, 3)
    expect(run(ws, Btn.QuickNade, 1)).toEqual(['pull'])
    expect(ws.current).toBe(GRENADE_ID); expect(ws.nade.quick).toBe(true); expect(ws.prevSlot).toBe(3)
    run(ws, Btn.QuickNade, pull); expect(ws.nade.phase).toBe('ready')
    expect(run(ws, 0, 1)).toEqual(['threw'])
    run(ws, 0, ms(GRENADE.autoSwitchBackMs) + 2)
    expect(ws.current).toBe(1); expect(ws.ammo[GRENADE_ID]).toBe(1)   // còn 1 quả nhưng đã về súng
  })

  it('G thả sớm: huỷ, về súng cũ ngay, còn nguyên lựu đạn', () => {
    wanted = 3; seq = 9000
    const ws = player(2)
    run(ws, 0, 1, 3)
    run(ws, Btn.QuickNade, ms(100))
    expect(run(ws, 0, 1)).toEqual(['cancel'])
    run(ws, 0, 2)
    expect(ws.current).toBe(1); expect(ws.ammo[GRENADE_ID]).toBe(2)
  })

  it('không có lựu đạn: G và phím 5 không làm gì', () => {
    wanted = 3; seq = 10000
    const ws = player(0)
    run(ws, 0, 1, 3)
    expect(run(ws, Btn.QuickNade, 5)).toEqual([]); expect(ws.current).toBe(1)
    run(ws, 0, 1, GRENADE_SLOT); expect(ws.current).toBe(1)
  })

  it('tất định: hai bản chạy cùng dãy cmd cho state giống hệt (client dự đoán = server)', () => {
    wanted = 3; seq = 11000
    const a = player(2), b = player(2)
    const cmds: InputCmd[] = []
    for (let i = 0; i < 400; i++) cmds.push({ seq: seq++, buttons: (i % 90 < 30 ? Btn.Fire : 0) | (i % 130 > 100 ? Btn.Aim : 0), yaw: 0, pitch: 0, weapon: i > 5 ? GRENADE_SLOT : 3 })
    for (const c of cmds) { stepWeaponCmd(a, c); stepWeaponCmd(b, c); expect(JSON.stringify(a)).toBe(JSON.stringify(b)) }
  })
})
