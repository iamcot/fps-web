import type { PlayerState } from '@fps/shared'
import type { PingStats } from './net/ping'
import { clock } from './net/clock'
import { interp } from './net/interpolation'
import type { SnapshotStore } from './net/snapshots'
import type { Prediction } from './net/prediction'

export function initDebugOverlay(
  net?: PingStats,
  snap?: () => SnapshotStore | null,
  pred?: () => Prediction | null,
): (state: PlayerState, fps: number) => void {
  const el = document.createElement('pre')
  el.style.cssText =
    'position:fixed;top:8px;left:8px;color:#0f0;font:11px/1.5 monospace;' +
    'background:rgba(0,0,0,0.55);padding:4px 6px;pointer-events:none;z-index:20;display:none'
  document.body.appendChild(el)

  let visible = false
  document.addEventListener('keydown', e => {
    if (e.code === 'F3') { visible = !visible; el.style.display = visible ? 'block' : 'none'; e.preventDefault() }
  })

  return (state: PlayerState, fps: number) => {
    if (!visible) return
    const hspd = Math.hypot(state.vel[0], state.vel[2])
    el.textContent = [
      `FPS        ${fps.toFixed(0)}`,
      `Tốc độ    ${hspd.toFixed(2)} m/s`,
      `grounded  ${state.grounded}`,
      `slideTimer ${state.slideTimer.toFixed(3)}`,
      `pos  ${state.pos.map(v => v.toFixed(2)).join('  ')}`,
      `yaw  ${state.yaw.toFixed(3)}   pitch ${state.pitch.toFixed(3)}`,
      ...(pred?.() ? [`pending ${pred()!.pending.length}   sai số reconcile ${pred()!.lastError.toFixed(3)} m   max 5s ${pred()!.maxError().toFixed(3)} m`] : []),
      ...(snap?.() ? [`snapshot/s ${snap()!.perSec.toFixed(1)}   ghost(F5) bóng ma server`] : []),
      ...(snap?.()?.serverTime ? [`snapshot: serverNow − serverTime = ${(clock.serverNow() - snap()!.serverTime).toFixed(0)} ms   #${snap()!.count}`] : []),
      ...(net ? [`RTT  ${net.rttMs.toFixed(0)} ms   pong sai thứ tự ${net.outOfOrder}`, `interp delay ${interp.delayMs.toFixed(0)} ms (trễ 1 chiều ${clock.oneWayMs.toFixed(0)})`, `serverNow ${clock.serverNow().toFixed(0)}   offset ${clock.offset.toFixed(1)}${clock.synced ? '' : ' (chưa sync)'}`] : []),
    ].join('\n')
  }
}
