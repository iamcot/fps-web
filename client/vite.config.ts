import { defineConfig, type Plugin } from 'vite'
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
  proxy: { '/ws': { target: 'ws://localhost:8081', ws: true } },
}

export default defineConfig({
  plugins: [botsJsonHot()],
  server: shared,
  preview: shared,
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
