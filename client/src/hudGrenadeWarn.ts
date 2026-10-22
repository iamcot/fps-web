// Cảnh báo lựu đạn gần (G.9): icon đỏ dưới tâm ngắm + mũi tên quay theo hướng quả gần nhất. Quả của đồng đội bị bỏ qua (do caller lọc).
import { GRENADE } from '@fps/shared'
import { weaponIcon } from './weaponIcon'
import { t } from './i18n'

const BLINK_SLOW_HZ = 2, BLINK_FAST_HZ = 8
const ARROW_RADIUS_PX = 78

export interface WarnGrenade { x: number; y: number; z: number }

export function createGrenadeWarning() {
  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:13;display:none'
  const ring = document.createElement('div')
  ring.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0'
  const arrow = document.createElement('div')
  arrow.style.cssText = `position:absolute;left:-12px;top:${-ARROW_RADIUS_PX - 12}px;width:24px;height:24px;` +
    'background:#ff3030;clip-path:polygon(50% 0,100% 100%,50% 70%,0 100%);filter:drop-shadow(0 0 3px #000)'
  ring.appendChild(arrow)
  const icon = weaponIcon('m67', t('Grenade'), 'width:44px;height:44px;filter:sepia(1) saturate(8) hue-rotate(-35deg) drop-shadow(0 0 4px #000)')
  const iconBox = document.createElement('div')
  iconBox.style.cssText = 'position:absolute;left:-22px;top:46px;width:44px;height:44px'
  iconBox.appendChild(icon)
  root.append(ring, iconBox)
  document.body.appendChild(root)

  let phase = 0
  let shown = false
  return {
    /**
     * Gọi mỗi frame. Duyệt `n` phần tử đầu của `src`; chọn quả gần nhất trong GRENADE.warnRadius.
     * yaw: hướng nhìn (forward = (−sin, −cos), right = (cos, −sin)).
     */
    update<T>(dt: number, eye: { x: number; y: number; z: number }, yaw: number, src: readonly T[], pos: (g: T) => WarnGrenade, skip: (g: T) => boolean): void {
      let best = Infinity, bx = 0, bz = 0
      for (let i = 0; i < src.length; i++) {
        const g = src[i]!
        if (skip(g)) continue
        const p = pos(g)
        const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z
        const d = Math.hypot(dx, dy, dz)
        if (d < best) { best = d; bx = dx; bz = dz }
      }
      const on = best <= GRENADE.warnRadius
      if (on !== shown) { shown = on; root.style.display = on ? '' : 'none' }
      if (!on) return
      const near = 1 - best / GRENADE.warnRadius          // 0 xa … 1 sát
      phase += dt * Math.PI * 2 * (BLINK_SLOW_HZ + (BLINK_FAST_HZ - BLINK_SLOW_HZ) * near)
      const pulse = 0.55 + 0.45 * Math.sin(phase)
      root.style.opacity = String((0.3 + 0.7 * near) * pulse + 0.1)
      const f = bx * -Math.sin(yaw) + bz * -Math.cos(yaw)
      const r = bx * Math.cos(yaw) + bz * -Math.sin(yaw)
      ring.style.transform = `rotate(${Math.atan2(r, f)}rad)`   // 0 = phía trước (mũi tên chỉ lên)
    },
  }
}
export type GrenadeWarning = ReturnType<typeof createGrenadeWarning>
