// Âm thanh lựu đạn (plan 12, G.8): chốt, thìa, vung tay, nảy, nổ nhiều lớp, ù tai. Mỗi âm dùng file nếu có
// (client/public/sounds/grenade/*.ogg) còn không thì tổng hợp. Mọi số nằm trong GSND (mutable) để chỉnh ở bảng F8 tab Grenade.
import { dbToGain, distanceCutoff, randSpread } from './audioMath'
import { getGraph, listenerPos, type AudioGraph } from './context'
import { tone, noise } from './synth'
import { getBuffer } from './loader'

type Vec3 = [number, number, number]

export const GSND = {
  pin:    { toneHz: 3200, toneDb: -14, toneDecayMs: 120, noiseHz: 5000, noiseDb: -16, noiseDecayMs: 10, nearM: 6, nearDb: -8 },
  spoon:  { startHz: 2400, endHz: 1800, db: -16, decayMs: 200 },
  throw:  { startHz: 400, endHz: 1500, db: -16, durMs: 150 },
  bounce: { noiseHz: 1800, q: 3, noiseDecayMs: 40, toneHz: 900, toneDecayMs: 60, minDb: -24, maxDb: -10, maxSpeed: 10 },
  explode: {
    crackHz: 1500, crackDb: -2, crackDecayMs: 60,
    bodyHz: 900, bodyDb: 0, bodyDecayMs: 600,
    thumpStartHz: 70, thumpEndHz: 30, thumpDb: 0, thumpDecayMs: 450,
    tailHz: 400, tailAttackMs: 40, tailDb: -10, tailDecayMs: 2500,
    debrisN: 8, debrisDb: -22, debrisMinS: 0.3, debrisMaxS: 1.2,
    farM: 40,   // ngoài khoảng này chỉ còn thump + tail
  },
  tinnitus: { enabled: true, radiusM: 4, toneHz: 3500, toneDb: -18, durS: 2, muffleHz: 700 },
}

export const GRENADE_SOUND_FILES = ['pin', 'spoon', 'throw', 'bounce_01', 'bounce_02', 'explode_01', 'explode_02', 'explode_03'].map(n => `grenade/${n}`)

const dist = (o: Vec3): number => Math.hypot(o[0] - listenerPos[0], o[1] - listenerPos[1], o[2] - listenerPos[2])

function panner(g: AudioGraph, o: Vec3): PannerNode {
  const pn = g.ctx.createPanner()
  pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.refDistance = 4; pn.rolloffFactor = 1.2
  pn.positionX.value = o[0]; pn.positionY.value = o[1]; pn.positionZ.value = o[2]
  return pn
}

// Đích của một âm: của mình → master; ở vị trí → panner + lowpass theo khoảng cách → master
function sink(g: AudioGraph, pos: Vec3 | null, extraDb = 0): AudioNode {
  const gain = g.ctx.createGain()
  gain.gain.value = dbToGain(extraDb)
  if (!pos) { gain.connect(g.master); return gain }
  const lp = g.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = distanceCutoff(dist(pos))
  gain.connect(lp).connect(panner(g, pos)).connect(g.master)
  return gain
}

function playFile(g: AudioGraph, key: string, dest: AudioNode, when: number, db: number, rate = 1): boolean {
  const buf = getBuffer(key)
  if (!buf) return false
  const src = g.ctx.createBufferSource(), gn = g.ctx.createGain()
  src.buffer = buf; src.playbackRate.value = rate; gn.gain.value = dbToGain(db)
  src.connect(gn).connect(dest)
  src.start(when)
  src.onended = () => { src.disconnect(); gn.disconnect() }
  return true
}

/** Rút chốt: chỉ mình nghe; người khác trong pin.nearM mét nghe nhỏ (pos của người rút) */
export function playPin(pos?: Vec3): void {
  const g = getGraph()
  if (!g) return
  const p = GSND.pin, t = g.ctx.currentTime
  if (pos && dist(pos) > p.nearM) return
  const out = sink(g, pos ?? null, pos ? p.nearDb : 0)
  if (playFile(g, 'grenade/pin', out, t, 0)) return
  tone(g.ctx, out, { type: 'sine', freq: p.toneHz, gainDb: p.toneDb, decayMs: p.toneDecayMs, when: t })
  noise(g.ctx, out, { filter: 'highpass', freq: p.noiseHz, gainDb: p.noiseDb, decayMs: p.noiseDecayMs, when: t })
}

