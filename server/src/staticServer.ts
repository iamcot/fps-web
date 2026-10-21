import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname, join, resolve, sep } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'
const CACHE_WEEK = 'public, max-age=604800'

export function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export function cacheControlOf(urlPath: string): string | null {
  if (urlPath.startsWith('/assets/')) return CACHE_IMMUTABLE
  if (/^\/(models|sounds|icons|maps)\//.test(urlPath)) return CACHE_WEEK
  if (urlPath === '/' || urlPath.endsWith('/index.html')) return 'no-cache'
  return null
}

/**
 * Đổi đường dẫn URL thành đường dẫn file nằm TRONG `root`; null nếu có dấu hiệu đi ngược thư mục.
 * Từ chối: mã hoá hỏng, ký tự NUL, dấu `\`, đoạn `..`, và kết quả nằm ngoài `root` (kể cả sau khi giải mã %2e%2e).
 */
export function resolveSafe(root: string, rawPath: string): string | null {
  let p: string
  try { p = decodeURIComponent(rawPath) } catch { return null }
  if (p.includes('\0') || p.includes('\\') || !p.startsWith('/')) return null
  if (p.split('/').some(seg => seg === '..')) return null
  const abs = resolve(join(root, p))
  const base = resolve(root)
  if (abs !== base && !abs.startsWith(base + sep)) return null
  return abs
}

function send(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

/** Handler HTTP phục vụ file tĩnh từ `root` (thư mục `game/`), có SPA fallback về index.html. */
export function createStaticHandler(root: string): (req: IncomingMessage, res: ServerResponse) => void {
  const base = resolve(root)

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return send(res, 405, 'Method Not Allowed') }
    const urlPath = (req.url ?? '/').split('?')[0]!.split('#')[0]!
    let file = resolveSafe(base, urlPath)
    if (!file) return send(res, 400, 'Bad Request')
    let cachePath = urlPath
    let st = await stat(file).catch(() => null)
    if (st?.isDirectory()) { file = join(file, 'index.html'); cachePath = '/index.html'; st = await stat(file).catch(() => null) }
    if (!st) {
      // Không có file và không có đuôi → route của SPA; có đuôi → thật sự 404
      if (extname(urlPath)) return send(res, 404, 'Not Found')
      file = join(base, 'index.html'); cachePath = '/index.html'
      st = await stat(file).catch(() => null)
      if (!st) return send(res, 404, 'Not Found')
    }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
    const headers: Record<string, string | number> = {
      'Content-Type': mimeOf(file),
      'ETag': etag,
      'Last-Modified': st.mtime.toUTCString(),
    }
    const cc = cacheControlOf(cachePath)
    if (cc) headers['Cache-Control'] = cc
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return }
    headers['Content-Length'] = st.size
    res.writeHead(200, headers)
    if (req.method === 'HEAD') { res.end(); return }
    const stream = createReadStream(file)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  return (req, res) => { serve(req, res).catch(() => { if (!res.headersSent) send(res, 500, 'Internal Server Error'); else res.destroy() }) }
}
