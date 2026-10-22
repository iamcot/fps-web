// Lớp phủ trong thế giới cho các thể thức zombie (plan 17 T.7): thanh máu nhỏ trên đầu zombie vừa bị bắn, nhãn loại cho brute/screamer/boss,
// số damage nổi, dấu thập đỏ người gục, vòng đỏ báo trước chiêu boss. Sprite/texture dùng lại (cache theo mức máu), không cấp phát theo frame.
import * as THREE from 'three'
import { DEFENSE, ZOMBIE_TYPES, type TelegraphMsg } from '@fps/shared'
import { t } from '../i18n'

const BAR_SHOW_MS = 3000
const ALWAYS_NAME = new Set(['brute', 'screamer', 'boss'])
const NAME_COLOR: Record<string, string> = { mother: '#9be07a', brute: '#e8956a', screamer: '#f0e070', boss: '#ff5050' }
const STEPS = 20

interface Overlay { sprite: THREE.Sprite; key: string }
export interface OverlayPlayer { id: number; pos: [number, number, number]; flags: number; hp: number; hpMax: number; ztype?: string; zscale?: number; downLeft?: number; reviveP?: number }

const texCache = new Map<string, THREE.CanvasTexture>()
function cached(key: string, draw: (g: CanvasRenderingContext2D, c: HTMLCanvasElement) => void, w: number, h: number): THREE.CanvasTexture {
  let t = texCache.get(key)
  if (!t) {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    draw(c.getContext('2d')!, c)
    t = new THREE.CanvasTexture(c)
    texCache.set(key, t)
  }
  return t
}

function barTexture(type: string, step: number, withName: boolean): THREE.CanvasTexture {
  return cached(`bar|${type}|${step}|${withName}`, g => {
    const W = 128, H = 28
    if (withName) {
      g.font = 'bold 16px monospace'; g.textAlign = 'center'; g.textBaseline = 'top'
      const name = type === 'mother' ? t('Mother zombie') : t(ZOMBIE_TYPES[type]?.name ?? type)
      g.lineWidth = 4; g.strokeStyle = '#000'; g.strokeText(name, W / 2, 0)
      g.fillStyle = NAME_COLOR[type] ?? '#fff'; g.fillText(name, W / 2, 0)
    }
    g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(8, 19, W - 16, 8)
    g.fillStyle = step > STEPS * 0.5 ? '#c93a2c' : step > STEPS * 0.25 ? '#d98a2a' : '#e8d030'
    g.fillRect(9, 20, Math.max(0, (W - 18) * step / STEPS), 6)
  }, 128, 28)
}

function crossTexture(step: number, rev: number): THREE.CanvasTexture {
  return cached(`cross|${step}|${rev}`, g => {
    g.translate(32, 32)
    g.lineWidth = 6
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.arc(0, 0, 27, 0, Math.PI * 2); g.stroke()
    g.strokeStyle = '#ff3b3b'; g.beginPath(); g.arc(0, 0, 27, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * step / STEPS); g.stroke()   // thời gian còn lại
    g.fillStyle = '#ff3b3b'; g.fillRect(-5, -16, 10, 32); g.fillRect(-16, -5, 32, 10)
    if (rev > 0) { g.fillStyle = '#6fe06f'; g.fillRect(-26, 30, 52 * rev / STEPS, 5) }   // tiến độ cứu
  }, 64, 40 + 24)
}

function numberTexture(text: string, color: string): THREE.CanvasTexture {
  return cached(`num|${text}|${color}`, g => {
    g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 64, 24)
    g.fillStyle = color; g.fillText(text, 64, 24)
  }, 128, 48)
}

interface Floater { sprite: THREE.Sprite; age: number; life: number; vy: number }
interface Ring { mesh: THREE.Mesh; endsAtLocal: number; startedLocal: number; kind: TelegraphMsg['kind'] }

