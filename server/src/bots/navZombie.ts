// Cạnh nav chỉ dành cho zombie (plan 17, T.4), thêm vào lưới sau khi cạnh người đã xong:
//  - Hole: bò qua lỗ bắn. Từ node cách mặt tường 2–4m, chạy thẳng vào, ngồi + nhảy lúc còn ~1,8m (xem brain), chui qua khe giữa bệ và thanh ngang.
//  - Leap: chiêu E bật từ ĐỨNG YÊN (đà ngang chỉ còn 5 m/s) lên gờ tường / đỉnh tháp. Quãng ngang cố định theo độ cao (leapFlight).
import { ZOMBIE, leapFlight, type Vec3 } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { EdgeKind, DIRS8, type NavEdge } from './nav'

const AXIS_DIRS = [0, 2, 4, 6] as const
const HOLE_RUNUP_MIN = 2.0
const HOLE_RUNUP_MAX = 4.2
const SILL_MIN = 0.3, SILL_MAX = 1.3
const HOLE_THICK_MAX = 1.2
const HOLE_CROUCH_H = 0.9        // khe phía trên bệ phải cao hơn zombie ngồi (0,85m)
const HOLE_HIGH_LIFT = 1.55      // quả cầu quét ở độ cao này phải thoáng suốt khe
const LEAP_MIN_DY = 1.2
const LEAP_MAX_DY_GROUND = 4.2   // từ mặt đất: lên gờ tường
const LEAP_MAX_DY_ELEV = 2.2     // từ gờ: lên đỉnh tháp
const LEAP_DIST_TOL = 0.8        // brain tự chỉnh vị trí đứng tới đúng quãng bay, nên cạnh chấp nhận lệch từng này
const ARC_SPHERE_R = 0.45
const ARC_SAMPLE_TICKS = 4
const DT = 1 / 60

export interface ZombieEdgeCtx {
  world: CollisionWorld
  xs: number[]; ys: number[]; zs: number[]
  adj: NavEdge[][]
  colNodes: number[][]
  minX: number; minZ: number; nx: number; nz: number
  gravity: number
}

interface Arc { dist: number[]; h: number[]; landDist: number }
const arcCache = new Map<string, Arc>()
/** Quỹ đạo bật đứng yên tới độ cao dy: mỗi tick (quãng ngang, độ cao) — mô phỏng đúng như stepMovement */
function arcFor(dy: number, g: number): Arc | null {
  const key = `${dy.toFixed(2)}|${g}`
  const hit = arcCache.get(key)
  if (hit) return hit
  const f = leapFlight(dy, g)
  if (!f) return null
  const dist: number[] = [0], h: number[] = [0]
  let y = 0, vy: number = ZOMBIE.leap.velY
  const n = Math.round(f.time / DT)
  for (let i = 1; i <= n; i++) { vy -= g * DT; y += vy * DT; dist.push(ZOMBIE.leap.forward * i * DT); h.push(y) }
  const arc = { dist, h, landDist: f.dist }
  arcCache.set(key, arc)
  return arc
}

const DOWN: Vec3 = [0, -1, 0]

