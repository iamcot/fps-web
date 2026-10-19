// Âm thanh súng (A.4, A.6, A.7): nhiều lớp phát cùng lúc qua bus EQ riêng từng súng,
// vào gunGroup → master (compressor). Mọi lớp lên lịch bằng ctx.currentTime (không setTimeout)
// trừ các bước reload (cần huỷ được).
import { WEAPONS } from '@fps/shared'
import {
  dbToGain, pickNoRepeat, randSpread, lowAmmoActive, lowAmmoPitchFactor,
  reloadInsertTimes, distanceCutoff,
} from './audioMath'
import { getGraph, listenerPos, settings, type AudioGraph } from './context'
import { tone, noise } from './synth'
import { gunKey, commonKey, getBuffer } from './loader'
import { GUN_SOUNDS, SHELL_SYNTH, type GunSoundProfile, type LayerDef, type ReloadStep, type ReloadSynth } from './gunProfiles'

type Vec3 = [number, number, number]

// ── Bus EQ của mình (tạo một lần mỗi súng) ────────────────────────────────────
interface GunBus { low: BiquadFilterNode; high: BiquadFilterNode }
const buses = new Map<number, GunBus>()

function applyEq(bus: GunBus, p: GunSoundProfile): void {
  bus.low.frequency.value = p.eq.lowShelfHz
  bus.low.gain.value = p.eq.lowShelfDb
  bus.high.frequency.value = p.eq.highShelfHz
  bus.high.gain.value = p.eq.highShelfDb
}

function ensureBus(g: AudioGraph, id: number): GunBus | null {
  const p = GUN_SOUNDS[id]
  if (!p) return null
  let bus = buses.get(id)
  if (!bus) {
    const low = g.ctx.createBiquadFilter(); low.type = 'lowshelf'
    const high = g.ctx.createBiquadFilter(); high.type = 'highshelf'
    low.connect(high).connect(g.gunGroup)
    bus = { low, high }
    applyEq(bus, p)
    buses.set(id, bus)
  }
  return bus
}

/** Cập nhật EQ khi chỉnh profile (bảng F8). */
export function refreshBus(id: number): void {
  const bus = buses.get(id)
  const p = GUN_SOUNDS[id]
  if (bus && p) applyEq(bus, p)
}

// ── Giới hạn số tiếng mỗi súng ───────────────────────────────────────────────
interface Voice { gain: GainNode; endAt: number }
const voices = new Map<number, Voice[]>()
const VOICE_LIFETIME = 1.5   // s: thời gian một phát được coi là còn "sống"

function registerVoice(g: AudioGraph, id: number, gain: GainNode, maxVoices: number): void {
  const now = g.ctx.currentTime
  let list = voices.get(id)
  if (!list) { list = []; voices.set(id, list) }
  while (list.length > 0 && list[0]!.endAt < now) list.shift()
  list.push({ gain, endAt: now + VOICE_LIFETIME })
  while (list.length > maxVoices) {
    const old = list.shift()!
    old.gain.gain.cancelScheduledValues(now)
    old.gain.gain.setValueAtTime(old.gain.gain.value, now)
    old.gain.gain.linearRampToValueAtTime(0, now + 0.01)   // fade 10ms, không cắt cụt
  }
}

// ── Lớp âm ────────────────────────────────────────────────────────────────────
const lastPicked = new Map<string, string>()

function playBuffer(g: AudioGraph, buf: AudioBuffer, dest: AudioNode, rate: number, db: number, when: number): void {
  const src = g.ctx.createBufferSource()
  const gn = g.ctx.createGain()
  src.buffer = buf
  src.playbackRate.value = rate
  gn.gain.value = dbToGain(db)
  src.connect(gn).connect(dest)
  src.start(when)
  src.onended = () => { src.disconnect(); gn.disconnect() }
}

function synthLayer(g: AudioGraph, kind: 'body' | 'mech' | 'tail', def: LayerDef, rate: number, dest: AudioNode, t: number): void {
  const c = g.ctx
  if (kind === 'body') {
    noise(c, dest, { filter: 'highpass', freq: 900 * rate, q: 0.7, gainDb: -2, decayMs: 60, when: t })
    noise(c, dest, { filter: 'lowpass', freq: 700 * rate, q: 0.7, gainDb: -3, decayMs: 130, when: t })
  } else if (kind === 'mech') {
    noise(c, dest, { filter: 'bandpass', freq: 2200 * rate, q: 3, gainDb: -6, decayMs: 25, when: t })
    tone(c, dest, { type: 'square', freq: 900 * rate, gainDb: -18, decayMs: 15, when: t })
  } else {
    // mặc định lowpass (rền, nhiều bass); synthTailHz → bandpass rộng quanh tần số đó, bớt bass (rulô)
    const band = def.synthTailHz !== undefined
    noise(c, dest, {
      filter: band ? 'bandpass' : 'lowpass', freq: (def.synthTailHz ?? 1800) * rate, q: 0.5,
      gainDb: band ? -11 : -8,   // bandpass nghe to hơn lowpass ~3dB → bù để cùng độ lớn
      attackMs: 5, decayMs: def.synthDecayMs ?? 350, when: t,
    })
  }
}

