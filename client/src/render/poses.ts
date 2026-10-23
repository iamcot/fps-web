import * as THREE from 'three'
import raw from './poses.json'

// Tư thế tay/súng (plan 10). Mọi số nằm trong poses.json; file này chỉ định kiểu, kiểm tra và đọc.
export type Vec3 = [number, number, number]
export type Hold = 'twoHand' | 'oneHand' | 'pistolSupport' | 'grenade'
export type AnchorName = 'hand_r' | 'hand_l' | 'mag' | 'pin_pull'

export interface ArmStyleCfg { upperLen: number; foreLen: number; thickness: number; handSize: number; sleeveToElbow?: boolean }
// Lựu đạn góc 1 (plan 12, G.5). Toạ độ trong không gian camera của viewmodel (như first.gunPos); 'to' của đường tay trái:
// 'rest' = leftRest, 'pin_pull' = anchor vòng chốt (hệ lựu đạn), offset cộng thêm trong không gian camera.
export interface GrenadePullKey { t: number; to: 'rest' | 'pin_pull'; offset?: Vec3 }
export interface GrenadeFirst {
  idlePos: Vec3; idleRotDeg: Vec3
  pullLeftHandPath: GrenadePullKey[]
  leftRest: Vec3
  readyPos: { strong: Vec3; lob: Vec3 }; readyRotDeg: { strong: Vec3; lob: Vec3 }
  throwPos: { strong: Vec3; lob: Vec3 }
  windupMs: number; throwMs: number; recoverMs: number
  pinAttachT?: number          // mốc t của đường rút chốt khi chốt đổi sang tay trái (mặc định 0,75)
  handRotDegR?: Vec3; handRotDegL?: Vec3   // xoay thêm bàn tay (độ) so với hướng lựu đạn
}
export interface WeaponPose {
  anchors: Partial<Record<AnchorName, Vec3>>
  third: { hold: Hold; gunPos: Vec3; gunRotDeg: Vec3; adsGunPos?: Vec3; adsGunRotDeg?: Vec3; throwStartS?: number; releaseS?: number; throwRate?: number }   // 3 trường cuối: clip ném (giây vào clip lúc bắt đầu / lúc tay thả, tốc độ phát)
  first: { hold: Hold; gunPos?: Vec3; gunRotDeg: Vec3; scale: number; adsEyeDist?: number; adsRotDeg?: Vec3; grenade?: GrenadeFirst }   // adsEyeDist: đầu ruồi cách mắt bấy nhiêu m khi ngắm; adsRotDeg: xoay thêm khi ngắm hẳn
}
export interface ReloadKey { t: number; to: 'hand_l' | 'mag'; offset?: Vec3 }
export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
export interface CharacterCfg {
  crouchDrop: number; crouchWalkDrop: number; aimPivotBone: string; spinePitchBones: string[]; spinePitchLimitDeg: number; headPitchShare: number
  aimPivotOffset: Vec3; poleR: Vec3; poleL: Vec3
  handRotOffsetDegR: Vec3; handRotOffsetDegL: Vec3
  palmCenterFrac: number          // tâm lòng bàn tay = tỉ lệ này của đoạn cổ tay → khớp ngón giữa
  oneHandGunPos: Vec3; oneHandGunRotDeg: Vec3   // súng 1 tay trong hệ "bàn tay chuẩn" (ngón chĩa −Z, ngón cái +Y)
  /** Thế thủ cận chiến (góc nhìn thứ ba): tâm bàn tay so với vai cùng bên + hướng bàn tay chuẩn, trong hệ thân (x phải, y lên, −z trước, đã xoay theo pitch) */
  melee: { restR: Vec3; restRotDegR: Vec3; restL: Vec3; restRotDegL: Vec3 }
  anim: {
    blendTime: number; idleSpeed: number; walkRefSpeed: number; runStartSpeed: number; runBlendLen: number
    runRefSpeed: number; crouchRefSpeed: number; maxRate: number; jumpHoldS: number
  }
}
/** R / L: nắm báng súng; knifeR: tay phải nắm kín cán dao; supportL: tay trái thả lỏng làm tay phụ khi cầm dao */
export interface GripCfg { R: Record<FingerName, Vec3>; L: Record<FingerName, Vec3>; knifeR: Record<FingerName, Vec3>; supportL: Record<FingerName, Vec3>; axis: 'x' | 'y' | 'z' }
export interface Poses {
  style: { skinColor: string; sleeveColor: { A: string; B: string }; third: ArmStyleCfg; first: ArmStyleCfg }
  third: { shoulderR: Vec3; shoulderL: Vec3; aimPivot: Vec3; poleR: Vec3; poleL: Vec3 }
  first: { fov: number; shoulderR: Vec3; shoulderL: Vec3; poleR: Vec3; poleL: Vec3; armsRootOffset: Vec3; armsRootRotDeg: Vec3; armsScale: number; armsMaxExtension: number; armsPoleR: Vec3; armsPoleL: Vec3 }
  character: CharacterCfg
  grip: GripCfg
  grenade: { trajectory: boolean; trajectoryMaxS: number; dotEveryS: number }
  weapons: Record<string, WeaponPose>
  reloadLeftHand: {
    keys: ReloadKey[]; magDetachT: number; magAttachT: number
    gunTiltDeg: { roll: number; pitch: number; inT: number; outT: number }
  }
}

