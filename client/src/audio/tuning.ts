// Bảng chỉnh âm thanh F8 (A.5 + tab Hit của A.8): slider mọi trường profile, bắn thử, copy JSON, peak meter.
import { WEAPONS } from '@fps/shared'
import { GUN_SOUNDS, type LayerDef } from './gunProfiles'
import { playShot, refreshBus } from './gunAudio'
import { playHit, playHurt, HIT, type HitKind, type HitMode } from './hitAudio'
import { getGraph, settings, saveSettings } from './context'
import { setHealthForAudio } from './hitAudio'
import { FOOTSTEPS, playFootstep, playLanding, playFootstepOther, refreshFootstepBus } from './footsteps'
import { listenerPos } from './context'

type Range = [min: number, max: number, step: number]

const LAYER_RANGES: Record<Exclude<keyof LayerDef, 'files'>, Range> = {
  gainDb:       [-30, 10, 0.5],
  pitch:        [0.5, 1.5, 0.01],
  pitchRand:    [0, 0.2, 0.01],
  gainRandDb:   [0, 6, 0.5],
  delayMs:      [0, 100, 1],
  synthDecayMs: [50, 1500, 10],
  synthTailHz:  [500, 6000, 50],
}

const css = {
  btn: 'padding:3px 6px;background:#333;color:#fff;border:1px solid #888;cursor:pointer;font:11px monospace;margin:2px 2px 2px 0',
  head: 'font-weight:bold;color:#ff0;margin:8px 0 2px',
}

const KEY_RANGES: Record<string, Range> = {
  stepDistM: [0.5, 6, 0.1], minSpeed: [0, 5, 0.1], minFallSpeed: [1, 15, 0.5],
  pitchRand: [0, 0.3, 0.01], gainRandDb: [0, 6, 0.5], pan: [0, 1, 0.01],
  maxDistM: [5, 80, 1], refDistance: [1, 10, 0.5], rolloff: [0.5, 4, 0.1], bandQ: [0.1, 6, 0.1],
}

function rangeFor(key: string, v: number): Range {
  if (KEY_RANGES[key]) return KEY_RANGES[key]!
  if (/Db$/.test(key)) return [-40, 10, 0.5]
  if (/Hz$/.test(key)) return [20, Math.max(100, v * 3), 1]
  if (/Ms$/.test(key)) return [1, Math.max(50, v * 3), 1]
  if (/Ratio$/.test(key)) return [0.5, 8, 0.01]
  return [0, Math.max(1, v * 3), 0.1]
}

function slider(parent: HTMLElement, label: string, get: () => number, set: (v: number) => void, r: Range): void {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:1px'
  const lbl = document.createElement('span')
  lbl.style.cssText = 'width:100px;flex-shrink:0;font-size:10px'
  lbl.textContent = label
  const val = document.createElement('span')
  val.style.cssText = 'width:44px;text-align:right;font-size:10px;color:#0ff'
  const inp = document.createElement('input')
  inp.type = 'range'; inp.min = String(r[0]); inp.max = String(r[1]); inp.step = String(r[2])
  inp.value = String(get()); inp.style.cssText = 'flex:1;cursor:pointer'
  val.textContent = get().toFixed(2)
  inp.addEventListener('input', () => { const n = parseFloat(inp.value); set(n); val.textContent = n.toFixed(2) })
  row.append(lbl, inp, val)
  parent.appendChild(row)
}

function button(parent: HTMLElement, text: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = text; b.style.cssText = css.btn
  b.addEventListener('click', fn)
  parent.appendChild(b)
  return b
}

function heading(parent: HTMLElement, text: string): void {
  const h = document.createElement('div'); h.style.cssText = css.head; h.textContent = text; parent.appendChild(h)
}

function copyJson(btn: HTMLButtonElement, obj: unknown): void {
  void navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).then(() => {
    const old = btn.textContent
    btn.textContent = 'Đã copy!'
    setTimeout(() => { btn.textContent = old }, 1500)
  })
}

