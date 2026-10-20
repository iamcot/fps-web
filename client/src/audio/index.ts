// Mặt tiền của hệ thống âm thanh: main.ts chỉ import từ đây.
import { initAudioContext, onAudioReady } from './context'
import { preload, gunKey, commonKey } from './loader'
import { allGunSoundKeys } from './gunProfiles'
import { HIT_FILE_NAMES } from './hitAudio'
import { FOOTSTEP_FILES } from './footsteps'
import { GRENADE_SOUND_FILES } from './grenadeAudio'
import { ZOMBIE_SOUND_FILES } from './zombieAudio'

export { updateListener, settings, saveSettings } from './context'
export { playBuyOk, playBuyFail, playRoundStart, playRoundWin, playRoundLose, playTick } from './uiAudio'
export { playShot, playShotOther, playSwing, playDry, playDraw, startReload, cancelReload } from './gunAudio'
export { playFootstep, playLanding, playFootstepOther, FOOTSTEPS } from './footsteps'
export { StepTracker } from './audioMath'
export { playHit, playHurt, setHealthForAudio } from './hitAudio'
export { playPin, playSpoon, playThrowSwish, playBounce, playExplode, tinnitus } from './grenadeAudio'
export { playGrowl, playScream, playClawHit, playZombieStep, playZombieHurt, playZombieDeath, playInfectSting, startNightAmbient, stopNightAmbient, setNearbyZombieHeartbeat, updateZombieAudio } from './zombieAudio'
export type { HitKind } from './hitAudio'

/** Gọi một lần lúc khởi động: tạo context ở user gesture đầu tiên, rồi nạp file (thiếu thì bỏ qua); nạp xong gọi onLoaded. */
export function initAudio(onLoaded?: () => void): void {
  initAudioContext()
  onAudioReady((g) => {
    const keys = [...allGunSoundKeys(gunKey, commonKey), ...HIT_FILE_NAMES.map(commonKey), ...FOOTSTEP_FILES, ...GRENADE_SOUND_FILES, ...ZOMBIE_SOUND_FILES]
    void preload(g.ctx, keys).then(() => onLoaded?.())
  })
}
