// HUD trận đấu (5.2/5.3): điểm đội + đồng hồ, đếm ngược, banner kết thúc, bảng điểm giữ Tab. DOM thuần, chỉ ghi khi text đổi.
import { MatchPhase, TEAMS, winnerOf, type ScoreboardRow, type TeamId } from '@fps/shared'

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Sắp xếp bảng điểm: kill giảm dần, bằng nhau thì ít death hơn lên trước
export function sortRows(rows: readonly ScoreboardRow[], team: TeamId): ScoreboardRow[] {
  return rows.filter(r => r.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id)
}

export function bannerText(phase: MatchPhase, scoreA: number, scoreB: number): string {
  if (phase !== MatchPhase.Ended) return ''
  const w = winnerOf(scoreA, scoreB)
  return w ? `${TEAMS[w].name.toUpperCase()} THẮNG` : 'HOÀ'
}

function el(css: string): HTMLDivElement {
  const e = document.createElement('div')
  e.style.cssText = css
  document.body.appendChild(e)
  return e
}

function setText(e: HTMLElement, text: string): void { if (e.textContent !== text) e.textContent = text }

export function createMatchHud() {
  const top = el('position:fixed;top:8px;left:50%;transform:translateX(-50%);color:#fff;font:bold 20px monospace;' +
    'text-align:center;pointer-events:none;z-index:20;background:rgba(0,0,0,0.5);padding:4px 14px;display:none')
  const score = document.createElement('div')
  const clockEl = document.createElement('div')
  clockEl.style.cssText = 'font-size:16px;opacity:.9'
  top.append(score, clockEl)
  const big = el('position:fixed;top:30%;left:0;right:0;text-align:center;color:#fff;font:bold 96px monospace;' +
    'text-shadow:0 0 12px #000;pointer-events:none;z-index:21')
  const sub = el('position:fixed;top:calc(30% + 110px);left:0;right:0;text-align:center;color:#fff;font:bold 28px monospace;' +
    'text-shadow:0 0 8px #000;pointer-events:none;z-index:21')
  let phase: MatchPhase = MatchPhase.Waiting
  let endsAt = 0
  let a = 0, b = 0, swapped = false
  let online = false

  function render(serverNow: number): void {
    if (!online) { top.style.display = 'none'; setText(big, ''); setText(sub, ''); return }
    top.style.display = 'block'
    // Đội A bên trái, B bên phải, màu đội
    const sa = `${TEAMS.A.name} ${a}`, sb = `${b} ${TEAMS.B.name}`
    setText(score, `${sa} — ${sb}`)
    const left = endsAt - serverNow
    setText(clockEl, phase === MatchPhase.Playing ? formatClock(left)
      : phase === MatchPhase.Waiting ? 'Chờ thêm người chơi…'
      : phase === MatchPhase.Countdown ? 'Chuẩn bị' : 'Hết trận')
    setText(big, phase === MatchPhase.Countdown ? String(Math.max(0, Math.ceil(left / 1000)))
      : bannerText(phase, a, b))
    setText(sub, phase === MatchPhase.Countdown && swapped ? 'Đã đổi bên' : '')
  }

  return {
    setMatch(p: MatchPhase, ends: number, sa: number, sb: number, sw: boolean): void {
      phase = p; endsAt = ends; a = sa; b = sb; swapped = sw; online = true
    },
    tick: render,
    get phase(): MatchPhase { return phase },
    clear(): void { online = false; render(0) },
  }
}

export function createScoreboard() {
  const root = el('position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
    'z-index:30;pointer-events:none;font:14px monospace;color:#fff')
  const box = document.createElement('div')
  box.style.cssText = 'display:flex;gap:16px;background:rgba(0,0,0,0.7);padding:16px 20px'
  root.appendChild(box)
  let rows: ScoreboardRow[] = []
  let myId = -1
  let visible = false
  let dirty = true

  function table(team: TeamId): HTMLElement {
    const t = document.createElement('table')
    t.style.cssText = 'border-collapse:collapse;min-width:260px'
    const head = document.createElement('caption')
    head.textContent = TEAMS[team].name
    head.style.cssText = `font-weight:bold;font-size:18px;text-align:left;padding-bottom:4px;color:${TEAMS[team].uiColor === '#2f6fd6' ? '#6fa0ff' : TEAMS[team].uiColor}`
    t.appendChild(head)
    const hr = t.insertRow()
    for (const h of ['Tên', '$', 'K', 'D', 'Ping']) {
      const c = hr.insertCell(); c.textContent = h
      c.style.cssText = 'opacity:.6;padding:2px 8px;text-align:' + (h === 'Tên' ? 'left' : 'right')
    }
    for (const r of sortRows(rows, team)) {
      const tr = t.insertRow()
      if (r.id === myId) tr.style.background = 'rgba(255,255,255,0.22)'
      const cells: [string, string][] = [[r.name, 'left'], [r.money === undefined ? '—' : `$${r.money}`, 'right'], [String(r.kills), 'right'], [String(r.deaths), 'right'], [String(r.ping), 'right']]
      for (const [txt, al] of cells) { const c = tr.insertCell(); c.textContent = txt; c.style.cssText = `padding:2px 8px;text-align:${al}` }
    }
    return t
  }

  function rebuild(): void {
    box.replaceChildren(table('A'), table('B'))
    dirty = false
  }

  return {
    setRows(r: ScoreboardRow[], me: number): void { rows = r; myId = me; dirty = true; if (visible) rebuild() },
    show(v: boolean): void {
      if (v === visible) return
      visible = v
      root.style.display = v ? 'flex' : 'none'
      if (v && dirty) rebuild()
    },
  }
}
