// HUD dưới màn hình (H.6): tiền + máu bên trái, 4 ô vũ khí ở giữa, đạn bên phải. DOM thuần, chỉ ghi khi giá trị đổi.
import { CATEGORY_LABEL, SLOT_COUNT, WEAPON_BY_KEY } from '@fps/shared'
import { weaponIcon } from './weaponIcon'

const STYLE = `
:root{
  --hud-s:1; --hud-bottom:24px; --hud-side:24px;
  --slot:calc(72px*var(--hud-s)); --slot-gap:calc(10px*var(--hud-s)); --slot-radius:calc(10px*var(--hud-s));
  --money-size:calc(22px*var(--hud-s)); --hp-size:calc(32px*var(--hud-s)); --heart-size:calc(28px*var(--hud-s)); --ammo-size:calc(32px*var(--hud-s));
}
@media (max-height:700px){ :root{ --hud-s:0.85 } }
.hb{position:fixed;pointer-events:none;z-index:12;color:#fff;font-family:system-ui,sans-serif;text-shadow:0 0 4px #000}
.hb-left{left:var(--hud-side);bottom:var(--hud-bottom);display:flex;flex-direction:column;gap:calc(4px*var(--hud-s))}
.hb-money{font-weight:800;font-size:var(--money-size);position:relative;display:flex;align-items:baseline;gap:6px}
.hb-money .cur{color:#5fd16b}
.hb-money .num{transition:color 600ms}
.hb-hp{display:flex;align-items:center;gap:calc(8px*var(--hud-s));font-weight:800;font-size:var(--hp-size);line-height:1}
.hb-heart{width:var(--heart-size);height:var(--heart-size);fill:#ff3b3b;filter:drop-shadow(0 0 3px #000)}
.hb-hp.low .hb-heart{animation:hb-beat .9s ease-in-out infinite}
@keyframes hb-beat{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
.hb-slots{left:50%;bottom:var(--hud-bottom);transform:translateX(-50%);display:flex;gap:var(--slot-gap)}
.hb-slot{position:relative;width:var(--slot);height:var(--slot);box-sizing:border-box;border:2px solid #fff;border-radius:var(--slot-radius);
  background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:calc(8px*var(--hud-s));
  transition:transform 120ms,background 120ms,border-width 120ms,opacity 120ms}
.hb-slot img,.hb-slot span{max-width:100%;max-height:100%;width:100%}
.hb-slot.empty{opacity:.35}
.hb-slot.active{border-width:3px;background:rgba(255,255,255,.15);transform:translateY(-4px)}
.hb-slot .n{position:absolute;right:calc(6px*var(--hud-s));top:calc(3px*var(--hud-s));font:bold 14px sans-serif}
.hb-slot .k{position:absolute;left:calc(6px*var(--hud-s));bottom:calc(3px*var(--hud-s));font:bold 12px sans-serif}
.hb-right{right:var(--hud-side);bottom:var(--hud-bottom);text-align:right}
.hb-ammo{font-weight:800;font-size:var(--ammo-size);line-height:1}
.hb-ammo.low{color:#ff9a2e}
.hb-wname{font-size:calc(14px*var(--hud-s));opacity:.85;margin-top:4px}
.hb-float{position:absolute;left:100%;margin-left:12px;top:0;font-weight:800;white-space:nowrap;pointer-events:none;animation:hb-float 600ms ease-out forwards}
@keyframes hb-float{from{transform:translateY(0);opacity:1}to{transform:translateY(-28px);opacity:0}}
`

const HEART = '<svg class="hb-heart" viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.1 3 4.5 6.6 4.5c2 0 3.6 1 5.4 3 1.8-2 3.4-3 5.4-3 3.6 0 5.7 3.6 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>'

function div(cls: string, parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  ;(parent ?? document.body).appendChild(d)
  return d
}

