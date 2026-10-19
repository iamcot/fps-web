import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { defaultMovement, NetFlag, TEAMS, type TeamId } from '@fps/shared'
import { MUZZLE_FALLBACK, makeFlashTexture } from './viewmodel'
import { getCharacterSet, disposeRig, type CharacterRig } from './characters'
import { makeAnimState, updateAnim, type AnimState } from './characters/animate'
import { createDeathFx } from './characters/deathFx'

// Tối thiểu để vẽ; NetPlayer và InterpPlayer đều thoả
interface RenderPlayer { id: number; pos: [number, number, number]; yaw: number; pitch?: number; flags: number; weapon?: number }

export interface TeamInfo {
  teamOf(id: number): TeamId | undefined
  nameOf(id: number): string | undefined
  myTeam(): TeamId | undefined
  characterSet?(): string   // bộ nhân vật của phòng (mặc định nếu thiếu)
}

const FLASH_MS = 60
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

// Mỗi người = một rig dựng từ bộ nhân vật của phòng (render/characters) + súng + lửa nòng + animation
interface Actor {
  rig: CharacterRig
  anim: AnimState
  gun: THREE.Object3D | null
  gunId: number
  flash: THREE.Sprite
  flashUntil: number
  wasDead: boolean
}

function makeActor(rig: CharacterRig, dead: boolean): Actor {
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeFlashTexture(), transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  }))
  flash.scale.set(0.3, 0.3, 1)
  flash.renderOrder = 10
  flash.visible = false
  rig.gunAnchor.add(flash)
  return { rig, anim: makeAnimState(), gun: null, gunId: -1, flash, flashUntil: 0, wasDead: dead }
}

function disposeActor(a: Actor): void {
  disposeRig(a.rig)
  a.flash.material.map?.dispose()
  a.flash.material.dispose()
}

// pos là vị trí chân. Cao đứng/ngồi lấy từ MovementConfig (thu thân theo tỉ lệ như hitbox).
export function createPlayersRenderer(scene: THREE.Scene, info?: TeamInfo) {
  const { standHeight, crouchHeight } = defaultMovement
  const actors = new Map<number, Actor>()
  const lastSeen = new Map<number, number>()   // id → số frame cuối được thấy (tránh cấp phát Set mỗi frame)
  const labels = new Map<number, THREE.Sprite>()
  const deathFx = createDeathFx(scene)
  let frame = 0
  let lastNow = performance.now()
  let setId = ''
  requestGuns()

  function dropActor(id: number, a: Actor): void {
    scene.remove(a.rig.root)
    disposeActor(a)
    actors.delete(id)
    lastSeen.delete(id)
  }

  // Dựng lại khi đội đổi (TeamAssigned đến sau snapshot đầu) hoặc đổi bộ nhân vật
  function ensure(p: RenderPlayer): Actor {
    const team = info?.teamOf(p.id) ?? 'A'
    let a = actors.get(p.id)
    if (a && a.rig.team !== team) { dropActor(p.id, a); a = undefined }
    if (!a) {
      a = makeActor(getCharacterSet(setId).build(team), (p.flags & NetFlag.Dead) !== 0)
      scene.add(a.rig.root)
      actors.set(p.id, a)
    }
    return a
  }

  // Tên chỉ cho đồng đội, kẻ địch không có nhãn
  function dressLabel(id: number, a: Actor, h: number): void {
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
      label.visible = mate && a.rig.root.visible
      label.position.set(a.rig.root.position.x, a.rig.root.position.y + h + 0.5, a.rig.root.position.z)
    }
  }

  function dressGun(a: Actor, weapon: number): void {
    if (a.gunId === weapon && a.gun) return
    const src = gunModels.get(weapon)
    if (!src) return   // chưa load xong: thử lại frame sau
    if (a.gun) a.rig.gunAnchor.remove(a.gun)
    a.gun = src.clone(true)
    a.gunId = weapon
    a.rig.gunAnchor.add(a.gun)
    // Toạ độ đầu nòng đã đo sẵn trong hệ gunGroup (node 'muzzle' nằm trong GunRoot đã scale nên không dùng trực tiếp)
    a.flash.position.copy(MUZZLE_FALLBACK[weapon] ?? MUZZLE_FALLBACK[0]!)
  }

  function place(p: RenderPlayer, a: Actor, nowMs: number, dt: number) {
    const rig = a.rig
    const crouching = (p.flags & NetFlag.Crouching) !== 0
    const h = crouching ? crouchHeight : standHeight
    rig.root.scale.y = h / standHeight
    rig.root.position.set(p.pos[0], p.pos[1], p.pos[2])
    rig.root.rotation.y = p.yaw
    const dead = (p.flags & NetFlag.Dead) !== 0
    if (dead && !a.wasDead) deathFx.burst(rig)   // vừa chết: các khối tách ra
    a.wasDead = dead
    rig.root.visible = !dead
    if (!dead) {
      updateAnim(rig, a.anim, {
        x: p.pos[0], z: p.pos[2], dt,
        grounded: (p.flags & NetFlag.Grounded) !== 0, crouching, sliding: (p.flags & NetFlag.Sliding) !== 0,
        pitch: p.pitch ?? 0,
      })
    } else a.anim.hasLast = false   // hồi sinh xa chỗ chết: không tính thành chạy
    // Bất tử: nhấp nháy mờ
    const op = (p.flags & NetFlag.Invuln) ? 0.55 + 0.3 * Math.sin(nowMs / 70) : 1
    if (rig.mats[0]!.opacity !== op || op !== 1) for (const m of rig.mats) m.opacity = op
    dressGun(a, p.weapon ?? 0)
    a.flash.visible = nowMs < a.flashUntil
    dressLabel(p.id, a, h)
  }

  return {
    // Vẽ đúng danh sách người chơi trong snapshot; ai không còn trong danh sách thì xoá.
    // Không vẽ chính mình: camera nằm trong thân, lệch vài frame (jitter) là lộ ra.
    update(players: RenderPlayer[], selfId = -1) {
      frame++
      const now = performance.now()
      const dt = Math.min(0.1, (now - lastNow) / 1000)
      lastNow = now
      const want = info?.characterSet?.() ?? ''
      if (want !== setId) {   // đổi bộ nhân vật (vào phòng khác): dựng lại tất cả
        setId = want
        for (const [id, a] of actors) dropActor(id, a)
      }
      for (const p of players) {
        if (p.id === selfId) continue
        const a = ensure(p)
        lastSeen.set(p.id, frame)
        place(p, a, now, dt)
      }
      for (const [id, a] of actors) {
        if (lastSeen.get(id) === frame) continue
        const lb = labels.get(id)
        if (lb) { scene.remove(lb); lb.material.map?.dispose(); lb.material.dispose(); labels.delete(id) }
        dropActor(id, a)
      }
      deathFx.update(dt)
    },
    // Lửa đầu nòng khi nhận ShotFx của người này
    muzzleFlash(id: number) {
      const a = actors.get(id)
      if (a) a.flashUntil = performance.now() + FLASH_MS
    },
    clear() { this.update([]); deathFx.clear() },
  }
}
