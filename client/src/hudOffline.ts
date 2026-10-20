// Bảng điều khiển offline góc trên trái (plan 15, B.7): thêm bot, đổi phe, xoá bot, tiền vô hạn. DOM thuần.
import { BOT_TAG, TEAMS, type BotDifficulty, type OfflineBotInfo, type OfflineStateMsg, type TeamId } from '@fps/shared'

const BTN = 'pointer-events:auto;cursor:pointer;padding:5px 10px;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:6px;font:12px monospace'

export interface OfflinePanelDeps {
  addBot(difficulty: BotDifficulty, ally: boolean): void
  removeBot(id: number): void
  clearBots(): void
  swapSide(): void
  setInfiniteMoney(on: boolean): void
}

export function createOfflinePanel(deps: OfflinePanelDeps) {
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;right:12px;top:76px;z-index:30;display:flex;flex-direction:column;gap:6px;color:#fff;font:12px monospace;' +
    'background:rgba(0,0,0,.35);padding:8px;border-radius:8px;max-width:360px;pointer-events:none'
  const mkBtn = (text: string, on: (e: MouseEvent) => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.textContent = text; b.style.cssText = BTN
    b.addEventListener('click', e => { on(e); b.blur() })
    return b
  }
  const row1 = document.createElement('div'); row1.style.cssText = 'display:flex;gap:6px'
  row1.append(
    mkBtn('+ Bot trung bình', e => deps.addBot('medium', e.shiftKey)),
    mkBtn('+ Bot khó', e => deps.addBot('hard', e.shiftKey)),
  )
  const row2 = document.createElement('div'); row2.style.cssText = 'display:flex;gap:6px'
  const swapBtn = mkBtn('', () => deps.swapSide())
  row2.append(swapBtn, mkBtn('Xoá hết bot', () => deps.clearBots()))
  const list = document.createElement('div'); list.style.cssText = 'line-height:1.7;pointer-events:none'
  const moneyLabel = document.createElement('label'); moneyLabel.style.cssText = 'pointer-events:auto;cursor:pointer;display:flex;gap:6px;align-items:center'
  const moneyBox = document.createElement('input'); moneyBox.type = 'checkbox'; moneyBox.checked = true
  moneyBox.addEventListener('change', () => { deps.setInfiniteMoney(moneyBox.checked); moneyBox.blur() })
  moneyLabel.append(moneyBox, document.createTextNode('Tiền vô hạn'))
  const hint = document.createElement('div')
  hint.style.cssText = 'opacity:.7;font-size:11px;pointer-events:none'
  hint.textContent = 'Phím: [ bot TB · ] bot khó · \\ xoá hết · ~ đổi phe · Shift+nút = đồng đội · Esc nhả chuột'
  box.append(row1, row2, list, moneyLabel, hint)
  document.body.appendChild(box)

  let myTeam: TeamId = 'A'
  const label = () => { const o: TeamId = myTeam === 'A' ? 'B' : 'A'; swapBtn.textContent = `Đổi phe: ${TEAMS[myTeam].name} ⇄ ${TEAMS[o].name}` }
  label()

  function drawBots(bots: readonly OfflineBotInfo[]): void {
    list.replaceChildren()
    const head = document.createElement('span'); head.textContent = bots.length ? 'Bot: ' : 'Chưa có bot'
    list.appendChild(head)
    bots.forEach((b, i) => {
      if (i > 0) list.appendChild(document.createTextNode(' · '))
      const name = b.name.replace(/^\[BOT\]\s*/, '').replace(/\s+(TB|KHÓ)$/, '')
      const s = document.createElement('span')
      s.textContent = `${name} (${BOT_TAG[b.difficulty]}) `
      s.style.color = b.team === myTeam ? '#8fe08f' : '#ff9a9a'
      const x = document.createElement('span'); x.textContent = '✕'; x.style.cssText = 'cursor:pointer;pointer-events:auto;opacity:.85'
      x.addEventListener('click', () => deps.removeBot(b.id))
      list.append(s, x)
    })
  }

  let lastBots: readonly OfflineBotInfo[] = []
  return {
    setMyTeam(t: TeamId): void { if (t !== myTeam) { myTeam = t; label(); drawBots(lastBots) } },
    setState(m: OfflineStateMsg): void {
      moneyBox.checked = m.infiniteMoney
      lastBots = m.bots
      drawBots(m.bots)
    },
    get infiniteMoney(): boolean { return moneyBox.checked },
  }
}
