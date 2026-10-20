// HUD các thể thức zombie (plan 16 I.4/ZF.6, plan 17 T.7): thanh trên giữa, banner giữa màn hình, thanh máu/chiêu của zombie. DOM thuần, chỉ ghi khi text đổi.
import { MatchPhase, type HeroChosenMsg, type InfectedMsg, type InfectionCountMsg, type MatchEndMsg, type MatchStateMsg, type RoundEndMsg } from '@fps/shared'
import { formatClock } from './hudMatch'

function el(css: string): HTMLDivElement {
  const e = document.createElement('div')
  e.style.cssText = css
  document.body.appendChild(e)
  return e
}
function setText(e: HTMLElement, text: string): void { if (e.textContent !== text) e.textContent = text }

export interface ZombieSelf {
  zombie: boolean
  hp: number
  hpMax: number
  leapCdMs: number     // hồi chiêu E còn lại (ms)
  leapMaxMs: number
  sniffCdMs?: number   // Q (Lây Nhiễm): hồi chiêu đánh hơi còn lại
  sniffMaxMs?: number
}

export const ROUND_END_TEXT = {
  infected_all: 'Zombie đã lây nhiễm tất cả',
  time_survive: 'Hết giờ · còn người sống sót',
} as const

export function createZombieHud() {
  const top = el('position:fixed;top:8px;left:50%;transform:translateX(-50%);color:#fff;font:bold 22px monospace;' +
    'text-align:center;pointer-events:none;z-index:20;background:rgba(0,0,0,0.55);padding:4px 16px;display:none')
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:16px'
  const humansEl = document.createElement('span'), clockEl = document.createElement('span'), zombiesEl = document.createElement('span')
  humansEl.style.color = '#6fa0ff'; zombiesEl.style.color = '#7ed957'
  clockEl.style.cssText = 'min-width:84px;font-size:20px'
  row.append(humansEl, clockEl, zombiesEl)
  const subEl = document.createElement('div')
  subEl.style.cssText = 'font-size:13px;opacity:.85'
  top.append(row, subEl)

  const big = el('position:fixed;top:24%;left:0;right:0;text-align:center;color:#fff;font:bold 56px monospace;' +
    'text-shadow:0 0 12px #000;pointer-events:none;z-index:21')
  const sub = el('position:fixed;top:calc(24% + 70px);left:0;right:0;text-align:center;color:#fff;font:bold 24px monospace;' +
    'text-shadow:0 0 8px #000;pointer-events:none;z-index:21')
  const feed = el('position:fixed;top:60px;left:50%;transform:translateX(-50%);color:#fff;font:14px/1.6 monospace;text-align:center;pointer-events:none;z-index:20')

  // Zombie: thanh máu lớn + chiêu E (thay ô vũ khí/đạn)
  const self = el('position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:min(520px,60vw);display:none;pointer-events:none;z-index:20;font:bold 16px monospace;color:#fff;text-shadow:0 0 4px #000')
  const hpText = document.createElement('div')
  hpText.style.cssText = 'text-align:center;margin-bottom:2px'
  const hpOuter = document.createElement('div')
  hpOuter.style.cssText = 'height:18px;background:rgba(0,0,0,.6);border:2px solid #355'
  const hpFill = document.createElement('div')
  hpFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(#e24b3b,#9b2417)'
  hpOuter.appendChild(hpFill)
  const skills = document.createElement('div')
  skills.style.cssText = 'display:flex;gap:10px;justify-content:center;margin-top:8px'
  const mkSkill = (key: string, label: string) => {
    const b = document.createElement('div')
    b.style.cssText = 'position:relative;width:54px;height:54px;border:2px solid #7ed957;background:rgba(0,0,0,.6);text-align:center;line-height:54px;overflow:hidden'
    const cd = document.createElement('div')
    cd.style.cssText = 'position:absolute;left:0;bottom:0;right:0;height:0;background:rgba(0,0,0,.75)'
    const t = document.createElement('div')
    t.style.cssText = 'position:relative;font-size:12px;line-height:1.1;padding-top:10px'
    t.innerHTML = `<b style="font-size:20px">${key}</b><br>${label}`
    const n = document.createElement('div')
    n.style.cssText = 'position:absolute;inset:0;font-size:22px;color:#fff'
    b.append(cd, t, n)
    return { box: b, cd, num: n }
  }
  const leap = mkSkill('E', 'Nhảy'), sniff = mkSkill('Q', 'Đánh hơi')
  sniff.box.style.display = 'none'
  skills.append(leap.box, sniff.box)
  self.append(hpText, hpOuter, skills)

  let st: MatchStateMsg | null = null
  let counts = { humans: 0, zombies: 0 }
  let online = false
  let big_until = 0, sub_text = '', big_text = ''
  let lastEnd: RoundEndMsg | null = null
  let matchEnd: MatchEndMsg | null = null
  let mvp = ''
  let extraTop = ''   // thể thức khác (Thủ Thành) ghi dòng giữa vào đây

  function say(text: string, subText = '', ms = 2500, color = '#fff'): void {
    big_text = text; sub_text = subText; big_until = performance.now() + ms
    big.style.color = color
  }
  function line(text: string, color = '#fff'): void {
    const d = document.createElement('div')
    d.textContent = text
    d.style.cssText = `background:rgba(0,0,0,.55);padding:1px 10px;margin-bottom:2px;color:${color}`
    feed.appendChild(d)
    while (feed.children.length > 4) feed.firstElementChild!.remove()
    setTimeout(() => d.remove(), 4000)
  }

  function render(serverNow: number): void {
    const now = performance.now()
    if (now > big_until && big_text !== '') { big_text = ''; sub_text = '' }
    if (!online || !st || (st.mode !== 'infection' && st.mode !== 'defense')) { top.style.display = 'none'; setText(big, ''); setText(sub, ''); return }
    top.style.display = 'block'
    const left = st.phaseEndsAt - serverNow
    let clock = '', topSub = '', bigT = big_text, subT = sub_text
    if (st.mode === 'infection') {
      setText(humansEl, `🧍 ${counts.humans}`); setText(zombiesEl, `${counts.zombies} 🧟`)
      switch (st.phase) {
        case MatchPhase.Waiting: clock = 'Chờ thêm người (cần 3)…'; break
        case MatchPhase.Prep: clock = formatClock(left); bigT = bigT || `Zombie xuất hiện sau ${formatClock(left)}`; subT = subT || 'Mua súng ở bất cứ đâu · B'; break
        case MatchPhase.Playing: clock = formatClock(left); break
        case MatchPhase.RoundEnd:
          clock = '0:00'
          if (lastEnd && !big_text) { bigT = lastEnd.winner === 'A' ? 'NGƯỜI THẮNG' : 'ZOMBIE THẮNG'; subT = ROUND_END_TEXT[lastEnd.reason as keyof typeof ROUND_END_TEXT] ?? '' }
          break
        case MatchPhase.Ended:
          clock = `Trận mới sau ${formatClock(left)}`
          if (matchEnd) { bigT = 'KẾT THÚC TRẬN'; subT = mvp ? `Nhiều điểm nhất: ${mvp}` : '' }
          break
      }
      if (st.phase !== MatchPhase.Waiting) topSub = `Ván ${Math.min(st.round, st.maxRounds)}/${st.maxRounds}`
    } else {
      setText(humansEl, ''); setText(zombiesEl, '')
      clock = extraTop
    }
    setText(clockEl, clock); setText(subEl, topSub)
    setText(big, bigT); setText(sub, subT)
    if (st.mode === 'infection' && st.phase === MatchPhase.Prep && !big_text) big.style.color = '#fff'
  }

  return {
    setMatch(m: MatchStateMsg): void {
      if (m.phase === MatchPhase.Prep && st?.phase !== MatchPhase.Prep) { lastEnd = null; matchEnd = null }
      st = m; online = true
      if (m.mode === 'infection') { counts = { humans: m.aliveA, zombies: m.aliveB } }
    },
    onCount(m: InfectionCountMsg): void { counts = { humans: m.humans, zombies: m.zombies } },
    onInfected(m: InfectedMsg, nameOf: (id: number) => string, myId: number): void {
      if (m.kind === 'mother') { say('ZOMBIE MẸ ĐÃ XUẤT HIỆN', m.playerId === myId ? 'Bạn là zombie mẹ! Lây nhiễm tất cả' : '', 3000, '#7ed957'); return }
      if (m.playerId === myId) { say('BẠN ĐÃ BỊ LÂY NHIỄM!', '', 2500, '#7ed957'); return }
      line(`${nameOf(m.playerId)} ĐÃ BỊ LÂY NHIỄM`, '#9be07a')
    },
    onHero(m: HeroChosenMsg, nameOf: (id: number) => string, myId: number): void {
      say(m.playerId === myId ? 'BẠN LÀ NGƯỜI CUỐI CÙNG – ANH HÙNG!' : `${nameOf(m.playerId)} LÀ NGƯỜI CUỐI CÙNG – ANH HÙNG!`, '', 3000, '#ffd23c')
    },
    onRoundEnd(m: RoundEndMsg): void { lastEnd = m },
    onMatchEnd(m: MatchEndMsg, mvpName: string): void { matchEnd = m; mvp = mvpName },
    /** Ghi dòng thông báo/banner tuỳ ý (Thủ Thành dùng) */
    banner(text: string, subText = '', ms = 3000, color = '#fff'): void { say(text, subText, ms, color) },
    feedLine: line,
    setTopText(t: string): void { extraTop = t },
    setSelf(s: ZombieSelf): void {
      self.style.display = s.zombie ? 'block' : 'none'
      if (!s.zombie) return
      const frac = s.hpMax > 0 ? Math.max(0, Math.min(1, s.hp / s.hpMax)) : 0
      setText(hpText, `${Math.ceil(s.hp)} / ${Math.ceil(s.hpMax)}`)
      hpFill.style.width = `${(frac * 100).toFixed(1)}%`
      const f = s.leapMaxMs > 0 ? Math.min(1, s.leapCdMs / s.leapMaxMs) : 0
      leap.cd.style.height = `${(f * 100).toFixed(0)}%`
      setText(leap.num, s.leapCdMs > 0 ? String(Math.ceil(s.leapCdMs / 1000)) : '')
      if (s.sniffMaxMs !== undefined) {
        sniff.box.style.display = 'block'
        const g = s.sniffMaxMs > 0 ? Math.min(1, (s.sniffCdMs ?? 0) / s.sniffMaxMs) : 0
        sniff.cd.style.height = `${(g * 100).toFixed(0)}%`
        setText(sniff.num, (s.sniffCdMs ?? 0) > 0 ? String(Math.ceil((s.sniffCdMs ?? 0) / 1000)) : '')
      }
    },
    tick: render,
    clear(): void { online = false; st = null; lastEnd = null; matchEnd = null; self.style.display = 'none'; render(0) },
  }
}
