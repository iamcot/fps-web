import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { defaultMovement, ECONOMY, NetFlag, TEAMS, WEAPONS, type TeamId } from '@fps/shared'
import { makeBlobShadow } from './blobShadow'
import { MUZZLE_FALLBACK, makeFlashTexture, adjustModel } from './viewmodel'
import { BlockArm } from './blockArm'
import { poses, weaponPose, getAnchor, scanModelAnchors, colorOf, type Vec3, type WeaponPose } from './poses'
import { getCharacterSet, disposeRig, type CharacterRig } from './characters'
import { makeSkeletalRig, requestCharacters, skeletalEnabled, skeletalReady } from './characterRig'
import { GRENADE_ID } from '@fps/shared'
import { makeAnimState, updateAnim, HEAD_PITCH, type AnimState } from './characters/animate'
import { createDeathFx } from './characters/deathFx'

// Tối thiểu để vẽ; NetPlayer và InterpPlayer đều thoả
interface RenderPlayer { id: number; pos: [number, number, number]; yaw: number; pitch?: number; flags: number; weapon?: number; killStreak?: number; adsT?: number }

export interface TeamInfo {
  teamOf(id: number): TeamId | undefined
  nameOf(id: number): string | undefined
  myTeam(): TeamId | undefined
  characterSet?(): string   // bộ nhân vật của phòng (mặc định nếu thiếu)
}

const FLASH_MS = 60
const WANTED_STREAK = ECONOMY.bountyStreak   // killStreak từ ngần này: dấu truy nã trên đầu
const WEAPON_FILES = ['/models/ak47.glb', '/models/m16.glb', '/models/colt.glb', '/models/rouleau.glb', '/models/sniper.glb', '/models/shotgun.glb', '/models/knife_1.glb', '/models/submachine.glb', '/models/grenades/m67.glb']

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
      adjustModel(id, gltf.scene)
      scanModelAnchors(id, gltf.scene)
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

// Dấu truy nã: ngôi sao vàng viền đỏ, một texture dùng chung
let wantedTex: THREE.CanvasTexture | null = null
function makeWantedSprite(): THREE.Sprite {
  if (!wantedTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 29 : 12, a = -Math.PI / 2 + i * Math.PI / 5
      g.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r)
    }
    g.closePath()
    g.fillStyle = '#ffd23c'; g.fill()
    g.lineWidth = 4; g.strokeStyle = '#d02020'; g.stroke()
    wantedTex = new THREE.CanvasTexture(c)
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: wantedTex, depthTest: false, transparent: true }))
  sp.scale.set(0.5, 0.5, 1)
  sp.renderOrder = 11
  return sp
}

// Mỗi người = một rig dựng từ bộ nhân vật của phòng (render/characters) + súng + lửa nòng + animation.
// Súng 2 tay (poses.json third.hold = twoHand): súng gắn vào `holder` (con của `aimPivot`, xoay theo pitch),
// hai BlockArm bám hai điểm neo trên súng bằng IK. Súng 1 tay: như cũ (súng ở bàn tay phải của rig).
interface Actor {
  rig: CharacterRig
  anim: AnimState
  gun: THREE.Object3D | null
  gunId: number
  flash: THREE.Sprite
  flashUntil: number
  wasDead: boolean
  aimPivot: THREE.Group
  holder: THREE.Group
  armR: BlockArm | null   // null với nhân vật có xương (IK nằm trong rig.skel)
  armL: BlockArm | null
  twoHand: boolean | null   // null = chưa chọn chế độ
  drop: GunDrop | null      // súng rơi khỏi tay xác (nhân vật có xương)
  pulling: boolean          // đang rút chốt (người khác): hết cử động tay trái thì chốt rời quả
  pinOff: boolean           // chốt đã rút: ẩn node `pin` trên quả trong tay
  thrown: boolean           // vừa ném: sau khi hết animation ném, quả mới (nếu còn) hiện lại trong tay
}

// Súng rơi khỏi tay người chết: rơi thẳng + xoay, nằm xuống sàn, mờ dần cùng xác
const DROP_GRAVITY = 9.8
const DROP_SETTLE_S = 0.2
const DROP_HOLD_S = 3
const DROP_FADE_S = 0.7
const KILL_MEMORY_MS = 3000   // tin Kill đến trước snapshot chết trong khoảng này vẫn được dùng để chọn kiểu chết
interface GunDrop {
  obj: THREE.Object3D; mats: THREE.Material[]
  vy: number; wx: number; wz: number; floorY: number
  landed: boolean; settleT: number; age: number
  from: THREE.Quaternion; to: THREE.Quaternion
}

