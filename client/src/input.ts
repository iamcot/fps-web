import * as THREE from 'three'
import { Btn } from '@fps/shared'
import { t } from './i18n'

const LS_SENS_KEY = 'fps_sens'
let _sens = parseFloat(localStorage.getItem(LS_SENS_KEY) ?? '') || 0.0022

export let yaw = 0
export let pitch = 0

let _locked = false
let _skipFirstMove = false
const _keys: Record<string, boolean> = {}
let _mouseLeft = false
let _mouseRight = false
let _wheel = 0       // tổng bước lăn chuột chưa đọc (dấu: >0 lăn xuống)
let _sensScale = 1   // giảm độ nhạy khi zoom (tỉ lệ theo FOV)
let _flashlight = true         // đèn pin (phím F), mặc định bật; chỉ có tác dụng ban đêm
let _flashlightAllowed = false // phòng ban đêm + mình là người

// ── Overlay ───────────────────────────────────────────────────────────────────
const _overlay = document.createElement('div')
_overlay.style.cssText =
  'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
  'background:rgba(0,0,0,0);color:#fff;font:28px monospace;cursor:pointer;z-index:10;' +
  'user-select:none'
_overlay.textContent = t('Click to play')
document.body.appendChild(_overlay)

/** Offline cho phép bỏ lớp tối của màn "Click to play" để dễ nhìn khi chỉnh tay/súng */
export function setOverlayDim(dim: boolean): void {
  _overlay.style.background = dim ? 'rgba(0,0,0,0.55)' : 'transparent'
  _overlay.style.textShadow = dim ? '' : '0 0 6px #000, 0 0 3px #000'
}

function _setLocked(v: boolean) {
  _locked = v
  _overlay.style.display = v ? 'none' : 'flex'
}

export function initInput(canvas: HTMLElement): void {
  canvas.addEventListener('click', () => canvas.requestPointerLock())
  _overlay.addEventListener('click', () => canvas.requestPointerLock())

  document.addEventListener('pointerlockchange', () => {
    const isLocked = document.pointerLockElement === canvas
    _setLocked(isLocked)
    if (isLocked) {
      _skipFirstMove = true
    } else {
      // Xóa key state khi thoát pointer lock — tránh phím bị "kẹt"
      // vì browser không gửi keyup sau khi thoát lock
      for (const k in _keys) _keys[k] = false
      _mouseLeft = false
      _mouseRight = false
    }
  })

  document.addEventListener('mousemove', (e) => {
    if (!_locked) return
    if (_skipFirstMove) {
      _skipFirstMove = false
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return
    }
    if (_free) {
      camYaw -= e.movementX * _sens * _sensScale
      camPitch = Math.max(FREE_PITCH_MIN, Math.min(FREE_PITCH_MAX, camPitch - e.movementY * _sens * _sensScale))
      return
    }
    yaw   -= e.movementX * _sens * _sensScale
    pitch -= e.movementY * _sens * _sensScale
    pitch  = Math.max(-1.553, Math.min(1.553, pitch))
  })

  document.addEventListener('keydown', (e) => {
    _keys[e.code] = true
    if (e.code === 'KeyF' && !e.repeat && _locked) _flashlight = !_flashlight
    // Ctrl+phím (S lưu trang, D bookmark, W đóng tab...) mở hộp thoại của trình duyệt
    // → mất focus → keyup Ctrl không bao giờ tới → kẹt ngồi. Chặn mọi Ctrl+phím khi đang khoá chuột.
    if (_locked && e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') {
      e.preventDefault()
    }
  })
  // Mất focus cửa sổ (Alt+Tab, hộp thoại...) cũng không có keyup
  window.addEventListener('blur', () => {
    for (const k in _keys) _keys[k] = false
    _mouseLeft = false
    _mouseRight = false
  })
  document.addEventListener('keyup', (e) => { _keys[e.code] = false })

  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) _mouseLeft = true; else if (e.button === 2) _mouseRight = true })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  document.addEventListener('wheel', (e) => { if (_locked) _wheel += Math.sign(e.deltaY) }, { passive: true })
  // mouseup trên document để không miss khi nhả ngoài canvas
  document.addEventListener('mouseup',  (e) => { if (e.button === 0) _mouseLeft = false; else if (e.button === 2) _mouseRight = false })
}

