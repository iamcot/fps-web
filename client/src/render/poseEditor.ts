import * as THREE from 'three'
import { poses, WEAPON_KEYS, type FingerName, weaponPose, getAnchor, notifyPosesChanged, exportPoses, exportWeapon, resetPosesToFile, type Vec3 } from './poses'
import type { ViewmodelHandle } from './viewmodel'

// Debug (plan 10, P.6): F9 = bảng chỉnh tư thế (tay + súng, ghi thẳng vào `poses` đang chạy), F10 = camera quỹ đạo
// nhìn model của chính mình. Chỉ dùng để chỉnh; chỉnh xong "Copy JSON" rồi dán vào render/poses.json.
type Tab = 'First' | 'Third' | 'Character' | 'Grip' | 'Anchors' | 'Style' | 'Reload'
const TABS: Tab[] = ['First', 'Third', 'Character', 'Grip', 'Anchors', 'Style', 'Reload']
const FINGERS: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky']
const AXES = ['x', 'y', 'z']

export interface PoseEditor {
  readonly orbitOn: boolean
  /** Đặt camera quỹ đạo quanh (x,y,z) khi F10 bật */
  applyOrbit(camera: THREE.PerspectiveCamera, x: number, y: number, z: number): void
  /** Mỗi frame: cập nhật chấm debug / phát thử nạp đạn */
  tick(dt: number): void
}