function playLayer(
  g: AudioGraph, kind: 'body' | 'mech' | 'tail', def: LayerDef, p: GunSoundProfile,
  dest: AudioNode, when: number, extraDb: number,
): void {
  const keys = def.files.map(f => gunKey(p.folder, f)).filter(k => getBuffer(k))
  const rate = def.pitch + randSpread(def.pitchRand)
  const db = def.gainDb + extraDb + randSpread(def.gainRandDb)
  const t = when + def.delayMs / 1000
  const id = `${p.folder}/${kind}`
  const key = pickNoRepeat(keys, lastPicked.get(id), Math.random)
  if (key) {
    lastPicked.set(id, key)
    playBuffer(g, getBuffer(key)!, dest, rate, db, t)
  } else {
    // không có file: âm tổng hợp qua gain lớp
    const lg = g.ctx.createGain()
    lg.gain.value = dbToGain(db)
    lg.connect(dest)
    synthLayer(g, kind, def, rate, lg, t)
  }
}

function playShell(g: AudioGraph, kind: 'rifle' | 'pistol', dest: AudioNode, when: number, extraDb = 0): void {
  const keys = [1, 2, 3].map(i => commonKey(`shell_${kind}_0${i}`)).filter(k => getBuffer(k))
  const key = pickNoRepeat(keys, lastPicked.get(`shell_${kind}`), Math.random)
  if (key) {
    lastPicked.set(`shell_${kind}`, key)
    playBuffer(g, getBuffer(key)!, dest, 1 + randSpread(0.05), -14 + extraDb, when)
    return
  }
  synthShell(g, kind, dest, when, extraDb)
}

function synthShell(g: AudioGraph, kind: 'rifle' | 'pistol', dest: AudioNode, when: number, extraDb: number): void {
  const c = SHELL_SYNTH[kind]
  noise(g.ctx, dest, { filter: 'highpass', freq: 4000, gainDb: c.clickDb + extraDb, decayMs: 8, when })   // va đập đầu tiên
  let t = when
  for (let i = 0; i < c.gainsDb.length; i++) {
    const freq = c.freqMin + Math.random() * (c.freqMax - c.freqMin)
    const decay = c.decayMs * Math.pow(c.decayMul, i)
    const db = c.gainsDb[i]! + extraDb
    tone(g.ctx, dest, { type: 'sine', freq, gainDb: db, decayMs: decay, when: t })
    tone(g.ctx, dest, { type: 'sine', freq: freq * c.partialRatio, gainDb: db + c.partialDb, decayMs: decay, when: t })
    t += (c.firstGapMs / 1000) * Math.pow(c.gapMul, i)   // khoảng nảy ngắn dần
  }
}

function playThump(g: AudioGraph, dest: AudioNode, p: GunSoundProfile, when: number): void {
  const t = p.thump
  tone(g.ctx, dest, { type: 'sine', freq: t.startHz, freqEnd: t.endHz, gainDb: t.gainDb, attackMs: 4, decayMs: t.durationMs, when })
}

/** Phát các lớp của một phát bắn vào `dest`. */
function playShotLayers(g: AudioGraph, p: GunSoundProfile, dest: AudioNode, when: number, own: boolean): void {
  playLayer(g, 'body', p.layers.body, p, dest, when, 0)
  if (own && p.layers.mech) playLayer(g, 'mech', p.layers.mech, p, dest, when, 0)   // cơ khí chỉ nghe ở gần tay
  if (p.layers.tail) playLayer(g, 'tail', p.layers.tail, p, dest, when, own ? 0 : 3)  // người khác: vang to hơn 3dB
  playThump(g, dest, p, when)
}

