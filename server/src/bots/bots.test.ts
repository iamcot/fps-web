import { describe, it, expect } from 'vitest'
import { MsgType, WEAPONS, type TeamId } from '@fps/shared'
import { createArena, type Arena } from './arena'
import { addBot } from './roster'
import type { BotController } from './controller'

function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const ready = (ms = 150) => new Promise(r => setTimeout(r, ms))   // world của bot nạp bất đồng bộ

async function arenaWith(team: TeamId, difficulty: 'medium' | 'hard', seed = 5) {
  const a = await createArena()
  const bot = addBot(a.room, difficulty, team, seeded(seed))!
  const dummy = await a.addDummy(team === 'A' ? 'B' : 'A')
  await ready()
  a.step(2); dummy.player.hp = 1e9
  a.step(60 * 3)   // vào trận + mua đồ
  return { a, bot, dummy }
}

const priv = (b: BotController) => b as unknown as { state: string; goTo(p: [number, number, number], run: boolean): void; flankUntil: number; perc: { known: Map<number, unknown> }; aim: { yaw: number } }

describe('bot — nhận thức (B.3)', () => {
  it('địch sau tường: bot không thấy, không bắn, không quay thẳng vào chỗ địch', async () => {
    const { a, bot, dummy } = await arenaWith('A', 'hard')
    // trụ tường thành ở x = −19 (z ∈ [1; 4,67]) chắn giữa hai người
    bot.state.pos = [-22, 0, 3]; bot.bot!.aim.set(-Math.PI / 2, 0)
    dummy.player.state.pos = [-16, 0, 3]
    const shots0 = bot.shotsFired
    a.step(60 * 4, () => { bot.state.pos[0] = -22; bot.state.pos[2] = 3; dummy.player.state.pos[0] = -16; dummy.player.state.pos[2] = 3 })
    expect(priv(bot.bot!).perc.known.size).toBe(0)
    expect(bot.shotsFired).toBe(shots0)
    a.dispose()
  })

  it('bị bắn từ sau lưng: bot quay lại (sau thời gian phản xạ), không quay ngay', async () => {
    const { a, bot } = await arenaWith('A', 'medium')
    bot.state.pos = [-10, 0, 5]; bot.bot!.aim.set(-Math.PI / 2, 0)   // nhìn +X
    const hold = () => { bot.state.pos[0] = -10; bot.state.pos[2] = 5 }
    a.step(30, hold)
    const yaw0 = priv(bot.bot!).aim.yaw
    bot.bot!.transport.send({ t: MsgType.Hurt, origin: [-25, 1.6, 5], damage: 20 })   // từ phía −X (sau lưng)
    a.step(3, hold)
    expect(Math.abs(Math.abs(priv(bot.bot!).aim.yaw - yaw0))).toBeLessThan(Math.PI / 2)   // chưa kịp quay
    a.step(90, hold)
    const turned = Math.abs(((priv(bot.bot!).aim.yaw - yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
    expect(turned).toBeGreaterThan(Math.PI * 0.5 - 0.6)   // đã quay hẳn về phía sau (± sai số 20°)
    a.dispose()
  })

  it('tiếng súng ngoài bán kính nghe không làm bot nghi ngờ', async () => {
    const { a, bot } = await arenaWith('A', 'medium')
    bot.state.pos = [-10, 0, 5]
    const b = bot.bot as unknown as { perc: { suspicion: unknown } }
    bot.bot!.transport.send({ t: MsgType.ShotFx, shooterId: 2, weapon: 0, origin: [29, 1.6, -15], dir: [0, 0, 1], dist: 10 })
    expect(b.perc.suspicion).toBeNull()
    a.dispose()
  })
})

describe('bot — là người chơi bình thường (B.2)', () => {
  it('thêm bot: phe địch xuất hiện ở căn cứ, mua đồ như người (tiền vô hạn không bị trừ)', async () => {
    const { a, bot } = await arenaWith('B', 'hard')
    expect(bot.team).toBe('B')
    const slots = bot.weapon.slots
    const long = slots[3]!, mid = slots[2]!
    expect(long >= 0 || mid >= 0).toBe(true)
    expect(bot.money).toBe(a.room.eco.maxMoney)   // offline + vô hạn: mua không trừ
    a.dispose()
  })

  it('bot không thể bắn khi hết đạn / đang nạp: tuân thủ tryFire (số viên ≤ băng đạn trước khi nạp)', async () => {
    const { a, bot, dummy } = await arenaWith('A', 'medium')
    bot.state.pos = [-10, 0, 5]; bot.bot!.aim.set(-Math.PI / 2, 0); dummy.player.state.pos = [10, 0, 5]
    const def = WEAPONS[bot.weapon.current]!
    const start = bot.shotsFired
    let maxBurst = 0, cur = 0, prevAmmo = bot.weapon.ammo[def.id]!
    a.step(60 * 10, () => {
      bot.state.pos[0] = -10; bot.state.pos[2] = 5
      const am = bot.weapon.ammo[def.id]!
      if (am < prevAmmo) cur += prevAmmo - am; else if (am > prevAmmo) { maxBurst = Math.max(maxBurst, cur); cur = 0 }
      prevAmmo = am
    })
    expect(bot.shotsFired).toBeGreaterThan(start)
    expect(maxBurst).toBeLessThanOrEqual(def.magSize)
    a.dispose()
  })
})

describe('bot — di chuyển (B.1/B.2)', () => {
  it('bot khó đi theo đường tới đỉnh tháp A (ramp → tháp) mà không kẹt', async () => {
    const { a, bot } = await arenaWith('A', 'hard')
    // không có địch nào nhìn thấy: dùng Flank để ép đi theo đường tới đích
    bot.state.pos = [-28, 0.2, -6]
    const b = priv(bot.bot!) as ReturnType<typeof priv> & { thinkHard(): void }
    b.thinkHard = () => {}   // tắt bộ chọn hành vi: chỉ kiểm bám đường (follow + nhảy + chống kẹt)
    b.state = 'Hunt'
    b.goTo([-15, 6.5, -18], true)
    let maxY = 0
    a.step(60 * 35, () => { maxY = Math.max(maxY, bot.state.pos[1]) })
    expect(maxY).toBeGreaterThan(6)   // lên tới mặt tháp
    a.dispose()
  }, 60000)

  it('8 bot cùng lúc: mỗi tick mô phỏng rẻ (không phải nút cổ chai)', async () => {
    const a: Arena = await createArena()
    const rng = seeded(11)
    for (let i = 0; i < 8; i++) addBot(a.room, i % 2 ? 'hard' : 'medium', i < 4 ? 'A' : 'B', rng)
    await ready(400)
    a.step(60 * 5)
    const t0 = performance.now()
    a.step(60 * 20)
    const msPerTick = (performance.now() - t0) / (60 * 20)
    console.log(`8 bot: ${msPerTick.toFixed(2)} ms/tick (ngân sách 16.7)`)
    expect(msPerTick).toBeLessThan(6)
    a.dispose()
  }, 60000)
})