// Thứ tự = id súng trong shared (WEAPONS)
export const WEAPON_KEYS = ['ak47', 'm16', 'colt', 'rulo', 'sniper', 'shotgun', 'knife', 'smg', 'm67'] as const

const DEFAULTS = {
  style: {
    skinColor: '#e0a77a', sleeveColor: { A: '#2f6fd6', B: '#2b2b2b' },
    third: { upperLen: 0.34, foreLen: 0.36, thickness: 0.11, handSize: 0.12 },
    first: { upperLen: 0.45, foreLen: 0.47, thickness: 0.075, handSize: 0.085, sleeveToElbow: true },
  },
  third: { shoulderR: [0.25, 1.4, 0], shoulderL: [-0.25, 1.4, 0], aimPivot: [0, 1.35, 0], poleR: [0.35, -0.55, 0.25], poleL: [-0.35, -0.55, 0.05] },
  first: { fov: 54, shoulderR: [0.22, -0.3, 0.12], shoulderL: [-0.2, -0.3, 0.1], poleR: [0.45, -0.5, 0.2], poleL: [-0.45, -0.5, 0.1], armsRootOffset: [0, -0.3, 0], armsRootRotDeg: [0, 0, 0], armsScale: 1.4, armsMaxExtension: 0.92, armsPoleR: [0.4, -0.5, 0.3], armsPoleL: [-0.4, -0.5, 0.3] },
  character: {
    crouchDrop: 0, crouchWalkDrop: 0.25, aimPivotBone: 'mixamorigSpine2', spinePitchBones: ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2'],
    spinePitchLimitDeg: 60, headPitchShare: 0.3, aimPivotOffset: [0, 0.08, 0], poleR: [0.35, -0.6, 0.3], poleL: [-0.35, -0.6, 0.1],
    handRotOffsetDegR: [0, 0, 0], handRotOffsetDegL: [0, 0, 0], palmCenterFrac: 0.6,
    oneHandGunPos: [0, 0, 0], oneHandGunRotDeg: [0, 0, 0],
    melee: { restR: [-0.04, -0.24, -0.4], restRotDegR: [0, 0, 0], restL: [0.16, -0.26, -0.32], restRotDegL: [0, 0, 0] },
    anim: { blendTime: 0.15, idleSpeed: 0.3, walkRefSpeed: 1.6, runStartSpeed: 5, runBlendLen: 2, runRefSpeed: 5, crouchRefSpeed: 1, maxRate: 2, jumpHoldS: 0.35 },
  },
  grip: {
    R: { thumb: [10, 20, 15], index: [15, 20, 10], middle: [55, 70, 40], ring: [60, 75, 45], pinky: [65, 75, 45] },
    L: { thumb: [15, 25, 20], index: [45, 55, 35], middle: [55, 65, 40], ring: [60, 70, 45], pinky: [65, 70, 45] },
    knifeR: { thumb: [-50, 30, 40], index: [70, 68, 50], middle: [82, 64, 40], ring: [100, 60, 55], pinky: [105, 70, 45] },
    supportL: { thumb: [-12, -1, 20], index: [28, 30, 20], middle: [34, 34, 22], ring: [40, 38, 24], pinky: [44, 40, 26] },
    axis: 'x',
  },
  grenade: { trajectory: true, trajectoryMaxS: 2, dotEveryS: 0.06 },   // đường bay dự kiến khi giữ ready
  reloadLeftHand: { keys: [], magDetachT: 0.12, magAttachT: 0.55, gunTiltDeg: { roll: 0, pitch: 0, inT: 0.1, outT: 0.85 } },
}
const WEAPON_DEFAULT: WeaponPose = {
  anchors: {},
  third: { hold: 'oneHand', gunPos: [0.12, -0.05, -0.25], gunRotDeg: [0, 0, 0] },
  first: { hold: 'oneHand', gunRotDeg: [0, 0, 0], scale: 1 },
}

const warned = new Set<string>()
function warnOnce(msg: string): void {
  if (warned.has(msg)) return
  warned.add(msg)
  console.warn(`poses.json: ${msg}`)
}

// Trộn `src` lên bản sao của `def`: thiếu trường → mặc định (+ cảnh báo một lần); `_doc` bỏ qua; mảng lấy nguyên khối
function merge(def: unknown, src: unknown, path: string): unknown {
  if (Array.isArray(def)) {
    if (Array.isArray(src) && (def.length === 0 || src.length === def.length)) return src.slice()
    if (src !== undefined) warnOnce(`${path} sai dạng, dùng mặc định`)
    else warnOnce(`thiếu ${path}, dùng mặc định`)
    return def.slice()
  }
  if (def && typeof def === 'object') {
    const out: Record<string, unknown> = {}
    const s = (src && typeof src === 'object' ? src : {}) as Record<string, unknown>
    if (src === undefined) warnOnce(`thiếu ${path}, dùng mặc định`)
    for (const k of Object.keys(def)) out[k] = merge((def as Record<string, unknown>)[k], s[k], `${path}.${k}`)
    // Khoá thêm ngoài mặc định (ví dụ sleeveToElbow, offset) giữ nguyên
    for (const k of Object.keys(s)) if (k !== '_doc' && !(k in out)) out[k] = s[k]
    return out
  }
  if (src === undefined) { warnOnce(`thiếu ${path}, dùng mặc định`); return def }
  return typeof src === typeof def ? src : def
}