// ── Bắn của mình ──────────────────────────────────────────────────────────────
/** `ammoLeft` = số đạn còn lại SAU phát vừa bắn. */
export function playShot(id: number, ammoLeft: number): void {
  const g = getGraph()
  const p = GUN_SOUNDS[id]
  const def = WEAPONS[id]
  if (!g || !p || !def) return
  const bus = ensureBus(g, id)
  if (!bus) return
  const now = g.ctx.currentTime

  const shot = g.ctx.createGain()
  shot.connect(bus.low)
  registerVoice(g, id, shot, p.maxVoices)
  playShotLayers(g, p, shot, now, true)

  // if (p.shell) playShell(g, p.shell, g.gunGroup, now + p.shellDelayMs / 1000)
  if (p.cockFile) playCock(g, p, bus.low, now + 0.6 * def.fireIntervalMs / 1000)
  if (settings.lowAmmoWarning && p.lowAmmoWarning !== false && lowAmmoActive(ammoLeft, def.magSize)) playLowAmmo(g, ammoLeft, def.magSize, now)
}

// ── Bắn của người khác (từ ShotFx, phase 4) ───────────────────────────────────
function makePanner(g: AudioGraph, origin: Vec3): PannerNode {
  const pn = g.ctx.createPanner()
  pn.panningModel = 'equalpower'
  pn.distanceModel = 'inverse'
  pn.refDistance = 4
  pn.rolloffFactor = 1.2
  pn.positionX.value = origin[0]; pn.positionY.value = origin[1]; pn.positionZ.value = origin[2]
  return pn
}

const distTo = (o: Vec3): number => Math.hypot(o[0] - listenerPos[0], o[1] - listenerPos[1], o[2] - listenerPos[2])

export function playShotOther(id: number, origin: Vec3): void {
  const g = getGraph()
  const p = GUN_SOUNDS[id]
  if (!g || !p) return
  const c = g.ctx
  const d = distTo(origin)
  const now = c.currentTime

  // Mỗi phát có vị trí riêng → chuỗi filter riêng (khác súng của mình dùng bus chung)
  const shot = c.createGain()
  const low = c.createBiquadFilter(); low.type = 'lowshelf'
  low.frequency.value = p.eq.lowShelfHz; low.gain.value = p.eq.lowShelfDb
  const high = c.createBiquadFilter(); high.type = 'highshelf'
  high.frequency.value = p.eq.highShelfHz; high.gain.value = p.eq.highShelfDb
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'
  lp.frequency.value = distanceCutoff(d)
  shot.connect(low).connect(high).connect(lp).connect(makePanner(g, origin)).connect(g.master)
  registerVoice(g, 1000 + id, shot, p.maxVoices)
  playShotLayers(g, p, shot, now, false)
  if (p.shell && d < 15) playShell(g, p.shell, shot, now + p.shellDelayMs / 1000)
}

// ── Lên cò (rulô) ─────────────────────────────────────────────────────────────
function playCock(g: AudioGraph, p: GunSoundProfile, dest: AudioNode, when: number): void {
  const key = p.cockFile ? gunKey(p.folder, p.cockFile) : ''
  const buf = key ? getBuffer(key) : undefined
  if (buf) playBuffer(g, buf, dest, 1 + randSpread(0.03), -6, when)
  else synthReload(g, 'magin', dest, when)
}

// ── Hết đạn / sắp hết (A.7) ───────────────────────────────────────────────────
const DRY_GAP = 0.09   // s giữa hai tiếng "cạch cạch"

/** Hết đạn: phát nhanh file dryfire hai lần (lần hai nhỏ hơn 3dB, cao hơn chút); thiếu file → âm tổng hợp hai lần. */
export function playDry(id: number): void {
  const g = getGraph()
  const p = GUN_SOUNDS[id]
  if (!g || !p) return
  const now = g.ctx.currentTime
  const click =
    (p.dryfire.file ? getBuffer(gunKey(p.folder, p.dryfire.file)) : undefined) ??
    getBuffer(commonKey(`dryfire_${p.dryfire.kind}`))
  for (let i = 0; i < 2; i++) {
    const t = now + i * DRY_GAP
    if (click) playBuffer(g, click, g.master, 1 + i * 0.04, i * -3, t)
    else synthDry(g, p.dryfire.kind, g.master, t, i)
  }
}

