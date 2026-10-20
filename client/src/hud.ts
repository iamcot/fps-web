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
const MAX_HOLES = 120

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
    clear() { for (const h of holes) scene.remove(h); holes.length = 0 },
  }
}

// ── Tâm ngắm 4 vạch (khoảng hở = độ toé thật của súng) + máu + đạn ──────────────
const CROSS_LEN   = 10   // px
const CROSS_MIN_GAP = 3  // px: khoảng hở tối thiểu để tâm không dính lại khi spread ≈ 0
const CROSS_FIXED_GAP = 6   // px khi tắt "tâm ngắm động"
const GAP_TAU_MS  = 30   // làm mượt hiển thị (không ảnh hưởng đạn)

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
  const dot = document.createElement('div')   // sniper không ngắm: chỉ một chấm xanh viền đen mỏng, tán mờ nhẹ ra ngoài (bắn không ngắm là may rủi)
  dot.style.cssText = 'position:absolute;width:5px;height:5px;margin:-3.5px 0 0 -3.5px;border-radius:50%;background:#7CFF7C;border:1px solid #000;box-shadow:0 0 4px 2px rgba(0,0,0,0.45);display:none'
  const ring = document.createElement('div')   // shotgun: vòng mờ cho nón của chùm chì
  ring.style.cssText = 'position:absolute;border:1px solid rgba(124,255,124,0.45);border-radius:50%;display:none;box-sizing:border-box'
  root.append(dot, ring)
  document.body.appendChild(root)

  let gap = CROSS_MIN_GAP
  let fovDeg = 75   // FOV dọc hiện tại của camera chính (đổi khi zoom ngắm)
  let dynamic = true
  let adsT = 0   // ngắm: 4 vạch mờ dần, còn lại một chấm (như Krunker)
  function place(g: number) {
    // 0 trái, 1 phải, 2 trên, 3 dưới
    bars[0]!.style.transform = `translate(${-g - CROSS_LEN}px,-1px)`
    bars[1]!.style.transform = `translate(${g}px,-1px)`
    bars[2]!.style.transform = `translate(-1px,${-g - CROSS_LEN}px)`
    bars[3]!.style.transform = `translate(-1px,${g}px)`
  }
  place(gap)
  // độ (nửa góc nón) → pixel, theo FOV dọc hiện tại của camera chính
  const degToPx = (deg: number) => Math.tan(deg * Math.PI / 180) / Math.tan(fovDeg * Math.PI / 360) * (window.innerHeight / 2)
  let ringShown = false, dotShown = false, barsShown = true
  return {
    setFov(deg: number) { fovDeg = deg },
    setVisible(v: boolean) { root.style.display = v ? '' : 'none' },
    setAds(t: number) { adsT = Math.min(1, Math.max(0, t)) },
    setDynamic(v: boolean) { dynamic = v },
    /** spreadDeg: nửa góc nón hiện tại; coneDeg > 0 (shotgun) vẽ thêm vòng cho nón chùm; dotOnly: ẩn 4 vạch, chỉ chấm */
    tick(spreadDeg: number, dtMs: number, coneDeg = 0, dotOnly = false) {
      const target = dynamic ? Math.max(CROSS_MIN_GAP, degToPx(spreadDeg)) : CROSS_FIXED_GAP
      gap += (target - gap) * (1 - Math.exp(-dtMs / GAP_TAU_MS))
      place(gap)
      for (const b of bars) b.style.opacity = String(1 - adsT)
      dot.style.opacity = dotOnly ? '1' : String(adsT)
      if (adsT > 0 && !dotOnly) { dot.style.display = '' ; dotShown = true }
      if (barsShown === dotOnly) { barsShown = !dotOnly; for (const b of bars) b.style.display = barsShown ? '' : 'none' }
      if (!(adsT > 0 && !dotOnly) && dotShown !== dotOnly) { dotShown = dotOnly; dot.style.display = dotOnly ? '' : 'none' }
      const wantRing = coneDeg > 0 && dynamic
      if (wantRing !== ringShown) { ringShown = wantRing; ring.style.display = wantRing ? '' : 'none' }
      if (wantRing) {
        const r = degToPx(coneDeg + spreadDeg)
        ring.style.width = ring.style.height = `${2 * r}px`
        ring.style.left = ring.style.top = `${-r}px`
      }
    },
  }
}

// ── Export ────────────────────────────────────────────────────────────────────
export interface HUDHandle {
  showHitmarker(headshot: boolean): void
  addBulletHole(hitPos: [number, number, number], normal: [number, number, number]): void
  clearBulletHoles(): void
  tick(dtMs: number): void
  setSpread(spreadDeg: number, dtMs: number, coneDeg?: number, dotOnly?: boolean): void
  setCrosshairFade(adsT: number): void   // ngắm: vạch → chấm
  setCrosshairDynamic(on: boolean): void
  setCrosshairVisible(v: boolean): void
  setCrosshairFov(deg: number): void
  setHealth(v: number): void
  setAmmo(name: string, cur: number, mag: number, reloading: boolean, melee?: boolean, consumable?: boolean): void
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
    clearBulletHoles: () => bh.clear(),
    tick:          (ms)  => { hm.tick(ms); st.tick(ms) },
    setSpread:     (d, ms, cone, dot) => ch.tick(d, ms, cone, dot),
    setCrosshairFade: (t) => ch.setAds(t),
    setCrosshairDynamic: (on) => ch.setDynamic(on),
    setCrosshairVisible: (v) => ch.setVisible(v),
    setCrosshairFov: (d) => ch.setFov(d),
    setHealth:     (v)   => st.setHealth(v),
    setAmmo:       (n, c, m, r, melee, cons) => st.setAmmo(n, c, m, r, melee, cons),
    bottom:        st,
  }
}
