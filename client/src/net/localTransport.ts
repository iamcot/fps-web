import { encode, decode, type Transport } from '@fps/shared'
import { t } from '../i18n'

/** Transport nói chuyện với Web Worker offline qua postMessage; vẫn encode/decode msgpack như mạng thật. Không áp netsim (ping = 0). */
export function createLocalTransport(worker: Worker): Transport {
  const msgCbs: Parameters<Transport['onMessage']>[0][] = []
  const closeCbs: (() => void)[] = []
  worker.addEventListener('message', e => {
    const d = e.data
    if (!(d instanceof ArrayBuffer)) return   // tin điều khiển ('ready', 'error') xử lý ở nơi tạo worker
    try { const m = decode(d); for (const cb of msgCbs) cb(m) } catch { /* gói hỏng: bỏ qua */ }
  })
  window.addEventListener('pagehide', () => { for (const cb of closeCbs) cb(); worker.terminate() })
  return {
    send: msg => {
      const b = encode(msg).slice()
      worker.postMessage(b.buffer, [b.buffer])
    },
    onMessage: cb => { msgCbs.push(cb) },
    onClose: cb => { closeCbs.push(cb) },
  }
}

/** Mở worker offline và chờ nó nạp xong Rapier + lưới di chuyển. Reject nếu worker lỗi. */
export function startOfflineWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../../server/src/offline/worker.ts', import.meta.url), { type: 'module' })
    const timer = setTimeout(() => { worker.terminate(); reject(new Error(t('Offline worker failed to start'))) }, 20000)
    worker.addEventListener('message', function onMsg(e) {
      const d = e.data as { t?: string; message?: string }
      if (d?.t === 'ready') { clearTimeout(timer); worker.removeEventListener('message', onMsg); resolve(worker) }
      else if (d?.t === 'error') { clearTimeout(timer); worker.terminate(); reject(new Error(d.message ?? t('Offline worker error'))) }
    })
    worker.addEventListener('error', ev => { clearTimeout(timer); worker.terminate(); reject(new Error(ev.message || t('Offline worker error'))) })
    // Dev: sửa server/src/bots/bots.json → plugin trong vite.config.ts đẩy nội dung mới qua kênh HMR (không tải lại trang) → bot đổi cách chơi ngay
    if (import.meta.hot) {
      import.meta.hot.on('bots-json', (params: unknown) => {
        worker.postMessage({ t: 'bots', params })
        console.log('[bots] bots.json đã nạp lại, bot đổi cách chơi ngay')
      })
    }
  })
}
