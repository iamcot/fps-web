import { defineConfig } from 'vite'
import { resolve } from 'path'

// Trình duyệt nói chuyện với backend qua /ws của chính Vite (proxy → :8081): cùng một địa chỉ cho LAN và ngrok (https → wss)
const shared = {
  host: true,   // nghe mọi card mạng để máy khác trong LAN vào được (Vite in dòng Network)
  allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.ngrok-free.dev'],   // Vite chặn tên miền lạ
  proxy: { '/ws': { target: 'ws://localhost:8081', ws: true } },
}

export default defineConfig({
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
