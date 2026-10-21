// Đóng gói "nhấp đúp là chạy" cho nền tảng đang chạy script (K.3): npm run package
// → release/FPSWeb-<os>-<arch>.zip (Node Single Executable Application)
//
// Biến môi trường (dùng cho CI khi build chéo, ví dụ bản Mac Intel trên runner chip M):
//   FPS_NODE_BINARY  file `node` dùng làm vỏ (phải CÙNG phiên bản Node đang chạy script)
//   FPS_TARGET       tên bản phát hành, ví dụ macos-x64 (bắt buộc khi đặt FPS_NODE_BINARY)
import { spawnSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCredits, creditsText } from './credits.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const win = process.platform === 'win32'
const mac = process.platform === 'darwin'
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const nodeBinary = process.env.FPS_NODE_BINARY ? resolve(process.env.FPS_NODE_BINARY) : process.execPath
if (process.env.FPS_NODE_BINARY && !process.env.FPS_TARGET) fail('Đặt FPS_NODE_BINARY thì phải đặt cả FPS_TARGET (ví dụ macos-x64).')
const target = process.env.FPS_TARGET ?? `${win ? 'windows' : mac ? 'macos' : process.platform}-${process.arch}`
const targetIsWin = target.startsWith('windows')
const targetIsMac = target.startsWith('macos')

const exeName = targetIsWin ? 'FPSWeb.exe' : 'FPSWeb'
const outDir = join(root, 'release', 'FPSWeb')
const exe = join(outDir, exeName)
const zipName = `FPSWeb-${target}.zip`
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function fail(msg) {
  console.error('\nLỖI đóng gói: ' + msg)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: win && cmd === 'npm', ...opts })
  if (r.status !== 0) fail(`lệnh thất bại (mã ${r.status}): ${cmd} ${args.join(' ')}`)
}

function step(n, text) { console.log(`\n[${n}] ${text}`) }

// ── Kiểm tra trước khi tốn thời gian build ────────────────────────────────────
const nodeVer = spawnSync(nodeBinary, ['--version'], { encoding: 'utf8' }).stdout?.trim()
if (nodeVer !== process.version) fail(`file node dùng làm vỏ là ${nodeVer}, khác bản đang chạy script (${process.version}). Blob SEA phải tạo và tiêm bằng cùng một phiên bản Node.`)
try {
  const want = readFileSync(join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
  if (process.version.replace(/^v/, '') !== want) console.warn(`Cảnh báo: .nvmrc ghi Node ${want} nhưng đang chạy ${process.version}.`)
} catch { /* không có .nvmrc */ }

step('K.6', 'Kiểm tra ghi công asset')
const credits = checkCredits(root)
if (credits.missing.length) fail('asset trong client/public chưa khai báo ở assets/CREDITS.json:\n  - ' + credits.missing.join('\n  - '))
if (credits.stale.length) console.warn('Cảnh báo: CREDITS.json có file không còn trong client/public:\n  - ' + credits.stale.join('\n  - '))
if (credits.unverified.length) console.warn(`Cảnh báo: ${credits.unverified.length} asset chưa xác minh tác giả/giấy phép (xem assets/CREDITS.json). Hãy kiểm tra trước khi phát hành cho người ngoài.`)

step(1, 'Build client')
run('npm', ['run', 'build', '-w', 'client'])
step(2, 'Gom server thành build/server.cjs')
run(process.execPath, ['scripts/bundle-server.mjs'])

step(3, 'Ghi build/sea-config.json')
const blob = join(root, 'build', 'sea-prep.blob')
writeFileSync(join(root, 'build', 'sea-config.json'), JSON.stringify({
  main: 'build/server.cjs',
  output: 'build/sea-prep.blob',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2))

step(4, 'Tạo blob SEA')
run(process.execPath, ['--experimental-sea-config', 'build/sea-config.json'])

step(5, `Copy node → ${exeName}`)
rmSync(join(root, 'release'), { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
copyFileSync(nodeBinary, exe)
chmodSync(exe, 0o755)

if (targetIsMac) { step(6, 'Gỡ chữ ký gốc của node (Mac)'); run('codesign', ['--remove-signature', exe]) }

step(7, 'Tiêm blob bằng postject')
const postject = join(root, 'node_modules', 'postject', 'dist', 'cli.js')
if (!existsSync(postject)) fail('thiếu node_modules/postject, chạy npm ci trước.')
run(process.execPath, [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SENTINEL, ...(targetIsMac ? ['--macho-segment-name', 'NODE_SEA'] : [])])

if (targetIsMac) { step(8, 'Ký ad-hoc (bắt buộc trên Mac chip M)'); run('codesign', ['--sign', '-', exe]) }

step(9, 'Copy game/, config.json, HUONG-DAN.txt, CREDITS.txt')
cpSync(join(root, 'client', 'dist'), join(outDir, 'game'), { recursive: true })
copyFileSync(join(root, 'packaging', 'config.json'), join(outDir, 'config.json'))
const eol = text => (targetIsWin ? text.replace(/\r?\n/g, '\r\n') : text)
writeFileSync(join(outDir, 'HUONG-DAN.txt'), eol(readFileSync(join(root, 'packaging', 'HUONG-DAN.txt'), 'utf8').replaceAll('{version}', version)))
writeFileSync(join(outDir, 'CREDITS.txt'), eol(creditsText(credits.entries, version)))

// Chạy thử file vừa tạo (từ thư mục khác) trước khi nén: bắt lỗi SEA/ký số sớm
step('✔', 'Chạy thử file vừa đóng gói')
await new Promise(res => {
  const child = spawn(exe, ['--no-open', '--port', '18080'], { cwd: join(root, 'release'), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  const timer = setTimeout(() => { child.kill(); fail('file chạy không báo "đang chạy" sau 30 giây:\n' + out) }, 30_000)
  const onData = d => {
    out += d
    if (out.includes('đang chạy')) { clearTimeout(timer); child.kill(); res() }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', code => { if (!out.includes('đang chạy')) { clearTimeout(timer); fail(`file chạy thoát sớm (mã ${code}):\n${out}`) } })
})

step(10, `Nén ${zipName}`)
const zip = join(root, 'release', zipName)
if (mac) run('ditto', ['-c', '-k', '--keepParent', 'FPSWeb', zipName], { cwd: join(root, 'release') })
else if (win) run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path 'FPSWeb' -DestinationPath '${zipName}' -Force`], { cwd: join(root, 'release'), shell: false })
else run('zip', ['-r', '-y', '-q', zipName, 'FPSWeb'], { cwd: join(root, 'release') })
console.log(`\nXong: ${zip}`)
