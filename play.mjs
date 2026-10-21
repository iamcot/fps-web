// Chạy bản "chơi thật": server không watch + client đã build (vite preview, cổng 4173). Dùng: npm run play
import { spawn } from 'child_process'

const server = spawn('npm', ['-w', 'server', 'run', 'start'], { stdio: 'inherit' })
const client = spawn('npm', ['-w', 'client', 'run', 'preview'], { stdio: 'inherit' })

function cleanup() {
  server.kill()
  client.kill()
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