const HIP_Y = 0.8   // khớp kit.ts: `upper` có gốc ở hông
const _m = new THREE.Matrix4()
const _eul = new THREE.Euler()
const _anchor = new THREE.Vector3()
const _shoulder = new THREE.Vector3()
const _pole = new THREE.Vector3()
const _handTarget = new THREE.Vector3()
const DEG = Math.PI / 180

function makeActor(rig: CharacterRig, dead: boolean): Actor {
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeFlashTexture(), transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  }))
  flash.scale.set(0.3, 0.3, 1)
  flash.renderOrder = 10
  flash.visible = false
  rig.gunAnchor.add(flash)
  rig.root.add(makeBlobShadow())
  if (rig.skel) {
    return { rig, anim: makeAnimState(), gun: null, gunId: -1, flash, flashUntil: 0, wasDead: dead, aimPivot: rig.skel.aimPivot, holder: rig.skel.holder, armR: null, armL: null, twoHand: null, drop: null, pulling: false, pinOff: false, thrown: false }
  }
  const aimPivot = new THREE.Group()
  const holder = new THREE.Group()
  aimPivot.add(holder)
  rig.upper.add(aimPivot)
  const sleeve = colorOf(poses.style.sleeveColor[rig.team])
  const skin = colorOf(poses.style.skinColor)
  const armR = new BlockArm(() => poses.style.third, sleeve, skin)
  const armL = new BlockArm(() => poses.style.third, sleeve, skin)
  armR.setVisible(false); armL.setVisible(false)
  rig.upper.add(armR.root, armL.root)
  for (const arm of [armR, armL]) rig.mats.push(...arm.mats)
  return { rig, anim: makeAnimState(), gun: null, gunId: -1, flash, flashUntil: 0, wasDead: dead, aimPivot, holder, armR, armL, twoHand: null, drop: null, pulling: false, pinOff: false, thrown: false }
}

function disposeActor(a: Actor): void {
  if (a.drop) { a.drop.obj.removeFromParent(); for (const m of a.drop.mats) m.dispose(); a.drop = null }
  if (a.rig.skel) a.rig.skel.dispose(); else disposeRig(a.rig)
  a.armR?.dispose(); a.armL?.dispose()
  a.flash.material.map?.dispose()
  a.flash.material.dispose()
}

// Chuyển giữa tay khối cũ (súng 1 tay) và hai BlockArm (súng 2 tay) ngay trong frame đổi súng
function setHold(a: Actor, two: boolean): void {
  if (a.twoHand === two) return
  a.twoHand = two
  const { rig } = a
  if (rig.skel) {
    const parent = two ? a.holder : rig.gunAnchor
    if (a.gun) parent.add(a.gun)
    parent.add(a.flash)
    return
  }
  rig.armR.visible = rig.armL.visible = !two
  const swap = (from: THREE.Mesh[], to: THREE.Mesh[]) => {
    for (const m of from) { const i = rig.parts.indexOf(m); if (i >= 0) rig.parts.splice(i, 1) }
    for (const m of to) if (!rig.parts.includes(m)) rig.parts.push(m)
  }
  const old: THREE.Mesh[] = []
  for (const g of [rig.armL, rig.armR]) g.traverse(o => { if (o instanceof THREE.Mesh) old.push(o) })
  const blocks = [...a.armR!.meshes, ...a.armL!.meshes]
  if (two) swap(old, blocks); else swap(blocks, old)
  if (!two) { a.armR!.setVisible(false); a.armL!.setVisible(false) }
  const parent = two ? a.holder : rig.gunAnchor
  if (a.gun) parent.add(a.gun)
  parent.add(a.flash)
}

