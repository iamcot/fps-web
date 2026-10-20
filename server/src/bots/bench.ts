// Đo độ chính xác của bot (plan 15, B.4/B.8): `npm run bot-bench`. Chạy không giao diện trên Room + Rapier thật.
// Nếu số đo nằm ngoài khoảng mục tiêu thì chỉnh bots.json, KHÔNG sửa code ngắm để ép kết quả.
import { MsgType, WEAPONS, type BotDifficulty } from '@fps/shared'
import { createArena, type Arena } from './arena'
import { addBot } from './roster'
import { getBotParams, setBotParams } from './params'

export interface BenchResult {
  hitRate: number          // trúng / số viên bắn
  headRate: number         // trúng đầu / số viên trúng
  shots: number
  maxHeadStreak: number    // chuỗi viên trúng đầu liên tiếp dài nhất
}

let saved: Record<BotDifficulty, ReturnType<typeof getBotParams>> | null = null
export function restoreParams(): void { if (saved) { setBotParams(saved); saved = null } }

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const BOT_POS: [number, number, number] = [-10, 0, 5]
const YAW_PLUS_X = -Math.PI / 2   // forward = (−sin yaw, −cos yaw) = (+1, 0)

async function setup(difficulty: BotDifficulty, seed: number, weapon?: string) {
  // bài đo chuẩn dùng AK47 (plan B.4): ép bot mua AK, không lựu đạn; trả lại bảng tham số khi xong (restoreParams)
  const tbl = { medium: structuredClone(getBotParams('medium')), hard: structuredClone(getBotParams('hard')) }
  saved ??= structuredClone(tbl)
  for (const d of ['medium', 'hard'] as const) { tbl[d].buy = { long: ['ak47'], pistol: [], mid: [], grenades: 0 } }
  setBotParams(tbl)
  const a = await createArena({ nav: false })
  const rng = seeded(seed)
  const bot = addBot(a.room, difficulty, 'A', rng)!
  const dummy = await a.addDummy('B', [10, 0, 5])
  await new Promise(r => setTimeout(r, 100))   // world của bot nạp bất đồng bộ
  const events: { shot: number; head: boolean | null }[] = []
  let hits = 0, heads = 0
  const send = bot.bot!.transport.send
  bot.bot!.transport.send = msg => {
    if (msg.t === MsgType.HitConfirm && msg.targetId === dummy.player.id) {
      hits++; if (msg.headshot) heads++
      events.push({ shot: bot.shotsFired, head: msg.headshot })
    }
    send(msg)
  }
  if (weapon) { /* súng do bot tự mua theo bots.json; weapon chỉ để đối chiếu */ void weapon }
  // chờ vào trận + mua đồ. Đầu trận mọi người hồi sinh đủ máu: đặt máu vô hạn cho bia SAU tick đầu tiên (không thì bot bắn chết bia lúc khởi động rồi bia hồi sinh về căn cứ)
  a.step(2)
  dummy.player.hp = 1e9
  a.step(60 * 4)
  const place = () => {
    bot.state.pos = [BOT_POS[0], BOT_POS[1], BOT_POS[2]]; bot.state.vel = [0, 0, 0]
    bot.bot!.aim.set(YAW_PLUS_X, 0)
  }
  place()
  dummy.player.state.pos = [10, 0, 5]
  return { a, bot, dummy, rng, events, counters: () => ({ hits, heads }), reset: () => { hits = 0; heads = 0; events.length = 0 }, place }
}

function result(events: { shot: number; head: boolean | null }[], shots: number, hits: number, heads: number): BenchResult {
  let streak = 0, maxStreak = 0
  for (const e of events) { if (e.head) { streak++; maxStreak = Math.max(maxStreak, streak) } else streak = 0 }
  return { hitRate: hits / Math.max(1, shots), headRate: heads / Math.max(1, hits), shots, maxHeadStreak: maxStreak }
}

