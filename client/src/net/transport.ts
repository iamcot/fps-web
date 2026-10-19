import { encode, decode, withNetsim, type Transport } from '@fps/shared'

export function connectWebSocket(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const msgCbs: Parameters<Transport['onMessage']>[0][] = []
    const closeCbs: (() => void)[] = []
    ws.onmessage = e => {
      try { const m = decode(e.data as ArrayBuffer); for (const cb of msgCbs) cb(m) } catch { /* gói hỏng: bỏ qua */ }
    }
    ws.onclose = () => { for (const cb of closeCbs) cb() }
    ws.onerror = () => reject(new Error(`WebSocket lỗi: ${url}`))
    ws.onopen = () => resolve({
      send: msg => { if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg)) },
      onMessage: cb => { msgCbs.push(cb) },
      onClose: cb => { closeCbs.push(cb) },
    })
  })
}

// Netsim chỉ bật khi có ?lat= hoặc ?jit= trên URL (dev)
export function maybeNetsim(t: Transport, search = location.search): Transport {
  const q = new URLSearchParams(search)
  const latencyMs = Number(q.get('lat') ?? 0) || 0
  const jitterMs = Number(q.get('jit') ?? 0) || 0
  if (latencyMs <= 0 && jitterMs <= 0) return t
  console.log(`[netsim] lat=${latencyMs}ms/chiều jit=±${jitterMs}ms`)
  return withNetsim(t, { latencyMs, jitterMs })
}
