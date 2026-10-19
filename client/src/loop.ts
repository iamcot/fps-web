import { DT, TICK_RATE } from '@fps/shared'
import { stepMovement, lerpState, defaultMovement } from '@fps/shared'
import type { PlayerState, MovementConfig, InputCmd } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { Btn } from '@fps/shared'
import { sampleButtons, yaw, pitch, isLocked } from './input'

let _seq      = 0
let _tick     = 0
let _prev: PlayerState
let _curr: PlayerState

// Súng đang chọn: gửi theo mỗi cmd, logic súng đổi súng khi xử lý cmd (client và server như nhau)
let _weapon = 0
export function setWantedWeapon(id: number): void { _weapon = id }

let _dead = false
export function setDead(v: boolean): void { _dead = v }

function _buildCmd(): InputCmd {
  let buttons = _dead ? 0 : sampleButtons()   // người chết không di chuyển/bắn (server cũng bỏ nút)
  if (!isLocked()) buttons &= ~(Btn.Fire | Btn.Reload)   // chưa khoá chuột thì không bắn/nạp
  return { seq: _seq++, buttons, yaw, pitch, weapon: _weapon }
}

// Chế độ online (3.6): state do Prediction giữ; loop chỉ tạo cmd, gọi step và vẽ.
export interface NetHooks {
  current(): PlayerState                                   // state dự đoán (đã reconcile) trước tick này
  step(cmd: InputCmd): PlayerState                         // gửi cmd + chạy dự đoán, trả state mới
  visualOffset(): readonly [number, number, number]        // gọi mỗi frame hiển thị (tự giảm dần)
}
let _net: NetHooks | null = null
export function setNetHooks(h: NetHooks | null): void { _net = h }
export function currentState(): PlayerState { return _curr }

export function startLoop(
  world: CollisionWorld,
  cfg: MovementConfig,
  onRender: (state: PlayerState) => void,
  onTick?: (state: PlayerState, cmd: InputCmd, simMs: number) => void,
): void {
  let acc  = 0
  let last = performance.now()

  function frame(now: number) {
    acc  += Math.min((now - last) / 1000, 0.25)
    last  = now

    while (acc >= DT) {
      const cmd = _buildCmd()
      if (_net) {
        _prev = _net.current()   // sau reconcile: nội suy từ state đã sửa, không phải state cũ
        _curr = _net.step(cmd)
      } else {
        _prev = _curr
        _curr = stepMovement(_curr, cmd, world, cfg, DT)
      }
      // Thời gian mô phỏng (ms) — client và server tính giống nhau, không dùng performance.now()
      onTick?.(_curr, cmd, (_tick++) * 1000 / TICK_RATE)
      acc   -= DT
    }

    const view = lerpState(_prev, _curr, acc / DT)
    if (_net) {
      const o = _net.visualOffset()
      view.pos[0] += o[0]; view.pos[1] += o[1]; view.pos[2] += o[2]
    }
    onRender(view)
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

export function initGameState(spawnPos: [number, number, number], spawnYaw: number): void {
  _curr = {
    pos:          [...spawnPos],
    vel:          [0, 0, 0],
    yaw:          spawnYaw,
    pitch:        0,
    grounded:     false,
    crouching:    false,
    slideTimer:   0,
    slideCooldown: 0,
  }
  _prev = _curr
}

export { defaultMovement }
