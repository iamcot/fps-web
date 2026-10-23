import * as THREE from 'three'
import { GRENADE, type Vec3 } from '@fps/shared'

// Hiệu ứng nổ lựu đạn (plan 12, G.7): chớp sáng + đèn, cầu lửa, khói, tia lửa, vết cháy, rung màn hình.
// Mọi texture sprite sinh bằng canvas (gradient tròn), không tải file. Toàn bộ dùng pool dựng sẵn: không cấp phát khi nổ,
// không đổi số đèn trong scene (đổi số đèn làm shader Lambert biên dịch lại → giật).
export interface CastRay { (o: Vec3, d: Vec3, max: number): { dist: number; normal: Vec3 } | null }

// ── Thông số hiệu ứng ──────────────────────────────────────────────────────────
const FLASH_SIZE = 7, FLASH_S = 0.08
const LIGHT_S = 0.25, LIGHT_INTENSITY = 380, LIGHT_DIST = 20, LIGHT_POOL = 3
const FIRE_COUNT = 14, FIRE_R0 = 0.7, FIRE_R1 = 3.6, FIRE_GROW_S = 0.3, FIRE_LIFE_S = 0.6
const SMOKE_COUNT = 48, SMOKE_LIFE_S = 5, SMOKE_MAX = 420, SMOKE_RISE = 1.2, SMOKE_R0 = 0.8, SMOKE_R1 = 3.6
const SPARK_COUNT = 60, SPARK_LIFE_S = 0.8, SPARK_GRAVITY = 12, SPARK_SPEED = 11
const FLASH_POOL = 6, FIRE_POOL = 80, SPARK_POOL = 360
const DECAL_SIZE = 3.5, DECAL_LIFE_S = 20, DECAL_FADE_S = 3, DECAL_MAX = 10
const SHAKE_S = 0.6, SHAKE_MAX_M = 0.07, SHAKE_MAX_ROT = 0.05

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  for (const [t, col] of stops) grad.addColorStop(t, col)
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

interface Particle { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; age: number; life: number; vx: number; vy: number; vz: number; r0: number; r1: number; grow: number; alive: boolean }