/** Búa đập vào buồng đạn rỗng: "tách" gắt + chuông kim loại ngắn (cho tiếng trong). `n` = lần thứ mấy (lần 2 nhỏ và cao hơn chút). */
export function synthDry(g: AudioGraph, kind: 'rifle' | 'pistol', dest: AudioNode, when: number, n = 0): void {
  const c = g.ctx
  const up = n === 0 ? 1 : 1.06
  const db = n === 0 ? 0 : -3
  if (kind === 'rifle') {
    noise(c, dest, { filter: 'bandpass', freq: 4200 * up, q: 3, gainDb: -10 + db, decayMs: 55, when })
    tone(c, dest, { type: 'sine', freq: 2600 * up, gainDb: -15 + db, decayMs: 90, when })
    tone(c, dest, { type: 'sine', freq: 6200 * up, gainDb: -21 + db, decayMs: 55, when })
    tone(c, dest, { type: 'sine', freq: 220, freqEnd: 140, gainDb: -18 + db, decayMs: 50, when })
  } else {
    noise(c, dest, { filter: 'bandpass', freq: 5600 * up, q: 3, gainDb: -10 + db, decayMs: 45, when })
    tone(c, dest, { type: 'sine', freq: 3400 * up, gainDb: -15 + db, decayMs: 75, when })
    tone(c, dest, { type: 'sine', freq: 7800 * up, gainDb: -21 + db, decayMs: 45, when })
    tone(c, dest, { type: 'sine', freq: 300, freqEnd: 200, gainDb: -20 + db, decayMs: 45, when })
  }
}

function playLowAmmo(g: AudioGraph, ammoLeft: number, magSize: number, when: number): void {
  const pf = lowAmmoPitchFactor(ammoLeft, magSize)
  const boost = ammoLeft <= 0 ? 4 : 0   // viên cuối to hơn 4dB
  const buf = getBuffer(commonKey('lowammo'))
  if (buf) playBuffer(g, buf, g.gunGroup, pf, -16 + boost, when)
  else tone(g.ctx, g.gunGroup, { type: 'sine', freq: 2600 * pf, gainDb: -20 + boost, decayMs: 60, when })
}

export function playDraw(id: number): void {
  const g = getGraph()
  const p = GUN_SOUNDS[id]
  if (!g || !p) return
  const now = g.ctx.currentTime
  const buf = getBuffer(gunKey(p.folder, p.draw))
  if (buf) { playBuffer(g, buf, g.master, 1 + randSpread(0.03), -6, now); return }
  noise(g.ctx, g.master, { filter: 'bandpass', freq: 1500, q: 2, gainDb: -14, decayMs: 50, when: now })
  tone(g.ctx, g.master, { type: 'sine', freq: 260, freqEnd: 180, gainDb: -20, decayMs: 60, when: now })
}

// ── Reload (A.6) ──────────────────────────────────────────────────────────────
function synthReload(g: AudioGraph, kind: ReloadSynth, dest: AudioNode, t: number): void {
  const c = g.ctx
  switch (kind) {
    case 'magout':
      noise(c, dest, { filter: 'bandpass', freq: 1800, q: 3, gainDb: -10, decayMs: 40, when: t })
      tone(c, dest, { type: 'sine', freq: 320, freqEnd: 220, gainDb: -14, decayMs: 60, when: t })
      break
    case 'magin':
      noise(c, dest, { filter: 'bandpass', freq: 2500, q: 4, gainDb: -8, decayMs: 25, when: t })
      noise(c, dest, { filter: 'bandpass', freq: 2500, q: 4, gainDb: -8, decayMs: 25, when: t + 0.045 })
      tone(c, dest, { type: 'sine', freq: 180, gainDb: -12, decayMs: 70, when: t + 0.045 })
      break
    case 'bolt':
      noise(c, dest, { filter: 'bandpass', freq: 1200, freqEnd: 3500, q: 2, gainDb: -12, decayMs: 90, when: t })
      noise(c, dest, { filter: 'bandpass', freq: 3000, q: 5, gainDb: -6, decayMs: 30, when: t + 0.12 })
      break
    case 'shells':
      for (let i = 0; i < 6; i++) {
        tone(c, dest, { type: 'sine', freq: 3500 + Math.random() * 1700, gainDb: -18, decayMs: 80, when: t + Math.random() * 0.25 })
      }
      break
    case 'insert':
      noise(c, dest, { filter: 'bandpass', freq: 2800, q: 6, gainDb: -10, decayMs: 20, when: t })
      tone(c, dest, { type: 'sine', freq: 1400, gainDb: -16, decayMs: 35, when: t })
      break
  }
}

function playReloadStep(g: AudioGraph, p: GunSoundProfile, file: string, synth: ReloadSynth, dest: AudioNode, rate = 1): void {
  const now = g.ctx.currentTime
  const buf = getBuffer(gunKey(p.folder, file))
  if (buf) playBuffer(g, buf, dest, rate, 0, now)
  else synthReload(g, synth, dest, now)
}

