import type { WebSocket, WebSocketServer } from 'ws'

// Kết nối chết mà không có close frame (đóng tab đột ngột, proxy/tunnel giữ socket, mạng rớt) thì
// server không bao giờ nhận 'close' nên người chơi ma ở lại phòng. Ping định kỳ: ai không trả
// Pong trước lần ping kế tiếp thì ngắt (→ 'close' → Room.leave).
export function startHeartbeat(wss: WebSocketServer, intervalMs = 5000): () => void {
  const alive = new WeakMap<WebSocket, boolean>()
  wss.on('connection', ws => {
    alive.set(ws, true)
    ws.on('pong', () => alive.set(ws, true))
  })
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue }
      alive.set(ws, false)
      ws.ping()
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
