import { MsgType, netToState, type NetPlayer, type PlayerState, type Transport } from '@fps/shared'

// Snapshot mới nhất từ server (task 3.4: "client câm" chỉ vẽ đúng cái này)
export interface SnapshotStore {
  yourId: number
  tick: number
  serverTime: number          // 0 = chưa nhận snapshot nào
  ack: number
  players: NetPlayer[]
  self: PlayerState | null    // state của chính mình trong snapshot mới nhất
  count: number
}

export function attachSnapshots(
  transport: Transport,
  yourId: number,
  onSnapshot?: (store: SnapshotStore) => void,
): SnapshotStore {
  const store: SnapshotStore = { yourId, tick: 0, serverTime: 0, ack: -1, players: [], self: null, count: 0 }
  transport.onMessage(msg => {
    if (msg.t !== MsgType.Snapshot) return
    if (msg.tick <= store.tick) return   // cũ hoặc trùng
    store.tick = msg.tick
    store.serverTime = msg.serverTime
    store.ack = msg.ack
    store.players = msg.players
    store.count++
    const me = msg.players.find(p => p.id === yourId)
    store.self = me ? netToState(me) : null
    onSnapshot?.(store)
  })
  return store
}