/** Lựu đạn rời tay: thìa bật ra ("toinggg") */
export function playSpoon(pos?: Vec3): void {
  const g = getGraph()
  if (!g) return
  const p = GSND.spoon, t = g.ctx.currentTime
  const out = sink(g, pos ?? null)
  if (playFile(g, 'grenade/spoon', out, t, 0)) return
  tone(g.ctx, out, { type: 'sine', freq: p.startHz, freqEnd: p.endHz, gainDb: p.db, decayMs: p.decayMs, when: t })
}

/** Vung tay ném: tiếng gió quét */
export function playThrowSwish(pos?: Vec3): void {
  const g = getGraph()
  if (!g) return
  const p = GSND.throw, t = g.ctx.currentTime
  const out = sink(g, pos ?? null)
  if (playFile(g, 'grenade/throw', out, t, 0)) return
  noise(g.ctx, out, { filter: 'bandpass', freq: p.startHz, freqEnd: p.endHz, q: 1.2, gainDb: p.db, attackMs: 40, decayMs: p.durMs, when: t })
}

/** Mỗi lần nảy; âm lượng theo tốc độ va chạm (−24 → −10 dB) */
export function playBounce(pos: Vec3, speed: number): void {
  const g = getGraph()
  if (!g) return
  const p = GSND.bounce, t = g.ctx.currentTime
  const k = Math.min(1, Math.max(0, speed / p.maxSpeed))
  const db = p.minDb + (p.maxDb - p.minDb) * k
  const out = sink(g, pos)
  const f = ['grenade/bounce_01', 'grenade/bounce_02'][Math.random() < 0.5 ? 0 : 1]!
  if (playFile(g, f, out, t, db, 1 + randSpread(0.05))) return
  noise(g.ctx, out, { filter: 'bandpass', freq: p.noiseHz * (1 + randSpread(0.1)), q: p.q, gainDb: db, decayMs: p.noiseDecayMs, when: t })
  tone(g.ctx, out, { type: 'sine', freq: p.toneHz * (1 + randSpread(0.1)), gainDb: db - 2, decayMs: p.toneDecayMs, when: t })
}

/** Tiếng nổ nhiều lớp. `alive`: người nghe còn sống (mới bị ù tai) */
export function playExplode(pos: Vec3, alive = true): void {
  const g = getGraph()
  if (!g) return
  const e = GSND.explode, c = g.ctx, t = c.currentTime
  const d = dist(pos)
  const out = sink(g, pos)
  const far = d > e.farM
  if (!far) {
    // crack + body, hoặc file explode_01..03 thay cả hai lớp đó
    const f = `grenade/explode_0${1 + Math.floor(Math.random() * 3)}`
    if (!playFile(g, f, out, t, 0, 1 + randSpread(0.04))) {
      noise(c, out, { filter: 'highpass', freq: e.crackHz, gainDb: e.crackDb, decayMs: e.crackDecayMs, when: t })
      noise(c, out, { filter: 'lowpass', freq: e.bodyHz, gainDb: e.bodyDb, decayMs: e.bodyDecayMs, when: t })
    }
  }
  tone(c, out, { type: 'sine', freq: e.thumpStartHz, freqEnd: e.thumpEndHz, gainDb: e.thumpDb, decayMs: e.thumpDecayMs, when: t })
  noise(c, out, { filter: 'lowpass', freq: e.tailHz, gainDb: e.tailDb, attackMs: e.tailAttackMs, decayMs: e.tailDecayMs, when: t })
  if (!far) {   // mảnh vụn rơi lạch cạch rải rác sau nổ
    for (let i = 0; i < e.debrisN; i++) {
      const at = t + e.debrisMinS + Math.random() * (e.debrisMaxS - e.debrisMinS)
      noise(c, out, { filter: 'bandpass', freq: 2200 + Math.random() * 3000, q: 4, gainDb: e.debrisDb + randSpread(3), decayMs: 25 + Math.random() * 30, when: at })
    }
  }
  if (alive && d < GSND.tinnitus.radiusM) tinnitus()
}

/** Ù tai: tone 3500Hz nhỏ dần + master bị bịt lowpass 700Hz rồi mở dần về 20kHz */
export function tinnitus(): void {
  const g = getGraph(), s = GSND.tinnitus
  if (!g || !s.enabled) return
  const t = g.ctx.currentTime
  tone(g.ctx, g.comp, { type: 'sine', freq: s.toneHz, gainDb: s.toneDb, attackMs: 30, decayMs: s.durS * 1000, when: t })   // đi thẳng vào compressor: không bị chính lowpass bịt mất
  const f = g.muffle.frequency
  f.cancelScheduledValues(t)
  f.setValueAtTime(s.muffleHz, t)
  f.exponentialRampToValueAtTime(20000, t + s.durS)
}

