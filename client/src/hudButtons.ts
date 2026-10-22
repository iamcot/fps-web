import { tr  } from './i18n'
// Hai nút góc trên trái (Xem thành tích / Đổi phe), hộp hỏi đổi phe và thông báo ngắn. DOM thuần.
const BTN = 'pointer-events:auto;cursor:pointer;padding:6px 12px;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:6px;font:13px monospace'

export interface TopButtonsDeps {
  onScores(): void
  onSwitch(): void
}

export function createTopButtons(deps: TopButtonsDeps, showSwitch: boolean) {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:12px;top:12px;z-index:30;display:flex;gap:8px;pointer-events:none'
  const scores = document.createElement('button'); scores.textContent = tr('Scoreboard (TAB)'); scores.style.cssText = BTN
  scores.addEventListener('click', () => deps.onScores())
  box.appendChild(scores)
  if (showSwitch) {
    const sw = document.createElement('button'); sw.textContent = tr('Switch team (~)'); sw.style.cssText = BTN
    sw.addEventListener('click', () => deps.onSwitch())
    box.appendChild(sw)
  }
  document.body.appendChild(box)
  const setActive = (v: boolean) => { scores.style.background = v ? 'rgba(80,110,200,.8)' : 'rgba(0,0,0,.55)' }
  return { setScoresActive: setActive }
}

/** Hộp hỏi: Enter / nút Đồng ý = xác nhận, Esc / nút Hủy = bỏ */
export function createConfirmPrompt() {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:40;color:#fff;font:16px monospace'
  const card = document.createElement('div')
  card.style.cssText = 'background:rgba(15,18,28,.95);border:1px solid #667;border-radius:10px;padding:18px 22px;display:flex;flex-direction:column;gap:14px;min-width:300px;text-align:center'
  const text = document.createElement('div')
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:center'
  const ok = document.createElement('button'); ok.textContent = tr('Confirm (Enter)'); ok.style.cssText = BTN
  const no = document.createElement('button'); no.textContent = tr('Cancel (Esc)'); no.style.cssText = BTN
  row.append(ok, no); card.append(text, row); el.appendChild(card)
  document.body.appendChild(el)
  let onYes: (() => void) | null = null
  const close = () => { el.style.display = 'none'; onYes = null }
  const yes = () => { const f = onYes; close(); f?.() }
  ok.addEventListener('click', yes); no.addEventListener('click', close)
  document.addEventListener('keydown', e => {
    if (!onYes) return
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); yes() }
    else if (e.code === 'Escape') { e.preventDefault(); close() }
  }, true)
  return {
    get isOpen(): boolean { return onYes !== null },
    open(message: string, confirm: () => void): void {
      text.textContent = message
      onYes = confirm
      el.style.display = 'flex'
      document.exitPointerLock?.()   // cần con trỏ để bấm nút
    },
    close,
  }
}

export function createToast() {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:35;color:#fff;font:15px monospace;background:rgba(0,0,0,.65);padding:6px 14px;border-radius:6px;pointer-events:none;display:none'
  document.body.appendChild(el)
  let timer = 0
  return (text: string) => {
    el.textContent = text; el.style.display = 'block'
    clearTimeout(timer); timer = window.setTimeout(() => { el.style.display = 'none' }, 3000)
  }
}

/** Nút góc trên phải: về màn hình chọn phòng */
export function createLeaveButton(onClick: () => void): void {
  const b = document.createElement('button')
  b.textContent = tr('Back to lobby')
  b.style.cssText = BTN + ';position:fixed;right:12px;top:12px;z-index:30'
  b.addEventListener('click', onClick)
  document.body.appendChild(b)
}

/** Góc trên trái, dưới 2 nút: "Sinh Tử · Hai thành · ROOM 1" + nút sao chép link vào thẳng phòng */
export function createRoomLabel(text: string, link: string | null, onCopied: () => void): void {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:12px;top:48px;z-index:30;display:flex;gap:8px;align-items:center;color:#fff;font:12px monospace;text-shadow:0 0 4px #000'
  const t = document.createElement('span'); t.textContent = text
  box.append(t)
  if (link !== null) {   // offline không có link vào phòng
    const b = document.createElement('button'); b.textContent = tr('Copy link'); b.style.cssText = BTN + ';padding:2px 8px;font-size:11px'
    b.addEventListener('click', () => {
      void navigator.clipboard?.writeText(link).then(onCopied, () => {})
    })
    box.append(b)
  }
  document.body.appendChild(box)
}

/** Ô lệnh debug (chỉ build dev): `/` mở, Enter gửi, Esc đóng */
export function createCommandBox(onSubmit: (cmd: string) => void) {
  const input = document.createElement('input')
  input.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);width:360px;z-index:45;display:none;padding:6px 10px;background:rgba(0,0,0,.8);color:#fff;border:1px solid #889;border-radius:6px;font:15px monospace'
  input.placeholder = '/endround A | /setround 9 | /time 10 | /money 16000 | /hp 30 | /kill | /zombie | /human | /wave 9 | /clearwave'
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { const v = input.value.trim(); close(); if (v) onSubmit(v) }
    else if (e.code === 'Escape') close()
  })
  document.body.appendChild(input)
  function close(): void { input.style.display = 'none'; input.blur(); input.value = '' }
  return {
    get isOpen(): boolean { return input.style.display !== 'none' },
    open(): void { input.style.display = 'block'; input.value = '/'; document.exitPointerLock?.(); input.focus() },
  }
}

/** Cột bên phải màn hình, dưới killfeed (top:120px, tối đa 5 dòng): chứa gợi ý phím và bảng bot offline */
export function getRightColumn(): HTMLDivElement {
  let col = document.getElementById('hud-right-col') as HTMLDivElement | null
  if (!col) {
    col = document.createElement('div'); col.id = 'hud-right-col'
    col.style.cssText = 'position:fixed;right:12px;top:290px;z-index:25;display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none'
    document.body.appendChild(col)
  }
  return col
}

/** Gợi ý phím tắt lúc chơi, bên phải màn hình. `setItems` đặt danh sách (phím, việc); `setHidden` ẩn (vd. đang làm zombie). */
export function createKeyHints() {
  const box = document.createElement('div')
  box.style.cssText = 'display:flex;flex-direction:column;gap:3px;align-items:flex-end;color:#fff;font:13px monospace;text-shadow:0 0 4px #000;pointer-events:none'
  getRightColumn().prepend(box)
  let key = ''
  let hidden = false
  return {
    setItems(items: readonly (readonly [string, string])[]): void {
      const k = items.map(i => i.join('|')).join(';')
      if (k === key) return
      key = k
      box.replaceChildren(...items.map(([label, code]) => {
        const row = document.createElement('div')
        row.style.cssText = 'background:rgba(0,0,0,.45);padding:2px 8px;border-radius:4px'
        row.textContent = `${label} (${code})`
        return row
      }))
    },
    setHidden(v: boolean): void { if (v !== hidden) { hidden = v; box.style.display = v ? 'none' : 'flex' } },
  }
}
