import { DT, TICK_RATE } from '@fps/shared'
import { stepMovement, lerpState, defaultMovement } from '@fps/shared'
import type { PlayerState, MovementConfig, InputCmd } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { sampleButtons, yaw, pitch } from './input'

let _seq      = 0
let _tick     = 0
let _prev: PlayerState
let _curr: PlayerState

function _buildCmd(): InputCmd {
  return { seq: _seq++, buttons: sampleButtons(), yaw, pitch, weapon: 0 }
}

// Chế độ online "client câm" (3.4): không tự mô phỏng, gửi cmd và lấy state từ server.
// 3.6 sẽ thay bằng prediction.
export interface NetHooks {
  onCmd(cmd: InputCmd): void
  authoritative(): PlayerState | null
}
let _net: NetHooks | null = null
export function setNetHooks(h: NetHooks | null): void { _net = h }

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
      _prev  = _curr
      if (_net) {
        _net.onCmd(cmd)
        const auth = _net.authoritative()
        if (auth) _curr = auth
      } else {
        _curr = stepMovement(_curr, cmd, world, cfg, DT)
      }
      // Thời gian mô phỏng (ms) — client và server tính giống nhau, không dùng performance.now()
      onTick?.(_curr, cmd, (_tick++) * 1000 / TICK_RATE)
      acc   -= DT
    }

    onRender(lerpState(_prev, _curr, acc / DT))
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
