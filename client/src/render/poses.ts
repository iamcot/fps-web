import * as THREE from 'three'
import raw from './poses.json'

// Tư thế tay/súng (plan 10). Mọi số nằm trong poses.json; file này chỉ định kiểu, kiểm tra và đọc.
export type Vec3 = [number, number, number]
export type Hold = 'twoHand' | 'oneHand' | 'pistolSupport'
export type AnchorName = 'hand_r' | 'hand_l' | 'mag'

export interface ArmStyleCfg { upperLen: number; foreLen: number; thickness: number; handSize: number; sleeveToElbow?: boolean }
export interface WeaponPose {
  anchors: Partial<Record<AnchorName, Vec3>>
  third: { hold: Hold; gunPos: Vec3; gunRotDeg: Vec3 }
  first: { hold: Hold; gunPos?: Vec3; gunRotDeg: Vec3; scale: number }
}
export interface ReloadKey { t: number; to: 'hand_l' | 'mag'; offset?: Vec3 }
export interface Poses {
  style: { skinColor: string; sleeveColor: { A: string; B: string }; third: ArmStyleCfg; first: ArmStyleCfg }
  third: { shoulderR: Vec3; shoulderL: Vec3; aimPivot: Vec3; poleR: Vec3; poleL: Vec3 }
  first: { fov: number; shoulderR: Vec3; shoulderL: Vec3; poleR: Vec3; poleL: Vec3 }
  weapons: Record<string, WeaponPose>
  reloadLeftHand: {
    keys: ReloadKey[]; magDetachT: number; magAttachT: number
    gunTiltDeg: { roll: number; pitch: number; inT: number; outT: number }
  }
}

// Thứ tự = id súng trong shared (WEAPONS)
export const WEAPON_KEYS = ['ak47', 'm16', 'colt', 'rulo', 'sniper', 'shotgun', 'knife', 'smg'] as const

const DEFAULTS = {
  style: {
    skinColor: '#e0a77a', sleeveColor: { A: '#2f6fd6', B: '#2b2b2b' },
    third: { upperLen: 0.34, foreLen: 0.36, thickness: 0.11, handSize: 0.12 },
    first: { upperLen: 0.45, foreLen: 0.47, thickness: 0.075, handSize: 0.085, sleeveToElbow: true },
  },
  third: { shoulderR: [0.25, 1.4, 0], shoulderL: [-0.25, 1.4, 0], aimPivot: [0, 1.35, 0], poleR: [0.35, -0.55, 0.25], poleL: [-0.35, -0.55, 0.05] },
  first: { fov: 54, shoulderR: [0.22, -0.3, 0.12], shoulderL: [-0.2, -0.3, 0.1], poleR: [0.45, -0.5, 0.2], poleL: [-0.45, -0.5, 0.1] },
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
const ANCHOR_NAMES: AnchorName[] = ['hand_r', 'hand_l', 'mag']

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
