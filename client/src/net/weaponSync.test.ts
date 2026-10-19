import { describe, it, expect, beforeEach } from 'vitest'
import { Btn, makeWeaponState, stepWeaponCmd, type InputCmd } from '@fps/shared'
import { reconcileWeapon, weaponSyncStats } from './weaponSync'

const cmd = (seq: number, buttons: number, weapon = 0): InputCmd => ({ seq, buttons, yaw: 0, pitch: 0, weapon })

describe('reconcileWeapon', () => {
  beforeEach(() => { weaponSyncStats.checks = 0; weaponSyncStats.mismatches = 0 })

  it('client và server cùng chạy một dãy cmd: không lệch', () => {
    const client = makeWeaponState(), server = makeWeaponState()
    const cmds = Array.from({ length: 90 }, (_, i) => cmd(i, Btn.Fire))
    for (const c of cmds) stepWeaponCmd(client, c)
    for (const c of cmds.slice(0, 40)) stepWeaponCmd(server, c)   // server mới tới cmd 39
    const pending = cmds.slice(40).map(c => ({ cmd: c }))
    expect(reconcileWeapon(client, server, pending)).toBe(false)
    expect(weaponSyncStats.mismatches).toBe(0)
  })

  it('server từ chối một phát: client sửa ammo về theo server', () => {
    const client = makeWeaponState(), server = makeWeaponState()
    const cmds = Array.from({ length: 30 }, (_, i) => cmd(i, Btn.Fire))
    for (const c of cmds) stepWeaponCmd(client, c)
    // server chưa bắn phát nào ở cmd 0 vì giả sử đang reload
    server.reloadEndMs = 100
    server.ammo[0] = 20
    expect(reconcileWeapon(client, server, cmds.map(c => ({ cmd: c })))).toBe(true)
    expect(client.ammo[0]).toBeGreaterThan(20)   // reload của server xong ở 100ms rồi bắn tiếp
    expect(weaponSyncStats.mismatches).toBe(1)
  })
})
