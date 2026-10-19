import { MsgType, TEAMS, type TeamId, type Transport } from '@fps/shared'
import { connectWebSocket, maybeNetsim } from './transport'

export interface Session {
  transport: Transport
  yourId: number
  names: Map<number, string>   // id → tên (killfeed); giữ cả người đã rời
  teams: Map<number, TeamId>   // id → đội (TeamAssigned)
}

const STORE_KEY = 'fps.lobby'
const WS_URL = `ws://${location.hostname}:8081`

function loadSaved(): { name: string; room: string; team: string } {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
    return { name: String(o.name ?? ''), room: String(o.room ?? 'lobby'), team: String(o.team ?? 'auto') }
  } catch { return { name: '', room: 'lobby', team: 'auto' } }
}

// Dòng sự kiện mạng góc phải trên: "X vào", "X đã rời"
function createEventFeed() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;top:8px;right:8px;color:#fff;font:13px/1.5 monospace;' +
    'text-align:right;pointer-events:none;z-index:20'
  document.body.appendChild(el)
  return (text: string) => {
    console.log(`[net] ${text}`)
    const line = document.createElement('div')
    line.textContent = text
    line.style.cssText = 'background:rgba(0,0,0,0.5);padding:2px 6px;margin-bottom:2px'
    el.appendChild(line)
    setTimeout(() => line.remove(), 5000)
  }
}

function connectAndJoin(name: string, room: string, team: TeamId | 'auto'): Promise<Session> {
  return connectWebSocket(WS_URL).then(raw => new Promise<Session>((resolve, reject) => {
    const transport = maybeNetsim(raw)
    const names = new Map<number, string>()
    const teams = new Map<number, TeamId>()
    const log = createEventFeed()
    let welcomed = false
    transport.onMessage(msg => {
      if (msg.t === MsgType.Welcome && !welcomed) {
        welcomed = true
        for (const p of msg.players) names.set(p.id, p.name)
        log(`Vào phòng "${room}" với id ${msg.yourId}`)
        resolve({ transport, yourId: msg.yourId, names, teams })
      } else if (msg.t === MsgType.TeamAssigned) {
        teams.set(msg.id, msg.team)
      } else if (msg.t === MsgType.PlayerJoined) {
        names.set(msg.id, msg.name)
        log(`${msg.name} (#${msg.id}) vào`)
      } else if (msg.t === MsgType.PlayerLeft) {
        log(`${names.get(msg.id) ?? '#' + msg.id} đã rời`)
      }
    })
    transport.onClose(() => {
      if (!welcomed) reject(new Error('Server đóng kết nối'))
      else log('Mất kết nối server')
    })
    transport.send({ t: MsgType.Join, name, room, team })
  }))
}

// Màn hình nhập tên + mã phòng. Resolve null nếu chọn chơi offline.
export function showLobby(): Promise<Session | null> {
  const saved = loadSaved()
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.8);z-index:100;font:16px monospace;color:#fff'
  el.innerHTML = `
    <form style="display:flex;flex-direction:column;gap:10px;width:260px">
      <div style="font-size:24px;text-align:center">FPS Web</div>
      <input name="name" placeholder="Tên" maxlength="16" value="" autocomplete="off">
      <input name="room" placeholder="Mã phòng" maxlength="32" value="" autocomplete="off">
      <select name="team">
        <option value="auto">Đội: tự động</option>
        <option value="A">Đội: ${TEAMS.A.name}</option>
        <option value="B">Đội: ${TEAMS.B.name}</option>
      </select>
      <button type="submit">Vào phòng</button>
      <button type="button" data-offline>Chơi offline</button>
      <div data-err style="color:#f66;min-height:1.2em"></div>
    </form>`
  document.body.appendChild(el)
  const form = el.querySelector('form')!
  const nameIn = form.elements.namedItem('name') as HTMLInputElement
  const roomIn = form.elements.namedItem('room') as HTMLInputElement
  const err = el.querySelector('[data-err]') as HTMLElement
  const teamIn = form.elements.namedItem('team') as HTMLSelectElement
  teamIn.value = saved.team === 'A' || saved.team === 'B' ? saved.team : 'auto'
  nameIn.value = saved.name
  roomIn.value = new URLSearchParams(location.search).get('room') ?? saved.room
  // Gõ chữ không được kích hoạt phím tắt của game
  el.addEventListener('keydown', e => e.stopPropagation())

  return new Promise(resolve => {
    el.querySelector('[data-offline]')!.addEventListener('click', () => { el.remove(); resolve(null) })
    form.addEventListener('submit', e => {
      e.preventDefault()
      const name = nameIn.value.trim()
      const room = roomIn.value.trim()
      if (!name || !room) { err.textContent = 'Nhập tên và mã phòng'; return }
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ name, room, team: teamIn.value })) } catch { /* bỏ qua */ }
      err.textContent = 'Đang kết nối…'
      connectAndJoin(name, room, teamIn.value as TeamId | 'auto').then(
        s => { el.remove(); resolve(s) },
        () => { err.textContent = 'Không vào được: server tắt hoặc phòng đã đầy' },
      )
    })
  })
}
