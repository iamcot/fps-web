// Mặt tiền của hệ thống âm thanh: main.ts chỉ import từ đây.
import { initAudioContext, onAudioReady } from './context'
import { preload, gunKey, commonKey } from './loader'
import { allGunSoundKeys } from './gunProfiles'
import { HIT_FILE_NAMES } from './hitAudio'
import { FOOTSTEP_FILES } from './footsteps'

export { updateListener, settings, saveSettings } from './context'
export { playShot, playShotOther, playDry, playDraw, startReload, cancelReload } from './gunAudio'
export { playFootstep, playLanding, playFootstepOther, FOOTSTEPS } from './footsteps'
export { StepTracker } from './audioMath'
export { playHit, playHurt, setHealthForAudio } from './hitAudio'
export type { HitKind } from './hitAudio'

/** Gọi một lần lúc khởi động: tạo context ở user gesture đầu tiên, rồi nạp file (thiếu thì bỏ qua); nạp xong gọi onLoaded. */
export function initAudio(onLoaded?: () => void): void {
  initAudioContext()
  onAudioReady((g) => {
    const keys = [...allGunSoundKeys(gunKey, commonKey), ...HIT_FILE_NAMES.map(commonKey), ...FOOTSTEP_FILES]
    void preload(g.ctx, keys).then(() => onLoaded?.())
  })
}
