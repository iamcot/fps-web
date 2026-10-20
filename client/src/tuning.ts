import { WEAPONS, type MovementConfig, type SpreadDef } from '@fps/shared'

type FieldRange = [min: number, max: number, step: number]

// Chỉ các tham số số của người (leap/hopPenalty là của zombie, nằm trong shared/zombie.ts)
type TunableKey = Exclude<keyof MovementConfig, 'leap' | 'hopPenalty'>
const RANGES: Record<TunableKey, FieldRange> = {
  runSpeed:      [1,    20,  0.5],
  crouchSpeed:   [1,    10,  0.5],
  groundAccel:   [1,    40,  0.5],
  airAccel:      [1,    40,  0.5],
  airWishCap:    [0.1,  5,   0.1],
  friction:      [1,    20,  0.5],
  stopSpeed:     [0.1,  5,   0.1],
  gravity:       [5,    50,  1  ],
  jumpVelocity:  [1,    20,  0.5],
  standHeight:   [1,    3,   0.1],
  crouchHeight:  [0.5,  2,   0.1],
  radius:        [0.1,  1,   0.05],
  eyeStand:      [0.5,  2.5, 0.1],
  eyeCrouch:     [0.3,  2,   0.1],
  slideBoost:    [0,    10,  0.5],
  slideDuration: [0.1,  2,   0.1],
  slideFriction: [0,    3,   0.1],
  slideCooldown: [0,    5,   0.1],
  slideMinSpeed: [0,    15,  0.5],
}

export function initTuningPanel(cfg: MovementConfig): void {
  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;width:280px;max-height:90vh;overflow-y:auto;' +
    'background:rgba(0,0,0,0.8);color:#fff;font:12px monospace;padding:8px;' +
    'border:1px solid #555;z-index:20;display:none'
  document.body.appendChild(panel)

  const title = document.createElement('div')
  title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#ff0'
  title.textContent = 'Chỉnh thông số  [F6 đóng]'
  panel.appendChild(title)
  const tabs = document.createElement('div')
  tabs.style.cssText = 'display:flex;gap:4px;margin-bottom:6px'
  const moveBox = document.createElement('div')
  const spreadBox = document.createElement('div')
  spreadBox.style.display = 'none'
  const tabBtn = (label: string, box: HTMLElement): HTMLButtonElement => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'flex:1;padding:3px;background:#333;color:#fff;border:1px solid #888;cursor:pointer;font:11px monospace'
    b.addEventListener('click', () => {
      for (const [bb, bx] of [[tabM, moveBox], [tabS, spreadBox]] as const) { bx.style.display = bx === box ? '' : 'none'; bb.style.background = bx === box ? '#555' : '#333' }
    })
    return b
  }
  const tabM = tabBtn('Movement', moveBox), tabS = tabBtn('Spread', spreadBox)
  tabM.style.background = '#555'
  tabs.append(tabM, tabS)
  panel.append(tabs, moveBox, spreadBox)
  buildSpreadTab(spreadBox)

  const labels: Partial<Record<TunableKey, HTMLSpanElement>> = {}

  for (const key of Object.keys(RANGES) as TunableKey[]) {
    const [min, max, step] = RANGES[key]
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:2px'

    const lbl = document.createElement('span')
    lbl.style.cssText = 'width:110px;flex-shrink:0;font-size:10px'
    lbl.textContent = key

    const val = document.createElement('span')
    val.style.cssText = 'width:40px;text-align:right;font-size:10px;color:#0ff'
    val.textContent = (cfg[key] as number).toFixed(2)
    labels[key] = val

    const slider = document.createElement('input')
    slider.type  = 'range'
    slider.min   = String(min)
    slider.max   = String(max)
    slider.step  = String(step)
    slider.value = String(cfg[key])
    slider.style.cssText = 'flex:1;cursor:pointer'
    slider.addEventListener('input', () => {
      const n = parseFloat(slider.value);
      (cfg as unknown as Record<string, number>)[key] = n
      val.textContent = n.toFixed(2)
    })

    row.append(lbl, slider, val)
    moveBox.appendChild(row)
  }

  const copyBtn = document.createElement('button')
  copyBtn.textContent = 'Copy JSON'
  copyBtn.style.cssText =
    'margin-top:8px;width:100%;padding:4px;background:#333;color:#fff;' +
    'border:1px solid #888;cursor:pointer;font:12px monospace'
  copyBtn.addEventListener('click', () => {
    const json = JSON.stringify(cfg, null, 2)
    navigator.clipboard.writeText(json).then(() => {
      copyBtn.textContent = 'Đã copy!'
      setTimeout(() => { copyBtn.textContent = 'Copy JSON' }, 1500)
    })
  })
  moveBox.appendChild(copyBtn)

  let visible = false
  document.addEventListener('keydown', e => {
    if (e.code === 'F6') {
      visible = !visible
      panel.style.display = visible ? 'block' : 'none'
      // Đồng bộ slider nếu cfg bị thay đổi từ ngoài
      if (visible) {
        for (const key of Object.keys(RANGES) as TunableKey[]) {
          const inputs = moveBox.querySelectorAll<HTMLInputElement>('input[type=range]')
          const idx = (Object.keys(RANGES) as string[]).indexOf(key)
          if (inputs[idx]) {
            inputs[idx].value = String(cfg[key])
            labels[key]!.textContent = (cfg[key] as number).toFixed(2)
          }
        }
      }
      e.preventDefault()
    }
  })
}

