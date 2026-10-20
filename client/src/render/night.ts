// Ban đêm + đèn pin (plan 16, ZF.3). Số đèn trong scene luôn CỐ ĐỊNH (đổi số đèn làm three biên dịch lại shader → giật):
// mọi đèn tạo sẵn, tắt bằng intensity = 0. Đèn pin người khác: tối đa MAX_OTHER_SPOTS cái gần nhất là SpotLight thật, còn lại vẽ nón sáng giả.
import * as THREE from 'three'
import { NetFlag } from '@fps/shared'

const MAX_LAMPS = 6
const MAX_OTHER_SPOTS = 4
const MAX_FAKE_CONES = 12
const FLASH_ANGLE = 25 * Math.PI / 180
const FLASH_RANGE = 30

export const NIGHT = {
  hemiSky: 0x16213a, hemiGround: 0x070a10, hemiIntensity: 0.55,
  moonColor: 0x7a93c8, moonIntensity: 0.3,
  fogColor: 0x070c16, fogDensity: 0.035,
  background: 0x05080f,
  lampColor: 0xffb468, lampIntensity: 140, lampRange: 26,
  flashIntensity: 80, flashColor: 0xfff2d6,
  zombieAmbientMul: 3,
  zombieOverlay: 'rgba(150,20,20,0.16)',
}

// Đèn đường đặt cố định trên đỉnh tường thành (theo map). Map khác chưa có thì không có đèn đường.
const LAMPS: Record<string, [number, number, number][]> = {
  Deathmatch: [[-19.6, 5.2, -11.3], [-19.6, 5.2, 0], [-19.6, 5.2, 11.3], [19.6, 5.2, -11.3], [19.6, 5.2, 0], [19.6, 5.2, 11.3]],
}

export interface NightPlayer { id: number; pos: [number, number, number]; yaw: number; pitch?: number; flags: number }

export interface NightRig {
  /** Bật/tắt chế độ ban đêm của phòng */
  setNight(on: boolean): void
  /** Mình là zombie: nhìn đêm (ambient ×3, lọc đỏ) */
  setZombieVision(on: boolean): void
  /** Mỗi frame: đèn pin của mình (theo camera) + của người khác */
  update(camera: THREE.Camera, selfFlash: boolean, others: readonly NightPlayer[]): void
  readonly night: boolean
}

interface Hemi { sky: number; ground: number; intensity: number }

