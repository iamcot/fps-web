import type { AnyMsg } from './protocol'

// Giao diện chung; client và server mỗi bên một bản cài đặt (WebSocket)
export interface Transport {
  send(msg: AnyMsg): void
  onMessage(cb: (msg: AnyMsg) => void): void   // cộng dồn, gọi mọi listener theo thứ tự đăng ký
  onClose(cb: () => void): void
}

export interface NetsimOptions {
  latencyMs: number            // trễ mỗi chiều
  jitterMs: number             // dao động ± quanh latencyMs
  now?: () => number           // inject để test
  random?: () => number
}

// Bọc ngoài Transport, trễ cả hai chiều. Giữ đúng thứ tự gói (như TCP):
// thời điểm giao của gói sau ≥ gói trước, theo từng chiều.
export function withNetsim(inner: Transport, opts: NetsimOptions): Transport {
  const now = opts.now ?? (() => performance.now())
  const random = opts.random ?? Math.random

  // Hàng đợi FIFO + một timer: setTimeout độ dài khác nhau không đảm bảo thứ tự khi nổ cùng ms
  function makeDelayer(deliver: (msg: AnyMsg) => void) {
    const queue: { due: number; msg: AnyMsg }[] = []
    let lastDue = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const drain = () => {
      timer = null
      while (queue.length > 0 && queue[0]!.due <= now()) deliver(queue.shift()!.msg)
      if (queue.length > 0) timer = setTimeout(drain, Math.max(0, queue[0]!.due - now()))
    }
    return (msg: AnyMsg) => {
      const t = now()
      const delay = Math.max(0, opts.latencyMs + (random() * 2 - 1) * opts.jitterMs)
      lastDue = Math.max(t + delay, lastDue)
      queue.push({ due: lastDue, msg })
      if (timer === null) timer = setTimeout(drain, Math.max(0, lastDue - t))
    }
  }

  const listeners: ((msg: AnyMsg) => void)[] = []
  const delayIn = makeDelayer(msg => { for (const l of listeners) l(msg) })
  const delayOut = makeDelayer(msg => inner.send(msg))
  inner.onMessage(delayIn)

  return {
    send: delayOut,
    onMessage(cb) { listeners.push(cb) },
    onClose(cb) { inner.onClose(cb) },
  }
}
