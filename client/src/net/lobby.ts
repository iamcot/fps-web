import { MsgType, TEAMS, CHARACTER_SETS, DEFAULT_CHARACTER_SET, type JoinRejectReason, type MapInfo, type RoomInfo, type TeamId, type Transport } from '@fps/shared'
import { connectWebSocket, maybeNetsim } from './transport'
import { getCharacterSet } from '../render/characters'

export interface Session {
  transport: Transport
  yourId: number
  names: Map<number, string>   // id → tên (killfeed); giữ cả người đã rời
  teams: Map<number, TeamId>   // id → đội (TeamAssigned)
  characterSet: string         // bộ nhân vật của phòng (Welcome)
}

const STORE_KEY = 'fps.lobby'
const WS_URL = `ws://${location.hostname}:8081`

function loadSaved(): { name: string; team: string; characters: string } {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}')
    return { name: String(o.name ?? ''), team: String(o.team ?? 'auto'), characters: String(o.characters ?? DEFAULT_CHARACTER_SET) }
  } catch { return { name: '', team: 'auto', characters: DEFAULT_CHARACTER_SET } }
}

const REJECT_TEXT: Record<JoinRejectReason, string> = {
  full: 'Phòng đã đầy', exists: 'Tên phòng đã có người dùng', missing: 'Phòng không còn nữa', bad: 'Tên hoặc tên phòng không hợp lệ',
}

