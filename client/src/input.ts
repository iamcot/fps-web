import * as THREE from 'three'
import { Btn } from '@fps/shared'

const LS_SENS_KEY = 'fps_sens'
let _sens = parseFloat(localStorage.getItem(LS_SENS_KEY) ?? '') || 0.0022

export let yaw = 0
export let pitch = 0

let _locked = false
let _skipFirstMove = false
const _keys: Record<string, boolean> = {}
let _mouseLeft = false

// ── Overlay ───────────────────────────────────────────────────────────────────
const _overlay = document.createElement('div')
_overlay.style.cssText =
  'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
  'background:rgba(0,0,0,0.55);color:#fff;font:28px monospace;cursor:pointer;z-index:10;' +
  'user-select:none'
_overlay.textContent = 'Click để chơi'
document.body.appendChild(_overlay)

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
    }
  })

  document.addEventListener('mousemove', (e) => {
    if (!_locked) return
    if (_skipFirstMove) {
      _skipFirstMove = false
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return
    }
    yaw   -= e.movementX * _sens
    pitch -= e.movementY * _sens
    pitch  = Math.max(-1.553, Math.min(1.553, pitch))
  })

  document.addEventListener('keydown', (e) => {
    _keys[e.code] = true
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
  })
  document.addEventListener('keyup', (e) => { _keys[e.code] = false })

  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) _mouseLeft = true })
  // mouseup trên document để không miss khi nhả ngoài canvas
  document.addEventListener('mouseup',  (e) => { if (e.button === 0) _mouseLeft = false })
}

export function sampleButtons(): number {
  let b = 0
  if (_keys['KeyW'])                                            b |= Btn.Forward
  if (_keys['KeyS'])                                            b |= Btn.Back
  if (_keys['KeyA'])                                            b |= Btn.Left
  if (_keys['KeyD'])                                            b |= Btn.Right
  if (_keys['Space'])                                           b |= Btn.Jump
  if (_keys['KeyC'] || _keys['ControlLeft'] || _keys['ControlRight']) b |= Btn.Crouch
  if (_mouseLeft)                                               b |= Btn.Fire
  if (_keys['KeyR'])                                            b |= Btn.Reload
  return b
}

export function applyCameraRotation(camera: THREE.Camera): void {
  (camera as THREE.PerspectiveCamera).rotation.order = 'YXZ'
  camera.rotation.y = yaw
  camera.rotation.x = pitch
}

export function isKeyDown(code: string): boolean {
  return !!_keys[code]
}

export function isLocked(): boolean {
  return _locked
}
