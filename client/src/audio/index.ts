// Mặt tiền của hệ thống âm thanh: main.ts chỉ import từ đây.
import { initAudioContext, onAudioReady } from './context'
import { preload, gunKey, commonKey } from './loader'
import { allGunSoundKeys } from './gunProfiles'
import { HIT_FILE_NAMES } from './hitAudio'
import { tone, noise } from './synth'
import { getGraph } from './context'

export { updateListener, settings, saveSettings } from './context'
export { playShot, playShotOther, playDry, playDraw, startReload, cancelReload } from './gunAudio'
export { playHit, playHurt, setHealthForAudio } from './hitAudio'
export type { HitKind } from './hitAudio'

/** Gọi một lần lúc khởi động: tạo context ở user gesture đầu tiên, rồi nạp file (thiếu thì bỏ qua). */
export function initAudio(): void {
  initAudioContext()
  onAudioReady((g) => {
    const keys = [...allGunSoundKeys(gunKey, commonKey), ...HIT_FILE_NAMES.map(commonKey)]
    void preload(g.ctx, keys)
  })
}

/** Bước chân (tổng hợp, chưa có file): `volume` 0..1. */
export function playStep(volume: number): void {
  const g = getGraph()
  if (!g) return
  const t = g.ctx.currentTime
  const db = 20 * Math.log10(Math.max(0.01, volume))
  noise(g.ctx, g.master, { filter: 'lowpass', freq: 700 + Math.random() * 300, q: 0.7, gainDb: db - 6, attackMs: 3, decayMs: 70, when: t })
  tone(g.ctx, g.master, { type: 'sine', freq: 90, freqEnd: 60, gainDb: db - 10, decayMs: 60, when: t })
}