// ── Camera tự do ở góc nhìn thứ ba (V, plan 19): chuột xoay camera (camYaw/camPitch), còn `yaw`/`pitch` là HƯỚNG NHÂN VẬT gửi lên server.
// Đi: WASD tính theo camera, nhân vật tự quay về hướng đi (chỉ gửi Forward). Đánh / đỡ: nhân vật quay ngay về hướng camera, WASD đi theo hướng đó (strafe).
let _free = false
export let camYaw = 0
export let camPitch = 0
const FREE_TURN_TAU = 0.07       // s: nhân vật quay về hướng đi (hằng số mũ)
const FREE_AIM_TAU = 0.04         // s: nhân vật quay về hướng camera khi đánh (ngắn hơn gồng chiêu ≥ 117 ms nên nhát quét đã đúng hướng)
const FREE_LOCK_S = 0.6          // s: sau lần bấm đánh / đỡ cuối, giữ hướng camera (chiêu vẫn đang chạy, quét theo yaw của từng cmd)
let _lockT = 0
const FREE_PITCH_TAU = 0.1       // s: hạ pitch về 0 khi không đánh
const FREE_AIM_PITCH = 0.4       // phần pitch camera chuyển thành pitch đánh (camera đứng cao nhìn xuống nên không lấy hết)
const FREE_PITCH_MIN = -0.9, FREE_PITCH_MAX = 1.2
const TWO_PI = Math.PI * 2
export function setFreeCamera(on: boolean): void {
  if (on === _free) return
  _free = on
  if (on) { camYaw = yaw; camPitch = Math.max(FREE_PITCH_MIN, Math.min(FREE_PITCH_MAX, pitch)) }
  else { yaw = camYaw; pitch = Math.max(-1.553, Math.min(1.553, camPitch)); _lockT = 0 }   // thoát: góc nhìn thứ nhất tiếp tục từ chỗ camera đang nhìn
}
/** Hướng nhìn của camera (hiển thị): camera tự do nếu đang bật, không thì hướng nhân vật */
export function viewYaw(): number { return _free ? camYaw : yaw }
/** Mỗi tick lúc dựng cmd: cập nhật hướng nhân vật theo camera tự do; trả nút đã chỉnh (đi → chỉ Forward). */
export function freeLookStep(dt: number, b: number): number {
  if (!_free) return b
  if ((b & (Btn.Fire | Btn.Aim | Btn.Guard)) !== 0) _lockT = FREE_LOCK_S
  else if (_lockT > 0) _lockT -= dt
  if (_lockT > 0) {   // đánh / đỡ (và 0,6 s sau đó): quay về hướng camera, WASD giữ nguyên = đi ngang
    let d = (camYaw - yaw) % TWO_PI
    if (d > Math.PI) d -= TWO_PI; else if (d < -Math.PI) d += TWO_PI
    const k = 1 - Math.exp(-dt / FREE_AIM_TAU)
    yaw += d * k
    pitch += (camPitch * FREE_AIM_PITCH - pitch) * k
    return b
  }
  pitch *= Math.exp(-dt / FREE_PITCH_TAU)
  const fwd = (b & Btn.Forward ? 1 : 0) - (b & Btn.Back ? 1 : 0), side = (b & Btn.Right ? 1 : 0) - (b & Btn.Left ? 1 : 0)
  const out = b & ~(Btn.Forward | Btn.Back | Btn.Left | Btn.Right)
  if (fwd === 0 && side === 0) return out
  const s = Math.sin(camYaw), c = Math.cos(camYaw)
  const wx = -s * fwd + c * side, wz = -c * fwd - s * side   // hướng đi trong thế giới (forward = (−sin, −cos), right = (cos, −sin))
  const target = Math.atan2(-wx, -wz)
  let d = (target - yaw) % TWO_PI
  if (d > Math.PI) d -= TWO_PI; else if (d < -Math.PI) d += TWO_PI
  yaw += d * (1 - Math.exp(-dt / FREE_TURN_TAU))
  return out | Btn.Forward
}

export function sampleButtons(): number {
  let b = 0
  if (_keys['KeyW'])                                            b |= Btn.Forward
  if (_keys['KeyS'])                                            b |= Btn.Back
  if (_keys['KeyA'])                                            b |= Btn.Left
  if (_keys['KeyD'])                                            b |= Btn.Right
  if (_keys['Space'])                                           b |= Btn.Jump
  if (_keys['KeyC'] || _keys['ControlLeft'] || _keys['ControlRight']) b |= Btn.Crouch
  if (_keys['KeyX'])                                            b |= Btn.QuickNade   // ném lựu đạn nhanh (trước đây phím G; G giờ nhặt / vứt vũ khí)
  if (_keys['KeyG'])                                            b |= Btn.Interact
  if (_keys['KeyE'])                                            b |= Btn.Ability
  if (_keys['KeyQ'])                                            b |= Btn.Sniff
  if (_keys['ShiftLeft'])                                       b |= Btn.Guard   // đỡ đòn khi cầm vũ khí cận chiến (plan 19)
  if (_flashlight && _flashlightAllowed)                        b |= Btn.Flashlight
  if (_mouseLeft)                                               b |= Btn.Fire
  if (_keys['KeyR'])                                            b |= Btn.Reload
  if (_mouseRight)                                              b |= Btn.Aim
  return b
}

export function applyCameraRotation(camera: THREE.Camera): void {
  (camera as THREE.PerspectiveCamera).rotation.order = 'YXZ'
  camera.rotation.y = _free ? camYaw : yaw
  camera.rotation.x = _free ? camPitch : pitch
  camera.rotation.z = 0   // rung vụ nổ cộng vào z mỗi frame: không reset thì nghiêng cộng dồn
}

// Server đặt hướng nhìn (hồi sinh)
export function setLook(y: number, p: number): void { yaw = y; pitch = p; camYaw = y; camPitch = Math.max(FREE_PITCH_MIN, Math.min(FREE_PITCH_MAX, p)) }

/** Phòng ban đêm và mình là người: mới gửi/vẽ đèn pin */
export function setFlashlightAllowed(v: boolean): void { _flashlightAllowed = v }
export function flashlightOn(): boolean { return _flashlight && _flashlightAllowed }

export function isKeyDown(code: string): boolean {
  return !!_keys[code]
}

export function isLocked(): boolean {
  return _locked
}

/** Độ nhạy chuột nhân thêm (1 = bình thường); zoom càng sâu càng nhỏ */
export function setSensScale(v: number): void { _sensScale = v }

/** Đọc rồi xoá số bước lăn chuột tích luỹ (>0 lăn xuống, <0 lăn lên) */
export function consumeWheel(): number { const w = _wheel; _wheel = 0; return w }
