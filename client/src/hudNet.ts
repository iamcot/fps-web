// HUD phần mạng (4.5): killfeed, màn hình chết, viền đỏ khi bị bắn. DOM thuần, không cấp phát theo frame.

import { weaponIcon } from './weaponIcon'

const KILLFEED_MAX = 5
const KILLFEED_LIFE_MS = 5000
const HURT_FADE_MS = 700

/**
 * Trọng số 4 cạnh màn hình (trên, phải, dưới, trái) theo hướng người bắn so với hướng nhìn.
 * (dx, dz) = người bắn − mình; yaw = hướng nhìn (quy ước dự án: forward = (−sin, −cos), right = (cos, −sin)).
 */
export function hurtEdgeWeights(dx: number, dz: number, yaw: number, out: [number, number, number, number]): void {
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) { out[0] = out[1] = out[2] = out[3] = 0; return }
  const f = (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / len
  const r = (dx * Math.cos(yaw) + dz * -Math.sin(yaw)) / len
  out[0] = Math.max(0, f)    // đằng trước → cạnh trên
  out[1] = Math.max(0, r)    // bên phải
  out[2] = Math.max(0, -f)   // đằng sau → cạnh dưới
  out[3] = Math.max(0, -r)   // bên trái
}

export function createKillfeed() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;top:120px;right:8px;color:#fff;font:14px/1.6 monospace;' +
    'text-align:right;pointer-events:none;z-index:20'
  document.body.appendChild(el)
  return {
    // mine: người bắn/nạn nhân là mình → viền để dễ nhìn
    add(killer: string, weapon: string, victim: string, headshot: boolean, killerIsMe: boolean, victimIsMe: boolean, reward = 0): void {
      const line = document.createElement('div')
      line.style.cssText =
        'background:rgba(0,0,0,0.55);padding:2px 8px;margin-bottom:3px;' +
        (killerIsMe ? 'border-right:3px solid #ff5555;' : victimIsMe ? 'border-right:3px solid #ffaa33;' : '')
      if (weapon === 'M67') {   // lựu đạn: icon thay tên súng
        line.append(`${killer} `, weaponIcon('m67', weapon, 'width:28px;height:18px;vertical-align:middle'), ` ${headshot ? '🎯 ' : ''}${victim}`)
      } else line.textContent = `${killer} [${weapon}] ${headshot ? '🎯 ' : ''}${victim}`
      if (killerIsMe && reward > 0) {   // tiền thưởng chỉ ở dòng do mình hạ
        const r = document.createElement('span')
        r.textContent = ` +$${reward}`
        r.style.cssText = `font-size:11px;font-weight:bold;color:${reward >= 1000 ? '#ffd23c' : '#5fd16b'}`
        line.appendChild(r)
      }
      el.appendChild(line)
      while (el.children.length > KILLFEED_MAX) el.firstElementChild!.remove()
      setTimeout(() => line.remove(), KILLFEED_LIFE_MS)
    },
  }
}

export function createDeathScreen() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;' +
    'background:rgba(50,50,50,0.7);backdrop-filter:grayscale(1);color:#fff;font:bold 32px monospace;' +
    'text-align:center;pointer-events:none;z-index:14;text-shadow:0 0 6px #000'
  const who = document.createElement('div')
  const timer = document.createElement('div')
  timer.style.cssText = 'font-size:22px;margin-top:12px;opacity:.85'
  el.append(who, timer)
  document.body.appendChild(el)
  let until = 0
  let lastSec = -1
  return {
    /** respawnInMs < 0: không hồi sinh (Sinh Tử) → không hiện đồng hồ */
    show(killerName: string, respawnInMs: number): void {
      who.textContent = killerName ? `Bị ${killerName} hạ` : 'Bạn đã chết'
      until = respawnInMs < 0 ? 0 : performance.now() + respawnInMs
      timer.textContent = ''
      lastSec = -1
      el.style.display = 'flex'
    },
    hide(): void { el.style.display = 'none'; until = 0 },
    tick(): void {
      if (until === 0) return
      const sec = Math.max(0, Math.ceil((until - performance.now()) / 1000))
      if (sec === lastSec) return   // chỉ ghi DOM khi đổi giây
      lastSec = sec
      timer.textContent = `Hồi sinh sau ${sec}s`
    },
  }
}

export function createHurtIndicator() {
  const mk = (css: string) => {
    const e = document.createElement('div')
    e.style.cssText = 'position:fixed;pointer-events:none;z-index:13;opacity:0;' + css
    document.body.appendChild(e)
    return e
  }
  const g = (dir: string) => `background:linear-gradient(${dir},rgba(255,0,0,0.65),rgba(255,0,0,0));`
  const edges = [
    mk(`left:0;right:0;top:0;height:18vh;${g('to bottom')}`),
    mk(`top:0;bottom:0;right:0;width:18vh;${g('to left')}`),
    mk(`left:0;right:0;bottom:0;height:18vh;${g('to top')}`),
    mk(`top:0;bottom:0;left:0;width:18vh;${g('to right')}`),
  ]
  const w: [number, number, number, number] = [0, 0, 0, 0]
  const level: [number, number, number, number] = [0, 0, 0, 0]
  return {
    show(dx: number, dz: number, yaw: number): void {
      hurtEdgeWeights(dx, dz, yaw, w)
      for (let i = 0; i < 4; i++) level[i] = Math.max(level[i]!, w[i]!)
    },
    tick(dtMs: number): void {
      const k = dtMs / HURT_FADE_MS
      for (let i = 0; i < 4; i++) {
        if (level[i]! <= 0) continue
        level[i] = Math.max(0, level[i]! - k)
        edges[i]!.style.opacity = String(level[i])
      }
    },
  }
}

// Dòng giữa màn hình khi hạ người bị truy nã: "TRUY NÃ! Hạ [tên] (chuỗi 3)" trong 1,5s
export function createBountyBanner() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:0;right:0;top:22%;text-align:center;color:#ffd23c;font:bold 30px sans-serif;' +
    'text-shadow:0 0 8px #000;pointer-events:none;z-index:21;opacity:0;transition:opacity 250ms'
  document.body.appendChild(el)
  let timer = 0
  return {
    show(victimName: string, streak: number): void {
      el.textContent = `TRUY NÃ! Hạ ${victimName} (chuỗi ${streak})`
      el.style.opacity = '1'
      clearTimeout(timer)
      timer = window.setTimeout(() => { el.style.opacity = '0' }, 1500)
    },
  }
}

/** Dòng dưới giữa khi đang xem đồng đội: "Đang xem: tên  ♥ 80". set(undefined) = ẩn; set(null) = camera bay (không ai để xem) */
export function createSpectateLabel() {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:none;color:#fff;font:bold 20px monospace;' +
    'background:rgba(0,0,0,.55);padding:6px 16px;border-radius:6px;pointer-events:none;z-index:16;text-shadow:0 0 4px #000;text-align:center'
  document.body.appendChild(el)
  let last = ''
  return {
    set(name: string | null | undefined, hp: number): void {
      const text = name === undefined ? '' : name === null ? 'Không còn đồng đội để xem' : `Đang xem: ${name}   ♥ ${Math.max(0, Math.round(hp))}   (Click / Space: đổi người)`
      if (text === last) return
      last = text
      el.textContent = text
      el.style.display = text ? 'block' : 'none'
    },
  }
}