export function createBottomHud() {
  const st = document.createElement('style')
  st.textContent = STYLE
  document.head.appendChild(st)

  // Trái dưới: tiền + máu
  const left = div('hb hb-left')
  const moneyRow = div('hb-money', left)
  moneyRow.innerHTML = '<span class="cur">$</span><span class="num">0</span>'
  const moneyNum = moneyRow.querySelector('.num') as HTMLElement
  const hpRow = div('hb-hp', left)
  hpRow.innerHTML = HEART + '<span class="v">100</span>'
  const hpVal = hpRow.querySelector('.v') as HTMLElement

  // Giữa dưới: 4 ô vũ khí
  const slotsBox = div('hb hb-slots')
  const slotEls: HTMLDivElement[] = []
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = div('hb-slot empty', slotsBox)
    const k = document.createElement('div'); k.className = 'k'; k.textContent = String(i + 1)
    s.appendChild(k)
    slotEls.push(s)
  }
  let slotKey = ''

  // Phải dưới: đạn + tên súng
  const right = div('hb hb-right')
  const ammoEl = div('hb-ammo', right)
  const wnameEl = div('hb-wname', right)
  let ammoKey = ''

  // Tiền: số chạy dần tới giá trị mới trong 400ms
  let shown = 0, from = 0, target = 0, t = 400
  let first = true
  function flash(up: boolean): void {
    moneyNum.style.transition = 'none'
    moneyNum.style.color = up ? '#5fd16b' : '#ff5555'
    void moneyNum.offsetWidth
    moneyNum.style.transition = 'color 600ms'
    moneyNum.style.color = '#fff'
  }

  let infinite = false
  return {
    setMoneyVisible(v: boolean): void { moneyRow.style.display = v ? '' : 'none' },
    /** Offline + tiền vô hạn: hiện `∞` thay cho số tiền */
    setInfiniteMoney(v: boolean): void { infinite = v; moneyNum.textContent = v ? '∞' : String(shown) },
    /** Ẩn cả cụm HUD dưới (khi đang xem đồng đội) */
    setVisible(v: boolean): void { const d = v ? '' : 'none'; left.style.display = d; slotsBox.style.display = d; right.style.display = d },
    setMoney(v: number): void {
      if (first) { first = false; shown = from = target = v; moneyNum.textContent = infinite ? '∞' : String(v); return }
      if (v === target) return
      if (!infinite) flash(v > target)
      from = shown; target = v; t = 0
    },
    /** +$500 bay lên cạnh số tiền rồi mờ đi (600ms). bounty: to hơn, vàng */
    floatMoney(delta: number, bounty = false): void {
      const f = document.createElement('div')
      f.className = 'hb-float'
      f.textContent = `${delta >= 0 ? '+' : '-'}$${Math.abs(delta)}`
      f.style.color = bounty ? '#ffd23c' : delta >= 0 ? '#5fd16b' : '#ff5555'
      f.style.fontSize = bounty ? '1.5em' : '1em'
      moneyRow.appendChild(f)
      setTimeout(() => f.remove(), 650)
    },
    setHealth(v: number): void {
      hpVal.textContent = String(Math.max(0, Math.round(v)))
      hpRow.classList.toggle('low', v > 0 && v < 30)
    },
    /** keys: key súng ở 4 ô (null = trống); active = ô đang cầm */
    setSlots(keys: readonly (string | null)[], active: number, counts?: readonly (number | null)[]): void {
      const k = keys.join(',') + '|' + active + '|' + (counts ? counts.join(',') : '')
      if (k === slotKey) return
      slotKey = k
      for (let i = 0; i < SLOT_COUNT; i++) {
        const el = slotEls[i]!
        const key = keys[i] ?? null
        el.classList.toggle('empty', key === null)
        el.classList.toggle('active', i === active && key !== null)
        el.querySelector('img,span:not(.k)')?.remove()
        el.querySelector('.n')?.remove()
        const cnt = counts?.[i]
        if (key && cnt != null) {
          const n = document.createElement('div'); n.className = 'n'; n.textContent = `×${cnt}`
          el.appendChild(n)
        }
        if (key) {
          const def = WEAPON_BY_KEY.get(key)
          el.insertBefore(weaponIcon(key, def?.name ?? key), el.firstChild)
          el.title = def ? CATEGORY_LABEL[def.category] : ''
        }
      }
    },
    setAmmo(name: string, cur: number, mag: number, reloading: boolean, melee = false, consumable = false, infinite = false): void {
      const key = `${name}|${cur}|${mag}|${reloading}|${melee}|${consumable}|${infinite}`
      if (key === ammoKey) return
      ammoKey = key
      ammoEl.textContent = consumable ? `×${cur}` : melee ? '—' : reloading ? 'RELOAD' : `${cur} / ${infinite ? '∞' : mag}`
      ammoEl.classList.toggle('low', !melee && !consumable && !reloading && mag > 0 && cur <= mag * 0.25)
      wnameEl.textContent = name
    },
    tick(dtMs: number): void {
      if (shown === target) return
      t += dtMs
      const k = Math.min(1, t / 400)
      shown = k >= 1 ? target : Math.round(from + (target - from) * (1 - (1 - k) * (1 - k)))
      if (!infinite) moneyNum.textContent = String(shown)
    },
  }
}
export type BottomHud = ReturnType<typeof createBottomHud>
