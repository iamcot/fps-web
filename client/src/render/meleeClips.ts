import * as THREE from 'three'

// Clip Mixamo cận chiến (đổi từ assets/source/combat_anims bằng tools/melee/convert-clips.mjs) phát lên thân trên ở góc nhìn thứ ba.
// Co giãn thời gian theo từng chiêu: đoạn [win0 → hit] trải trong windupMs, [hit → win1] trải trong phần còn lại của chiêu.
export interface ClipData { dur: number; win: [number, number]; hit: number; tracks: Record<string, { t: number[]; q: number[] }> }
export interface MeleeClip { name: string; clip: THREE.AnimationClip; win0: number; hit: number; win1: number }

const clips = new Map<string, MeleeClip>()
let requested = false

export function requestMeleeClips(url = `${import.meta.env?.BASE_URL ?? '/'}anims/combat.json`): void {
  if (requested) return
  requested = true
  fetch(url).then(r => r.json() as Promise<Record<string, ClipData>>).then(all => {
    for (const [name, d] of Object.entries(all)) {
      const tracks = Object.entries(d.tracks).map(([bone, k]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, k.t, k.q))
      clips.set(name, { name, clip: new THREE.AnimationClip(name, d.dur, tracks), win0: d.win[0], hit: d.hit, win1: d.win[1] })
    }
  }).catch(err => console.warn('meleeClips: không tải được clip cận chiến, dùng động tác IK', err))
}
export function getMeleeClip(name: string): MeleeClip | undefined { return clips.get(name) }

/**
 * Chiêu (key trong meleeConfig) → clip. Quy tắc dự phòng của plan: hai tay m2 → m1, thương sp → m2 → m1.
 * Hiện m2 chỉ có chop, sp chỉ có stab, nên chém ngang của búa / gậy / thương dùng m1_slash (cầm một tay, tay trái vẫn IK vào cán).
 */
export const MOVE_CLIP: Record<string, string> = {
  knife_l1: 'm1_slash_r', knife_l2: 'm1_slash_l', knife_l3: 'm1_stab', knife_llr: 'm1_stab', knife_spin: 'm1_spin',
  knife_lr: 'm1_chop', knife_rise: 'm1_upper', knife_r1: 'm1_stab', knife_rr: 'm1_stab', knife_flip: 'm1_slash_l',
  machete_l1: 'm1_slash_r', machete_ll: 'm1_slash_l', machete_lr: 'm1_slash_l', machete_llr: 'm1_slash_r', machete_lrl: 'm1_slash_r', machete_lrlr: 'm1_stab', machete_r1: 'm1_stab',
  hammer_l1: 'm2_chop', hammer_ll: 'm2_chop', hammer_r1: 'm1_slash_r', hammer_rr: 'm1_slash_l', hammer_rl: 'm2_chop', hammer_rrr: 'm1_spin',
  spear_l1: 'sp_stab', spear_ll: 'sp_stab', spear_lll: 'sp_stab', spear_lr: 'm1_slash_r', spear_r1: 'm1_slash_l', spear_rl: 'sp_stab',
  staff_l1: 'm1_slash_r', staff_ll: 'm1_slash_l', staff_lll: 'm1_slash_r', staff_llll: 'm2_chop', staff_r1: 'm1_stab', staff_lr: 'm1_slash_l', staff_rl: 'm2_chop', staff_lrl: 'm1_slash_r',
}
/** Thế đỡ một tay (clip `block`, giữ nguyên một khung) */
export const GUARD_CLIP = 'block'
export const GUARD_CLIP_T = 0.5

/** Thời gian trong clip ứng với `tMs` kể từ lúc bắt đầu chiêu (tổng `totalMs`, nhát đánh đầu ở `hitMs`). */
export function clipTimeAt(c: MeleeClip, tMs: number, hitMs: number, totalMs: number): number {
  if (tMs <= hitMs) return c.win0 + (c.hit - c.win0) * (hitMs > 0 ? tMs / hitMs : 1)
  const span = totalMs - hitMs
  return c.hit + (c.win1 - c.hit) * (span > 0 ? Math.min(1, (tMs - hitMs) / span) : 1)
}
