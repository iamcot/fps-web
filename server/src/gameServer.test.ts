import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { WebSocket, WebSocketServer } from 'ws'
import { encode, decode, MsgType, type MapFile } from '@fps/shared'
import { createGameServer } from './gameServer'

// Lỗi cũ: world dựng nav bị dispose ngay sau buildNav → zombie Thủ Thành gọi findPath là ném lỗi mỗi tick, vòng lặp đứng, không zombie nào chạy
describe('server thật: Thủ Thành qua WebSocket', () => {
  it('zombie sinh ra, di chuyển và vòng lặp không ném lỗi', async () => {
    const map = JSON.parse(readFileSync(new URL('../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile
    const game = createGameServer({ maps: { deathmatch: map }, allowDebugCmds: true })
    const wss = new WebSocketServer({ port: 0 })
    game.attach(wss)
    await game.ready
    const errors: unknown[] = []
    const onErr = (e: unknown) => errors.push(e)
    process.on('uncaughtException', onErr)
    const ws = new WebSocket(`ws://127.0.0.1:${(wss.address() as { port: number }).port}`)
    ws.binaryType = 'arraybuffer'
    let zombieMoved = false
    const first = new Map<number, number>()
    ws.on('message', (d: ArrayBuffer) => {
      const m = decode(new Uint8Array(d))
      if (m.t !== MsgType.Snapshot) return
      for (const p of m.players) {
        if (p.ztype === undefined) continue
        const x0 = first.get(p.id)
        if (x0 === undefined) first.set(p.id, p.pos[0] + p.pos[2])
        else if (Math.abs(p.pos[0] + p.pos[2] - x0) > 1) zombieMoved = true
      }
    })
    await new Promise(r => ws.on('open', r))
    ws.send(encode({ t: MsgType.Join, name: 'a', room: 'r', create: true, options: { mode: 'defense', settings: { waves: 10, intermissionSec: 2, difficulty: 'normal' } } }))
    await new Promise(r => setTimeout(r, 500))
    ws.send(encode({ t: MsgType.DebugCmd, cmd: '/wave 1' }))
    for (let i = 0; i < 100 && !zombieMoved; i++) await new Promise(r => setTimeout(r, 100))
    process.off('uncaughtException', onErr)
    ws.close(); game.close(); wss.close()
    expect(errors).toEqual([])
    expect(first.size).toBeGreaterThan(0)
    expect(zombieMoved).toBe(true)
  }, 20000)
})
