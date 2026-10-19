// Tiếng bước chân + tiếp đất. Thông số nằm hết trong FOOTSTEPS (chỉnh ở F8 > Footsteps).
import { dbToGain, randSpread, pickNoRepeat, distanceCutoff } from './audioMath'
import { getGraph, listenerPos, type AudioGraph } from './context'
import { tone, noise } from './synth'
import { commonKey, getBuffer } from './loader'

export const FOOTSTEPS = {
  stepDistM: 2.4,       // mỗi 2,4m một bước
  minSpeed: 1,          // m/s: chậm hơn thì không tính là đang bước
  own: {
    gainDb: -20, crouchDb: -10,                 // đang ngồi: thêm −10dB
    highpassHz: 180, lowShelfHz: 250, lowShelfDb: -5, highShelfHz: 3000, highShelfDb: 2,
    pitchRand: 0.07, gainRandDb: 2, pan: 0.15,  // xen kẽ trái/phải ±pan
  },
  landing: { minFallSpeed: 4, gainDb: -14, thumpDb: -6 },   // vận tốc rơi (m/s) > minFallSpeed
  other: { gainDb: -14, maxDistM: 25, refDistance: 3, rolloff: 1.5 },
  synth: { bandHz: 1100, bandQ: 1.2, decayMs: 45, shuffleHz: 3000, shuffleDecayMs: 15, shuffleDb: -10 },
}

export const FOOTSTEP_FILES = ['footstep_01', 'footstep_02', 'footstep_03', 'footstep_04', 'land_01'].map(commonKey)

// ── Bus của mình: 2 panner trái/phải ─► highpass ─► lowshelf ─► highshelf ─► master ──
interface Bus { left: StereoPannerNode; right: StereoPannerNode; hp: BiquadFilterNode; low: BiquadFilterNode; high: BiquadFilterNode }
let bus: Bus | null = null
let nextRight = false
let lastFile: string | undefined

function applyBus(b: Bus): void {
  const o = FOOTSTEPS.own
  b.hp.frequency.value = o.highpassHz
  b.low.frequency.value = o.lowShelfHz; b.low.gain.value = o.lowShelfDb
  b.high.frequency.value = o.highShelfHz; b.high.gain.value = o.highShelfDb
  b.left.pan.value = -o.pan
  b.right.pan.value = o.pan
}

function ensureBus(g: AudioGraph): Bus {
  if (!bus) {
    const c = g.ctx
    const hp = c.createBiquadFilter(); hp.type = 'highpass'
    const low = c.createBiquadFilter(); low.type = 'lowshelf'
    const high = c.createBiquadFilter(); high.type = 'highshelf'
    const left = c.createStereoPanner(), right = c.createStereoPanner()
    left.connect(hp); right.connect(hp)
    hp.connect(low).connect(high).connect(g.master)
    bus = { left, right, hp, low, high }
    applyBus(bus)
  }
  return bus
}

/** Gọi khi chỉnh FOOTSTEPS.own ở bảng F8. */
export function refreshFootstepBus(): void {
  if (bus) applyBus(bus)
}

/** Một bước (file nếu có, không thì tổng hợp) vào `dest`; `pitch` nhân tần số/tốc độ phát. */
function emitStep(g: AudioGraph, dest: AudioNode, when: number, pitch: number, db: number, landing: boolean): void {
  const files = (landing ? ['land_01'] : ['footstep_01', 'footstep_02', 'footstep_03', 'footstep_04'])
    .map(commonKey).filter(k => getBuffer(k))
  const key = pickNoRepeat(files, lastFile, Math.random)
  if (key) {
    lastFile = key
    const src = g.ctx.createBufferSource()
    const gn = g.ctx.createGain()
    src.buffer = getBuffer(key)!
    src.playbackRate.value = pitch
    gn.gain.value = dbToGain(db)
    src.connect(gn).connect(dest)
    src.start(when)
    src.onended = () => { src.disconnect(); gn.disconnect() }
    return
  }
  // Dự phòng: thân bước (bandpass) + tiếng sột của đế giày (highpass, nhỏ hơn)
  const s = FOOTSTEPS.synth
  noise(g.ctx, dest, { filter: 'bandpass', freq: s.bandHz * pitch, q: s.bandQ, gainDb: db, decayMs: s.decayMs, when })
  noise(g.ctx, dest, { filter: 'highpass', freq: s.shuffleHz * pitch, gainDb: db + s.shuffleDb, decayMs: s.shuffleDecayMs, when })
  if (landing) tone(g.ctx, dest, { type: 'sine', freq: 80 * pitch, freqEnd: 50 * pitch, gainDb: db + FOOTSTEPS.landing.thumpDb, decayMs: 90, when })
}

/** Bước chân của mình. Xen kẽ trái/phải. */
export function playFootstep(crouching: boolean): void {
  const g = getGraph()
  if (!g) return
  const o = FOOTSTEPS.own
  const b = ensureBus(g)
  const db = o.gainDb + (crouching ? o.crouchDb : 0) + randSpread(o.gainRandDb)
  emitStep(g, nextRight ? b.right : b.left, g.ctx.currentTime, 1 + randSpread(o.pitchRand), db, false)
  nextRight = !nextRight
}

/** Tiếp đất của mình (một tiếng, giữa hai tai). */
export function playLanding(): void {
  const g = getGraph()
  if (!g) return
  const o = FOOTSTEPS.own
  const b = ensureBus(g)
  const db = FOOTSTEPS.landing.gainDb + randSpread(o.gainRandDb)
  const mid = g.ctx.createStereoPanner()   // pan 0, vào cùng chuỗi lọc
  mid.connect(b.hp)
  emitStep(g, mid, g.ctx.currentTime, 1 + randSpread(o.pitchRand), db, true)
  setTimeout(() => mid.disconnect(), 1000)
}

/** Bước chân người khác: chỉ trong maxDistM, panner + lowpass theo khoảng cách như tiếng súng. */
export function playFootstepOther(origin: [number, number, number]): void {
  const g = getGraph()
  if (!g) return
  const f = FOOTSTEPS.other
  const d = Math.hypot(origin[0] - listenerPos[0], origin[1] - listenerPos[1], origin[2] - listenerPos[2])
  if (d > f.maxDistM) return
  const c = g.ctx
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'
  lp.frequency.value = distanceCutoff(d)
  const pn = c.createPanner()
  pn.panningModel = 'equalpower'
  pn.distanceModel = 'inverse'
  pn.refDistance = f.refDistance
  pn.rolloffFactor = f.rolloff
  pn.positionX.value = origin[0]; pn.positionY.value = origin[1]; pn.positionZ.value = origin[2]
  lp.connect(pn).connect(g.master)
  emitStep(g, lp, c.currentTime, 1 + randSpread(FOOTSTEPS.own.pitchRand), f.gainDb + randSpread(FOOTSTEPS.own.gainRandDb), false)
  setTimeout(() => { lp.disconnect(); pn.disconnect() }, 1000)
}