export function addZombieEdges(c: ZombieEdgeCtx): void {
  const { world, xs, ys, zs, adj } = c
  const o: Vec3 = [0, 0, 0], d: Vec3 = [0, 0, 0]
  const n = xs.length
  const colAt = (ix: number, iz: number): number[] => (ix < 0 || iz < 0 || ix >= c.nx || iz >= c.nz ? [] : c.colNodes[ix * c.nz + iz] ?? [])
  const cellOf = (x: number, z: number): [number, number] => [Math.floor(x - c.minX), Math.floor(z - c.minZ)]
  const nodeNear = (x: number, y: number, z: number, tolY: number, tolXZ: number): number => {
    const [ix, iz] = cellOf(x, z)
    let best = -1, bestD = tolXZ * tolXZ
    const r = Math.ceil(tolXZ)
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const b of colAt(ix + dx, iz + dz)) {
      if (Math.abs(ys[b]! - y) > tolY) continue
      const dd = (xs[b]! - x) ** 2 + (zs[b]! - z) ** 2
      if (dd < bestD) { bestD = dd; best = b }
    }
    return best
  }
  const has = (a: number, b: number): boolean => adj[a]!.some(e => e.to === b)

  // ── Hole ────────────────────────────────────────────────────────────────────
  for (let a = 0; a < n; a++) {
    const ax = xs[a]!, ay = ys[a]!, az = zs[a]!
    for (const k of AXIS_DIRS) {
      const dx = DIRS8[k]![0], dz = DIRS8[k]![1]
      // mặt tường phía trước ở độ cao ngực
      o[0] = ax; o[1] = ay + 0.5; o[2] = az; d[0] = dx; d[1] = 0; d[2] = dz
      const front = world.castRay(o, d, HOLE_RUNUP_MAX + 0.2)
      if (!front || front.dist < HOLE_RUNUP_MIN || front.dist > HOLE_RUNUP_MAX) continue
      if (Math.abs(front.normal[0] * dx + front.normal[2] * dz) < 0.9) continue   // tường vuông góc hướng chạy
      const fx = ax + dx * front.dist, fz = az + dz * front.dist
      // bệ: mặt trên của vật cản ngay sau mặt tường
      o[0] = fx + dx * 0.15; o[1] = ay + SILL_MAX + 0.3; o[2] = fz + dz * 0.15   // bắt đầu ngay trên bệ cao nhất cho phép (không lọt vào thanh ngang phía trên khe)
      const top = world.castRay(o, DOWN, SILL_MAX + 0.3)
      if (!top) continue
      const sill = o[1]! - top.dist - ay
      if (sill < SILL_MIN || sill > SILL_MAX) continue
      // khe thoáng ở độ cao zombie ngồi bò qua: quả cầu quét suốt từ a tới 3m sau mặt tường, và đủ cao trên bệ
      if (!sweepFree(world, ax, ay + HOLE_HIGH_LIFT, az, fx + dx * 3, ay + HOLE_HIGH_LIFT, fz + dz * 3, o, d)) continue
      o[0] = fx + dx * 0.15; o[1] = ay + sill + 0.03; o[2] = fz + dz * 0.15; d[0] = 0; d[1] = 1; d[2] = 0
      if (world.castRay(o, d, HOLE_CROUCH_H)) continue
      // độ dày tường: tia ngược từ phía bên kia
      const farX = fx + dx * 3, farZ = fz + dz * 3
      o[0] = farX; o[1] = ay + 0.5; o[2] = farZ; d[0] = -dx; d[1] = 0; d[2] = -dz
      const back = world.castRay(o, d, 3.1)
      if (!back) continue
      const thick = 3 - back.dist
      if (thick < 0.05 || thick > HOLE_THICK_MAX) continue
      const exitX = farX - dx * back.dist, exitZ = farZ - dz * back.dist
      const b = nodeNear(exitX + dx * 1.0, ay, exitZ + dz * 1.0, 0.3, 0.7)
      if (b < 0 || has(a, b)) continue
      adj[a]!.push({ to: b, cost: Math.hypot(xs[b]! - ax, zs[b]! - az) + 4, kind: EdgeKind.Hole, face: [fx, fz] })
    }
  }

  // ── Leap ────────────────────────────────────────────────────────────────────
  const g = c.gravity
  for (let b = 0; b < n; b++) {
    const by = ys[b]!
    if (by < LEAP_MIN_DY) continue
    const bx = xs[b]!, bz = zs[b]!
    const [bix, biz] = cellOf(bx, bz)
    const R = 7
    for (let dxc = -R; dxc <= R; dxc++) for (let dzc = -R; dzc <= R; dzc++) {
      for (const a of colAt(bix + dxc, biz + dzc)) {
        const ay = ys[a]!, dy = by - ay
        if (dy < LEAP_MIN_DY || dy > (ay < 1 ? LEAP_MAX_DY_GROUND : LEAP_MAX_DY_ELEV)) continue
        const hx = bx - xs[a]!, hz = bz - zs[a]!
        const h = Math.hypot(hx, hz)
        const arc = arcFor(dy, g)
        if (!arc || Math.abs(h - arc.landDist) > LEAP_DIST_TOL || has(a, b)) continue
        const ux = hx / h, uz = hz / h
        // chỗ bật thật = cách b đúng quãng bay, trên đường a → b
        const sx = bx - ux * arc.landDist, sz = bz - uz * arc.landDist
        if (!arcClear(world, arc, sx, ay, sz, ux, uz, o, d)) continue
        adj[a]!.push({ to: b, cost: 6 + arc.landDist * 1.5 + dy, kind: EdgeKind.Leap })
      }
    }
  }
}

function sweepFree(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Vec3, d: Vec3): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) return true
  d[0] = dx / len; d[1] = dy / len; d[2] = dz / len
  o[0] = ax; o[1] = ay; o[2] = az
  return world.castSphere(o, d, len, 0.35) === null
}

/** Quỹ đạo bật không đụng gì: quả cầu quét giữa các mẫu liên tiếp ở hai độ cao thân (đầu gối / ngực) */
function arcClear(world: CollisionWorld, arc: Arc, sx: number, sy: number, sz: number, ux: number, uz: number, o: Vec3, d: Vec3): boolean {
  const last = arc.dist.length - 1
  for (const lift of [0.7, 1.4]) {
    let px = sx, py = sy + lift, pz = sz
    for (let i = ARC_SAMPLE_TICKS; ; i += ARC_SAMPLE_TICKS) {
      const j = Math.min(i, last)
      const qx = sx + ux * arc.dist[j]!, qy = sy + arc.h[j]! + lift, qz = sz + uz * arc.dist[j]!
      const dx = qx - px, dy = qy - py, dz = qz - pz
      const len = Math.hypot(dx, dy, dz)
      if (len > 1e-6) {
        d[0] = dx / len; d[1] = dy / len; d[2] = dz / len
        o[0] = px; o[1] = py; o[2] = pz
        // bỏ qua đoạn cuối chạm mặt đáp (sát b): chỉ kiểm tới trước điểm đáp một chút
        const lim = j === last ? Math.max(0, len - 0.25) : len
        if (lim > 0 && world.castSphere(o, d, lim, ARC_SPHERE_R)) return false
      }
      px = qx; py = qy; pz = qz
      if (j === last) break
    }
  }
  return true
}
