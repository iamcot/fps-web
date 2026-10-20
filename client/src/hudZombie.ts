// HUD các thể thức zombie (plan 16 I.4/ZF.6, plan 17 T.7): thanh trên giữa, banner giữa màn hình, thanh máu/chiêu của zombie. DOM thuần, chỉ ghi khi text đổi.
import { MatchPhase, type DefenseEndMsg, type DefenseStateMsg, type WaveClearMsg, type WaveStartMsg, type HeroChosenMsg, type InfectedMsg, type InfectionCountMsg, type MatchEndMsg, type MatchStateMsg, type RoundEndMsg } from '@fps/shared'
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

  // ── Thủ Thành: thanh máu boss, lời nhắc cứu, màn gục, mũi tên đồng đội bị tấn công, bảng thống kê cuối trận
  const bossBar = el('position:fixed;top:64px;left:50%;transform:translateX(-50%);width:min(560px,70vw);display:none;pointer-events:none;z-index:20;text-align:center;color:#ff6a6a;font:bold 18px monospace;text-shadow:0 0 4px #000')
  const bossName = document.createElement('div')
  const bossOuter = document.createElement('div')
  bossOuter.style.cssText = 'height:16px;background:rgba(0,0,0,.65);border:2px solid #722;margin-top:2px'
  const bossFill = document.createElement('div')
  bossFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(#e33,#911)'
  bossOuter.appendChild(bossFill)
  bossBar.append(bossName, bossOuter)
  const prompt = el('position:fixed;top:58%;left:50%;transform:translateX(-50%);display:none;pointer-events:none;z-index:20;color:#fff;font:bold 20px monospace;text-shadow:0 0 4px #000;text-align:center')
  const promptBar = document.createElement('div')
  promptBar.style.cssText = 'height:8px;width:200px;background:rgba(0,0,0,.6);margin:4px auto 0;border:1px solid #fff'
  const promptFill = document.createElement('div')
  promptFill.style.cssText = 'height:100%;width:0;background:#6fe06f'
  promptBar.appendChild(promptFill)
  const promptText = document.createElement('div')
  prompt.append(promptText, promptBar)
  const downed = el('position:fixed;inset:0;display:none;pointer-events:none;z-index:15;background:radial-gradient(transparent 40%,rgba(160,0,0,.55));color:#fff;font:bold 28px monospace;text-align:center;padding-top:62vh;text-shadow:0 0 6px #000')
  const arrow = el('position:fixed;left:50%;top:50%;width:0;height:0;display:none;pointer-events:none;z-index:19;border-left:14px solid transparent;border-right:14px solid transparent;border-bottom:34px solid #ffb030;filter:drop-shadow(0 0 3px #000)')
  const endBox = el('position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,.6);z-index:25;color:#fff;font:15px monospace;pointer-events:none')
  const nose = el('position:fixed;top:92px;left:50%;transform:translateX(-50%);display:none;pointer-events:none;z-index:20;font:bold 22px monospace;color:#ff6a6a;text-shadow:0 0 6px #000')
  nose.textContent = '👃 Bạn bị zombie đánh hơi!'
  let defense: DefenseStateMsg | null = null
  let lastClear: WaveClearMsg | null = null

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
      const d = defense
      if (d) {
        const leftSec = formatClock(d.phaseEndsAt - serverNow)
        switch (d.phase) {
          case 'waiting': clock = 'Chờ người chơi…'; break
          case 'prep': clock = `Chuẩn bị · ${leftSec}`; bigT = bigT || `Zombie tới sau ${leftSec}`; subT = subT || 'Mua súng ở khu mua · B'; break
          case 'wave': clock = `ĐỢT ${d.wave} / ${d.waves}  ·  Còn ${d.zombiesLeft} zombie`; break
          case 'intermission': clock = `Đợt tiếp theo sau ${leftSec}`; break
          case 'victory': clock = 'THẮNG!'; break
          case 'defeat': clock = 'THUA'; break
        }
        if (d.phase === 'intermission' && lastClear && !big_text) { bigT = `HẾT ĐỢT ${lastClear.wave} · +$${lastClear.bonus}` }
      } else clock = extraTop
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
    setDefense(m: DefenseStateMsg): void { defense = m; if (m.phase === 'wave' || m.phase === 'prep') endBox.style.display = 'none' },
    onWaveStart(m: WaveStartMsg): void { lastClear = null; say(m.title, m.hint, 3000, '#ffd23c') },
    onWaveClear(m: WaveClearMsg): void { lastClear = m; say(`HẾT ĐỢT ${m.wave} · +$${m.bonus}`, '', 3000, '#7ed957') },
    onDefenseEnd(m: DefenseEndMsg, nameOf: (id: number) => string): void {
      endBox.replaceChildren()
      const title = document.createElement('div')
      title.textContent = m.result === 'victory' ? 'THỦ THÀNH THÀNH CÔNG!' : `THUA Ở ĐỢT ${m.wave}`
      title.style.cssText = `font-size:44px;font-weight:bold;margin-bottom:14px;color:${m.result === 'victory' ? '#7ed957' : '#ff6a6a'}`
      const tb = document.createElement('table')
      tb.style.cssText = 'border-collapse:collapse;min-width:420px;background:rgba(0,0,0,.5)'
      const hr = tb.insertRow()
      for (const h of ['Tên', 'Zombie hạ', 'Sát thương', 'Cứu']) { const c = hr.insertCell(); c.textContent = h; c.style.cssText = 'opacity:.6;padding:3px 10px;text-align:' + (h === 'Tên' ? 'left' : 'right') }
      for (const r of m.stats.slice().sort((a, b) => b.kills - a.kills)) {
        const tr = tb.insertRow()
        const cells: [string, string][] = [[nameOf(r.id), 'left'], [String(r.kills), 'right'], [String(r.damage), 'right'], [String(r.revives), 'right']]
        for (const [t, al] of cells) { const c = tr.insertCell(); c.textContent = t; c.style.cssText = `padding:3px 10px;text-align:${al}` }
      }
      endBox.append(title, tb)
      endBox.style.display = 'flex'
    },
    /** frac = máu boss 0..1; null = không có boss */
    setBoss(frac: number | null, name = 'ĐẠI CA ZOMBIE'): void {
      if (frac === null) { bossBar.style.display = 'none'; return }
      bossBar.style.display = 'block'
      setText(bossName, `${name}  ${Math.ceil(frac * 100)}%`)
      bossFill.style.width = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`
    },
    /** Lời nhắc "Giữ E để cứu" kèm tiến độ; null ẩn */
    setRevivePrompt(p: { name: string; progress: number } | null): void {
      if (!p) { prompt.style.display = 'none'; return }
      prompt.style.display = 'block'
      setText(promptText, `Giữ E để cứu ${p.name}`)
      promptFill.style.width = `${(Math.max(0, Math.min(1, p.progress)) * 100).toFixed(0)}%`
    },
    /** Mình đang gục: số giây còn lại; null = không gục */
    setDownedSelf(secLeft: number | null): void {
      if (secLeft === null) { downed.style.display = 'none'; return }
      downed.style.display = 'block'
      setText(downed, `BẠN ĐÃ GỤC · chờ đồng đội cứu (${Math.ceil(secLeft)}s)`)
    },
    /** Mũi tên mép màn hình chỉ hướng đồng đội đang bị zombie tấn công; angle rad (0 = lên trên, + = sang phải); null ẩn */
    setAttackArrow(angle: number | null): void {
      if (angle === null) { arrow.style.display = 'none'; return }
      arrow.style.display = 'block'
      const r = Math.min(window.innerWidth, window.innerHeight) * 0.42
      arrow.style.transform = `translate(${Math.sin(angle) * r - 14}px, ${-Math.cos(angle) * r - 17}px) rotate(${angle}rad)`
    },
    onMatchEnd(m: MatchEndMsg, mvpName: string): void { matchEnd = m; mvp = mvpName },
    /** Ghi dòng thông báo/banner tuỳ ý (Thủ Thành dùng) */
    banner(text: string, subText = '', ms = 3000, color = '#fff'): void { say(text, subText, ms, color) },
    feedLine: line,
    setTopText(t: string): void { extraTop = t },
    /** Icon mũi 2 giây khi bị zombie đánh hơi */
    setNose(on: boolean): void { nose.style.display = on ? 'block' : 'none' },
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
    clear(): void { online = false; st = null; lastEnd = null; matchEnd = null; defense = null; self.style.display = 'none'; bossBar.style.display = 'none'; prompt.style.display = 'none'; downed.style.display = 'none'; arrow.style.display = 'none'; endBox.style.display = 'none'; render(0) },
  }
}
