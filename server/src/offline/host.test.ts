import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { MsgType, TICK_RATE, loadMap, type AnyMsg, type InputCmd, type MapFile, type Transport } from '@fps/shared'
import { createOfflineHost } from './host'

const map = loadMap(JSON.parse(readFileSync(new URL('../../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)

function fakeClient() {
  const got: AnyMsg[] = []
  const handlers: ((m: AnyMsg) => void)[] = []
  const t: Transport = {
    send: m => { got.push(m) },
    onMessage: cb => { handlers.push(cb) },
    onClose: () => {},
  }
  return { t, got, send: (m: AnyMsg) => { for (const h of handlers) h(m) } }
}

async function setup() {
  let clock = 0
  const host = await createOfflineHost(map, () => clock)
  const c = fakeClient()
  host.connect(c.t)
  c.send({ t: MsgType.Join, name: 'Tester', room: 'offline', team: 'A', create: true })
  const adv = (ticks: number) => { for (let i = 0; i < ticks; i++) { clock += 1000 / TICK_RATE; host.pump() } }
  return { host, c, adv, cmdSeq: { n: 0 } }
}

describe('offline host (phòng Room chạy không cần server Node)', () => {
  it('Join → Welcome, OfflineState, hồi sinh, trận tự bắt đầu với 1 người', async () => {
    const { host, c, adv } = await setup()
    adv(60 * 4)
    expect(c.got.some(m => m.t === MsgType.Welcome)).toBe(true)
    expect(c.got.some(m => m.t === MsgType.OfflineState)).toBe(true)
    const ms = [...c.got].reverse().find(m => m.t === MsgType.MatchState)
    expect(ms && ms.t === MsgType.MatchState && ms.phase).toBe(2)   // Playing
    host.dispose()
  })

  it('thêm bot: phe địch, tên [BOT] ... + nhãn độ khó; giới hạn tổng số người', async () => {
    const { host, c, adv } = await setup()
    adv(30)
    for (let i = 0; i < 12; i++) c.send({ t: MsgType.OfflineCmd, cmd: 'addBot', difficulty: i % 2 ? 'hard' : 'medium' })
    adv(10)
    const st = [...c.got].reverse().find(m => m.t === MsgType.OfflineState)!
    expect(st.t === MsgType.OfflineState && st.bots.length).toBe(9)   // 10 chỗ − 1 người
    if (st.t === MsgType.OfflineState) {
      expect(st.bots.filter(b => b.team === 'B').length).toBe(5)
      expect(st.bots.filter(b => b.team === 'A').length).toBe(4)   // phe địch (B) 5, phe mình 4 sau khi đầy
      expect(new Set(st.bots.map(b => b.name)).size).toBe(st.bots.length)
      expect(st.bots.every(b => b.name.startsWith('[BOT] '))).toBe(true)
      expect(st.bots.some(b => b.name.endsWith('KHÓ'))).toBe(true)
    }
    host.dispose()
  })
})
