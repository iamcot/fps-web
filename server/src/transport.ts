import type { WebSocket, RawData } from 'ws'
import { encode, decode, type Transport } from '@fps/shared'

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return data
}

export function wrapWebSocket(ws: WebSocket): Transport {
  ws.binaryType = 'arraybuffer'
  return {
    send(msg) {
      if (ws.readyState === ws.OPEN) ws.send(encode(msg))
    },
    onMessage(cb) {
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return
        try { cb(decode(toBytes(data))) } catch { /* gói hỏng: bỏ qua */ }
      })
    },
    onClose(cb) { ws.on('close', cb) },
  }
}