// Dòng sự kiện mạng góc phải trên: "X vào", "X đã rời"
function createEventFeed() {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;top:52px;right:8px;color:#fff;font:13px/1.5 monospace;' +
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


interface JoinOpts { name: string; room: string; team: TeamId | 'auto'; characterSet?: string; create?: boolean; mapId?: string }

function joinRoom(transport: Transport, o: JoinOpts): Promise<Session> {
  return new Promise<Session>((resolve, reject) => {
    const names = new Map<number, string>()
    const teams = new Map<number, TeamId>()
    const log = createEventFeed()
    let welcomed = false
    let dead = false   // đã bị từ chối: handler này không làm gì nữa (lần Join sau dùng handler mới)
    transport.onMessage(msg => {
      if (dead) return
      if (msg.t === MsgType.Welcome && !welcomed) {
        welcomed = true
        for (const p of msg.players) names.set(p.id, p.name)
        log(`Vào phòng "${o.room}" với id ${msg.yourId}`)
        resolve({ transport, yourId: msg.yourId, names, teams, characterSet: msg.characterSet })
      } else if (msg.t === MsgType.JoinRejected && !welcomed) {
        dead = true
        reject(new Error(REJECT_TEXT[msg.reason] ?? 'Không vào được'))
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
    transport.send({ t: MsgType.Join, name: o.name, room: o.room, team: o.team, characterSet: o.characterSet, create: o.create, mapId: o.mapId })
  })
}

/** Đặt trước khi tải lại trang để lobby bỏ qua bước nhập tên */
export const BACK_KEY = 'fps.backToLobby'

const BTN = 'padding:8px 14px;background:#2a3550;color:#fff;border:1px solid #556;border-radius:6px;cursor:pointer;font:inherit'
const INPUT = 'padding:7px 8px;background:#111;color:#fff;border:1px solid #556;border-radius:6px;font:inherit'

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (css) e.style.cssText = css
  if (text) e.textContent = text
  return e
}

function teamSelect(value: string): HTMLSelectElement {
  const sel = mk('select', INPUT)
  sel.innerHTML = `<option value="auto">Phe: tự động</option><option value="A">Phe: ${TEAMS.A.name}</option><option value="B">Phe: ${TEAMS.B.name}</option>`
  sel.value = value === 'A' || value === 'B' ? value : 'auto'
  return sel
}

// Màn hình vào game: (1) nhập tên → (2) danh sách phòng + tạo phòng. Resolve null nếu chọn chơi offline.
export function showLobby(): Promise<Session | null> {
  const saved = loadSaved()
  const el = mk('div', 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:100;font:15px monospace;color:#fff;overflow:auto')
  // Gõ chữ không được kích hoạt phím tắt của game
  el.addEventListener('keydown', e => e.stopPropagation())
  document.body.appendChild(el)

  return new Promise(resolve => {
    const offline = () => { el.remove(); resolve(null) }
    const done = (s: Session) => { el.remove(); resolve(s) }

    // ── Bước 1: tên ──────────────────────────────────────────────────────────
    function nameStep(): void {
      el.replaceChildren()
      const form = mk('form', 'display:flex;flex-direction:column;gap:10px;width:280px')
      const title = mk('div', 'font-size:26px;text-align:center', 'FPS Web')
      const nameIn = mk('input', INPUT); nameIn.name = 'name'; nameIn.placeholder = 'Nhập tên của bạn'; nameIn.maxLength = 16; nameIn.autocomplete = 'off'
      nameIn.value = saved.name
      const go = mk('button', BTN, 'Tiếp tục'); go.type = 'submit'
      const off = mk('button', BTN, 'Chơi offline'); off.type = 'button'; off.setAttribute('data-offline', '')
      off.addEventListener('click', offline)
      const err = mk('div', 'color:#f66;min-height:1.2em')
      form.append(title, nameIn, go, off, err)
      form.addEventListener('submit', e => {
        e.preventDefault()
        const name = nameIn.value.trim()
        if (!name) { err.textContent = 'Nhập tên trước đã'; return }
        saved.name = name
        err.textContent = 'Đang kết nối…'
        connectWebSocket(WS_URL).then(raw => {
          const transport = maybeNetsim(raw)
          const direct = new URLSearchParams(location.search).get('room')
          if (direct) {   // ?room=xxx: vào thẳng (dev / test 2 tab), không qua danh sách
            joinRoom(transport, { name, room: direct, team: saved.team as TeamId | 'auto' }).then(done, e2 => { err.textContent = String(e2.message) })
          } else listStep(transport)
        }, () => { err.textContent = 'Không kết nối được server' })
      })
      el.appendChild(form)
      nameIn.focus()
      // Quay về từ "Về phòng chờ": đã có tên thì đi thẳng tới danh sách phòng
      let back = false
      try { back = sessionStorage.getItem(BACK_KEY) === '1'; sessionStorage.removeItem(BACK_KEY) } catch { /* bỏ qua */ }
      if (back && saved.name) form.requestSubmit()
    }

    // ── Bước 2: danh sách phòng + tạo phòng ──────────────────────────────────
    function listStep(transport: Transport): void {
      el.replaceChildren()
      el.style.alignItems = 'flex-start'
      const wrap = mk('div', 'width:min(1000px,94vw);padding:28px 0;display:flex;flex-direction:column;gap:14px')
      const top = mk('div', 'display:flex;align-items:center;justify-content:space-between')
      top.append(mk('div', 'font-size:22px', `Phòng đang chơi — ${saved.name}`))
      const off = mk('button', BTN, 'Chơi offline'); off.type = 'button'; off.setAttribute('data-offline', ''); off.addEventListener('click', offline)
      top.appendChild(off)
      const grid = mk('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:14px')
      const empty = mk('div', 'opacity:.7;padding:16px 0', 'Chưa có phòng nào. Hãy tạo phòng mới ở bên dưới.')
      const err = mk('div', 'color:#f66;min-height:1.2em')
      const createBox = mk('div', 'display:flex;flex-direction:column;gap:10px;padding:14px;background:rgba(255,255,255,0.07);border-radius:8px')
      wrap.append(top, grid, err, createBox)
      el.appendChild(wrap)

      let rooms: RoomInfo[] = [], maps: MapInfo[] = []
      const teamChoice = new Map<string, string>()   // chọn phe từng card, giữ qua các lần vẽ lại
      let busy = false

      const fail = (e: unknown) => { busy = false; err.textContent = String((e as Error).message ?? e) }
      const enter = (opts: JoinOpts) => {
        if (busy) return
        busy = true; err.textContent = 'Đang vào phòng…'
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ name: saved.name, team: opts.team, characters: DEFAULT_CHARACTER_SET })) } catch { /* bỏ qua */ }
        joinRoom(transport, opts).then(s => { clearInterval(poll); done(s) }, fail)
      }

      function drawRooms(): void {
        grid.replaceChildren()
        if (rooms.length === 0) { grid.appendChild(empty); return }
        for (const r of rooms) {
          const mapName = maps.find(m => m.id === r.mapId)?.name ?? r.mapId
          const card = mk('div', `position:relative;height:170px;border-radius:10px;overflow:hidden;border:1px solid #556;background:#223 linear-gradient(rgba(0,0,0,.35),rgba(0,0,0,.75)),url('/maps/${r.mapId}.png') center/cover;background-blend-mode:normal`)
          card.style.backgroundImage = `linear-gradient(rgba(0,0,0,.3),rgba(0,0,0,.8)), url('/maps/${r.mapId}.png')`
          card.style.backgroundSize = 'cover'; card.style.backgroundPosition = 'center'
          const name = mk('div', 'position:absolute;left:12px;top:10px;font-size:18px;font-weight:bold;text-shadow:0 0 4px #000;max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', r.id)
          const cnt = mk('div', 'position:absolute;right:10px;top:10px;padding:2px 8px;background:rgba(0,0,0,.6);border-radius:12px;font-weight:bold', `👤 ${r.players}/${r.maxPlayers}`)
          const info = mk('div', 'position:absolute;left:12px;top:40px;font-size:12px;line-height:1.5;text-shadow:0 0 4px #000',
            `${mapName} · ${getCharacterSet(r.characterSet).label}\n${TEAMS.A.name} ${r.teamA} — ${r.teamB} ${TEAMS.B.name}`)
          info.style.whiteSpace = 'pre-line'
          const row = mk('div', 'position:absolute;left:0;right:0;bottom:10px;display:flex;justify-content:center;gap:6px')
          const sel = teamSelect(teamChoice.get(r.id) ?? saved.team)
          sel.addEventListener('change', () => teamChoice.set(r.id, sel.value))
          const full = r.players >= r.maxPlayers
          const join = mk('button', BTN, full ? 'Đầy' : 'Vào phòng'); join.disabled = full
          if (full) join.style.opacity = '.5'
          join.addEventListener('click', () => enter({ name: saved.name, room: r.id, team: sel.value as TeamId | 'auto', create: false }))
          row.append(sel, join)
          card.append(name, cnt, info, row)
          grid.appendChild(card)
        }
      }

      // Tạo phòng
      const openBtn = mk('button', BTN + ';align-self:flex-start', 'Tạo phòng')
      const form = mk('div', 'display:none;flex-direction:column;gap:10px')
      const nameIn = mk('input', INPUT); nameIn.maxLength = 32; nameIn.placeholder = 'Tên phòng'
      const mapSel = mk('select', INPUT)
      const charSel = mk('select', INPUT)
      charSel.innerHTML = CHARACTER_SETS.map(id => `<option value="${id}">Nhân vật: ${getCharacterSet(id).label}</option>`).join('')
      charSel.value = DEFAULT_CHARACTER_SET   // luôn mặc định nhân vật người (Cớm & Cướp)
      const teamSel = teamSelect(saved.team)
      const btns = mk('div', 'display:flex;gap:8px')
      const ok = mk('button', BTN, 'Tạo phòng')
      const cancel = mk('button', BTN, 'Cancel')
      btns.append(ok, cancel)
      form.append(nameIn, mapSel, charSel, teamSel, btns)
      createBox.append(openBtn, form)
      const defaultRoomName = () => { let i = 1; while (rooms.some(r => r.id === `ROOM ${i}`)) i++; return `ROOM ${i}` }
      openBtn.addEventListener('click', () => {
        openBtn.style.display = 'none'; form.style.display = 'flex'
        nameIn.value = defaultRoomName(); nameIn.focus(); nameIn.select()
      })
      cancel.addEventListener('click', () => { form.style.display = 'none'; openBtn.style.display = '' ; err.textContent = '' })
      ok.addEventListener('click', () => {
        const room = nameIn.value.trim()
        if (!room) { err.textContent = 'Nhập tên phòng'; return }
        enter({ name: saved.name, room, team: teamSel.value as TeamId | 'auto', characterSet: charSel.value, create: true, mapId: mapSel.value })
      })
      nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); else if (e.key === 'Escape') cancel.click() })

      let sig = ''
      transport.onMessage(msg => {
        if (msg.t !== MsgType.RoomList) return
        const next = JSON.stringify(msg)
        if (next === sig) return   // không đổi thì không vẽ lại (đang mở dropdown phe sẽ bị đóng)
        sig = next
        rooms = msg.rooms; maps = msg.maps
        if (mapSel.options.length !== maps.length) mapSel.innerHTML = maps.map(m => `<option value="${m.id}">Map: ${m.name}</option>`).join('')
        drawRooms()
      })
      transport.onClose(() => { clearInterval(poll); err.textContent = 'Mất kết nối server — tải lại trang' })
      const ask = () => transport.send({ t: MsgType.ListRooms })
      const poll = setInterval(() => { if (!busy) ask() }, 2000)
      ask()
    }

    nameStep()
  })
}