export function createZombieOverlay(scene: THREE.Scene) {
  const bars = new Map<number, Overlay>()
  const crosses = new Map<number, Overlay>()
  const hitAt = new Map<number, number>()
  const floaters: Floater[] = []
  const rings: Ring[] = []
  const lastHp = new Map<number, number>()

  const mkSprite = (w: number, h: number): THREE.Sprite => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, fog: false }))
    s.scale.set(w, h, 1)
    s.renderOrder = 12
    scene.add(s)
    return s
  }
  const drop = (m: Map<number, Overlay>, id: number): void => { const o = m.get(id); if (o) { scene.remove(o.sprite); o.sprite.material.dispose(); m.delete(id) } }

  const ringGeo = new THREE.RingGeometry(0.0, 1, 48)
  const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)

  return {
    /** HitConfirm: zombie này vừa bị bắn → hiện thanh máu 3s */
    onHit(id: number): void { hitAt.set(id, performance.now()) },
    /** Số damage nổi tại `pos` */
    floatDamage(pos: [number, number, number], dmg: number, headshot: boolean): void {
      const s = floaters.find(f => f.age >= f.life) ?? null
      let f = s
      if (!f) {
        if (floaters.length >= 24) return
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, fog: false }))
        sprite.renderOrder = 13
        scene.add(sprite)
        f = { sprite, age: 99, life: 0, vy: 0 }
        floaters.push(f)
      }
      f.sprite.material.map = numberTexture(String(dmg), headshot ? '#ffd23c' : '#ffffff')
      f.sprite.material.needsUpdate = true
      f.sprite.scale.set(headshot ? 0.9 : 0.7, headshot ? 0.34 : 0.26, 1)
      f.sprite.position.set(pos[0] + (Math.random() - 0.5) * 0.4, pos[1], pos[2] + (Math.random() - 0.5) * 0.4)
      f.sprite.visible = true
      f.age = 0; f.life = 0.8; f.vy = 1.4
    },
    /** Báo trước chiêu boss; `serverToLocal` đổi serverTime → performance.now() */
    telegraph(msg: TelegraphMsg, serverToLocal: (t: number) => number): void {
      const endsAtLocal = serverToLocal(msg.endsAt), now = performance.now()
      const color = msg.kind === 'slam' ? 0xff2a2a : msg.kind === 'charge' ? 0xff7a1a : 0xa04cff
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, fog: false })
      let mesh: THREE.Mesh
      if (msg.kind === 'charge' && msg.dir) {
        mesh = new THREE.Mesh(flatGeo, mat)   // hình chữ nhật nằm phẳng, trục dài = z cục bộ
        const len = msg.radius
        mesh.scale.set(2.2, 1, len)
        mesh.rotation.y = Math.atan2(-msg.dir[0], -msg.dir[2])
        mesh.position.set(msg.pos[0] + msg.dir[0] * len / 2, msg.pos[1] + 0.06, msg.pos[2] + msg.dir[2] * len / 2)
      } else {
        mesh = new THREE.Mesh(ringGeo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.scale.set(msg.radius, msg.radius, 1)
        mesh.position.set(msg.pos[0], msg.pos[1] + 0.06, msg.pos[2])
      }
      mesh.renderOrder = 5
      scene.add(mesh)
      rings.push({ mesh, endsAtLocal, startedLocal: now, kind: msg.kind })
    },
    update(dt: number, players: readonly OverlayPlayer[], selfId: number, camera: THREE.Camera): void {
      const now = performance.now()
      const seen = new Set<number>()
      for (const p of players) {
        if (p.id === selfId) continue
        const dead = (p.flags & 8) !== 0   // NetFlag.Dead
        // ── thanh máu / nhãn zombie
        if (p.hpMax > 0 && p.ztype && !dead) {   // mọi zombie luôn hiện máu trên đầu (Lây Nhiễm: mẹ/thường; Thủ Thành: theo loại)
          const prev = lastHp.get(p.id)
          if (prev !== undefined && p.hp < prev) hitAt.set(p.id, now)
          lastHp.set(p.id, p.hp)
          const showName = ALWAYS_NAME.has(p.ztype) || p.ztype === 'mother'
          const far = Math.hypot(p.pos[0] - camera.position.x, p.pos[2] - camera.position.z) > 45
          if (!far) {
            const step = Math.max(0, Math.min(STEPS, Math.ceil(STEPS * p.hp / p.hpMax)))
            let o = bars.get(p.id)
            if (!o) { o = { sprite: mkSprite(1.1, 0.24), key: '' }; bars.set(p.id, o) }
            const key = `${p.ztype}|${step}|${showName}`
            if (o.key !== key) { o.key = key; o.sprite.material.map = barTexture(p.ztype, step, showName); o.sprite.material.needsUpdate = true }
            const h = (p.zscale ?? 1) * 1.95 + 0.35
            o.sprite.position.set(p.pos[0], p.pos[1] + h, p.pos[2])
            o.sprite.scale.set(1.1 * Math.max(1, (p.zscale ?? 1) * 0.8), 0.24 * Math.max(1, (p.zscale ?? 1) * 0.8), 1)
            seen.add(p.id)
          }
        }
        // ── dấu thập đỏ người gục (xuyên tường)
        if ((p.flags & 512) !== 0 && !dead) {   // NetFlag.Downed
          const step = Math.max(0, Math.min(STEPS, Math.ceil(STEPS * (p.downLeft ?? 0) / DEFENSE.down.dieAfterMs)))
          const rev = Math.round(STEPS * (p.reviveP ?? 0))
          let o = crosses.get(p.id)
          if (!o) { o = { sprite: mkSprite(0.6, 0.6 * 64 / 40), key: '' }; crosses.set(p.id, o) }
          const key = `${step}|${rev}`
          if (o.key !== key) { o.key = key; o.sprite.material.map = crossTexture(step, rev); o.sprite.material.needsUpdate = true }
          o.sprite.position.set(p.pos[0], p.pos[1] + 1.1, p.pos[2])
          seen.add(-p.id - 1)
        }
      }
      for (const id of [...bars.keys()]) if (!seen.has(id)) drop(bars, id)
      for (const id of [...crosses.keys()]) if (!seen.has(-id - 1)) drop(crosses, id)
      for (const id of [...hitAt.keys()]) if (now - hitAt.get(id)! > 10_000) { hitAt.delete(id); lastHp.delete(id) }
      // số damage
      for (const f of floaters) {
        if (f.age >= f.life) { f.sprite.visible = false; continue }
        f.age += dt
        f.sprite.position.y += f.vy * dt
        f.sprite.material.opacity = Math.max(0, 1 - f.age / f.life)
      }
      // vòng báo trước: nhấp nháy mạnh dần, hết giờ thì xoá
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]!
        const left = r.endsAtLocal - now
        if (left < -150) { scene.remove(r.mesh); (r.mesh.material as THREE.Material).dispose(); rings.splice(i, 1); continue }
        const k = Math.min(1, Math.max(0, (now - r.startedLocal) / Math.max(1, r.endsAtLocal - r.startedLocal)))
        ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = left < 0 ? 0.7 : 0.18 + 0.3 * k + 0.12 * Math.sin(now / 60)
      }
    },
    clear(): void {
      for (const id of [...bars.keys()]) drop(bars, id)
      for (const id of [...crosses.keys()]) drop(crosses, id)
      for (const f of floaters) f.sprite.visible = false
      for (const r of rings) { scene.remove(r.mesh); (r.mesh.material as THREE.Material).dispose() }
      rings.length = 0
    },
  }
}
