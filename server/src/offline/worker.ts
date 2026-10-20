// Điểm vào của Web Worker offline (plan 15, B.0). Chạy đúng code Room/simulation của server Node, nói chuyện với trang qua postMessage
// (vẫn encode/decode msgpack như mạng thật). Trang tạo bằng: new Worker(new URL('.../offline/worker.ts', import.meta.url), { type: 'module' }).
import { decode, encode, loadMap, type AnyMsg, type MapFile, type Transport } from '@fps/shared'
import mapRaw from '../../../assets/maps/deathmatch.json'
import { setBotParams } from '../bots/params'
import { createOfflineHost } from './host'

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((e: { data: unknown }) => void) | null
}
const scope = globalThis as unknown as WorkerScope

const handlers: ((m: AnyMsg) => void)[] = []
const closers: (() => void)[] = []

const transport: Transport = {
  send(msg) {
    const buf = encode(msg).slice()   // bản gọn, sở hữu riêng để chuyển quyền (không copy lần nữa)
    scope.postMessage(buf.buffer, [buf.buffer])
  },
  onMessage(cb) { handlers.push(cb) },
  onClose(cb) { closers.push(cb) },
}

scope.onmessage = e => {
  const d = e.data
  if (d instanceof ArrayBuffer) {
    try { const m = decode(d); for (const h of handlers) h(m) } catch { /* gói hỏng: bỏ qua */ }
  } else if (d && typeof d === 'object') {
    const o = d as { t?: string; params?: unknown }
    if (o.t === 'bots') setBotParams(o.params)         // hot-reload bots.json (dev)
    else if (o.t === 'close') for (const c of closers) c()
  }
}

createOfflineHost(loadMap(mapRaw as unknown as MapFile)).then(host => {
  host.connect(transport)
  setInterval(() => host.pump(), 2)
  scope.postMessage({ t: 'ready' })
}).catch(err => scope.postMessage({ t: 'error', message: String(err?.message ?? err) }))