export function createExplosionFx(scene: THREE.Scene, castRay: () => CastRay | null) {
  const flashTex = radialTexture([[0, 'rgba(255,255,235,1)'], [0.4, 'rgba(255,230,150,0.8)'], [1, 'rgba(255,200,80,0)']])
  const fireTex = radialTexture([[0, 'rgba(255,230,120,1)'], [0.45, 'rgba(255,120,30,0.85)'], [1, 'rgba(160,30,0,0)']])
  const smokeTex = radialTexture([[0, 'rgba(70,70,70,0.95)'], [0.6, 'rgba(55,55,55,0.65)'], [1, 'rgba(35,35,35,0)']])
  const sparkTex = radialTexture([[0, 'rgba(255,255,220,1)'], [0.5, 'rgba(255,170,50,0.9)'], [1, 'rgba(255,100,0,0)']])
  const decalTex = radialTexture([[0, 'rgba(0,0,0,0.85)'], [0.55, 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']])

  const mkParticle = (tex: THREE.Texture, additive: boolean, depthTest = true): Particle => {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    const sprite = new THREE.Sprite(mat); sprite.visible = false
    scene.add(sprite)
    return { sprite, mat, age: 0, life: 1, vx: 0, vy: 0, vz: 0, r0: 1, r1: 1, grow: 1, alive: false }
  }
  const pools = {
    flash: Array.from({ length: FLASH_POOL }, () => mkParticle(flashTex, true, false)),
    fire: Array.from({ length: FIRE_POOL }, () => mkParticle(fireTex, true)),
    smoke: Array.from({ length: SMOKE_MAX }, () => mkParticle(smokeTex, false)),
    spark: Array.from({ length: SPARK_POOL }, () => mkParticle(sparkTex, true)),
  }
  const lights = Array.from({ length: LIGHT_POOL }, () => { const l = new THREE.PointLight(0xff8a30, 0, LIGHT_DIST, 2); scene.add(l); return { l, age: 99 } })
  const decals: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number }[] = []
  const decalGeo = new THREE.PlaneGeometry(DECAL_SIZE, DECAL_SIZE)
  for (let i = 0; i < DECAL_MAX; i++) {
    const mat = new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const mesh = new THREE.Mesh(decalGeo, mat); mesh.visible = false; mesh.renderOrder = 1
    scene.add(mesh); decals.push({ mesh, mat, age: 99 })
  }
  let nextDecal = 0
  const shake = { amp: 0, t: 99, x: 0, y: 0, rot: 0 }
  let smokeNext = 0

  const take = (pool: Particle[]): Particle | null => pool.find(p => !p.alive) ?? null
  const _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 0, 1)

  function spawn(p: Particle | null, x: number, y: number, z: number, life: number, r0: number, r1: number, vx = 0, vy = 0, vz = 0, grow = life): void {
    if (!p) return
    p.alive = true; p.age = 0; p.life = life; p.r0 = r0; p.r1 = r1; p.vx = vx; p.vy = vy; p.vz = vz; p.grow = grow
    p.sprite.position.set(x, y, z); p.sprite.scale.setScalar(r0); p.mat.opacity = 1; p.sprite.visible = true
  }

  // Vết cháy: tia xuống sàn; không có thì tường gần nhất trong 4 hướng ngang + trần
  function placeDecal(x: number, y: number, z: number): void {
    const cast = castRay()
    if (!cast) return
    const o: Vec3 = [x, y + 0.3, z]
    let dir: Vec3 = [0, -1, 0]
    let hit = cast(o, dir, 3)
    if (!hit) {
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]] as Vec3[]) {
        const h = cast(o, d, 3)
        if (h && (!hit || h.dist < hit.dist)) { hit = h; dir = d }
      }
      if (!hit) return
    }
    const dec = decals[nextDecal++ % DECAL_MAX]!
    _n.set(hit.normal[0], hit.normal[1], hit.normal[2])
    dec.mesh.position.set(o[0] + dir[0] * hit.dist, o[1] + dir[1] * hit.dist, o[2] + dir[2] * hit.dist).addScaledVector(_n, 0.03)   // nhích ra khỏi mặt để không nhấp nháy z
    dec.mesh.quaternion.setFromUnitVectors(_up, _n)
    dec.age = 0; dec.mesh.visible = true; dec.mat.opacity = 1
  }

  return {
    /** Nổ tại pos. camPos để tính rung theo khoảng cách (1 − d / shakeRadius) */
    explode(pos: Vec3, camPos: Vec3): void {
      const [x, y, z] = pos
      spawn(take(pools.flash), x, y + 0.2, z, FLASH_S, FLASH_SIZE, FLASH_SIZE * 0.2)
      const li = lights.reduce((a, b) => (b.age > a.age ? b : a))
      li.age = 0; li.l.position.set(x, y + 0.5, z); li.l.intensity = LIGHT_INTENSITY
      for (let i = 0; i < FIRE_COUNT; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.5
        spawn(take(pools.fire), x + Math.cos(a) * r, y + 0.2 + Math.random() * 0.6, z + Math.sin(a) * r, FIRE_LIFE_S * (0.7 + Math.random() * 0.5), FIRE_R0, FIRE_R1 * (0.6 + Math.random() * 0.4), 0, 0.6, 0, FIRE_GROW_S)
      }
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.6
        const p = pools.smoke[smokeNext++ % SMOKE_MAX]!   // quá 200 thì tái dùng sprite cũ nhất
        spawn(p, x + Math.cos(a) * r, y + 0.3 + Math.random() * 1.4, z + Math.sin(a) * r, SMOKE_LIFE_S * (0.7 + Math.random() * 0.5), SMOKE_R0, SMOKE_R1 * (0.7 + Math.random() * 0.5), (Math.random() - 0.5) * 1.6, SMOKE_RISE * (0.5 + Math.random() * 0.8), (Math.random() - 0.5) * 1.6)
      }
      for (let i = 0; i < SPARK_COUNT; i++) {   // hạt sáng bắn tung nửa cầu trên
        const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.5, sp = SPARK_SPEED * (0.4 + Math.random() * 0.6)
        spawn(take(pools.spark), x, y + 0.3, z, SPARK_LIFE_S, 0.12, 0.03, Math.cos(th) * Math.cos(ph) * sp, Math.sin(ph) * sp, Math.sin(th) * Math.cos(ph) * sp)
      }
      placeDecal(x, y, z)
      const d = Math.hypot(x - camPos[0], y - camPos[1], z - camPos[2])
      const amp = Math.max(0, 1 - d / GRENADE.shakeRadius)
      if (amp > shake.amp * Math.max(0, 1 - shake.t / SHAKE_S)) { shake.amp = amp; shake.t = 0 }
    },

    /** Rung ngắn khi đánh trúng / bị đánh (cận chiến), amp 0..1 */
    kick(amp: number): void {
      if (amp > shake.amp * Math.max(0, 1 - shake.t / SHAKE_S)) { shake.amp = amp; shake.t = SHAKE_S * 0.5 }
    },

    /** Mỗi frame */
    update(dt: number): void {
      for (const p of pools.flash) if (p.alive) {
        p.age += dt
        if (p.age >= p.life) { p.alive = false; p.sprite.visible = false; continue }
        const k = p.age / p.life
        p.sprite.scale.setScalar(p.r0 + (p.r1 - p.r0) * k); p.mat.opacity = 1 - k
      }
      for (const p of pools.fire) if (p.alive) {
        p.age += dt
        if (p.age >= p.life) { p.alive = false; p.sprite.visible = false; continue }
        const g = Math.min(1, p.age / p.grow), s = 1 - Math.pow(1 - g, 3)   // nở nhanh rồi chậm lại
        p.sprite.scale.setScalar(p.r0 + (p.r1 - p.r0) * s)
        p.sprite.position.y += p.vy * dt
        p.mat.opacity = Math.max(0, 1 - Math.max(0, p.age - p.grow * 0.6) / (p.life - p.grow * 0.6))
      }
      for (const p of pools.smoke) if (p.alive) {
        p.age += dt
        if (p.age >= p.life) { p.alive = false; p.sprite.visible = false; continue }
        const k = p.age / p.life
        p.sprite.scale.setScalar(p.r0 + (p.r1 - p.r0) * Math.sqrt(k))
        p.sprite.position.x += p.vx * dt; p.sprite.position.y += p.vy * dt * (1 - k * 0.6); p.sprite.position.z += p.vz * dt
        p.mat.opacity = (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9) * 0.85
      }
      for (const p of pools.spark) if (p.alive) {
        p.age += dt
        if (p.age >= p.life) { p.alive = false; p.sprite.visible = false; continue }
        p.vy -= SPARK_GRAVITY * dt
        p.sprite.position.x += p.vx * dt; p.sprite.position.y += p.vy * dt; p.sprite.position.z += p.vz * dt
        const k = p.age / p.life
        p.sprite.scale.setScalar(p.r0 + (p.r1 - p.r0) * k); p.mat.opacity = 1 - k
      }
      for (const li of lights) {
        li.age += dt
        li.l.intensity = li.age >= LIGHT_S ? 0 : LIGHT_INTENSITY * Math.pow(1 - li.age / LIGHT_S, 2)
      }
      for (const d of decals) if (d.mesh.visible) {
        d.age += dt
        if (d.age >= DECAL_LIFE_S) { d.mesh.visible = false; continue }
        d.mat.opacity = Math.min(1, (DECAL_LIFE_S - d.age) / DECAL_FADE_S)
      }
      // rung: biên độ giảm tuyến tính theo thời gian, hướng ngẫu nhiên mỗi frame
      shake.t += dt
      const k = Math.max(0, 1 - shake.t / SHAKE_S) * shake.amp
      shake.x = (Math.random() - 0.5) * 2 * SHAKE_MAX_M * k
      shake.y = (Math.random() - 0.5) * 2 * SHAKE_MAX_M * k
      shake.rot = (Math.random() - 0.5) * 2 * SHAKE_MAX_ROT * k
    },

    /** Sang ván mới: xoá mọi hạt, vết cháy và rung đang chạy */
    clear(): void {
      for (const p of pools.flash.concat(pools.fire, pools.smoke, pools.spark)) { p.alive = false; p.sprite.visible = false }
      for (const d of decals) d.mesh.visible = false
      for (const li of lights) { li.age = 99; li.l.intensity = 0 }
      shake.amp = 0; shake.t = 99; shake.x = shake.y = shake.rot = 0
    },

    /** Độ lệch rung của frame này (m, rad): cộng vào camera chính, không đụng viewmodel */
    get shake(): { x: number; y: number; rot: number } { return shake },

    /** Số sprite đang sống (test/debug) */
    get liveCount(): number { return pools.flash.concat(pools.fire, pools.smoke, pools.spark).filter(p => p.alive).length },
    get liveSmoke(): number { return pools.smoke.filter(p => p.alive).length },
    get decalCount(): number { return decals.filter(d => d.mesh.visible).length },
  }
}

export type ExplosionFx = ReturnType<typeof createExplosionFx>