// ── Tab Spread (plan 14 S.4): chỉnh SpreadDef + recoilPitchDeg của từng súng ngay trong game (chỉ client; server giữ số gốc) ──
const SPREAD_RANGES: Record<keyof SpreadDef, FieldRange> = {
  standDeg:              [0, 6,   0.01],
  crouchDeg:             [0, 6,   0.01],
  moveDeg:               [0, 6,   0.05],
  accurateSpeed:         [0, 8,   0.25],
  airDeg:                [0, 14,  0.1 ],
  bloomPerShotDeg:       [0, 2,   0.01],
  bloomMaxDeg:           [0, 6,   0.05],
  bloomRecoverDegPerSec: [0, 30,  0.5 ],
  bloomRecoverDelayMs:   [0, 1000, 10 ],
  pelletConeDeg:         [0, 12,  0.1 ],
  unscopedDeg:           [0, 16,  0.1 ],
}

function buildSpreadTab(box: HTMLElement): void {
  const sel = document.createElement('select')
  sel.style.cssText = 'width:100%;margin-bottom:6px;background:#222;color:#fff;font:12px monospace'
  const guns = WEAPONS.filter(w => !w.melee && !w.consumable)
  for (const w of guns) sel.add(new Option(w.name, String(w.id)))
  const rows = document.createElement('div')
  const copyBtn = document.createElement('button')
  copyBtn.textContent = 'Copy JSON súng này'
  copyBtn.style.cssText = 'margin-top:8px;width:100%;padding:4px;background:#333;color:#fff;border:1px solid #888;cursor:pointer;font:12px monospace'
  box.append(sel, rows, copyBtn)

  const cur = () => WEAPONS[Number(sel.value)]!
  function addRow(label: string, range: FieldRange, get: () => number, set: (n: number) => void): void {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:2px'
    const lbl = document.createElement('span')
    lbl.style.cssText = 'width:120px;flex-shrink:0;font-size:10px'
    lbl.textContent = label
    const val = document.createElement('span')
    val.style.cssText = 'width:44px;text-align:right;font-size:10px;color:#0ff'
    val.textContent = get().toFixed(2)
    const slider = document.createElement('input')
    slider.type = 'range'; slider.min = String(range[0]); slider.max = String(range[1]); slider.step = String(range[2]); slider.value = String(get())
    slider.style.cssText = 'flex:1;cursor:pointer'
    slider.addEventListener('input', () => { const n = parseFloat(slider.value); set(n); val.textContent = n.toFixed(2) })
    row.append(lbl, slider, val)
    rows.appendChild(row)
  }
  function render(): void {
    rows.textContent = ''
    const w = cur()
    for (const k of Object.keys(SPREAD_RANGES) as (keyof SpreadDef)[]) {
      if (w.spread[k] === undefined) continue
      addRow(k, SPREAD_RANGES[k], () => w.spread[k]!, n => { w.spread[k] = n })
    }
    addRow('recoilPitchDeg', [0, 6, 0.01], () => w.recoilPitchDeg, n => { w.recoilPitchDeg = n })
    if (w.ads) addRow('ads.spreadMult', [0, 1.5, 0.01], () => w.ads!.spreadMult, n => { w.ads!.spreadMult = n })
  }
  sel.addEventListener('change', render)
  copyBtn.addEventListener('click', () => {
    const w = cur()
    const json = JSON.stringify({ key: w.key, spread: w.spread, recoilPitchDeg: w.recoilPitchDeg, ...(w.ads ? { adsSpreadMult: w.ads.spreadMult } : {}) }, null, 2)
    navigator.clipboard.writeText(json).then(() => {
      copyBtn.textContent = 'Đã copy!'
      setTimeout(() => { copyBtn.textContent = 'Copy JSON súng này' }, 1500)
    })
  })
  render()
}
