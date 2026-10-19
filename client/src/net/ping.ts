import { MsgType, type Transport } from '@fps/shared'

export interface PingStats {
  rttMs: number          // RTT của Pong gần nhất (0 = chưa có)
  outOfOrder: number     // số Pong đến sai thứ tự (phải luôn = 0)
}

// Gửi Ping mỗi giây, đo RTT. Pong echo lại clientTime (tăng dần) nên dùng nó làm seq.
export function startPing(transport: Transport, stats: PingStats): void {
  let lastEcho = -Infinity
  transport.onMessage(msg => {
    if (msg.t !== MsgType.Pong) return
    stats.rttMs = performance.now() - msg.clientTime
    if (msg.clientTime < lastEcho) {
      stats.outOfOrder++
      console.warn(`[net] Pong sai thứ tự: ${msg.clientTime} < ${lastEcho}`)
    }
    lastEcho = msg.clientTime
  })
  const send = () => transport.send({ t: MsgType.Ping, clientTime: performance.now() })
  send()
  setInterval(send, 1000)
}
