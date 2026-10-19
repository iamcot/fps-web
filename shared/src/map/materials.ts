// Vật liệu của map (chỉ tên + số liệu, không import Three). Map JSON khai báo mỗi box bằng:
//   "texture": tên class ("brick" | "stone" | "concrete" | "plain"), hoặc loại ("wall" | "floor" | "crate"), hoặc tên file ảnh ("concrete_2")
//   "variant": (tuỳ chọn) chọn ảnh thứ n (từ 1) trong class; bỏ trống = chọn theo vị trí box (hai bên đối xứng giống nhau)
//   "color":   (tuỳ chọn) "#rrggbb" — nhân vào ảnh (ảnh xám như concrete đổi màu rất rõ) hoặc sơn phẳng nếu class là plain
// Ảnh nằm ở client/public/textures/<tên>.jpg (nguồn gốc: assets/source/texture).
import type { MapBox } from './types'

export interface TextureClass {
  files: string[]   // tên file (không đuôi) trong client/public/textures
  tileM: number     // một lần lặp ảnh phủ bao nhiêu mét
}

export const TEXTURE_CLASSES: Record<string, TextureClass> = {
  brick:    { files: ['brick_1'], tileM: 3 },                  // gạch đỏ
  stone:    { files: ['stone_1'], tileM: 2.5 },                // đá tảng be
  concrete: { files: ['concrete_1', 'concrete_2'], tileM: 2 }, // bê tông xám
  plain:    { files: [], tileM: 1 },                           // không ảnh, chỉ ô kẻ + màu
  greenfloor:    { files: ['greenfloor'], tileM: 1 },          // sàn xanh rêu
}

export const FLOOR_COLOR = '#3d5a2a'   // xanh rêu
export const CRATE_TYPE = 'crate'      // box loại này vẽ bằng model thùng gỗ (va chạm/đạn vẫn theo hộp của box)

// Loại cũ → class + màu mặc định
const TYPE_DEFAULTS: Record<string, { cls: string; color?: string }> = {
  wall:  { cls: 'concrete' },
  floor: { cls: 'plain', color: FLOOR_COLOR },
}

export interface BoxLook {
  crate: boolean
  file: string | null    // ảnh dùng (không đuôi) hoặc null = ô kẻ
  tileM: number
  color: string | null
}

function pickIndex(box: MapBox, n: number): number {
  if (box.variant !== undefined) return Math.max(0, Math.min(n - 1, Math.floor(box.variant) - 1))
  // |x| để box và bản đối xứng chọn cùng một ảnh
  const h = Math.abs(Math.round(box.pos[0] * 7 + box.pos[1] * 13 * 7 + box.pos[2] * 31 * 7))
  return h % n
}

/** Đổi khai báo vật liệu của box thành thứ cần vẽ. Tên lạ → ô kẻ trơn (không lỗi). */
export function resolveBoxLook(box: MapBox): BoxLook {
  if (box.texture === CRATE_TYPE) return { crate: true, file: null, tileM: 1, color: box.color ?? null }
  const def = TYPE_DEFAULTS[box.texture]
  const cls = TEXTURE_CLASSES[def?.cls ?? box.texture]
  const color = box.color ?? def?.color ?? null
  if (cls) {
    const file = cls.files.length ? cls.files[pickIndex(box, cls.files.length)]! : null
    return { crate: false, file, tileM: cls.tileM, color }
  }
  for (const c of Object.values(TEXTURE_CLASSES)) {
    if (c.files.includes(box.texture)) return { crate: false, file: box.texture, tileM: c.tileM, color }
  }
  return { crate: false, file: null, tileM: 1, color }
}
