import credits from '@assets/CREDITS.json'

interface CreditEntry { file: string; author: string; source: string; license: string; url?: string }

/** Cửa sổ "Ghi công": cùng nội dung với CREDITS.txt (sinh từ assets/CREDITS.json). */
export function showCredits(): void {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.92);color:#fff;font:13px/1.5 monospace;overflow:auto;padding:24px;display:flex;flex-direction:column;align-items:center'
  box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') box.remove() })
  const wrap = document.createElement('div')
  wrap.style.cssText = 'width:min(900px,94vw);display:flex;flex-direction:column;gap:6px'
  const head = document.createElement('div')
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:20px;margin-bottom:8px'
  head.textContent = 'Credits'
  const close = document.createElement('button')
  close.textContent = 'Close'
  close.style.cssText = 'padding:6px 12px;background:#2a3550;color:#fff;border:1px solid #556;border-radius:6px;cursor:pointer;font:inherit'
  close.addEventListener('click', () => box.remove())
  head.appendChild(close)
  wrap.appendChild(head)
  for (const c of credits as CreditEntry[]) {
    const row = document.createElement('div')
    row.style.cssText = 'padding:6px 0;border-top:1px solid #334'
    const lines = [c.file, `Tác giả: ${c.author}`, `Nguồn: ${c.source}${c.url ? ` (${c.url})` : ''}`, `Giấy phép: ${c.license}`]
    lines.forEach((t, i) => {
      const d = document.createElement('div')
      d.textContent = t
      if (i === 0) d.style.fontWeight = 'bold'; else d.style.opacity = '0.8'
      row.appendChild(d)
    })
    wrap.appendChild(row)
  }
  box.appendChild(wrap)
  document.body.appendChild(box)
  close.focus()
}