// Súng ở holder: tư thế thường, hoặc (người đó đang ngắm) trượt dần sang adsGunPos/adsGunRotDeg: lên cao, sát má.
// poses.json không có adsGunPos thì dùng ADS_THIRD_SHIFT cộng vào tư thế thường
const ADS_THIRD_SHIFT: Vec3 = [-0.06, 0.1, 0.03]
function placeHolder(a: Actor, weapon: number, wp: WeaponPose['third'], adsT: number): void {
  const k = WEAPONS[weapon]?.ads ? smoothstep01((adsT - 0.3) / 0.4) : 0
  const gp = wp.adsGunPos ?? null, gr = wp.adsGunRotDeg ?? wp.gunRotDeg
  const px = gp ? gp[0] : wp.gunPos[0] + ADS_THIRD_SHIFT[0], py = gp ? gp[1] : wp.gunPos[1] + ADS_THIRD_SHIFT[1], pz = gp ? gp[2] : wp.gunPos[2] + ADS_THIRD_SHIFT[2]
  a.holder.position.set(wp.gunPos[0] + (px - wp.gunPos[0]) * k, wp.gunPos[1] + (py - wp.gunPos[1]) * k, wp.gunPos[2] + (pz - wp.gunPos[2]) * k)
  a.holder.rotation.copy(_eul.set(
    (wp.gunRotDeg[0] + (gr[0] - wp.gunRotDeg[0]) * k) * DEG, (wp.gunRotDeg[1] + (gr[1] - wp.gunRotDeg[1]) * k) * DEG, (wp.gunRotDeg[2] + (gr[2] - wp.gunRotDeg[2]) * k) * DEG, 'XYZ'))
}
function smoothstep01(x: number): number { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t) }

// Đặt súng ở holder theo poses.json rồi giải IK hai tay vào hai điểm neo. Mọi toạ độ trong hệ `rig.upper`.
function solveArms(a: Actor, weapon: number, pitch: number, adsT: number): void {
  const t = poses.third, wp = weaponPose(weapon).third
  a.aimPivot.position.set(t.aimPivot[0], t.aimPivot[1] - HIP_Y, t.aimPivot[2])
  a.aimPivot.rotation.x = pitch * HEAD_PITCH
  placeHolder(a, weapon, wp, adsT)
  a.aimPivot.updateMatrix(); a.holder.updateMatrix()
  _m.multiplyMatrices(a.aimPivot.matrix, a.holder.matrix)
  const arm = (side: 'R' | 'L') => {
    const sh = side === 'R' ? t.shoulderR : t.shoulderL, pl = side === 'R' ? t.poleR : t.poleL
    _shoulder.set(sh[0], sh[1] - HIP_Y, sh[2])
    _pole.set(sh[0] + pl[0], sh[1] - HIP_Y + pl[1], sh[2] + pl[2])
    getAnchor(weapon, side === 'R' ? 'hand_r' : 'hand_l', _anchor)
    _handTarget.copy(_anchor).applyMatrix4(_m)
    ;(side === 'R' ? a.armR! : a.armL!).solve(_shoulder, _handTarget, _pole)
  }
  arm('R'); arm('L')
}

const _gq = new THREE.Quaternion()
const _rq = new THREE.Quaternion()
const _sh = new THREE.Vector3()
// Nhân vật có xương: đặt súng ở holder rồi IK hai bàn tay thật vào hai điểm neo, gập ngón. Mọi toạ độ thế giới.
function solveSkelArms(a: Actor, weapon: number, adsT: number): void {
  const sk = a.rig.skel!, wp = weaponPose(weapon).third, c = poses.character
  placeHolder(a, weapon, wp, adsT)
  a.holder.updateWorldMatrix(true, false)
  a.holder.getWorldQuaternion(_gq)
  sk.root.getWorldQuaternion(_rq)
  for (const side of ['R', 'L'] as const) {
    const arm = side === 'R' ? sk.armR : sk.armL
    getAnchor(weapon, side === 'R' ? 'hand_r' : 'hand_l', _anchor)
    _handTarget.copy(_anchor).applyMatrix4(a.holder.matrixWorld)
    arm.upper.getWorldPosition(_sh)
    const pl = side === 'R' ? c.poleR : c.poleL
    _pole.set(pl[0], pl[1], pl[2]).applyQuaternion(_rq).add(_sh)
    ;(side === 'R' ? sk.lastTargetR : sk.lastTargetL).copy(_handTarget)
    arm.solve(_handTarget, _gq, _pole, sk.ikWeight)
    arm.applyGrip(sk.ikWeight)
  }
}

