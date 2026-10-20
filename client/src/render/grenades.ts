import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DT, GRENADE, TICK_RATE, stepGrenade, type GrenadeEvent, type GrenadeState, type GrenadeSpawnMsg, type GrenadeExplodeMsg, type TeamId, type ThrowMode, type Vec3 } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'

// Lựu đạn phía client (plan 12, G.4). grenadePhysics tất định và lựu đạn không chạm người nên client TỰ mô phỏng mọi quả từ
// GrenadeSpawn (server không gửi vị trí trong snapshot). Người khác: tua nhanh từ spawnTick tới giờ vẽ (trễ như người chơi khác).
// Quả của mình: tạo ngay lúc dự đoán ném, nhận id khi GrenadeSpawn cùng throwSeq về (lệch <0,2m giữ nguyên, lệch nhiều thì chuyển dần).
// GrenadeExplode là nguồn chân lý. Chỉ vẽ + mô phỏng, không có logic luật chơi.
const TICK_MS = 1000 / TICK_RATE
const MODEL = '/models/grenades/m67.glb'
const SNAP_DIST = 0.2           // lệch hơn mức này giữa quả dự đoán và quả server thì chuyển về quỹ đạo server
const SMOOTH_S = 0.2            // thời gian hoà bù lệch
const CONFIRM_TIMEOUT_MS = 500  // server không xác nhận quả dự đoán (+ RTT) thì xoá
const MAX_STEPS_PER_FRAME = 400 // tua nhanh quả đến muộn
const SAFETY_EXTRA_S = 2        // quá fuse + từng ấy mà chưa có GrenadeExplode thì xoá
const SPIN_PER_MS = 1.4         // rad/s xoay mỗi m/s khi bay
const SPOON_LIFE_S = 5
const SPOON_PHYS: Pick<GrenadeState, 'team' | 'ownerId' | 'spawnTick'> = { team: 'A', ownerId: -1, spawnTick: 0 }

export interface GrenadeView { id: number; ownerId: number; pos: THREE.Vector3; resting: boolean; predicted: boolean }

interface Sim {
  g: GrenadeState
  prev: Vec3
  init: Vec3                 // vị trí lúc tạo (so với server khi xác nhận)
  stepped: number
  elapsed: number            // giây kể từ lúc rời tay trên đồng hồ của quả này
  predicted: boolean
  confirmed: boolean
  throwSeq: number
  createdMs: number
  spawnServerMs: number      // quả của người khác: mốc server lúc rời tay
  pivot: THREE.Group
  quat: THREE.Quaternion
  offset: THREE.Vector3      // lệch hiển thị đang hoà dần về 0
  view: GrenadeView
}

interface Spoon { g: GrenadeState; prev: Vec3; pivot: THREE.Group; age: number; acc: number; spin: THREE.Vector3 }

export interface GrenadeDeps {
  world(): CollisionWorld | null
  /** Offline (không có server): tự nổ khi hết ngòi */
  localFuse(): boolean
  onBounce?(pos: Vec3, speed: number): void
  onExplode?(pos: Vec3, hits: { id: number; damage: number }[]): void
  onRelease?(pos: Vec3, own: boolean): void   // lựu đạn rời tay (tiếng thìa)
}

const _v = new THREE.Vector3(), _axis = new THREE.Vector3(), _dq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0)

