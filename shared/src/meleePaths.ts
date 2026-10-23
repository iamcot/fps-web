// Cung quét của đòn cận chiến (plan 19, P3): tính đoạn gốc–mũi trong thế giới tại thời điểm u của cửa sổ đánh.
// Server không cần xương: chỉ cần vị trí mắt, yaw, pitch. Không import Three.js/DOM, không cấp phát.
import type { MeleeArc } from './meleeConfig'

const DEG = Math.PI / 180

/** Đoạn quét, toạ độ thế giới. base = tay, tip = mũi vùng quét */
export interface BladeSeg {
  base: [number, number, number]
  tip: [number, number, number]
}

export function makeBladeSeg(): BladeSeg { return { base: [0, 0, 0], tip: [0, 0, 0] } }

function lerp2(p: readonly [number, number], u: number): number { return p[0] + (p[1] - p[0]) * u }

/**
 * Đoạn quét tại u ∈ [0,1]. `eye` = vị trí mắt người đánh; yaw/pitch = hướng nhìn (quy ước dự án: yaw 0 nhìn -Z, yaw tăng = quay trái).
 * Hệ cục bộ: x phải, y lên (theo pitch), z trước.
 */
export function bladeSegAt(out: BladeSeg, arc: MeleeArc, u: number, eye: readonly number[], yaw: number, pitch: number): BladeSeg {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch)
  // Trục thế giới của khung nhìn
  const rx = cy, rz = -sy                   // phải
  const ux = sy * sp, uy = cp, uz = cy * sp  // lên (đã nghiêng theo pitch)
  const fx = -sy * cp, fy = sp, fz = -cy * cp   // trước
  const a = lerp2(arc.yaw, u) * DEG, p = lerp2(arc.pitch, u) * DEG, reach = lerp2(arc.reach, u)
  const bx = lerp2(arc.side, u), by = lerp2(arc.height, u), bz = lerp2(arc.fwd, u)
  // Hướng cung trong khung cục bộ
  const dl = Math.sin(a) * Math.cos(p), du = Math.sin(p), df = Math.cos(a) * Math.cos(p)
  out.base[0] = eye[0]! + bx * rx + by * ux + bz * fx
  out.base[1] = eye[1]! +              by * uy + bz * fy
  out.base[2] = eye[2]! + bx * rz + by * uz + bz * fz
  out.tip[0] = out.base[0] + reach * (dl * rx + du * ux + df * fx)
  out.tip[1] = out.base[1] + reach * (             du * uy + df * fy)
  out.tip[2] = out.base[2] + reach * (dl * rz + du * uz + df * fz)
  return out
}