export function createNight(scene: THREE.Scene, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight, skyApi: { setNight(on: boolean): void }, mapName: string): NightRig {
  const day: Hemi & { sunColor: number; sunIntensity: number; fog: THREE.Fog | THREE.FogExp2 | null; bg: THREE.Color | THREE.Texture | null } = {
    sky: hemi.color.getHex(), ground: hemi.groundColor.getHex(), intensity: hemi.intensity,
    sunColor: sun.color.getHex(), sunIntensity: sun.intensity, fog: scene.fog, bg: scene.background as THREE.Color | null,
  }
  const nightFog = new THREE.FogExp2(NIGHT.fogColor, NIGHT.fogDensity)
  const nightBg = new THREE.Color(NIGHT.background)

  // Đèn đường: tạo đủ MAX_LAMPS, thừa thì cường độ 0
  const lampPos = LAMPS[mapName] ?? []
  const lamps: THREE.PointLight[] = []
  const lampBulbs = new THREE.Group()
  const bulbGeo = new THREE.SphereGeometry(0.18, 8, 6)
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false })
  for (let i = 0; i < MAX_LAMPS; i++) {
    const l = new THREE.PointLight(NIGHT.lampColor, 0, NIGHT.lampRange, 1.4)
    l.castShadow = false
    const p = lampPos[i]
    if (p) { l.position.set(p[0], p[1], p[2]); const b = new THREE.Mesh(bulbGeo, bulbMat); b.position.copy(l.position); lampBulbs.add(b) }
    scene.add(l)
    lamps.push(l)
  }
  lampBulbs.visible = false
  scene.add(lampBulbs)

  // Đèn pin: [0] của mình, [1..4] của người khác gần nhất
  const spots: THREE.SpotLight[] = []
  for (let i = 0; i <= MAX_OTHER_SPOTS; i++) {
    const s = new THREE.SpotLight(NIGHT.flashColor, 0, FLASH_RANGE, FLASH_ANGLE, 0.45, 1.6)
    s.castShadow = false
    scene.add(s); scene.add(s.target)
    spots.push(s)
  }
  // Nón sáng giả cho đèn pin ở xa (không phải đèn thật): nón cộng sáng, đỉnh ở đèn, mở rộng theo hướng chiếu
  const coneGeo = new THREE.ConeGeometry(Math.tan(FLASH_ANGLE) * 14, 14, 16, 1, true)
  coneGeo.translate(0, -7, 0)   // đỉnh ở gốc, mở xuống −Y
  coneGeo.rotateX(-Math.PI / 2) // mở theo −Z (hướng nhìn của dự án)
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff2d6, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
  const cones: THREE.Mesh[] = []
  for (let i = 0; i < MAX_FAKE_CONES; i++) { const m = new THREE.Mesh(coneGeo, coneMat); m.visible = false; m.frustumCulled = false; scene.add(m); cones.push(m) }

  // Lớp lọc đỏ khi làm zombie
  const overlay = document.createElement('div')
  overlay.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:5;background:${NIGHT.zombieOverlay};display:none;mix-blend-mode:multiply`
  document.body.appendChild(overlay)

  let night = false
  let zombieVision = false
  const cand: { p: NightPlayer; d: number }[] = []
  const _dir = new THREE.Vector3()
  const _pos = new THREE.Vector3()

  function applyBase(): void {
    if (night) {
      hemi.color.setHex(NIGHT.hemiSky); hemi.groundColor.setHex(NIGHT.hemiGround)
      hemi.intensity = NIGHT.hemiIntensity * (zombieVision ? NIGHT.zombieAmbientMul : 1)
      sun.color.setHex(NIGHT.moonColor); sun.intensity = NIGHT.moonIntensity
      scene.fog = nightFog; scene.background = nightBg
    } else {
      hemi.color.setHex(day.sky); hemi.groundColor.setHex(day.ground); hemi.intensity = day.intensity
      sun.color.setHex(day.sunColor); sun.intensity = day.sunIntensity
      scene.fog = day.fog; scene.background = day.bg
    }
    for (let i = 0; i < MAX_LAMPS; i++) lamps[i]!.intensity = night && lampPos[i] ? NIGHT.lampIntensity : 0
    lampBulbs.visible = night
    overlay.style.display = night && zombieVision ? 'block' : 'none'
    skyApi.setNight(night)
  }

  function aim(s: THREE.SpotLight, x: number, y: number, z: number, yaw: number, pitch: number): void {
    const cp = Math.cos(pitch)
    _dir.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp)
    s.position.set(x, y, z)
    s.target.position.set(x + _dir.x * 10, y + _dir.y * 10, z + _dir.z * 10)
  }

  return {
    get night() { return night },
    setNight(on) { if (on === night) return; night = on; applyBase() },
    setZombieVision(on) { if (on === zombieVision) return; zombieVision = on; applyBase() },
    update(camera, selfFlash, others) {
      for (const s of spots) s.intensity = 0
      for (const c of cones) c.visible = false
      if (!night) return
      const self = spots[0]!
      if (selfFlash) {
        camera.getWorldPosition(_pos)
        camera.getWorldDirection(_dir)
        // lệch xuống một chút để vệt sáng như cầm ở tay, không chói ngay trước mắt
        self.position.set(_pos.x + _dir.x * 0.3, _pos.y - 0.12, _pos.z + _dir.z * 0.3)
        self.target.position.set(_pos.x + _dir.x * 10, _pos.y + _dir.y * 10, _pos.z + _dir.z * 10)
        self.intensity = NIGHT.flashIntensity
      }
      camera.getWorldPosition(_pos)
      cand.length = 0
      for (const p of others) {
        if ((p.flags & NetFlag.Flashlight) === 0 || (p.flags & NetFlag.Dead) !== 0) continue
        cand.push({ p, d: Math.hypot(p.pos[0] - _pos.x, p.pos[2] - _pos.z) })
      }
      cand.sort((a, b) => a.d - b.d)
      let cone = 0
      for (let i = 0; i < cand.length; i++) {
        const p = cand[i]!.p
        const eyeY = p.pos[1] + ((p.flags & NetFlag.Crouching) ? 1.0 : 1.6) - 0.12
        const pitch = p.pitch ?? 0
        if (i < MAX_OTHER_SPOTS) {
          const s = spots[1 + i]!
          aim(s, p.pos[0], eyeY, p.pos[2], p.yaw, pitch)
          s.intensity = NIGHT.flashIntensity
        } else if (cone < MAX_FAKE_CONES) {
          const c = cones[cone++]!
          c.visible = true
          c.position.set(p.pos[0], eyeY, p.pos[2])
          c.rotation.set(pitch, p.yaw, 0, 'YXZ')
        }
      }
    },
  }
}
