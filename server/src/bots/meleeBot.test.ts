import { describe, it, expect } from 'vitest'
import { MsgType, WEAPONS, type HitConfirmMsg } from '@fps/shared'
import { createArena } from './arena'
import { addBot } from './roster'

function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

describe('Cận Chiến (plan 19 P7)', () => {
  it('bộ đồ chỉ có dao, không mua được gì', async () => {
    const a = await createArena({ options: { mode: 'melee' } })
    const d = await a.addDummy('A')
    a.step(5)
    const ws = d.player.weapon
    expect(ws.slots.filter(id => id >= 0).map(id => WEAPONS[id]!.key)).toEqual(['knife'])
    expect(WEAPONS[ws.current]!.key).toBe('knife')
    expect(a.room.mode.canBuy(a.room, d.player, a.room.serverNow)).toBe(false)
    a.dispose()
  })

  it('2 bot khó vs 2 bot trung bình đánh dao 60s: áp sát, có đòn trúng / bị đỡ, có người chết, không ai cầm súng', async () => {
    const a = await createArena({ options: { mode: 'melee' } })
    const rng = seeded(11)
    const bots = [addBot(a.room, 'hard', 'A', rng)!, addBot(a.room, 'hard', 'A', rng)!, addBot(a.room, 'medium', 'B', rng)!, addBot(a.room, 'medium', 'B', rng)!]
    await new Promise(r => setTimeout(r, 300))
    const outcomes = [0, 0, 0, 0]
    for (const p of bots) {
      const send = p.transport.send.bind(p.transport)
      p.transport.send = m => { if (m.t === MsgType.HitConfirm) outcomes[(m as HitConfirmMsg).outcome ?? 0]!++; send(m) }
    }
    let guardTicks = 0, closeTicks = 0, moveTicks = 0, retreatTicks = 0, wantGuard = 0
    a.step(60 * 60, () => { for (const p of bots) { if (p.weapon.guardSinceMs >= 0) guardTicks++; if (p.weapon.meleeMove >= 0) moveTicks++; const mb = (p.bot as unknown as { melee: { retreating: boolean; guardFrom: number; guardUntil: number } | null }).melee; if (mb?.retreating) retreatTicks++; if (mb && a.room.serverNow >= mb.guardFrom && a.room.serverNow < mb.guardUntil) wantGuard++; if (p.alive && bots.some(o => o.team !== p.team && o.alive && Math.hypot(o.state.pos[0] - p.state.pos[0], o.state.pos[2] - p.state.pos[2]) < 3)) closeTicks++; expect(WEAPONS[p.weapon.current]!.melee).toBe(true) } })
    console.log(`melee 60s: kills ${bots.map(p => `${p.name}=${p.kills}/${p.deaths}`).join(' ')} outcomes hit/blocked/parried/break=${outcomes.join('/')} guard=${(guardTicks / 60).toFixed(1)}s close=${(closeTicks / 60).toFixed(1)}s attacking=${(moveTicks / 60).toFixed(1)}s retreat=${(retreatTicks / 60).toFixed(1)}s wantGuard=${(wantGuard / 60).toFixed(1)}s`)
    expect(bots.reduce((s, p) => s + p.kills, 0)).toBeGreaterThan(0)
    expect(outcomes[0]).toBeGreaterThan(0)
    expect(guardTicks).toBeGreaterThan(0)
    a.dispose()
  }, 120000)
})
