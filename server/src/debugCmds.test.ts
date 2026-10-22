import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { MATCH, loadMap, weaponByKey, type MapFile, type Transport } from '@fps/shared'
import { RoomManager } from './room'
import { handleDebugCmd } from './debugCmds'

const map = loadMap(JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)

describe('/gun (bảng F9 chọn súng trong phòng)', () => {
  it('cầm súng chỉ định ngay, đạn đầy, đưa vào ô theo dòng; tên sai bị từ chối', () => {
    const rm = new RoomManager(map, () => 0, { ...MATCH, minPlayersToStart: 99 })
    const t: Transport = { send: () => {}, onMessage: () => {}, onClose: () => {} }
    const { player } = rm.join('r', 'a', t, 0, 'A')
    const room = rm.rooms.get('r')!
    expect(handleDebugCmd(room, player, '/gun nope')).toBe(false)
    expect(handleDebugCmd(room, player, '/gun ak47')).toBe(true)
    const ak = weaponByKey('ak47')!
    expect(player.weapon.current).toBe(ak.id)
    expect(player.weapon.slots).toContain(ak.id)
    expect(player.weapon.ammo[ak.id]).toBeGreaterThan(0)
    expect(player.loadout.slots.some(s => s?.key === 'ak47')).toBe(true)
  })
})
