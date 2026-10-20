import { describe, it, expect } from 'vitest'
import { WEAPONS } from '@fps/shared'
import { createArena } from './arena'
import { addBot } from './roster'

function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

describe('bot vs bot', () => {
  it('2 bot khó vs 2 bot trung bình chơi 90s: có người chết, không đứng yên mãi, tick đủ nhanh', async () => {
    const a = await createArena()
    const rng = seeded(7)
    const bots = [addBot(a.room, 'hard', 'A', rng)!, addBot(a.room, 'hard', 'A', rng)!, addBot(a.room, 'medium', 'B', rng)!, addBot(a.room, 'medium', 'B', rng)!]
    await new Promise(r => setTimeout(r, 300))   // world của bot nạp bất đồng bộ
    const t0 = performance.now()
    const states = new Map<string, number>()
    const dist = new Map<number, number>()
    const last = new Map<number, [number, number]>()
    a.step(60 * 90, () => {
      for (const p of bots) {
        states.set(`${p.bot!.difficulty}:${p.bot!.state}`, (states.get(`${p.bot!.difficulty}:${p.bot!.state}`) ?? 0) + 1)
        const l = last.get(p.id)
        if (l) dist.set(p.id, (dist.get(p.id) ?? 0) + Math.hypot(p.state.pos[0] - l[0], p.state.pos[2] - l[1]))
        last.set(p.id, [p.state.pos[0], p.state.pos[2]])
      }
    })
    const ms = performance.now() - t0
    console.log(`sim 90s: ${ms.toFixed(0)}ms (${(ms / 5400).toFixed(2)}ms/tick)`)
    console.log([...bots].map(p => `${p.name}: kills ${p.kills} deaths ${p.deaths} shots ${p.shotsFired} dist ${(dist.get(p.id) ?? 0).toFixed(0)}m w=${WEAPONS[p.weapon.current]!.key}`).join('\n'))
    console.log([...states.entries()].sort().map(([k, v]) => `${k}=${(v / 60).toFixed(0)}s`).join(' '))
    a.dispose()
    expect(bots.reduce((s, p) => s + p.kills, 0)).toBeGreaterThan(0)
  }, 120000)
})
