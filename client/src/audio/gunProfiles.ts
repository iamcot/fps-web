// Profile âm thanh từng súng (chỉ client). Giá trị khởi điểm theo plan/08-task-gun-audio.md,
// chỉnh tai bằng bảng F8 rồi dán JSON vào đây.

export interface LayerDef {
  files: string[]         // chọn ngẫu nhiên, không lặp file vừa phát nếu có ≥ 2
  gainDb: number
  pitch: number           // playbackRate gốc
  pitchRand: number       // ± ngẫu nhiên
  gainRandDb: number      // ± ngẫu nhiên
  delayMs: number
  synthDecayMs?: number   // độ dài âm tổng hợp dự phòng (chỉ dùng cho tail)
}

export interface ThumpDef {   // lớp bass tổng hợp
  gainDb: number
  startHz: number
  endHz: number
  durationMs: number
}

export type ReloadSynth = 'magout' | 'magin' | 'bolt' | 'shells' | 'insert'
export interface ReloadStep { file: string; at: number; synth: ReloadSynth; emptyOnly?: boolean }
export type ReloadSoundDef =
  | { kind: 'mag'; steps: ReloadStep[] }
  | {
      kind: 'perRound'
      open: ReloadStep; eject: ReloadStep; close: ReloadStep
      insert: { file: string; from: number; to: number; synth: ReloadSynth }
    }

export interface GunSoundProfile {
  folder: string
  layers: { body: LayerDef; mech?: LayerDef; tail?: LayerDef }
  thump: ThumpDef
  eq: { lowShelfHz: number; lowShelfDb: number; highShelfHz: number; highShelfDb: number }
  shell: 'rifle' | 'pistol' | null     // rulô không văng vỏ khi bắn
  shellDelayMs: number
  cockFile?: string                    // lên cò giữa hai phát (~60% fireIntervalMs)
  reload: ReloadSoundDef
  dryfire: { file?: string; kind: 'rifle' | 'pistol' }
  draw: string
  maxVoices: number
}

const rifleReload = (boltFile: string): ReloadSoundDef => ({
  kind: 'mag',
  steps: [
    { file: 'reload_magout', at: 0.15, synth: 'magout' },
    { file: 'reload_magin',  at: 0.55, synth: 'magin' },
    { file: boltFile,       at: 0.85, synth: 'bolt', emptyOnly: true },
  ],
})

export const GUN_SOUNDS: Record<number, GunSoundProfile> = {
  0: { // AK47: nặng, đục, rền
    folder: 'ak47',
    layers: {
      body: { files: ['shot_01', 'shot_02', 'shot_03', 'shot_04'], gainDb: 0,  pitch: 0.96, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                                  gainDb: -8, pitch: 1.0,  pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                                  gainDb: -6, pitch: 0.97, pitchRand: 0.03, gainRandDb: 1,   delayMs: 20, synthDecayMs: 350 },
    },
    thump: { gainDb: -3, startHz: 110, endHz: 45, durationMs: 140 },
    eq: { lowShelfHz: 150, lowShelfDb: 4, highShelfHz: 5000, highShelfDb: -2 },
    shell: 'rifle', shellDelayMs: 320,
    reload: rifleReload('reload_bolt'),
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 8,
  },
  1: { // M16: gọn, sắc, chát
    folder: 'm16',
    layers: {
      body: { files: ['shot_01', 'shot_02', 'shot_03', 'shot_04'], gainDb: 0,  pitch: 1.05, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                                  gainDb: -6, pitch: 1.1,  pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                                  gainDb: -9, pitch: 1.0,  pitchRand: 0.03, gainRandDb: 1,   delayMs: 15, synthDecayMs: 220 },
    },
    thump: { gainDb: -8, startHz: 130, endHz: 60, durationMs: 90 },
    eq: { lowShelfHz: 150, lowShelfDb: 0, highShelfHz: 4000, highShelfDb: 3 },
    shell: 'rifle', shellDelayMs: 300,
    reload: rifleReload('reload_bolt'),
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 8,
  },
  2: { // Colt: chắc, bốp
    folder: 'colt',
    layers: {
      body: { files: ['shot_01', 'shot_02', 'shot_03'], gainDb: -1, pitch: 1.0, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                       gainDb: -7, pitch: 1.0, pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                       gainDb: -7, pitch: 1.0, pitchRand: 0.03, gainRandDb: 1,   delayMs: 20, synthDecayMs: 300 },
    },
    thump: { gainDb: -5, startHz: 120, endHz: 55, durationMs: 110 },
    eq: { lowShelfHz: 200, lowShelfDb: 2, highShelfHz: 5000, highShelfDb: 0 },
    shell: 'pistol', shellDelayMs: 280,
    reload: {
      kind: 'mag',
      steps: [
        { file: 'reload_magout', at: 0.2,  synth: 'magout' },
        { file: 'reload_magin',  at: 0.6,  synth: 'magin' },
        { file: 'reload_slide',  at: 0.85, synth: 'bolt', emptyOnly: true },
      ],
    },
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 4,
  },
  3: { // Rulô: nổ to, đoàng, vang dài
    folder: 'rulo',
    layers: {
      body: { files: ['shot_01', 'shot_02', 'shot_03'], gainDb: 1,  pitch: 0.92, pitchRand: 0.03, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],                       gainDb: -3, pitch: 0.95, pitchRand: 0.03, gainRandDb: 1, delayMs: 25, synthDecayMs: 700 },
    },
    thump: { gainDb: 0, startHz: 95, endHz: 38, durationMs: 200 },
    eq: { lowShelfHz: 140, lowShelfDb: 5, highShelfHz: 5000, highShelfDb: -1 },
    shell: null, shellDelayMs: 0,
    cockFile: 'cock',
    reload: {
      kind: 'perRound',
      open:   { file: 'reload_open',   at: 0.08, synth: 'magout' },
      eject:  { file: 'reload_eject',  at: 0.22, synth: 'shells' },
      insert: { file: 'reload_insert', from: 0.35, to: 0.8, synth: 'insert' },
      close:  { file: 'reload_close',  at: 0.88, synth: 'magin' },
    },
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 4,
  },
}

/** Mọi file (khoá, không đuôi) mà các profile + âm chung có thể dùng — để preload. */
export function allGunSoundKeys(gunKey: (f: string, n: string) => string, commonKey: (n: string) => string): string[] {
  const keys: string[] = []
  for (const p of Object.values(GUN_SOUNDS)) {
    for (const l of [p.layers.body, p.layers.mech, p.layers.tail]) {
      if (l) for (const f of l.files) keys.push(gunKey(p.folder, f))
    }
    if (p.reload.kind === 'mag') {
      for (const s of p.reload.steps) keys.push(gunKey(p.folder, s.file))
    } else {
      const r = p.reload
      for (const f of [r.open.file, r.eject.file, r.close.file, r.insert.file]) keys.push(gunKey(p.folder, f))
    }
    if (p.dryfire.file) keys.push(gunKey(p.folder, p.dryfire.file))
    if (p.cockFile) keys.push(gunKey(p.folder, p.cockFile))
    keys.push(gunKey(p.folder, p.draw))
  }
  for (const n of ['dryfire_rifle', 'dryfire_pistol', 'lowammo']) keys.push(commonKey(n))
  for (const kind of ['rifle', 'pistol']) for (let i = 1; i <= 3; i++) keys.push(commonKey(`shell_${kind}_0${i}`))
  return keys
}