// Cầm lựu đạn (người khác): tay trái chạm vòng chốt khi rút chốt, chốt rời quả sau đó, quả trong tay ẩn tới khi ném xong.
function nadeHand(a: Actor): void {
  const sk = a.rig.skel!, gun = a.gun!
  if (a.pulling && sk.pullT <= 0) { a.pinOff = true; a.pulling = false }
  if (a.thrown && !sk.throwActive) { a.thrown = false; a.pinOff = false }   // ném xong: quả mới (nếu còn) trong tay, chốt về chỗ cũ
  gun.visible = !sk.throwReleased
  const pin = gun.getObjectByName('pin')
  if (pin) pin.visible = !a.pinOff
  const w = sk.pullWeight
  if (w <= 0) return
  gun.updateWorldMatrix(true, true)
  getAnchor(GRENADE_ID, 'pin_pull', _anchor)
  _handTarget.copy(_anchor).applyMatrix4(gun.matrixWorld)
  gun.getWorldQuaternion(_gq)
  sk.root.getWorldQuaternion(_rq)
  sk.armL.upper.getWorldPosition(_sh)
  const pl = poses.character.poleL
  _pole.set(pl[0], pl[1], pl[2]).applyQuaternion(_rq).add(_sh)
  sk.armL.solve(_handTarget, _gq, _pole, w)
  sk.armL.applyGrip(w)
}

