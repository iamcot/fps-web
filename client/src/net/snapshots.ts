import { MsgType, netToState, type NetPlayer, type OwnedWeapon, type PlayerState, type Transport, type WeaponState } from '@fps/shared'

// Snapshot mới nhất từ server (task 3.4: "client câm" chỉ vẽ đúng cái này)
export interface SnapshotStore {
  yourId: number
  tick: number
  serverTime: number          // 0 = chưa nhận snapshot nào
  ack: number
  players: NetPlayer[]
  self: PlayerState | null    // state của chính mình trong snapshot mới nhất
  wpn: WeaponState | null     // súng của mình (sau cmd ack)
  money: number               // tiền của mình (server quyết định)
  loadout: (OwnedWeapon | null)[] | null   // súng đã mua ở 4 ô
  hp: number                  // máu của mình
  flags: number               // cờ NetFlag của mình (Dead/Invuln)
  count: number
  perSec: number              // số snapshot nhận mỗi giây (cập nhật mỗi ~1s)
}

export function attachSnapshots(
  transport: Transport,
  yourId: number,
  onSnapshot?: (store: SnapshotStore) => void,
): SnapshotStore {
  const store: SnapshotStore = { yourId, tick: 0, serverTime: 0, ack: -1, players: [], self: null, wpn: null, money: 0, loadout: null, hp: 100, flags: 0, count: 0, perSec: 0 }
  let windowStart = performance.now()
  let windowCount = 0
  transport.onMessage(msg => {
    if (msg.t !== MsgType.Snapshot) return
    if (msg.tick <= store.tick) return   // cũ hoặc trùng
    store.tick = msg.tick
    store.serverTime = msg.serverTime
    store.ack = msg.ack
    store.players = msg.players
    store.count++
    windowCount++
    const now = performance.now()
    if (now - windowStart >= 1000) {
      store.perSec = windowCount * 1000 / (now - windowStart)
      windowStart = now; windowCount = 0
    }
    const me = msg.players.find(p => p.id === yourId)
    store.self = me ? netToState(me) : null
    store.wpn = msg.wpn ?? null
    store.money = msg.money ?? store.money
    store.loadout = msg.loadout ?? store.loadout
    store.hp = me?.hp ?? store.hp
    store.flags = me?.flags ?? 0
    onSnapshot?.(store)
  })
  return store
}