export function createGrenades(scene: THREE.Scene, deps: GrenadeDeps) {
  const sims: Sim[] = []
  const spoons: Spoon[] = []
  let bodyTpl: THREE.Object3D | null = null
  let spoonTpl: THREE.Object3D | null = null
  let loadFailed = false

  new GLTFLoader().loadAsync(MODEL).then(gltf => {
    bodyTpl = gltf.scene.getObjectByName('body') ?? null
    spoonTpl = gltf.scene.getObjectByName('spoon') ?? null
    for (const o of [bodyTpl, spoonTpl]) o?.traverse(m => { if (m instanceof THREE.Mesh) { m.castShadow = false; m.receiveShadow = false } })
    if (!bodyTpl) { loadFailed = true; console.warn('grenades: m67.glb thiếu node body, dùng quả cầu') }
  }).catch(err => { loadFailed = true; console.warn('grenades: không load được m67.glb, dùng quả cầu', err) })

  const fallbackGeo = new THREE.SphereGeometry(GRENADE.radius * 0.65, 10, 8)
  const fallbackMat = new THREE.MeshLambertMaterial({ color: 0x3f5a2a })

  function makeBody(): THREE.Group {
    const pivot = new THREE.Group()
    if (bodyTpl) {
      const b = bodyTpl.clone(true); b.position.set(0, 0, 0); b.quaternion.identity()
      pivot.add(b)
    } else if (loadFailed) pivot.add(new THREE.Mesh(fallbackGeo, fallbackMat))
    return pivot
  }

  function addSim(g: GrenadeState, predicted: boolean, throwSeq: number, spawnServerMs: number): Sim {
    const pivot = makeBody()
    pivot.position.set(g.pos[0], g.pos[1], g.pos[2])
    scene.add(pivot)
    const s: Sim = {
      g, prev: [g.pos[0], g.pos[1], g.pos[2]], init: [g.pos[0], g.pos[1], g.pos[2]], stepped: 0, elapsed: 0,
      predicted, confirmed: !predicted, throwSeq, createdMs: performance.now(), spawnServerMs,
      pivot, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
      offset: new THREE.Vector3(),
      view: { id: g.id, ownerId: g.ownerId, pos: new THREE.Vector3(), resting: false, predicted },
    }
    sims.push(s)
    return s
  }

  function spawnSpoon(pos: Vec3, vel: Vec3): void {
    if (!spoonTpl) return
    const pivot = new THREE.Group()
    const mesh = spoonTpl.clone(true); mesh.position.set(0, 0, 0); mesh.quaternion.identity()
    pivot.add(mesh)
    pivot.position.set(pos[0], pos[1], pos[2])
    scene.add(pivot)
    // bay chéo lên-ra sau so với hướng ném, thêm chút ngẫu nhiên
    const sp = Math.hypot(vel[0], vel[1], vel[2]) || 1
    const back = [-vel[0] / sp, -vel[1] / sp, -vel[2] / sp]
    const v: Vec3 = [
      vel[0] * 0.2 + back[0]! * 1.2 + (Math.random() - 0.5) * 1.2,
      vel[1] * 0.2 + 2.2 + Math.random(),
      vel[2] * 0.2 + back[2]! * 1.2 + (Math.random() - 0.5) * 1.2,
    ]
    spoons.push({
      g: { ...SPOON_PHYS, id: -1, pos: [pos[0], pos[1], pos[2]], vel: v, resting: false },
      prev: [pos[0], pos[1], pos[2]], pivot, age: 0, acc: 0,
      spin: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
    })
  }

  function removeSim(i: number): void {
    scene.remove(sims[i]!.pivot)
    sims[i] = sims[sims.length - 1]!; sims.pop()
  }

  function explodeSim(i: number, pos: Vec3, hits: { id: number; damage: number }[]): void {
    removeSim(i)
    deps.onExplode?.(pos, hits)
  }

  function advance(s: Sim, world: CollisionWorld | null, target: number): void {
    if (!world) return
    let n = 0
    while ((s.stepped + 1) * DT <= target && n < MAX_STEPS_PER_FRAME) {
      s.prev[0] = s.g.pos[0]; s.prev[1] = s.g.pos[1]; s.prev[2] = s.g.pos[2]
      const ev: GrenadeEvent | null = stepGrenade(s.g, world, DT)
      s.stepped++; n++
      if (ev && ev.type === 'bounce' && target - s.stepped * DT < 0.1) deps.onBounce?.(s.g.pos, ev.speed)   // tua nhanh quả cũ thì không phát tiếng nảy
    }
  }

  return {
    /** Lúc dự đoán ném: tạo ngay quả của mình (chưa có id; server xác nhận bằng throwSeq) */
    spawnLocal(throwSeq: number, ownerId: number, team: TeamId, pos: Vec3, vel: Vec3, _mode: ThrowMode): void {
      const g: GrenadeState = { id: -throwSeq, ownerId, team, pos: [pos[0], pos[1], pos[2]], vel: [vel[0], vel[1], vel[2]], spawnTick: 0, resting: false }
      addSim(g, true, throwSeq, 0)
      spawnSpoon(pos, vel)
      deps.onRelease?.(pos, true)
    },

    /** GrenadeSpawn từ server. tickOriginMs = serverTime của tick 0 (suy từ snapshot: serverTime − tick·TICK_MS). */
    onSpawn(msg: GrenadeSpawnMsg, tickOriginMs: number, myId: number, team: TeamId): void {
      if (msg.ownerId === myId) {
        const s = sims.find(x => x.predicted && !x.confirmed && x.throwSeq === msg.throwSeq)
        if (s) {
          s.confirmed = true; s.g.id = msg.id; s.view.id = msg.id
          const d = Math.hypot(s.init[0] - msg.pos[0], s.init[1] - msg.pos[1], s.init[2] - msg.pos[2])
          if (d >= SNAP_DIST) {
            // lệch nhiều: dựng lại từ trạng thái server, tua đúng số bước đã chạy, hoà bù lệch trong SMOOTH_S
            const world = deps.world()
            const ng: GrenadeState = { id: msg.id, ownerId: msg.ownerId, team, pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [msg.vel[0], msg.vel[1], msg.vel[2]], spawnTick: msg.spawnTick, resting: false }
            if (world) for (let i = 0; i < s.stepped; i++) stepGrenade(ng, world, DT)
            s.offset.set(s.g.pos[0] - ng.pos[0], s.g.pos[1] - ng.pos[1], s.g.pos[2] - ng.pos[2]).add(s.offset)
            s.g = ng
            s.prev[0] = ng.pos[0]; s.prev[1] = ng.pos[1]; s.prev[2] = ng.pos[2]
          }
          return
        }
      }
      const g: GrenadeState = { id: msg.id, ownerId: msg.ownerId, team, pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [msg.vel[0], msg.vel[1], msg.vel[2]], spawnTick: msg.spawnTick, resting: false }
      addSim(g, false, msg.throwSeq, tickOriginMs + msg.spawnTick * TICK_MS)
      spawnSpoon(msg.pos, msg.vel)
      deps.onRelease?.(msg.pos, false)
    },

    /** GrenadeExplode: nổ đúng chỗ server gửi, xoá quả local dù local chưa tới giờ */
    onExplode(msg: GrenadeExplodeMsg): void {
      const i = sims.findIndex(s => s.g.id === msg.id)
      if (i >= 0) explodeSim(i, msg.pos, msg.hits)
      else deps.onExplode?.(msg.pos, msg.hits)
    },

    /** Mỗi frame. renderServerMs = giờ server đang vẽ (trễ như người chơi khác); rttMs để đặt hạn xác nhận quả dự đoán */
    update(dt: number, renderServerMs: number, rttMs: number): void {
      const world = deps.world()
      const nowMs = performance.now()
      for (let i = sims.length - 1; i >= 0; i--) {
        const s = sims[i]!
        if (s.predicted) {
          if (!s.confirmed && !deps.localFuse() && nowMs - s.createdMs > CONFIRM_TIMEOUT_MS + rttMs) { removeSim(i); continue }   // bị từ chối (offline không có server nên không chờ xác nhận)
          s.elapsed += dt
        } else s.elapsed = Math.max(0, (renderServerMs - s.spawnServerMs) / 1000)
        advance(s, world, s.elapsed)
        if (deps.localFuse() && s.elapsed >= GRENADE.fuseMs / 1000) { explodeSim(i, [s.g.pos[0], s.g.pos[1], s.g.pos[2]], []); continue }
        if (s.elapsed > GRENADE.fuseMs / 1000 + SAFETY_EXTRA_S) { removeSim(i); continue }
        // hiển thị: nội suy giữa hai bước + hoà bù lệch
        const a = Math.min(1, Math.max(0, (s.elapsed - s.stepped * DT) / DT))
        s.offset.multiplyScalar(Math.exp(-dt / (SMOOTH_S / 3)))
        s.pivot.position.set(
          s.prev[0] + (s.g.pos[0] - s.prev[0]) * a + s.offset.x,
          s.prev[1] + (s.g.pos[1] - s.prev[1]) * a + s.offset.y,
          s.prev[2] + (s.g.pos[2] - s.prev[2]) * a + s.offset.z,
        )
        // xoay: bay = lộn quanh trục vuông góc vận tốc, ω ∝ tốc độ; lăn trên sàn ω = v / bán kính; nằm yên = đứng yên
        if (!s.g.resting) {
          const sp = Math.hypot(s.g.vel[0], s.g.vel[1], s.g.vel[2])
          if (sp > 0.05) {
            _v.set(s.g.vel[0], s.g.vel[1], s.g.vel[2])
            _axis.crossVectors(_v, _up)
            if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0)
            _axis.normalize()
            const rolling = Math.abs(s.g.vel[1]) < 0.5 && s.g.pos[1] < GRENADE.radius * 2.5
            const omega = rolling ? Math.hypot(s.g.vel[0], s.g.vel[2]) / GRENADE.radius : sp * SPIN_PER_MS
            s.quat.premultiply(_dq.setFromAxisAngle(_axis, omega * dt))
            s.pivot.quaternion.copy(s.quat)
          }
        }
        s.view.pos.copy(s.pivot.position); s.view.resting = s.g.resting
      }
      // thìa văng ra: vật lý như lựu đạn nhỏ, biến mất sau 5 giây
      for (let i = spoons.length - 1; i >= 0; i--) {
        const p = spoons[i]!
        p.age += dt
        if (p.age > SPOON_LIFE_S) { scene.remove(p.pivot); spoons[i] = spoons[spoons.length - 1]!; spoons.pop(); continue }
        p.acc += dt
        while (p.acc >= DT) {
          p.acc -= DT
          p.prev[0] = p.g.pos[0]; p.prev[1] = p.g.pos[1]; p.prev[2] = p.g.pos[2]
          if (world) stepGrenade(p.g, world, DT)
        }
        const a = p.acc / DT
        p.pivot.position.set(p.prev[0] + (p.g.pos[0] - p.prev[0]) * a, p.prev[1] + (p.g.pos[1] - p.prev[1]) * a, p.prev[2] + (p.g.pos[2] - p.prev[2]) * a)
        if (!p.g.resting) {
          p.pivot.rotateX(p.spin.x * dt); p.pivot.rotateY(p.spin.y * dt); p.pivot.rotateZ(p.spin.z * dt)
        }
      }
    },

    /** Các quả đang có (cảnh báo gần, G.9). Vị trí đã nội suy */
    list(): GrenadeView[] { return sims.map(s => s.view) },

    clear(): void {
      for (const s of sims) scene.remove(s.pivot)
      for (const p of spoons) scene.remove(p.pivot)
      sims.length = 0; spoons.length = 0
    },
  }
}

export type Grenades = ReturnType<typeof createGrenades>
