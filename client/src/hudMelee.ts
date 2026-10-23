// HUD cận chiến (plan 19, P4): thanh thể lực, chỉ báo đỡ / choáng, đếm combo. Chỉ hiện khi cầm vũ khí cận chiến có bộ chiêu.
// DOM thuần, chỉ ghi khi giá trị đổi.
import { MELEE, comboDepth, staminaAt, type MeleeSet, type WeaponState } from '@fps/shared'

export interface MeleeHudModel {
  stamina: number      // 0..1
  guarding: boolean
  staggered: boolean
  combo: number        // nhát thứ mấy của chuỗi đang chạy / vừa xong còn nối được (0 = không)
  lowStamina: boolean
}

/** Trạng thái HUD từ WeaponState tại nowMs (thang seq của chính mình) */
export function meleeHudModel(out: MeleeHudModel, ws: WeaponState, set: MeleeSet, nowMs: number): MeleeHudModel {
  out.stamina = staminaAt(ws, nowMs) / MELEE.staminaMax
  out.guarding = ws.guardSinceMs >= 0
  out.staggered = nowMs < ws.staggerUntilMs
  const idx = ws.meleeMove >= 0 ? ws.meleeMove : ws.comboNode >= 0 && nowMs <= ws.chainEndMs ? ws.comboNode : -1
  out.combo = comboDepth(set, idx)
  out.lowStamina = out.stamina < 0.2
  return out
}

export function makeMeleeHudModel(): MeleeHudModel { return { stamina: 1, guarding: false, staggered: false, combo: 0, lowStamina: false } }

const STYLE = `
.hm{position:fixed;left:50%;bottom:calc(var(--hud-bottom,24px) + var(--slot,72px) + 22px);transform:translateX(-50%);width:220px;pointer-events:none;z-index:12;display:none;font-family:system-ui,sans-serif;color:#fff;text-shadow:0 0 4px #000}
.hm-bar{height:8px;border:1px solid rgba(255,255,255,.8);border-radius:5px;background:rgba(0,0,0,.4);overflow:hidden}
.hm-fill{height:100%;width:100%;background:#e8e8e8;transform-origin:left;transition:background 120ms}
.hm.low .hm-fill{background:#ff9a2e}
.hm.guard .hm-fill{background:#6fb7ff}
.hm.stagger .hm-fill{background:#ff4a4a}
.hm-row{display:flex;justify-content:center;gap:6px;margin-top:5px;height:12px;font:700 11px/12px sans-serif}
.hm-pip{width:12px;height:6px;margin-top:3px;border-radius:2px;background:rgba(255,255,255,.25)}
.hm-pip.on{background:#fff}
.hm-tag{min-width:48px;text-align:center;letter-spacing:.06em}
`

export interface MeleeHud {
  update(m: MeleeHudModel | null): void
}

export function createMeleeHud(): MeleeHud {
  const st = document.createElement('style')
  st.textContent = STYLE
  document.head.appendChild(st)
  const root = document.createElement('div')
  root.className = 'hm'
  root.innerHTML = '<div class="hm-bar"><div class="hm-fill"></div></div><div class="hm-row"><span class="hm-pip"></span><span class="hm-pip"></span><span class="hm-pip"></span><span class="hm-pip"></span><span class="hm-tag"></span></div>'
  document.body.appendChild(root)
  const fill = root.querySelector('.hm-fill') as HTMLElement
  const pips = Array.from(root.querySelectorAll('.hm-pip')) as HTMLElement[]
  const tag = root.querySelector('.hm-tag') as HTMLElement
  let shown = false, lastW = -1, lastClass = '', lastCombo = -1, lastTag = ''
  return {
    update(m) {
      if (!m) { if (shown) { root.style.display = 'none'; shown = false } return }
      if (!shown) { root.style.display = 'block'; shown = true }
      const w = Math.round(Math.max(0, Math.min(1, m.stamina)) * 100)
      if (w !== lastW) { lastW = w; fill.style.transform = `scaleX(${w / 100})` }
      const cls = 'hm' + (m.staggered ? ' stagger' : m.guarding ? ' guard' : m.lowStamina ? ' low' : '')
      if (cls !== lastClass) { lastClass = cls; root.className = cls }
      if (m.combo !== lastCombo) { lastCombo = m.combo; pips.forEach((p, i) => p.classList.toggle('on', i < m.combo)) }
      const t = m.staggered ? 'STAGGER' : m.guarding ? 'GUARD' : ''
      if (t !== lastTag) { lastTag = t; tag.textContent = t }
    },
  }
}
