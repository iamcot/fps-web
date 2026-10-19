import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { startHeartbeat } from './heartbeat'

const INTERVAL = 80
let cleanup: (() => void)[] = []
afterEach(() => { cleanup.forEach(f => f()); cleanup = [] })

function setup() {
  const wss = new WebSocketServer({ port: 0 })
  const stop = startHeartbeat(wss, INTERVAL)
  cleanup.push(() => { stop(); wss.close() })
  const port = (wss.address() as { port: number }).port
  const closed: number[] = []
  let n = 0
  wss.on('connection', ws => { const id = n++; ws.on('close', () => closed.push(id)) })
  const open = (opts?: object) => new Promise<WebSocket>(res => {
    const c = new WebSocket(`ws://localhost:${port}`, opts)
    cleanup.push(() => c.terminate())
    c.on('open', () => res(c))
  })
  return { open, closed }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('startHeartbeat', () => {
  it('ngắt kết nối không trả Pong (trong ≤ 2 chu kỳ)', async () => {
    const { open, closed } = setup()
    await open({ autoPong: false })     // client "chết": không trả Pong
    await wait(INTERVAL * 3.5)
    expect(closed).toEqual([0])
  })

  it('giữ kết nối còn trả Pong', async () => {
    const { open, closed } = setup()
    await open()
    await wait(INTERVAL * 5)
    expect(closed).toEqual([])
  })
})