export function initAudioTuning(): void {
  const panel = document.createElement('div')
  panel.style.cssText =
    'position:fixed;top:8px;left:8px;width:340px;max-height:92vh;overflow-y:auto;' +
    'background:rgba(0,0,0,0.85);color:#fff;font:12px monospace;padding:8px;' +
    'border:1px solid #555;z-index:20;display:none'
  document.body.appendChild(panel)

  const title = document.createElement('div')
  title.style.cssText = 'font-weight:bold;color:#ff0;margin-bottom:4px'
  title.textContent = 'Âm thanh  [F8 đóng]'
  panel.appendChild(title)

  // Peak meter (đầu ra master, sau compressor)
  const meterWrap = document.createElement('div')
  meterWrap.style.cssText = 'height:8px;background:#222;margin-bottom:6px'
  const meter = document.createElement('div')
  meter.style.cssText = 'height:100%;width:0;background:#4c4'
  meterWrap.appendChild(meter)
  panel.appendChild(meterWrap)
  const samples = new Float32Array(1024)
  function meterTick() {
    if (panel.style.display === 'none') return
    const g = getGraph()
    if (g) {
      g.analyser.getFloatTimeDomainData(samples)
      let peak = 0
      for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]!); if (a > peak) peak = a }
      const db = 20 * Math.log10(Math.max(peak, 1e-5))
      meter.style.width = `${Math.max(0, Math.min(1, (db + 60) / 60)) * 100}%`
      meter.style.background = db > -1 ? '#e33' : '#4c4'   // đỏ nếu vượt -1 dBFS
    }
    requestAnimationFrame(meterTick)
  }

  const tabs = document.createElement('div')
  panel.appendChild(tabs)
  const body = document.createElement('div')
  panel.appendChild(body)

  let tab: 'gun' | 'hit' | 'foot' | 'misc' = 'gun'
  let gunId = 0
  let rifling = 0

  function render() {
    body.replaceChildren()
    tabs.replaceChildren()
    for (const [id, name] of [['gun', 'Súng'], ['hit', 'Hit'], ['foot', 'Footsteps'], ['misc', 'Chung']] as const) {
      const b = button(tabs, name, () => { tab = id; render() })
      if (id === tab) b.style.background = '#664'
    }
    if (tab === 'gun') renderGun()
    else if (tab === 'hit') renderHit()
    else if (tab === 'foot') renderFoot()
    else renderMisc()
  }

  function renderGun() {
    const sel = document.createElement('select')
    sel.style.cssText = 'width:100%;margin:4px 0;font:12px monospace'
    for (const w of WEAPONS) {
      const o = document.createElement('option'); o.value = String(w.id); o.textContent = w.name
      if (w.id === gunId) o.selected = true
      sel.appendChild(o)
    }
    sel.addEventListener('change', () => { gunId = Number(sel.value); render() })
    body.appendChild(sel)

    const p = GUN_SOUNDS[gunId]!
    const def = WEAPONS[gunId]!

    const act = document.createElement('div'); body.appendChild(act)
    button(act, 'Bắn thử', () => playShot(gunId, def.magSize))
    button(act, 'Xả 1 giây', () => {
      clearInterval(rifling)
      let n = 0
      const total = Math.floor(1000 / def.fireIntervalMs)
      rifling = window.setInterval(() => {
        playShot(gunId, Math.max(0, def.magSize - n))
        if (++n >= total) clearInterval(rifling)
      }, def.fireIntervalMs)
    })
    const copy = button(act, 'Copy JSON', () => copyJson(copy, p))

    for (const kind of ['body', 'mech', 'tail'] as const) {
      const layer = p.layers[kind]
      if (!layer) continue
      heading(body, `lớp ${kind}`)
      for (const k of Object.keys(LAYER_RANGES) as (keyof typeof LAYER_RANGES)[]) {
        if (layer[k] === undefined) continue
        slider(body, k, () => layer[k] as number, v => { (layer as unknown as Record<string, number>)[k] = v }, LAYER_RANGES[k])
      }
    }
    heading(body, 'thump')
    for (const k of Object.keys(p.thump) as (keyof typeof p.thump)[]) {
      slider(body, k, () => p.thump[k], v => { p.thump[k] = v }, rangeFor(k, p.thump[k]))
    }
    heading(body, 'EQ')
    for (const k of Object.keys(p.eq) as (keyof typeof p.eq)[]) {
      slider(body, k, () => p.eq[k], v => { p.eq[k] = v; refreshBus(gunId) }, rangeFor(k, p.eq[k]))
    }
    heading(body, 'vỏ đạn')
    slider(body, 'shellDelayMs', () => p.shellDelayMs, v => { p.shellDelayMs = v }, [0, 600, 10])
  }

  function renderHit() {
    const act = document.createElement('div'); body.appendChild(act)
    button(act, 'Thử trúng thân', () => { playHit('body') })
    button(act, 'Thử trúng đầu', () => { playHit('head') })
    button(act, 'Thử hạ gục', () => { playHit('kill') })
    button(act, 'Thử hạ gục headshot', () => { playHit('killHead') })
    button(act, 'Thử combo 6 phát', () => {
      for (let i = 0; i < 6; i++) setTimeout(() => playHit('body'), i * 90)   // cách 90ms: qua ngưỡng gộp 30ms
    })
    button(act, 'Thử bị trúng (bên phải)', () => playHurt(1, 0, 0))
    const copy = button(act, 'Copy JSON', () => copyJson(copy, HIT))

    heading(body, 'mode (file / synth / both)')
    for (const kind of Object.keys(HIT.mode) as HitKind[]) {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;margin-bottom:2px;align-items:center'
      const l = document.createElement('span'); l.style.cssText = 'width:100px;font-size:10px'; l.textContent = kind
      const s = document.createElement('select'); s.style.cssText = 'font:11px monospace'
      for (const m of ['file', 'synth', 'both']) {
        const o = document.createElement('option'); o.value = m; o.textContent = m; if (m === HIT.mode[kind]) o.selected = true; s.appendChild(o)
      }
      s.addEventListener('change', () => { HIT.mode[kind] = s.value as HitMode })
      row.append(l, s); body.appendChild(row)
    }
    for (const group of ['body', 'head', 'thick', 'kill', 'hurt'] as const) {
      heading(body, `lớp ${group}`)
      const obj = HIT[group] as Record<string, number>
      for (const k of Object.keys(obj)) slider(body, k, () => obj[k]!, v => { obj[k] = v }, rangeFor(k, obj[k]!))
    }
  }

  function renderFoot() {
    const act = document.createElement('div'); body.appendChild(act)
    button(act, 'Bước (đứng)', () => playFootstep(false))
    button(act, 'Bước (ngồi)', () => playFootstep(true))
    button(act, 'Đi 6 bước', () => { for (let i = 0; i < 6; i++) setTimeout(() => playFootstep(false), i * 350) })
    button(act, 'Tiếp đất', () => playLanding())
    button(act, 'Người khác (phải, 5m)', () => playFootstepOther([listenerPos[0] + 5, listenerPos[1], listenerPos[2]]))
    button(act, 'Người khác (xa 30m)', () => playFootstepOther([listenerPos[0] + 30, listenerPos[1], listenerPos[2]]))
    const copy = button(act, 'Copy JSON', () => copyJson(copy, FOOTSTEPS))

    for (const [name, value] of Object.entries(FOOTSTEPS)) {
      if (typeof value === 'number') {
        slider(body, name, () => FOOTSTEPS[name as 'stepDistM'], v => { (FOOTSTEPS as Record<string, unknown>)[name] = v }, rangeFor(name, value))
        continue
      }
      heading(body, name)
      const obj = value as Record<string, number>
      for (const k of Object.keys(obj)) {
        slider(body, k, () => obj[k]!, v => { obj[k] = v; if (name === 'own') refreshFootstepBus() }, rangeFor(k, obj[k]!))
      }
    }
  }

  function renderMisc() {
    slider(body, 'volume', () => settings.volume, v => { settings.volume = v; saveSettings() }, [0, 1, 0.05])
    for (const [key, label] of [['lowAmmoWarning', 'Cảnh báo sắp hết đạn'], ['heartbeat', 'Tim đập khi máu thấp']] as const) {
      const row = document.createElement('label'); row.style.cssText = 'display:block;margin:4px 0'
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = settings[key]
      c.addEventListener('change', () => { settings[key] = c.checked; saveSettings(); if (key === 'heartbeat') setHealthForAudio(100) })
      row.append(c, ` ${label}`); body.appendChild(row)
    }
  }

  let visible = false
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'F8') return
    visible = !visible
    panel.style.display = visible ? 'block' : 'none'
    if (visible) { render(); requestAnimationFrame(meterTick) }
    e.preventDefault()
  })
}
