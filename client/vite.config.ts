import { defineConfig, type Plugin, type PreviewServer } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// Sửa bots.json lúc đang chơi offline: gửi nội dung mới tới trang qua HMR rồi chặn tải lại trang (worker offline giữ nguyên trận)
const botsJsonHot = (): Plugin => ({
  name: 'bots-json-hot',
  handleHotUpdate({ file, server }) {
    if (!file.replace(/\\/g, '/').endsWith('/server/src/bots/bots.json')) return
    try { server.ws.send({ type: 'custom', event: 'bots-json', data: JSON.parse(readFileSync(file, 'utf8')) }) } catch { /* JSON đang sửa dở: bỏ qua */ }
    return []
  },
})

// Trình duyệt nói chuyện với backend qua /ws của chính Vite (proxy → :8081): cùng một địa chỉ cho LAN và ngrok (https → wss)
const shared = {
  host: true,   // nghe mọi card mạng để máy khác trong LAN vào được (Vite in dòng Network)
  allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.ngrok-free.dev'],   // Vite chặn tên miền lạ
  proxy: { '/ws': { target: `ws://localhost:${process.env.FPS_PORT ?? 8081}`, ws: true } },
}

// `vite preview` (sirv) có thể ghi đè header, nên bọc res.writeHead để chèn Cache-Control ngay trước lúc gửi phản hồi.
// /assets/ (tên file có hash) cache 1 năm; model/âm thanh/icon cache 7 ngày; index.html không đặt (luôn kiểm tra lại).
const previewCache = (): Plugin => ({
  name: 'preview-cache-control',
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0]!
      const value = url.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
        : /^\/(models|sounds|icons)\//.test(url) ? 'public, max-age=604800' : null
      if (value) {
        const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => typeof res
        res.writeHead = ((...args: unknown[]) => {
          // sirv truyền header qua đối số của writeHead (đè setHeader): ghi đè Cache-Control ở cả hai nơi
          const h = args.find(x => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown> | undefined
          if (h) { for (const k of Object.keys(h)) if (k.toLowerCase() === 'cache-control') delete h[k]; h['Cache-Control'] = value }
          res.setHeader('Cache-Control', value)
          return writeHead(...args)
        }) as typeof res.writeHead
      }
      next()
    })
  },
})

export default defineConfig({
  plugins: [botsJsonHot(), previewCache()],
  server: shared,
  preview: { ...shared, port: 4173 },
  optimizeDeps: {
    entries: ['index.html'],
  },
  resolve: {
    alias: {
      '@fps/shared/physics/world': resolve(__dirname, '../shared/src/physics/world.ts'),
      '@fps/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@assets': resolve(__dirname, '../assets'),
    },
  },
})