interface TimedStep { atFrac: number; file: string; synth: ReloadSynth; rate: number }

/** Danh sách bước reload theo tỉ lệ thời gian nạp thực tế. */
export function reloadSchedule(p: GunSoundProfile, magSize: number, ammoAtStart: number): TimedStep[] {
  const empty = ammoAtStart <= 0
  const out: TimedStep[] = []
  const r = p.reload
  if (r.kind === 'mag') {
    for (const s of r.steps) {
      if (s.emptyOnly && !empty) continue
      out.push({ atFrac: s.at, file: s.file, synth: s.synth, rate: 1 })
    }
  } else {
    const step = (s: ReloadStep) => out.push({ atFrac: s.at, file: s.file, synth: s.synth, rate: 1 })
    step(r.open)
    step(r.eject)
    // nhét đúng số viên đã bắn, mỗi lần lệch cao độ ±4%
    for (const at of reloadInsertTimes(magSize - ammoAtStart, r.insert.from, r.insert.to)) {
      out.push({ atFrac: at, file: r.insert.file, synth: r.insert.synth, rate: 1 + randSpread(0.04) })
    }
    step(r.close)
  }
  return out
}

const BOLT_GAP_MS = 200   // khoảng nghỉ giữa tiếng thay băng và tiếng kéo khoá nòng

let activeReload: (() => void) | null = null

/** Huỷ reload của mình (đổi súng, chết): dừng mọi tiếng reload ngay. */
export function cancelReload(): void {
  activeReload?.()
  activeReload = null
}

/**
 * Lên lịch tiếng reload. `origin` có mặt → súng người khác (chỉ phát nếu trong 12m, qua panner, -10dB).
 * Trả hàm huỷ.
 */
export function startReload(id: number, ammoAtStart: number, durationMs: number, origin?: Vec3): () => void {
  const noop = () => {}
  const g = getGraph()
  const p = GUN_SOUNDS[id]
  const def = WEAPONS[id]
  if (!g || !p || !def) return noop
  if (!origin) cancelReload()

  const bus = g.ctx.createGain()   // gom mọi tiếng của lần nạp này để huỷ một phát
  if (origin) {
    if (distTo(origin) > 12) return noop
    bus.gain.value = dbToGain(-10)
    bus.connect(makePanner(g, origin)).connect(g.master)
  } else {
    bus.gain.value = dbToGain(-4)
    bus.connect(g.master)   // không qua EQ của súng
  }

  const timers: number[] = []
  const whole = p.reload.kind === 'mag' ? p.reload.whole : undefined
  const wholeBuf = whole ? getBuffer(commonKey(whole.file)) : undefined
  if (whole && wholeBuf) {
    // Phát sau startFrac (chờ animation hạ súng); file dài hơn phần thời gian còn lại thì tăng tốc (tối đa ×1.3)
    const rate = Math.min(1.3, Math.max(1, wholeBuf.duration / ((durationMs * (1 - whole.startFrac)) / 1000)))
    timers.push(window.setTimeout(() => playBuffer(g, wholeBuf, bus, rate, whole.gainDb, g.ctx.currentTime), whole.startFrac * durationMs))
    // Kéo khoá nòng: lúc animation đưa súng lên, nhưng sau tiếng thay băng một khoảng nghỉ để nghe tách bạch
    const boltBuf = whole.boltFile ? getBuffer(commonKey(whole.boltFile)) : undefined
    if (boltBuf) {
      const wholeEndMs = whole.startFrac * durationMs + (wholeBuf.duration / rate) * 1000
      const boltAt = Math.max((whole.boltAtFrac ?? 0.8) * durationMs, wholeEndMs + BOLT_GAP_MS)
      timers.push(window.setTimeout(() => playBuffer(g, boltBuf, bus, 1 + randSpread(0.02), 0, g.ctx.currentTime), boltAt))
    }
  } else for (const s of reloadSchedule(p, def.magSize, ammoAtStart)) {
    timers.push(window.setTimeout(() => playReloadStep(g, p, s.file, s.synth, bus, s.rate), s.atFrac * durationMs))
  }

  const cancel = () => {
    for (const t of timers) clearTimeout(t)
    const now = g.ctx.currentTime
    bus.gain.cancelScheduledValues(now)
    bus.gain.setValueAtTime(bus.gain.value, now)
    bus.gain.linearRampToValueAtTime(0, now + 0.02)   // fade 20ms
    window.setTimeout(() => bus.disconnect(), 60)
  }
  if (!origin) activeReload = cancel
  return cancel
}