export function createPoseEditor(vm: ViewmodelHandle, weaponId: () => number, equip?: (id: number) => void): PoseEditor {
  let open = false
  let orbit = false
  let tab: Tab = 'First'
  let selWeapon = -1   // -1 = theo súng đang cầm
  let orbitYaw = 0.6, orbitPitch = 0.25, orbitDist = 3
  let playT = -1       // phát thử nạp đạn: thời gian đã chạy (giây)

  const panel = document.createElement('div')
  panel.style.cssText = 'position:fixed;top:8px;right:8px;width:340px;max-height:calc(100vh - 16px);overflow:auto;background:rgba(10,12,16,.92);color:#dde;font:12px monospace;padding:8px;border:1px solid #445;z-index:50;display:none'
  document.body.appendChild(panel)

  // Chấm debug trong không gian camera của viewmodel
  const dots = new Map<string, THREE.Mesh>()
  const dotGeo = new THREE.SphereGeometry(0.008, 8, 6)
  const dot = (name: string, color: number) => {
    const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color, depthTest: false }))
    m.renderOrder = 20; m.visible = false
    vm.scene.add(m); dots.set(name, m)
  }
  dot('hand_r', 0xff3030); dot('hand_l', 0x3080ff); dot('mag', 0xffe030)
  dot('shoulderR', 0xffffff); dot('shoulderL', 0xffffff); dot('elbowR', 0xc040ff); dot('elbowL', 0xc040ff)
  const _v = new THREE.Vector3()

  const wid = () => (selWeapon >= 0 ? selWeapon : weaponId())
  const dirty = () => notifyPosesChanged()

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag); e.style.cssText = css; e.textContent = text; return e
  }
  function numRow(parent: HTMLElement, label: string, get: () => number, set: (v: number) => void, min: number, max: number, step = 0.005): void {
    const row = el('div', 'display:flex;align-items:center;gap:4px;margin:2px 0')
    row.append(el('span', 'width:84px;overflow:hidden;white-space:nowrap', label))
    const rng = el('input'); rng.type = 'range'; rng.min = String(min); rng.max = String(max); rng.step = String(step); rng.value = String(get()); rng.style.flex = '1'
    const num = el('input', 'width:62px;background:#111;color:#dde;border:1px solid #445'); num.type = 'number'; num.step = String(step); num.value = String(+get().toFixed(4))
    const apply = (v: number) => { if (Number.isFinite(v)) { set(v); dirty() } }
    rng.oninput = () => { num.value = rng.value; apply(parseFloat(rng.value)) }
    num.onchange = () => { rng.value = num.value; apply(parseFloat(num.value)) }
    row.append(rng, num); parent.append(row)
  }
  function vecRows(parent: HTMLElement, label: string, v: () => Vec3, min: number, max: number, step?: number): void {
    AXES.forEach((ax, i) => numRow(parent, `${label}.${ax}`, () => v()[i]!, n => { v()[i] = n }, min, max, step))
  }
  function selectRow(parent: HTMLElement, label: string, opts: string[], get: () => string, set: (v: string) => void): void {
    const row = el('div', 'margin:3px 0'); row.append(el('span', 'display:inline-block;width:84px', label))
    const s = el('select', 'background:#111;color:#dde')
    for (const o of opts) { const op = el('option', '', o); op.value = o; s.append(op) }
    s.value = get(); s.onchange = () => { set(s.value); dirty() }
    row.append(s); parent.append(row)
  }
  function btn(parent: HTMLElement, text: string, fn: () => void): void {
    const b = el('button', 'margin:2px 3px 2px 0;background:#223;color:#dde;border:1px solid #556;cursor:pointer', text)
    b.onclick = fn; parent.append(b)
  }
  function copy(obj: unknown): void {
    const text = JSON.stringify(obj, null, 2)
    navigator.clipboard?.writeText(text).catch(() => console.log(text))
  }

  function render(): void {
    panel.replaceChildren()
    const head = el('div', 'margin-bottom:4px')
    head.append(el('b', '', 'Pose editor (F9) · F10 camera quỹ đạo '))
    panel.append(head)
    const wsel = el('select', 'background:#111;color:#dde;margin-right:6px')
    const auto = el('option', '', '(súng đang cầm)'); auto.value = '-1'; wsel.append(auto)
    WEAPON_KEYS.forEach((k, i) => { const o = el('option', '', k); o.value = String(i); wsel.append(o) })
    wsel.value = String(selWeapon); wsel.onchange = () => { selWeapon = parseInt(wsel.value); if (selWeapon >= 0) equip?.(selWeapon); render() }
    head.append(wsel)
    const tabs = el('div', 'margin:4px 0')
    for (const t of TABS) { const b = el('button', `margin-right:2px;background:${t === tab ? '#446' : '#223'};color:#dde;border:1px solid #556;cursor:pointer`, t); b.onclick = () => { tab = t; render() }; tabs.append(b) }
    panel.append(tabs)

    const id = wid(), w = weaponPose(id), body = el('div')
    if (tab === 'First') {
      numRow(body, 'fov', () => poses.first.fov, v => { poses.first.fov = v }, 30, 90, 1)
      selectRow(body, 'hold', ['twoHand', 'pistolSupport', 'oneHand'], () => w.first.hold, v => { w.first.hold = v as never })
      if (!w.first.gunPos) w.first.gunPos = [0.14, -0.16, -0.36]
      vecRows(body, 'gunPos', () => w.first.gunPos!, -1, 1)
      vecRows(body, 'gunRotDeg', () => w.first.gunRotDeg, -90, 90, 0.5)
      numRow(body, 'scale', () => w.first.scale, v => { w.first.scale = v }, 0.3, 2, 0.01)
      vecRows(body, 'shoulderR', () => poses.first.shoulderR, -1, 1)
      vecRows(body, 'shoulderL', () => poses.first.shoulderL, -1, 1)
      vecRows(body, 'poleR', () => poses.first.poleR, -1, 1)
      vecRows(body, 'poleL', () => poses.first.poleL, -1, 1)
    } else if (tab === 'Third') {
      selectRow(body, 'hold', ['twoHand', 'oneHand'], () => w.third.hold, v => { w.third.hold = v as never })
      vecRows(body, 'gunPos', () => w.third.gunPos, -1, 1)
      vecRows(body, 'gunRotDeg', () => w.third.gunRotDeg, -90, 90, 0.5)
      vecRows(body, 'shoulderR', () => poses.third.shoulderR, -1, 2)
      vecRows(body, 'shoulderL', () => poses.third.shoulderL, -1, 2)
      vecRows(body, 'aimPivot', () => poses.third.aimPivot, -1, 2)
      vecRows(body, 'poleR', () => poses.third.poleR, -1, 1)
      vecRows(body, 'poleL', () => poses.third.poleL, -1, 1)
    } else if (tab === 'Character') {
      const c = poses.character, an = c.anim
      body.append(el('div', 'color:#8af', 'Nhân vật có xương (góc 3)'))
      numRow(body, 'crouchDrop', () => c.crouchDrop, v => { c.crouchDrop = v }, -0.3, 0.6, 0.01)
      numRow(body, 'crouchWalkDrop', () => c.crouchWalkDrop, v => { c.crouchWalkDrop = v }, -0.3, 0.6, 0.01)
      numRow(body, 'pitchLimit°', () => c.spinePitchLimitDeg, v => { c.spinePitchLimitDeg = v }, 10, 90, 1)
      numRow(body, 'headShare', () => c.headPitchShare, v => { c.headPitchShare = v }, 0, 1, 0.01)
      numRow(body, 'palmCenter', () => c.palmCenterFrac, v => { c.palmCenterFrac = v }, 0, 1.2, 0.01)
      vecRows(body, 'aimPivot+', () => c.aimPivotOffset, -0.6, 0.6)
      vecRows(body, 'poleR', () => c.poleR, -1, 1)
      vecRows(body, 'poleL', () => c.poleL, -1, 1)
      vecRows(body, 'handRotR°', () => c.handRotOffsetDegR, -180, 180, 1)
      vecRows(body, 'handRotL°', () => c.handRotOffsetDegL, -180, 180, 1)
      vecRows(body, '1tay.pos', () => c.oneHandGunPos, -0.3, 0.3, 0.002)
      vecRows(body, '1tay.rot°', () => c.oneHandGunRotDeg, -180, 180, 1)
      body.append(el('div', 'margin-top:6px;color:#8af', 'Animation'))
      numRow(body, 'blendTime', () => an.blendTime, v => { an.blendTime = v }, 0.02, 0.6, 0.01)
      numRow(body, 'walkRef m/s', () => an.walkRefSpeed, v => { an.walkRefSpeed = v }, 0.5, 4, 0.05)
      numRow(body, 'runRef m/s', () => an.runRefSpeed, v => { an.runRefSpeed = v }, 2, 10, 0.1)
      numRow(body, 'runStart m/s', () => an.runStartSpeed, v => { an.runStartSpeed = v }, 2, 10, 0.1)
      numRow(body, 'maxRate', () => an.maxRate, v => { an.maxRate = v }, 1, 4, 0.1)
      numRow(body, 'jumpHold s', () => an.jumpHoldS, v => { an.jumpHoldS = v }, 0, 1, 0.01)
    } else if (tab === 'Grip') {
      selectRow(body, 'axis', ['x', 'y', 'z'], () => poses.grip.axis, v => { poses.grip.axis = v as 'x' | 'y' | 'z' })
      for (const hand of ['R', 'L'] as const) {
        body.append(el('div', 'margin-top:4px;color:#8af', hand === 'R' ? 'Tay phải (độ gập đốt 1/2/3)' : 'Tay trái (độ gập đốt 1/2/3)'))
        for (const f of FINGERS) {
          const v = poses.grip[hand][f]
          for (let i = 0; i < 3; i++) numRow(body, `${f}${i + 1}`, () => v[i]!, n => { v[i] = n }, -120, 120, 1)
        }
      }
    } else if (tab === 'Anchors') {
      for (const n of ['hand_r', 'hand_l', 'mag'] as const) {
        if (!w.anchors[n]) { getAnchor(id, n, _v); w.anchors[n] = [_v.x, _v.y, _v.z] }
        vecRows(body, n, () => w.anchors[n]!, -1, 1, 0.002)
      }
    } else if (tab === 'Style') {
      for (const view of ['first', 'third'] as const) {
        body.append(el('div', 'margin-top:4px;color:#8af', view))
        const s = poses.style[view]
        numRow(body, 'upperLen', () => s.upperLen, v => { s.upperLen = v }, 0.1, 0.8)
        numRow(body, 'foreLen', () => s.foreLen, v => { s.foreLen = v }, 0.1, 0.8)
        numRow(body, 'thickness', () => s.thickness, v => { s.thickness = v }, 0.02, 0.2, 0.001)
        numRow(body, 'handSize', () => s.handSize, v => { s.handSize = v }, 0.02, 0.2, 0.001)
      }
      body.append(el('div', 'margin-top:6px', 'Màu tay áo/da đổi trong poses.json (tải lại trang để thấy).'))
    } else {
      const rl = poses.reloadLeftHand
      numRow(body, 't (dừng hình)', () => vm.debug.freezeReload, v => { vm.debug.freezeReload = v; playT = -1 }, 0, 1, 0.01)
      btn(body, 'Phát thử nạp đạn', () => { playT = 0 })
      btn(body, 'Bỏ dừng hình', () => { vm.debug.freezeReload = -1; playT = -1; render() })
      numRow(body, 'magDetachT', () => rl.magDetachT, v => { rl.magDetachT = v }, 0, 1, 0.01)
      numRow(body, 'magAttachT', () => rl.magAttachT, v => { rl.magAttachT = v }, 0, 1, 0.01)
      for (const k of ['roll', 'pitch'] as const) numRow(body, `tilt.${k}`, () => rl.gunTiltDeg[k], v => { rl.gunTiltDeg[k] = v }, -90, 90, 1)
      numRow(body, 'tilt.inT', () => rl.gunTiltDeg.inT, v => { rl.gunTiltDeg.inT = v }, 0, 1, 0.01)
      numRow(body, 'tilt.outT', () => rl.gunTiltDeg.outT, v => { rl.gunTiltDeg.outT = v }, 0, 1, 0.01)
      rl.keys.forEach((k, i) => {
        body.append(el('div', 'margin-top:4px;color:#8af', `key ${i}: → ${k.to}`))
        numRow(body, 't', () => k.t, v => { k.t = v }, 0, 1, 0.01)
        if (!k.offset) k.offset = [0, 0, 0]
        vecRows(body, 'offset', () => k.offset!, -0.6, 0.6)
      })
      body.append(el('div', 'margin-top:6px;color:#999', 'Mốc t nên trùng các mốc `at` trong profile âm thanh nạp đạn (A.6).'))
    }
    panel.append(body)
    const foot = el('div', 'margin-top:8px;border-top:1px solid #445;padding-top:6px')
    btn(foot, 'Copy JSON', () => copy(exportPoses()))
    btn(foot, 'Copy súng này', () => copy({ [WEAPON_KEYS[id]!]: exportWeapon(id) }))
    btn(foot, 'Reset về file', () => { resetPosesToFile(); render() })
    panel.append(foot)
  }

  function setOpen(v: boolean): void {
    open = v
    panel.style.display = v ? 'block' : 'none'
    vm.debug.showReach = v
    if (v) { document.exitPointerLock?.(); render() } else { vm.debug.freezeReload = -1; playT = -1 }
    for (const d of dots.values()) d.visible = v
  }
  function setOrbit(v: boolean): void {
    orbit = v
    vm.setHidden(v)
    if (v) document.exitPointerLock?.()
  }

  window.addEventListener('keydown', e => {
    if (e.code === 'F9') { e.preventDefault(); setOpen(!open) }
    else if (e.code === 'F10') { e.preventDefault(); setOrbit(!orbit) }
  })
  window.addEventListener('mousemove', e => {
    if (!orbit || (e.buttons & 1) === 0) return
    orbitYaw -= e.movementX * 0.006
    orbitPitch = Math.max(-1.2, Math.min(1.4, orbitPitch + e.movementY * 0.006))
  })
  window.addEventListener('wheel', e => { if (orbit) orbitDist = Math.max(1, Math.min(8, orbitDist + Math.sign(e.deltaY) * 0.3)) }, { passive: true })

  return {
    get orbitOn() { return orbit },
    applyOrbit(camera, x, y, z) {
      const cy = y + 1.1
      camera.position.set(
        x + Math.sin(orbitYaw) * Math.cos(orbitPitch) * orbitDist,
        cy + Math.sin(orbitPitch) * orbitDist,
        z + Math.cos(orbitYaw) * Math.cos(orbitPitch) * orbitDist,
      )
      camera.lookAt(x, cy, z)
    },
    tick(dt) {
      if (playT >= 0) {
        playT += dt
        const total = 2.2
        vm.debug.freezeReload = Math.min(1, playT / total)
        if (playT > total + 0.3) { vm.debug.freezeReload = -1; playT = -1 }
      }
      if (!open) return
      const d = vm.debug, id = vm.currentWeapon, M = d.gunGroup.matrix
      const put = (name: string, v: THREE.Vector3, on = true) => { const m = dots.get(name)!; m.position.copy(v); m.visible = on }
      put('hand_r', getAnchor(id, 'hand_r', _v).applyMatrix4(M))
      put('hand_l', getAnchor(id, 'hand_l', _v).applyMatrix4(M))
      put('mag', getAnchor(id, 'mag', _v).applyMatrix4(M))
      put('shoulderR', d.shoulderR); put('shoulderL', d.shoulderL)
      put('elbowR', d.armR.elbowPos, d.validR); put('elbowL', d.armL.elbowPos, d.validL)
    },
  }
}
