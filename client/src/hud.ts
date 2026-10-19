import * as THREE from 'three'
import { createBottomHud, type BottomHud } from './hudBottom'

// ── Hitmarker ─────────────────────────────────────────────────────────────────
function buildHitmarker() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'width:24px;height:24px;pointer-events:none;display:none;z-index:15'

  for (const angle of [45, -45]) {
    const line = document.createElement('div')
    line.style.cssText =
      `position:absolute;width:18px;height:2px;top:calc(50% - 1px);left:calc(50% - 9px);` +
      `transform:rotate(${angle}deg);background:#fff`
    el.appendChild(line)
  }
  document.body.appendChild(el)

  let _timer = 0
  return {
    el,
    show(headshot: boolean) {
      const color = headshot ? '#f55' : '#fff'
      for (const c of el.children) {
        (c as HTMLElement).style.background = color
      }
      el.style.display = 'block'
      _timer = 150
    },
    tick(ms: number) {
      if (_timer <= 0) return
      _timer -= ms
      if (_timer <= 0) el.style.display = 'none'
    },
  }
}

// ── Bullet holes ──────────────────────────────────────────────────────────────
const BH_MAT    = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })
const BH_GEO    = new THREE.CircleGeometry(0.05, 12)   // 10cm radius
const MAX_HOLES = 50

function buildBulletHoles(scene: THREE.Scene) {
  const holes: THREE.Mesh[] = []

  return {
    add(hitPos: [number, number, number], normal: [number, number, number]) {
      const mesh = new THREE.Mesh(BH_GEO, BH_MAT)
      const OFFSET = 0.005

      // Đẩy nhẹ theo normal để tránh z-fighting
      mesh.position.set(
        hitPos[0] + normal[0] * OFFSET,
        hitPos[1] + normal[1] * OFFSET,
        hitPos[2] + normal[2] * OFFSET,
      )
      // lookAt(hitPos - normal): -Z nhìn vào tường → front face (+Z) quay ra ngoài về phía player
      mesh.lookAt(
        hitPos[0] - normal[0],
        hitPos[1] - normal[1],
        hitPos[2] - normal[2],
      )

      scene.add(mesh)
      holes.push(mesh)

      if (holes.length > MAX_HOLES) {
        scene.remove(holes.shift()!)
      }
    },
  }
}

// ── Tâm ngắm 4 vạch (giãn theo spread) + máu + đạn ─────────────────────────────
const CROSS_LEN   = 10   // px
const CROSS_MIN_GAP = 1  // px (thấp để súng chính xác như M16 vẫn thấy tâm chụm/giãn khi đứng-ngồi-ngắm)
const GAP_EXPAND_MS  = 30   // hằng thời gian khi tâm giãn
const GAP_SHRINK_MS  = 15   // co về nhanh hơn (gần như tức thì như lúc nhảy)
const BLOOM_DECAY_MS = 100  // độ giãn thêm sau mỗi phát bắn tan dần
const BLOOM_MAX_DEG  = 6

function buildCrosshair() {
  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:12'
  const bars: HTMLDivElement[] = []
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('div')
    const horizontal = i < 2
    b.style.cssText =
      'position:absolute;background:#7CFF7C;box-shadow:0 0 2px #000;' +
      (horizontal ? `width:${CROSS_LEN}px;height:2px;` : `width:2px;height:${CROSS_LEN}px;`)
    root.appendChild(b)
    bars.push(b)
  }
  document.body.appendChild(root)

  let gap = CROSS_MIN_GAP
  let fovDeg = 75   // FOV dọc hiện tại của camera chính (đổi khi zoom ngắm)
  let bloom = 0   // độ (chỉ hiển thị), cộng thêm vào spread mỗi phát bắn
  function place(g: number) {
    // 0 trái, 1 phải, 2 trên, 3 dưới
    bars[0]!.style.transform = `translate(${-g - CROSS_LEN}px,-1px)`
    bars[1]!.style.transform = `translate(${g}px,-1px)`
    bars[2]!.style.transform = `translate(-1px,${-g - CROSS_LEN}px)`
    bars[3]!.style.transform = `translate(-1px,${g}px)`
  }
  place(gap)
  return {
    setFov(deg: number) { fovDeg = deg },
    setVisible(v: boolean) { root.style.display = v ? '' : 'none' },
    /** spreadDeg: nửa góc nón; đổi sang pixel theo FOV dọc của camera chính */
    kick(deg: number) { bloom = Math.min(BLOOM_MAX_DEG, bloom + deg) },
    tick(spreadDeg: number, dtMs: number) {
      bloom *= Math.exp(-dtMs / BLOOM_DECAY_MS)
      if (bloom < 1e-3) bloom = 0
      const px = Math.tan((spreadDeg + bloom) * Math.PI / 180) / Math.tan(fovDeg * Math.PI / 360) * (window.innerHeight / 2)
      const target = Math.max(CROSS_MIN_GAP, px)
      const tau = target > gap ? GAP_EXPAND_MS : GAP_SHRINK_MS
      gap += (target - gap) * (1 - Math.exp(-dtMs / tau))
      place(gap)
    },
  }
}

// ── Export ────────────────────────────────────────────────────────────────────
export interface HUDHandle {
  showHitmarker(headshot: boolean): void
  addBulletHole(hitPos: [number, number, number], normal: [number, number, number]): void
  tick(dtMs: number): void
  setSpread(spreadDeg: number, dtMs: number): void
  kickSpread(deg: number): void
  setCrosshairVisible(v: boolean): void
  setCrosshairFov(deg: number): void
  setHealth(v: number): void
  setAmmo(name: string, cur: number, mag: number, reloading: boolean, melee?: boolean): void
  readonly bottom: BottomHud   // tiền, 4 ô vũ khí, nổi +$
}

export function initHUD(scene: THREE.Scene): HUDHandle {
  const hm = buildHitmarker()
  const bh = buildBulletHoles(scene)
  const ch = buildCrosshair()
  const st = createBottomHud()

  return {
    showHitmarker: (hs) => hm.show(hs),
    addBulletHole: (p, n) => bh.add(p, n),
    tick:          (ms)  => { hm.tick(ms); st.tick(ms) },
    setSpread:     (d, ms) => ch.tick(d, ms),
    kickSpread:    (d)   => ch.kick(d),
    setCrosshairVisible: (v) => ch.setVisible(v),
    setCrosshairFov: (d) => ch.setFov(d),
    setHealth:     (v)   => st.setHealth(v),
    setAmmo:       (n, c, m, r, melee) => st.setAmmo(n, c, m, r, melee),
    bottom:        st,
  }
}