// pos là vị trí chân. Cao đứng/ngồi lấy từ MovementConfig (chỉ co chân khi ngồi, đỉnh đầu khớp hitbox).
export function createPlayersRenderer(scene: THREE.Scene, info?: TeamInfo) {
  const { standHeight, crouchHeight } = defaultMovement
  const actors = new Map<number, Actor>()
  const lastSeen = new Map<number, number>()   // id → số frame cuối được thấy (tránh cấp phát Set mỗi frame)
  const labels = new Map<number, THREE.Sprite>()
  const wanted = new Map<number, THREE.Sprite>()   // dấu truy nã trên đầu người có chuỗi hạ ≥ WANTED_STREAK (thấy cả với kẻ địch)
  const deathFx = createDeathFx(scene)
  let frame = 0
  let lastNow = performance.now()
  let setId = ''
  requestGuns()
  requestCharacters()

  function dropActor(id: number, a: Actor): void {
    dropWanted(id)
    scene.remove(a.rig.root)
    disposeActor(a)
    actors.delete(id)
    lastSeen.delete(id)
  }

  // Dựng lại khi đội đổi (TeamAssigned đến sau snapshot đầu) hoặc đổi bộ nhân vật
  function ensure(p: RenderPlayer): Actor {
    const team = info?.teamOf(p.id) ?? 'A'
    const wantSkel = skeletalEnabled() && getCharacterSet(setId).id === 'copRobber' && skeletalReady(team)   // bộ mặc định = Cớm & Cướp có xương
    let a = actors.get(p.id)
    if (a && (a.rig.team !== team || !!a.rig.skel !== wantSkel)) { dropActor(p.id, a); a = undefined }
    if (!a) {
      a = makeActor(wantSkel ? makeSkeletalRig(team) : getCharacterSet(setId).build(team), (p.flags & NetFlag.Dead) !== 0)
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

  function dropWanted(id: number): void {
    const w = wanted.get(id)
    if (!w) return
    scene.remove(w); w.material.dispose(); wanted.delete(id)
  }

  function dressWanted(p: RenderPlayer, a: Actor, h: number): void {
    const on = (p.killStreak ?? 0) >= WANTED_STREAK && a.rig.root.visible
    let w = wanted.get(p.id)
    if (!on) { if (w) dropWanted(p.id); return }
    if (!w) { w = makeWantedSprite(); scene.add(w); wanted.set(p.id, w) }
    // Cao hơn nhãn tên đồng đội một chút để không chồng lên
    w.position.set(a.rig.root.position.x, a.rig.root.position.y + h + 0.95, a.rig.root.position.z)
  }

  function dressGun(a: Actor, weapon: number): void {
    if (a.gunId === weapon && a.gun) return
    const src = gunModels.get(weapon)
    if (!src) return   // chưa load xong: thử lại frame sau
    const parent = a.twoHand ? a.holder : a.rig.gunAnchor
    if (a.gun) a.gun.removeFromParent()
    a.gun = src.clone(true)
    a.gunId = weapon
    a.pinOff = false; a.pulling = false; a.thrown = false
    if (weapon === GRENADE_ID) {   // lựu đạn: tâm lòng bàn tay (anchor hand_r) trùng gốc gunAnchor
      getAnchor(weapon, 'hand_r', _anchor)
      a.gun.position.set(-_anchor.x, -_anchor.y, -_anchor.z)
    }
    parent.add(a.gun)
    // Toạ độ đầu nòng đã đo sẵn trong hệ gunGroup (node 'muzzle' nằm trong GunRoot đã scale nên không dùng trực tiếp)
    a.flash.position.copy(MUZZLE_FALLBACK[weapon] ?? MUZZLE_FALLBACK[0]!)
  }

  const killMemory = new Map<number, { headshot: boolean; t: number }>()
  const _e = new THREE.Euler(), _fwd = new THREE.Vector3(), _roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)

  // Súng rời tay: giữ nguyên toạ độ thế giới, rơi + xoay. Vật liệu nhân bản để mờ riêng (geometry dùng chung nên không dispose)
  function dropGun(a: Actor): void {
    if (!a.gun || a.drop) return
    const g = a.gun
    g.updateWorldMatrix(true, false)
    scene.attach(g)
    const mats: THREE.Material[] = []
    g.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.material = (o.material as THREE.Material).clone()
      ;(o.material as THREE.Material).transparent = true
      mats.push(o.material as THREE.Material)
    })
    _fwd.set(0, 0, -1).applyQuaternion(g.quaternion)
    const yaw = Math.atan2(-_fwd.x, -_fwd.z)
    const to = new THREE.Quaternion().setFromEuler(_e.set(0, yaw, 0)).multiply(_roll)
    a.drop = {
      obj: g, mats, vy: 0, wx: (Math.random() - 0.5) * 6, wz: (Math.random() - 0.5) * 6,
      floorY: a.rig.root.position.y + 0.06, landed: false, settleT: 0, age: 0, from: new THREE.Quaternion(), to,
    }
    a.gun = null; a.gunId = -1
    a.flash.visible = false
  }

  function clearDrop(a: Actor): void {
    const d = a.drop
    if (!d) return
    d.obj.removeFromParent()
    for (const m of d.mats) m.dispose()
    a.drop = null
  }

  function updateDrop(a: Actor, dt: number): void {
    const d = a.drop
    if (!d) return
    d.age += dt
    if (!d.landed) {
      d.vy -= DROP_GRAVITY * dt
      d.obj.position.y += d.vy * dt
      d.obj.rotateX(d.wx * dt); d.obj.rotateZ(d.wz * dt)
      if (d.obj.position.y <= d.floorY) { d.obj.position.y = d.floorY; d.landed = true; d.from.copy(d.obj.quaternion) }
    } else if (d.settleT < DROP_SETTLE_S) {
      d.settleT += dt
      d.obj.quaternion.slerpQuaternions(d.from, d.to, Math.min(1, d.settleT / DROP_SETTLE_S))
    }
    const fade = Math.min(1, Math.max(0, (d.age - DROP_HOLD_S) / DROP_FADE_S))
    if (fade > 0) for (const m of d.mats) m.opacity = 1 - fade
    d.obj.visible = fade < 1
  }

  function takeKill(id: number): boolean {
    const k = killMemory.get(id)
    killMemory.delete(id)
    return !!k && performance.now() - k.t < KILL_MEMORY_MS && k.headshot
  }

  function place(p: RenderPlayer, a: Actor, nowMs: number, dt: number) {
    const rig = a.rig
    const crouching = (p.flags & NetFlag.Crouching) !== 0
    const h = crouching ? crouchHeight : standHeight
    rig.root.position.set(p.pos[0], p.pos[1], p.pos[2])
    rig.root.rotation.y = p.yaw
    const dead = (p.flags & NetFlag.Dead) !== 0
    const weapon = p.weapon ?? 0
    const sliding = (p.flags & NetFlag.Sliding) !== 0, grounded = (p.flags & NetFlag.Grounded) !== 0
    if (rig.skel) {
      // Nhân vật có xương. Thứ tự bắt buộc: mixer → spine theo pitch → súng → IK tay → ngón
      const sk = rig.skel
      if (dead && !sk.isDead) { sk.die(takeKill(p.id)); dropGun(a) }
      else if (!dead && sk.isDead) { sk.revive(); clearDrop(a) }
      a.wasDead = dead
      const frame = { dt, x: p.pos[0], z: p.pos[2], yaw: p.yaw, grounded, crouching, sliding, pitch: p.pitch ?? 0, pistol: false, dead }
      if (!dead) {
        dressGun(a, weapon)
        const two = weaponPose(weapon).third.hold === 'twoHand' && !!a.gun
        setHold(a, two)
        frame.pistol = !two
        sk.animate(frame)
        sk.placeAim()
        if (two) solveSkelArms(a, weapon, p.adsT ?? 0)
        else sk.refreshGunAnchor()
        if (weapon === GRENADE_ID && a.gun) nadeHand(a)
        sk.setOpacity((p.flags & NetFlag.Invuln) ? 0.55 + 0.3 * Math.sin(nowMs / 70) : 1)
      } else {
        sk.animate(frame)
        if (sk.ikWeight > 0 && a.twoHand) { sk.placeAim(); solveSkelArms(a, weapon, 0) }   // IK mờ dần về tư thế animation
      }
      rig.root.visible = sk.corpseVisible
      dressWanted(p, a, h)
      a.flash.visible = nowMs < a.flashUntil
      dressLabel(p.id, a, h)
      return
    }
    if (dead && !a.wasDead) deathFx.burst(rig)   // vừa chết: các khối tách ra
    a.wasDead = dead
    rig.root.visible = !dead
    if (!dead) {
      updateAnim(rig, a.anim, {
        x: p.pos[0], z: p.pos[2], dt,
        grounded, crouching, sliding,
        pitch: p.pitch ?? 0, crouchDrop: standHeight - crouchHeight,
      })
    } else a.anim.hasLast = false   // hồi sinh xa chỗ chết: không tính thành chạy
    // Bất tử: nhấp nháy mờ
    const op = (p.flags & NetFlag.Invuln) ? 0.55 + 0.3 * Math.sin(nowMs / 70) : 1
    if (rig.mats[0]!.opacity !== op || op !== 1) for (const m of rig.mats) m.opacity = op
    dressGun(a, weapon)
    const two = weaponPose(weapon).third.hold === 'twoHand' && !!a.gun
    setHold(a, two)
    if (two && !dead) {
      solveArms(a, weapon, p.pitch ?? 0, p.adsT ?? 0)
      a.armR!.setVisible(true); a.armL!.setVisible(true)
    }
    dressWanted(p, a, h)
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
      for (const a of actors.values()) if (a.drop) updateDrop(a, dt)
      deathFx.update(dt)
    },
    // GrenadeAnim của người khác: rút chốt (tay trái chạm vòng chốt), ném (clip thân trên), huỷ
    grenadeAnim(id: number, phase: 'pulling' | 'throw' | 'cancel', mode: 'strong' | 'lob' = 'strong') {
      const a = actors.get(id); const sk = a?.rig.skel
      if (!a || !sk) return
      if (phase === 'pulling') { sk.startPull(); a.pulling = true; a.pinOff = false }
      else if (phase === 'throw') { sk.playThrow(mode); a.thrown = true; a.pulling = false }
      else { sk.cancelThrow(); a.pulling = false; a.pinOff = false }
    },
    /** Độ trễ (ms) từ lúc nhận GrenadeSpawn tới lúc quả rời tay trong animation của người ném; 0 nếu không có animation */
    grenadeReleaseDelayMs(id: number, mode: 'strong' | 'lob'): number { return actors.get(id)?.rig.skel?.releaseDelayMs(mode) ?? 0 },
    // Tin Kill: chọn kiểu chết (headshot → death_2) cho nhân vật có xương; đến trước hay sau snapshot chết đều dùng được
    markKill(victimId: number, headshot: boolean) {
      killMemory.set(victimId, { headshot, t: performance.now() })
      actors.get(victimId)?.rig.skel?.setDeathVariant(headshot)
    },
    // Lửa đầu nòng khi nhận ShotFx của người này
    muzzleFlash(id: number) {
      const a = actors.get(id)
      if (a) a.flashUntil = performance.now() + FLASH_MS
    },
    clear() { this.update([]); deathFx.clear() },
  }
}