export function loadPoses(json: unknown): Poses {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const p = merge(DEFAULTS, j, 'poses') as Poses & { weapons?: unknown }
  const w = (j.weapons && typeof j.weapons === 'object' ? j.weapons : {}) as Record<string, unknown>
  const weapons: Record<string, WeaponPose> = {}
  for (const key of WEAPON_KEYS) {
    const src = w[key]
    if (src === undefined) warnOnce(`thiếu weapons.${key}, cầm một tay`)
    // Súng 1 tay không dùng gunPos/gunRotDeg của góc 3: khỏi cảnh báo thiếu
    const one = (src as { third?: { hold?: string } } | undefined)?.third?.hold === 'oneHand'
    const srcFilled = one ? { ...(src as object), third: { gunPos: WEAPON_DEFAULT.third.gunPos, gunRotDeg: WEAPON_DEFAULT.third.gunRotDeg, ...(src as { third: object }).third } } : src
    const wp = merge(WEAPON_DEFAULT, srcFilled, `weapons.${key}`) as WeaponPose
    const sw = (src && typeof src === 'object' ? src as Record<string, any> : {})
    wp.anchors = { ...(sw.anchors ?? {}) }
    if (sw.first?.gunPos) wp.first.gunPos = sw.first.gunPos
    weapons[key] = wp
  }
  p.weapons = weapons
  return p
}

// Bản đang dùng: sửa tại chỗ (F9 chỉnh trực tiếp, hot-reload ghi đè) rồi báo cho người nghe
let fileJson: unknown = raw
export const poses: Poses = loadPoses(raw)
const listeners = new Set<() => void>()
// Debug (vite dev): script kiểm tra từ trình duyệt chỉnh đúng bản `poses` đang chạy (import động có thể ra bản module khác)
if (import.meta.env?.DEV) Object.assign(globalThis, { __poses: poses, __notifyPoses: () => notifyPosesChanged() })
export function onPosesChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } }
export function notifyPosesChanged(): void { for (const fn of listeners) fn() }
export function replacePoses(json: unknown): void {
  fileJson = json
  const next = loadPoses(json)
  for (const k of Object.keys(next) as (keyof Poses)[]) (poses as any)[k] = next[k]
  notifyPosesChanged()
}
export function weaponPose(id: number): WeaponPose { return poses.weapons[WEAPON_KEYS[id] ?? 'ak47']! }

if (import.meta.hot) {
  import.meta.hot.accept('./poses.json', mod => { if (mod) replacePoses((mod as unknown as { default: unknown }).default) })
}

// ── Điểm neo ───────────────────────────────────────────────────────────────────
// Ưu tiên anchor trong poses.json; không có thì lấy Empty cùng tên trong glb (nếu có); cuối cùng gốc (0,0,0).
const glbAnchors = new Map<number, Map<AnchorName, THREE.Vector3>>()
const ANCHOR_NAMES: AnchorName[] = ['hand_r', 'hand_l', 'mag', 'pin_pull']

/** Gọi một lần khi model súng load xong (sau adjustModel). Toạ độ trong hệ cha của model. */
export function scanModelAnchors(id: number, model: THREE.Object3D): void {
  model.updateMatrixWorld(true)
  const m = new Map<AnchorName, THREE.Vector3>()
  for (const n of ANCHOR_NAMES) {
    const o = model.getObjectByName(n)
    if (o) m.set(n, o.getWorldPosition(new THREE.Vector3()))
  }
  glbAnchors.set(id, m)
}

export function getAnchor(id: number, name: AnchorName, out: THREE.Vector3): THREE.Vector3 {
  const j = weaponPose(id).anchors[name]
  if (j) return out.set(j[0], j[1], j[2])
  const g = glbAnchors.get(id)?.get(name)
  if (g) return out.copy(g)
  return out.set(0, 0, 0)
}

export function hasAnchor(id: number, name: AnchorName): boolean {
  return !!weaponPose(id).anchors[name] || !!glbAnchors.get(id)?.has(name)
}

export function colorOf(hex: string): number { return parseInt(hex.replace('#', ''), 16) }

/** Toàn bộ tư thế hiện tại ở dạng JSON y như file (để dán lại vào poses.json) */
export function exportPoses(): unknown {
  const doc = (fileJson as { _doc?: string } | null)?._doc
  return { ...(doc ? { _doc: doc } : {}), ...poses }
}
export function exportWeapon(id: number): unknown { return weaponPose(id) }
export function resetPosesToFile(): void { replacePoses(fileJson) }
