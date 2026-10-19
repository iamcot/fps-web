import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { defaultMovement, NetFlag, TEAMS, type TeamId } from '@fps/shared'
import { MUZZLE_FALLBACK, makeFlashTexture } from './viewmodel'

// Tối thiểu để vẽ; NetPlayer và InterpPlayer đều thoả
interface RenderPlayer { id: number; pos: [number, number, number]; yaw: number; flags: number; weapon?: number }

export interface TeamInfo {
  teamOf(id: number): TeamId | undefined
  nameOf(id: number): string | undefined
  myTeam(): TeamId | undefined
}

const FLASH_MS = 60
const SKIN = 0xe0b090
const WEAPON_FILES = ['/models/ak47.glb', '/models/m16.glb', '/models/colt.glb', '/models/rouleau.glb']

// Súng cầm trên tay người khác: load một lần mỗi loại, mỗi người clone (dùng chung geometry/material)
const gunModels = new Map<number, THREE.Object3D>()
let gunsRequested = false
function requestGuns(): void {
  if (gunsRequested) return
  gunsRequested = true
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  WEAPON_FILES.forEach((file, id) => {
    loader.loadAsync(file).then(gltf => {
      gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false } })
      gunModels.set(id, gltf.scene)
    }).catch(err => console.warn(`players: cannot load ${file}`, err))
  })
}

// Nhãn tên đồng đội: sprite canvas tạo một lần cho mỗi người
function makeNameSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 64
  const g = c.getContext('2d')!
  g.font = 'bold 34px monospace'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 128, 32)
  g.fillStyle = color; g.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(c)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sp.scale.set(1.6, 0.4, 1)
  sp.renderOrder = 10
  return sp
}

// Kích thước khớp hitbox (shared/hitbox.ts): chân 0–0.8, thân 0.8–1.45, đầu 1.45–1.8 (rộng 0.35, sâu 0.3)
// và thân rộng ≤ 0.6. Gốc ở chân, mặt nhìn −Z (yaw 0), lưng +Z.
interface Rig {
  root: THREE.Group
  mats: THREE.MeshLambertMaterial[]
  team: TeamId
  gunAnchor: THREE.Group
  gun: THREE.Object3D | null
  gunId: number
  flash: THREE.Sprite
  flashUntil: number
}

function buildRig(team: TeamId): Rig {
  const root = new THREE.Group()
  const mats: THREE.MeshLambertMaterial[] = []
  const mat = (color: number) => {
    const m = new THREE.MeshLambertMaterial({ color, transparent: true })
    mats.push(m)
    return m
  }
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
    m.position.set(x, y, z)
    m.castShadow = true
    parent.add(m)
    return m
  }
  const cop = team === 'A'
  const cloth = cop ? TEAMS.A.color : 0x1c1c1c
  const pants = cop ? 0x1d2f55 : 0x2e2e2e

  // Chân + thân + đầu
  box(root, 0.22, 0.8, 0.26, pants, -0.1, 0.4, 0)
  box(root, 0.22, 0.8, 0.26, pants, 0.1, 0.4, 0)
  box(root, 0.4, 0.65, 0.26, cloth, 0, 1.125, 0)
  box(root, 0.35, 0.35, 0.3, SKIN, 0, 1.625, 0)

  // Tay: nhấc về phía trước như đang cầm súng (pivot ở vai)
  const arm = (x: number, rotX: number, rotZ: number) => {
    const p = new THREE.Group()
    p.position.set(x, 1.4, 0)
    p.rotation.set(rotX, 0, rotZ)
    box(p, 0.1, 0.6, 0.14, cloth, 0, -0.3, 0)
    box(p, 0.1, 0.1, 0.14, SKIN, 0, -0.62, 0)   // bàn tay
    root.add(p)
  }
  arm(0.25, 1.35, 0)
  arm(-0.25, 1.15, -0.35)

  if (cop) {
    // Mũ kê-pi: hộp dẹt + vành trước
    box(root, 0.38, 0.1, 0.34, 0x1b2748, 0, 1.85, 0)
    box(root, 0.38, 0.03, 0.14, 0x0e0e0e, 0, 1.81, -0.2)
    box(root, 0.39, 0.03, 0.35, 0xd9b84a, 0, 1.79, 0)   // dải vàng
  } else {
    // Sọc ngang trên thân, khăn che nửa mặt dưới, túi tiền sau lưng
    for (const y of [0.95, 1.12, 1.29]) box(root, 0.42, 0.05, 0.28, 0xe8e8e8, 0, y, 0)
    box(root, 0.37, 0.16, 0.32, 0x111111, 0, 1.53, 0)
    box(root, 0.37, 0.07, 0.32, 0x111111, 0, 1.76, 0)   // khăn buộc trán
    const sack = box(root, 0.32, 0.34, 0.16, 0x7a6a3a, 0, 1.1, 0.21)
    box(sack, 0.12, 0.08, 0.1, 0x4f4326, 0, 0.2, 0)   // miệng túi
  }

  // Súng đặt trước người, ngang tầm bàn tay phải, chĩa −Z
  const gunAnchor = new THREE.Group()
  gunAnchor.position.set(0.25, 1.28, -0.4)
  root.add(gunAnchor)
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeFlashTexture(), transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  }))
  flash.scale.set(0.3, 0.3, 1)
  flash.renderOrder = 10
  flash.visible = false
  gunAnchor.add(flash)

  return { root, mats, team, gunAnchor, gun: null, gunId: -1, flash, flashUntil: 0 }
}

