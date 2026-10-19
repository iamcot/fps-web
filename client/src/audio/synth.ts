// Bộ âm tổng hợp (A.4 mục 10): tone + noise burst, envelope exponential từ/đến 0.0001.
import { dbToGain } from './audioMath'

const FLOOR = 0.0001   // exponentialRamp không nhận 0

export interface ToneOpts {
  type: OscillatorType
  freq: number
  freqEnd?: number
  gainDb: number
  attackMs?: number
  decayMs: number
  when: number
}

export interface NoiseOpts {
  filter: BiquadFilterType
  freq: number
  freqEnd?: number
  q?: number
  gainDb: number
  attackMs?: number
  decayMs: number
  when: number
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

/** Một buffer tiếng ồn trắng 1 giây, dùng lại cho mọi noise burst. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx)
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseBuffers.set(ctx, b)
  }
  return b
}

function envelope(g: GainNode, peakDb: number, attackMs: number, decayMs: number, when: number): number {
  const a = attackMs / 1000, d = decayMs / 1000
  g.gain.setValueAtTime(FLOOR, when)
  g.gain.exponentialRampToValueAtTime(Math.max(FLOOR, dbToGain(peakDb)), when + a)
  g.gain.exponentialRampToValueAtTime(FLOOR, when + a + d)
  return when + a + d
}

export function tone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOpts): void {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = o.type
  osc.frequency.setValueAtTime(o.freq, o.when)
  const end = envelope(g, o.gainDb, o.attackMs ?? 1, o.decayMs, o.when)
  if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, end)
  osc.connect(g).connect(dest)
  osc.start(o.when)
  osc.stop(end + 0.02)
  osc.onended = () => { osc.disconnect(); g.disconnect() }
}

export function noise(ctx: BaseAudioContext, dest: AudioNode, o: NoiseOpts): void {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const f = ctx.createBiquadFilter()
  const g = ctx.createGain()
  f.type = o.filter
  f.Q.value = o.q ?? 1
  f.frequency.setValueAtTime(o.freq, o.when)
  const end = envelope(g, o.gainDb, o.attackMs ?? 1, o.decayMs, o.when)
  if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(o.freqEnd, end)
  src.connect(f).connect(g).connect(dest)
  src.start(o.when, Math.random() * 0.9)   // offset ngẫu nhiên: mỗi cú nghe hơi khác
  src.stop(end + 0.02)
  src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect() }
}
