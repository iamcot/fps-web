import type { PlayerState } from '@fps/shared'
import type { PingStats } from './net/ping'

export function initDebugOverlay(net?: PingStats): (state: PlayerState, fps: number) => void {
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
      ...(net ? [`RTT  ${net.rttMs.toFixed(0)} ms   pong sai thứ tự ${net.outOfOrder}`] : []),
    ].join('\n')
  }
}
