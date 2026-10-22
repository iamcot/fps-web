// Bảng bot offline (plan 15, B.7): + Bot ngu ([), + Bot khôn (]), Xóa bot (\), danh sách bot. DOM thuần.
import { BOT_TAG, type BotDifficulty, type OfflineBotInfo, type OfflineStateMsg, type TeamId } from '@fps/shared'
import { getRightColumn } from './hudButtons'
import { t } from './i18n'

const BTN = 'pointer-events:auto;cursor:pointer;padding:5px 10px;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:6px;font:12px monospace'

export interface OfflinePanelDeps {
  addBot(difficulty: BotDifficulty, ally: boolean): void
  removeBot(id: number): void
  clearBots(): void
}

export function createOfflinePanel(deps: OfflinePanelDeps) {
  const box = document.createElement('div')
  box.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;color:#fff;font:12px monospace;' +
    'background:rgba(0,0,0,.35);padding:8px;border-radius:8px;max-width:360px;pointer-events:none'
  const mkBtn = (text: string, on: (e: MouseEvent) => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.textContent = text; b.style.cssText = BTN
    b.addEventListener('click', e => { on(e); b.blur() })
    return b
  }
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px'
  row.append(
    mkBtn(t('+ Easy bot ([)'), e => deps.addBot('medium', e.shiftKey)),
    mkBtn(t('+ Hard bot (])'), e => deps.addBot('hard', e.shiftKey)),
    mkBtn(t('Clear bots (\\)'), () => deps.clearBots()),
  )
  const list = document.createElement('div'); list.style.cssText = 'line-height:1.7;pointer-events:none;text-align:right'
  box.append(row, list)
  getRightColumn().appendChild(box)

  let myTeam: TeamId = 'A'

  function drawBots(bots: readonly OfflineBotInfo[]): void {
    list.replaceChildren()
    const head = document.createElement('span'); head.textContent = bots.length ? t('Bot: ') : t('No bots')
    list.appendChild(head)
    bots.forEach((b, i) => {
      if (i > 0) list.appendChild(document.createTextNode(' · '))
      const name = b.name.replace(/^\[BOT\]\s*/, '').replace(/\s+(TB|HARD)$/, '')
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
    setMyTeam(t: TeamId): void { if (t !== myTeam) { myTeam = t; drawBots(lastBots) } },
    setState(m: OfflineStateMsg): void {
      lastBots = m.bots
      drawBots(m.bots)
    },
  }
}
