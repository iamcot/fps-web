import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'
import { cacheControlOf, createStaticHandler, mimeOf, resolveSafe } from './staticServer'

describe('resolveSafe', () => {
  const root = join(tmpdir(), 'fps-game')
  it('chấp nhận đường dẫn nằm trong root', () => {
    expect(resolveSafe(root, '/')).toBe(root)
    expect(resolveSafe(root, '/models/a.glb')).toBe(join(root, 'models', 'a.glb'))
  })
  it.each(['/../x', '/a/../../x', '/%2e%2e/x', '/%2E%2E%2Fx', '/..%2f..%2fetc/passwd', '/a%5c..%5cx', '/a\\b', '/a%00b', '/%zz', 'models/a.glb'])('từ chối %s', p => {
    expect(resolveSafe(root, p)).toBeNull()
  })
})

describe('mime / cache', () => {
  it('MIME đúng', () => {
    expect(mimeOf('a.glb')).toBe('model/gltf-binary')
    expect(mimeOf('a.wasm')).toBe('application/wasm')
    expect(mimeOf('a.ogg')).toBe('audio/ogg')
    expect(mimeOf('a.unknown')).toBe('application/octet-stream')
  })
  it('Cache-Control theo thư mục', () => {
    expect(cacheControlOf('/assets/x.js')).toBe('public, max-age=31536000, immutable')
    expect(cacheControlOf('/models/x.glb')).toBe('public, max-age=604800')
    expect(cacheControlOf('/index.html')).toBe('no-cache')
    expect(cacheControlOf('/other.txt')).toBeNull()
  })
})

describe('createStaticHandler (HTTP thật)', () => {
  let dir: string, server: Server, base: string
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fps-static-'))
    const game = join(dir, 'game')
    mkdirSync(join(game, 'models'), { recursive: true })
    writeFileSync(join(game, 'index.html'), '<html>game</html>')
    writeFileSync(join(game, 'models', 'a.glb'), 'glb')
    writeFileSync(join(dir, 'secret.txt'), 'bí mật')
    server = createServer(createStaticHandler(game))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }) })

  const get = (path: string, init?: RequestInit) => fetch(base + path, init)
  // fetch chuẩn hoá `..` trước khi gửi → dùng socket thô cho các đường dẫn đi ngược
  const raw = (path: string) => new Promise<string>((resolve, reject) => {
    import('net').then(({ connect }) => {
      const s = connect((server.address() as AddressInfo).port, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`))
      let out = ''
      s.on('data', d => { out += d }); s.on('end', () => resolve(out)); s.on('error', reject)
    })
  })

  it('phục vụ file với MIME và cache đúng', async () => {
    const r = await get('/models/a.glb')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('model/gltf-binary')
    expect(r.headers.get('cache-control')).toBe('public, max-age=604800')
    expect(await r.text()).toBe('glb')
  })
  it('đường dẫn không đuôi → index.html (SPA); có đuôi mà không có → 404', async () => {
    expect(await (await get('/phong/abc')).text()).toBe('<html>game</html>')
    expect((await get('/nope.js')).status).toBe(404)
    expect((await get('/')).headers.get('cache-control')).toBe('no-cache')
  })
  it('ETag → 304', async () => {
    const etag = (await get('/models/a.glb')).headers.get('etag')!
    expect((await get('/models/a.glb', { headers: { 'If-None-Match': etag } })).status).toBe(304)
  })
  it('chặn đi ngược thư mục kể cả mã hoá', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/models/..%2f..%2fsecret.txt', '/%2e%2e%5csecret.txt']) {
      const res = await raw(p)
      expect(res.startsWith('HTTP/1.1 400'), p).toBe(true)
      expect(res).not.toContain('bí mật')
    }
  })
  it('chỉ nhận GET/HEAD', async () => {
    expect((await get('/', { method: 'POST' })).status).toBe(405)
  })
})
