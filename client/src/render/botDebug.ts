// F11: vẽ lưới di chuyển (node xanh, node núp vàng có gạch chỉ hướng tường, cạnh mảnh) và từng bot:
// tên + độ khó + trạng thái, đường đi (đỏ), hướng nhìn thật (xanh), điểm định nhắm (đỏ) — thấy rõ độ lệch (plan 15, B.1/B.8).
import * as THREE from 'three'
import type { BotDebugMsg, NavDebugMsg, OfflineBotInfo } from '@fps/shared'

const DIRS8: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]].map(([x, z]) => {
  const l = Math.hypot(x!, z!); return [x! / l, z! / l] as const
})

interface BotVis { group: THREE.Group; path: THREE.Line; look: THREE.Line; want: THREE.Line; label: THREE.Sprite; labelText: string }

function makeLabel(text: string): { sprite: THREE.Sprite; update(t: string): void } {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64
  const tex = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sprite.scale.set(2.4, 0.6, 1); sprite.renderOrder = 999
  const update = (t: string) => {
    const g = canvas.getContext('2d')!
    g.clearRect(0, 0, 256, 64); g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(0, 0, 256, 64)
    g.fillStyle = '#fff'; g.font = 'bold 22px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 128, 32)
    tex.needsUpdate = true
  }
  update(text)
  return { sprite, update }
}

export function createBotDebug(scene: THREE.Scene, send: (on: boolean) => void) {
  const root = new THREE.Group()
  root.visible = false
  scene.add(root)
  let navBuilt = false
  let on = false
  const bots = new Map<number, BotVis & { setLabel(t: string): void }>()
  const info = new Map<number, OfflineBotInfo>()

  function buildNav(m: NavDebugMsg): void {
    if (navBuilt) return
    navBuilt = true
    const n = m.nodes.length / 4
    const pts = new Float32Array(n * 3), ptsCover: number[] = [], coverLines: number[] = []
    for (let i = 0; i < n; i++) {
      const x = m.nodes[i * 4]!, y = m.nodes[i * 4 + 1]! + 0.05, z = m.nodes[i * 4 + 2]!, mask = m.nodes[i * 4 + 3]!
      pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z
      if (mask) {
        ptsCover.push(x, y + 0.02, z)
        for (let k = 0; k < 8; k++) if (mask & (1 << k)) coverLines.push(x, y + 0.02, z, x + DIRS8[k]![0] * 0.45, y + 0.02, z + DIRS8[k]![1] * 0.45)
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    root.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x33ff66, size: 0.12, depthTest: false, transparent: true })))
    const gc = new THREE.BufferGeometry(); gc.setAttribute('position', new THREE.Float32BufferAttribute(ptsCover, 3))
    root.add(new THREE.Points(gc, new THREE.PointsMaterial({ color: 0xffd23c, size: 0.2, depthTest: false, transparent: true })))
    const gl = new THREE.BufferGeometry(); gl.setAttribute('position', new THREE.Float32BufferAttribute(coverLines, 3))
    root.add(new THREE.LineSegments(gl, new THREE.LineBasicMaterial({ color: 0xffd23c })))
    const e: number[] = []
    for (let i = 0; i < m.edges.length; i += 2) {
      const a = m.edges[i]!, b = m.edges[i + 1]!
      e.push(pts[a * 3]!, pts[a * 3 + 1]!, pts[a * 3 + 2]!, pts[b * 3]!, pts[b * 3 + 1]!, pts[b * 3 + 2]!)
    }
    const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute(e, 3))
    root.add(new THREE.LineSegments(ge, new THREE.LineBasicMaterial({ color: 0x4488aa, transparent: true, opacity: 0.35 })))
  }

  const line = (color: number) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color, depthTest: false }))
    l.frustumCulled = false; l.renderOrder = 998
    return l
  }
  const setLine = (l: THREE.Line, pts: readonly (readonly [number, number, number])[]) => {
    l.visible = pts.length >= 2
    if (!l.visible) return
    l.geometry.setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])))
  }

  function bot(id: number) {
    let v = bots.get(id)
    if (!v) {
      const group = new THREE.Group()
      const path = line(0xff3333), look = line(0x3399ff), want = line(0xff3333)
      const lb = makeLabel('')
      group.add(path, look, want, lb.sprite)
      root.add(group)
      v = { group, path, look, want, label: lb.sprite, labelText: '', setLabel: t => { if (t !== v!.labelText) { v!.labelText = t; lb.update(t) } } }
      bots.set(id, v)
    }
    return v
  }

  return {
    get on(): boolean { return on },
    toggle(): void {
      on = !on
      root.visible = on
      send(on)
    },
    setBots(list: readonly OfflineBotInfo[]): void {
      info.clear(); for (const b of list) info.set(b.id, b)
      for (const [id, v] of bots) if (!info.has(id)) { root.remove(v.group); bots.delete(id) }
    },
    onNav(m: NavDebugMsg): void { buildNav(m) },
    onBots(m: BotDebugMsg): void {
      if (!on) return
      const seen = new Set<number>()
      for (const b of m.bots) {
        seen.add(b.id)
        const v = bot(b.id)
        v.group.visible = true
        setLine(v.path, b.path.length ? [b.eye, ...b.path] : [])
        setLine(v.look, [b.eye, b.look])
        setLine(v.want, b.want ? [b.eye, b.want] : [])
        const bi = info.get(b.id)
        v.label.position.set(b.eye[0], b.eye[1] + 0.9, b.eye[2])
        v.setLabel(`${bi ? bi.name.replace(/^\[BOT\]\s*/, '') : '#' + b.id} · ${b.state}`)
      }
      for (const [id, v] of bots) if (!seen.has(id)) v.group.visible = false
    },
  }
}
