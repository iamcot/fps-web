import * as THREE from 'three'

// Máu trắng (điểm nhấn hình ảnh): khi trúng người, vài giọt văng theo hướng đạn, rơi theo trọng lực;
// chạm sàn/tường thì để lại vệt trắng dẹt dính vào bề mặt rồi mờ dần. Chỉ là hiệu ứng, không ảnh hưởng gameplay.
// Pool cố định, không cấp phát mỗi giọt (trừ tia raycast của physics world).
const MAX_DROPS = 220
const MAX_SPLATS = 90
const DROPS_BODY = 9
const DROPS_HEAD = 16
const DROP_SPEED: [number, number] = [2.5, 6.5]   // m/s dọc hướng đạn
const DROP_SPREAD = 1.6                            // m/s lệch ngang ngẫu nhiên
const DROP_UP: [number, number] = [0.2, 2.2]       // m/s hất lên
const DROP_SIZE: [number, number] = [0.025, 0.055]
const GRAVITY = 9.8
const DROP_LIFE_S = 1.6
const SPLAT_SIZE: [number, number] = [0.07, 0.22]
const SPLAT_LIFE_S = 14
const SPLAT_FADE_S = 4

type CastRay = (origin: [number, number, number], dir: [number, number, number], maxDist: number) => { dist: number; normal: [number, number, number] } | null

const rnd = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0])

export interface BloodFx {
  /** pos: chỗ trúng; dir: hướng đạn (chuẩn hoá) */
  spawn(pos: ArrayLike<number>, dir: ArrayLike<number>, headshot: boolean): void
  update(dt: number): void
  clear(): void
}

export function createBloodFx(scene: THREE.Scene, castRay: () => CastRay | null): BloodFx {
  const dropMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), MAX_DROPS)
  dropMesh.count = 0
  dropMesh.frustumCulled = false
  scene.add(dropMesh)
  const px = new Float32Array(MAX_DROPS), py = new Float32Array(MAX_DROPS), pz = new Float32Array(MAX_DROPS)
  const vx = new Float32Array(MAX_DROPS), vy = new Float32Array(MAX_DROPS), vz = new Float32Array(MAX_DROPS)
  const size = new Float32Array(MAX_DROPS), age = new Float32Array(MAX_DROPS)
  let n = 0

  const planeGeo = new THREE.PlaneGeometry(1, 1)
  const splats: THREE.Mesh[] = []
  const splatAge: number[] = []
  for (let i = 0; i < MAX_SPLATS; i++) {
    const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, fog: false, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }))
    m.visible = false
    scene.add(m)
    splats.push(m); splatAge.push(SPLAT_LIFE_S)
  }
  let nextSplat = 0

  const _m = new THREE.Matrix4()
  const _o: [number, number, number] = [0, 0, 0]
  const _d: [number, number, number] = [0, 0, 0]

  function splat(x: number, y: number, z: number, nrm: [number, number, number], s: number): void {
    const i = nextSplat; nextSplat = (nextSplat + 1) % MAX_SPLATS
    const m = splats[i]!
    m.position.set(x + nrm[0] * 0.006, y + nrm[1] * 0.006, z + nrm[2] * 0.006)
    m.lookAt(x + nrm[0], y + nrm[1], z + nrm[2])   // Object3D.lookAt: trục +Z (mặt trước) hướng về điểm đó = ra ngoài bề mặt
    m.rotateZ(Math.random() * Math.PI * 2)
    m.scale.set(s * (0.7 + Math.random() * 0.6), s, 1)
    ;(m.material as THREE.MeshBasicMaterial).opacity = 0.95
    m.visible = true
    splatAge[i] = 0
  }

  function kill(i: number): void {
    n--
    if (i !== n) {
      px[i] = px[n]!; py[i] = py[n]!; pz[i] = pz[n]!
      vx[i] = vx[n]!; vy[i] = vy[n]!; vz[i] = vz[n]!
      size[i] = size[n]!; age[i] = age[n]!
    }
  }

  return {
    spawn(pos, dir, headshot) {
      const count = headshot ? DROPS_HEAD : DROPS_BODY
      for (let k = 0; k < count && n < MAX_DROPS; k++) {
        const sp = rnd(DROP_SPEED)
        px[n] = pos[0]!; py[n] = pos[1]!; pz[n] = pos[2]!
        vx[n] = dir[0]! * sp + (Math.random() - 0.5) * DROP_SPREAD
        vy[n] = dir[1]! * sp + rnd(DROP_UP)
        vz[n] = dir[2]! * sp + (Math.random() - 0.5) * DROP_SPREAD
        size[n] = rnd(DROP_SIZE); age[n] = 0
        n++
      }
    },
    update(dt) {
      const cast = castRay()
      for (let i = n - 1; i >= 0; i--) {
        age[i]! += dt
        if (age[i]! > DROP_LIFE_S) { kill(i); continue }
        vy[i]! -= GRAVITY * dt
        const sx = vx[i]! * dt, sy = vy[i]! * dt, sz = vz[i]! * dt
        const len = Math.hypot(sx, sy, sz)
        let hit: { dist: number; normal: [number, number, number] } | null = null
        if (cast && len > 1e-6) {
          _o[0] = px[i]!; _o[1] = py[i]!; _o[2] = pz[i]!
          _d[0] = sx / len; _d[1] = sy / len; _d[2] = sz / len
          hit = cast(_o, _d, len)
        }
        if (hit) {
          const t = hit.dist
          splat(px[i]! + _d[0] * t, py[i]! + _d[1] * t, pz[i]! + _d[2] * t, hit.normal, rnd(SPLAT_SIZE))
          kill(i); continue
        }
        px[i]! += sx; py[i]! += sy; pz[i]! += sz
        if (!cast && py[i]! < 0.01) { splat(px[i]!, 0, pz[i]!, [0, 1, 0], rnd(SPLAT_SIZE)); kill(i) }   // chưa có world: sàn y = 0
      }
      dropMesh.count = n
      for (let i = 0; i < n; i++) {
        _m.makeScale(size[i]!, size[i]!, size[i]!)
        _m.setPosition(px[i]!, py[i]!, pz[i]!)
        dropMesh.setMatrixAt(i, _m)
      }
      dropMesh.instanceMatrix.needsUpdate = true
      for (let i = 0; i < MAX_SPLATS; i++) {
        if (splatAge[i]! >= SPLAT_LIFE_S) continue
        splatAge[i]! += dt
        const m = splats[i]!
        if (splatAge[i]! >= SPLAT_LIFE_S) { m.visible = false; continue }
        const left = SPLAT_LIFE_S - splatAge[i]!
        if (left < SPLAT_FADE_S) (m.material as THREE.MeshBasicMaterial).opacity = 0.95 * left / SPLAT_FADE_S
      }
    },
    clear() {
      n = 0; dropMesh.count = 0
      for (let i = 0; i < MAX_SPLATS; i++) { splats[i]!.visible = false; splatAge[i] = SPLAT_LIFE_S }
    },
  }
}