/** Bia người đứng yên ở 20m (hoặc chạy ngang qua lại `strafeSpeed` m/s), bắn tới đủ `rounds` viên */
export async function benchAccuracy(difficulty: BotDifficulty, opts: { strafeSpeed?: number; rounds?: number; seed?: number } = {}): Promise<BenchResult> {
  const rounds = opts.rounds ?? 300
  const s = await setup(difficulty, opts.seed ?? 1)
  const { a, bot, dummy } = s
  s.reset()
  const startShots = bot.shotsFired
  let dir = 1
  const zc = 5, amp = 8
  const hold = () => {
    if (opts.strafeSpeed) {
      dummy.player.state.pos[2] += dir * opts.strafeSpeed / 60
      if (dummy.player.state.pos[2] > zc + amp) dir = -1
      if (dummy.player.state.pos[2] < zc - amp) dir = 1
      dummy.player.state.vel = [0, 0, dir * opts.strafeSpeed]
    }
    bot.state.pos[0] = BOT_POS[0]; bot.state.pos[2] = BOT_POS[2]   // giữ bot đúng chỗ: bài này đo ngắm, không đo di chuyển
  }
  for (let t = 0; t < 60 * 900 && bot.shotsFired - startShots < rounds; t += 60) {
    a.step(60, hold)
    if (process.env.BENCH_DEBUG && t < 60 * 12) {
      const b = bot.bot as unknown as { state: string; targetId: number; perc: { known: Map<number, { visible: boolean; reactAtMs: number }> } }
      console.log(t / 60, b.state, b.targetId, [...b.perc.known.values()].map(k => `${k.visible}/${k.reactAtMs.toFixed(0)}`).join(','), bot.bot!.aim.yaw.toFixed(2), 'shots', bot.shotsFired, 'now', a.room.serverNow.toFixed(0), 'alive', bot.alive, 'dpos', dummy.player.state.pos.map(v => v.toFixed(0)).join(','))
    }
  }
  const shots = bot.shotsFired - startShots
  const c = s.counters()
  const r = result(s.events, shots, c.hits, c.heads)
  a.dispose()
  restoreParams()
  return r
}

/** Thời gian từ lúc địch ló ra (đột ngột, đứng yên, trong tầm nhìn) tới phát bắn đầu tiên */
export async function benchReaction(difficulty: BotDifficulty, trials = 24): Promise<{ meanMs: number; minMs: number; maxMs: number }> {
  const s = await setup(difficulty, 99)
  const { a, bot, dummy } = s
  const times: number[] = []
  const hold = () => { bot.state.pos[0] = BOT_POS[0]; bot.state.pos[2] = BOT_POS[2] }
  for (let i = 0; i < trials; i++) {
    // giấu địch sau lưng bot (ngoài tầm nhìn), chờ bot yên, rồi cho ló ra phía trước
    dummy.player.state.pos = [-18, 0, 5]
    s.place()
    a.step(60 * 2, hold)
    s.place()
    bot.weapon.ammo[bot.weapon.current] = WEAPONS[bot.weapon.current]!.magSize; bot.weapon.reloadEndMs = 0   // mỗi lần thử bắt đầu với băng đầy, không đang nạp
    dummy.player.state.pos = [10, 0, 5]
    const base = bot.shotsFired
    let ticks = 0
    while (bot.shotsFired === base && ticks < 60 * 6) { a.step(1, hold); ticks++ }
    if (bot.shotsFired > base) times.push(ticks * 1000 / 60)
    a.step(60 * 2, hold)   // bot nghỉ/nạp trước lần sau
  }
  a.dispose()
  restoreParams()
  const mean = times.reduce((x, y) => x + y, 0) / Math.max(1, times.length)
  return { meanMs: mean, minMs: Math.min(...times), maxMs: Math.max(...times) }
}

export const TARGETS = {
  still: { medium: { hit: [0.25, 0.4], head: 0.15 }, hard: { hit: [0.4, 0.55], head: 0.3 } },
  strafe: { medium: { hit: [0.10, 0.20] }, hard: { hit: [0.20, 0.35] } },
  react: { medium: [700, 1100], hard: [300, 550] },
} as const

async function main(): Promise<void> {
  const fmt = (x: number) => `${(x * 100).toFixed(1)}%`
  console.log(`súng: ${WEAPONS[0]!.name} (bot tự mua theo bots.json)`)
  for (const d of ['medium', 'hard'] as const) {
    const still = await benchAccuracy(d)
    const run = await benchAccuracy(d, { strafeSpeed: 6 })
    const react = await benchReaction(d)
    const t = TARGETS
    console.log(`\n== ${d.toUpperCase()} ==`)
    console.log(`bia đứng yên 20m   : trúng ${fmt(still.hitRate)} (mục tiêu ${fmt(t.still[d].hit[0])}–${fmt(t.still[d].hit[1])}), trúng đầu/trúng ${fmt(still.headRate)} (≤ ${fmt(t.still[d].head)}), ${still.shots} viên, chuỗi đầu dài nhất ${still.maxHeadStreak}`)
    console.log(`bia chạy 6 m/s 20m : trúng ${fmt(run.hitRate)} (mục tiêu ${fmt(t.strafe[d].hit[0])}–${fmt(t.strafe[d].hit[1])}), ${run.shots} viên`)
    console.log(`từ thấy → phát đầu : TB ${react.meanMs.toFixed(0)}ms [${react.minMs.toFixed(0)}–${react.maxMs.toFixed(0)}] (mục tiêu ${t.react[d][0]}–${t.react[d][1]}ms)`)
  }
}

if (process.argv[1] && /bench\.(ts|js)$/.test(process.argv[1])) void main()
export type { Arena }
