import { DEFAULT_SLOT, DT, TICK_RATE, MatchPhase, phaseButtonMask } from '@fps/shared'
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
let _weapon = DEFAULT_SLOT   // ô 0–3 (cmd.weapon)
export function setWantedWeapon(slot: number): void { _weapon = slot }
export function wantedWeapon(): number { return _weapon }

// Hệ số tốc độ theo súng đang cầm (offline); online do hook step của main truyền vào Prediction
let _speedMul: (buttons: number) => number = () => 1
export function setSpeedMul(fn: (buttons: number) => number): void { _speedMul = fn }

let _dead = false
let _phase: MatchPhase = MatchPhase.Playing   // offline = đang chơi
export function setDead(v: boolean): void { _dead = v }
export function setMatchPhase(v: MatchPhase): void { _phase = v }

function _buildCmd(): InputCmd {
  let buttons = sampleButtons() & phaseButtonMask(_phase, !_dead)   // chết / đếm ngược / hết trận: server cũng bỏ nút này
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
        _curr = stepMovement(_curr, cmd, world, cfg, DT, _speedMul(cmd.buttons))
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
