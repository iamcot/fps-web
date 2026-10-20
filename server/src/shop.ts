import { ECONOMY, MatchPhase, MsgType, SWITCH_MS, TICK_RATE, applyBuy, inBuyZone, loadoutWeaponIds, quoteBuy, weaponByKey } from '@fps/shared'
import type { Player, Room } from './room'

function fail(p: Player, key: string, reason: string): void {
  p.transport.send({ t: MsgType.BuyResult, ok: false, reason, key })
}

// Xử lý lệnh Buy: server tự kiểm mọi thứ (còn sống, pha trận, vị trí server, tiền); client chỉ hiển thị
export function handleBuy(room: Room, p: Player, key: string): void {
  const now = room.serverNow
  while (p.buyTimes.length > 0 && p.buyTimes[0]! <= now - 1000) p.buyTimes.shift()
  if (p.buyTimes.length >= ECONOMY.maxBuysPerSecond) return fail(p, key, 'rate')
  p.buyTimes.push(now)

  if (!weaponByKey(key)) return fail(p, key, 'unknown')
  if (!p.alive) return fail(p, key, 'dead')
  if (room.phase === MatchPhase.Ended) return fail(p, key, 'phase')
  if (!inBuyZone(room.map, p.team, room.sideSwapped, p.state.pos)) return fail(p, key, 'out_of_zone')

  const q = quoteBuy(p.money, p.loadout, key)
  if (!q.ok) return fail(p, key, q.reason)
  const res = applyBuy(p.money, p.loadout, key)!
  p.money = res.money
  p.loadout = res.loadout

  // Cầm luôn súng vừa mua: đạn đầy, huỷ nạp. Thời gian khoá bắn tính theo seq của cmd gần nhất (cùng thang với stepWeaponCmd)
  const ws = p.weapon
  const def = weaponByKey(key)!
  ws.slots = loadoutWeaponIds(p.loadout)
  if (def.consumable) {   // lựu đạn: chỉ cất vào ô 5, không tự cầm (đang cầm súng gì thì giữ nguyên)
    p.transport.send({ t: MsgType.BuyResult, ok: true, key })
    p.transport.send({ t: MsgType.MoneyEvent, delta: -q.price, reason: 'buy' })
    return
  }
  ws.slot = q.slot
  ws.current = def.id
  ws.ammo[def.id] = def.magSize
  ws.reloadEndMs = 0
  ws.nextFireMs = Math.max(ws.nextFireMs, Math.max(0, p.lastProcessedSeq) * 1000 / TICK_RATE + SWITCH_MS)
  ws.triggerHeld = false
  p.recoil.pitch = 0; p.recoil.yaw = 0

  p.transport.send({ t: MsgType.BuyResult, ok: true, key })
  p.transport.send({ t: MsgType.MoneyEvent, delta: -q.price, reason: 'buy' })
  if (q.refund > 0) p.transport.send({ t: MsgType.MoneyEvent, delta: q.refund, reason: 'sell' })
}