function disposeRig(r: Rig): void {
  r.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
  for (const m of r.mats) m.dispose()
  r.flash.material.map?.dispose()
  r.flash.material.dispose()
}

// Người chơi = người khối hộp (Cớm / Cướp); pos là vị trí chân. Cao đứng/ngồi lấy từ MovementConfig.
export function createPlayersRenderer(scene: THREE.Scene, info?: TeamInfo) {
  const { standHeight, crouchHeight } = defaultMovement
  const rigs = new Map<number, Rig>()
  const lastSeen = new Map<number, number>()   // id → số frame cuối được thấy (tránh cấp phát Set mỗi frame)
  const labels = new Map<number, THREE.Sprite>()
  let frame = 0
  requestGuns()

  // Dựng lại khi đội đổi (TeamAssigned đến sau snapshot đầu)
  function ensure(id: number): Rig {
    const team = info?.teamOf(id) ?? 'A'
    let r = rigs.get(id)
    if (r && r.team !== team) { scene.remove(r.root); disposeRig(r); r = undefined }
    if (!r) {
      r = buildRig(team)
      scene.add(r.root)
      rigs.set(id, r)
    }
    return r
  }

  // Tên chỉ cho đồng đội, kẻ địch không có nhãn
  function dressLabel(id: number, r: Rig, h: number): void {
    const team = info?.teamOf(id)
    let label = labels.get(id)
    const mate = team !== undefined && team === info?.myTeam()
    if (mate && !label) {
      const name = info?.nameOf(id)
      if (name) {
        label = makeNameSprite(name, TEAMS[team!].uiColor)
        scene.add(label)
        labels.set(id, label)
      }
    }
    if (label) {
      label.visible = mate && r.root.visible
      label.position.set(r.root.position.x, r.root.position.y + h + 0.5, r.root.position.z)
    }
  }

  function dressGun(r: Rig, weapon: number): void {
    if (r.gunId === weapon && r.gun) return
    const src = gunModels.get(weapon)
    if (!src) return   // chưa load xong: thử lại frame sau
    if (r.gun) r.gunAnchor.remove(r.gun)
    r.gun = src.clone(true)
    r.gunId = weapon
    r.gunAnchor.add(r.gun)
    // Toạ độ đầu nòng đã đo sẵn trong hệ gunGroup (node 'muzzle' nằm trong GunRoot đã scale nên không dùng trực tiếp)
    r.flash.position.copy(MUZZLE_FALLBACK[weapon] ?? MUZZLE_FALLBACK[0]!)
  }

  function place(id: number, r: Rig, p: RenderPlayer, nowMs: number) {
    const h = (p.flags & NetFlag.Crouching) ? crouchHeight : standHeight
    r.root.scale.y = h / standHeight
    r.root.position.set(p.pos[0], p.pos[1], p.pos[2])
    r.root.rotation.y = p.yaw
    r.root.visible = !(p.flags & NetFlag.Dead)   // người chết không vẽ
    // Bất tử: nhấp nháy mờ
    const op = (p.flags & NetFlag.Invuln) ? 0.55 + 0.3 * Math.sin(nowMs / 70) : 1
    if (r.mats[0]!.opacity !== op || op !== 1) for (const m of r.mats) m.opacity = op
    dressGun(r, p.weapon ?? 0)
    r.flash.visible = nowMs < r.flashUntil
    dressLabel(id, r, h)
  }

  return {
    // Vẽ đúng danh sách người chơi trong snapshot; ai không còn trong danh sách thì xoá.
    // Không vẽ chính mình: camera nằm trong thân, lệch vài frame (jitter) là lộ ra.
    update(players: RenderPlayer[], selfId = -1) {
      frame++
      const now = performance.now()
      for (const p of players) {
        if (p.id === selfId) continue
        const r = ensure(p.id)
        lastSeen.set(p.id, frame)
        place(p.id, r, p, now)
      }
      for (const [id, r] of rigs) {
        if (lastSeen.get(id) === frame) continue
        scene.remove(r.root)
        disposeRig(r)
        const lb = labels.get(id)
        if (lb) { scene.remove(lb); lb.material.map?.dispose(); lb.material.dispose(); labels.delete(id) }
        rigs.delete(id)
        lastSeen.delete(id)
      }
    },
    // Lửa đầu nòng khi nhận ShotFx của người này
    muzzleFlash(id: number) {
      const r = rigs.get(id)
      if (r) r.flashUntil = performance.now() + FLASH_MS
    },
    clear() { this.update([]) },
  }
}
