// Lưới di chuyển cho bot (plan 15, B.1): sinh tự động từ collider map bằng Rapier (raycast/quét cầu), không cần vẽ tay.
// Node = chỗ đứng được (mọi mặt đứng: đất, mặt tường thành, đỉnh tháp, ramp). Cạnh: đi bộ, nhảy (gờ thấp), nhảy xuống (một chiều).
import type { LoadedMap, Vec3, MovementConfig } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { addZombieEdges } from './navZombie'

export const NAV_CELL = 1                 // m
const MIN_NORMAL_Y = 0.7                  // mặt đứng được
const WALK_MAX_SLOPE = 0.7                // dy / khoảng cách ngang tối đa của cạnh đi bộ (≈35°; ramp của map ≈30–33°)
const SURFACE_TOL = 0.2                 // sai lệch cao độ cho phép giữa mặt thật và đường thẳng nối hai node
const JUMP_MAX_DY = 0.95                  // nhảy lên gờ cao tối đa (jumpVelocity 7, g 22 → 1,11m)
const DROP_MAX = 4.5                      // nhảy xuống tối đa
const SWEEP_R = 0.35                      // bán kính quả cầu quét (capsule bán kính 0,4)
const SWEEP_LIFT = 0.5                    // quả cầu quét cách mặt đứng bấy nhiêu (đỡ vướng gờ nhỏ ≤ 0,15m)
const COVER_RAY_H = 1.2                   // tường cao ≥ 1,2m mới che người ngồi
const COVER_RAY_LEN = 1.2
const MAX_LAYERS = 8
const STAND_LIFT = 0.12

// Hole/Leap chỉ dành cho zombie (plan 17, T.4): Hole = bò (ngồi + nhảy) qua lỗ bắn; Leap = chiêu E bật từ đứng yên lên gờ tường / đỉnh tháp
export const EdgeKind = { Walk: 0, Jump: 1, Drop: 2, Hole: 3, Leap: 4 } as const
export type EdgeKindValue = (typeof EdgeKind)[keyof typeof EdgeKind]

export const Zone = { Mid: 0, BaseA: 1, BaseB: 2, WallA: 3, WallB: 4, TowerA: 5, TowerB: 6 } as const
export type ZoneId = (typeof Zone)[keyof typeof Zone]

/** 8 hướng: index 0 = +X, đi ngược chiều kim đồng hồ nhìn từ trên (x, z) */
export const DIRS8: readonly (readonly [number, number])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
].map(([x, z]) => { const l = Math.hypot(x!, z!); return [x! / l, z! / l] as const })

export interface NavEdge {
  to: number; cost: number; kind: EdgeKindValue
  face?: [number, number]   // Hole: điểm mặt tường phía mình (x, z) — bộ não zombie tính lúc ngồi + nhảy theo khoảng cách tới đây
}
export interface Waypoint { x: number; y: number; z: number; jump: boolean; kind: EdgeKindValue; face?: [number, number] }
/** Cạnh đặc biệt nào được phép dùng khi tìm đường (mặc định: không cạnh nào của zombie) */
export interface NavAbility { hole?: boolean; leap?: boolean }
const allowed = (e: NavEdge, ab: NavAbility | undefined): boolean => e.kind < EdgeKind.Hole || (e.kind === EdgeKind.Hole ? !!ab?.hole : !!ab?.leap)

export function zoneOf(x: number, y: number, z: number): ZoneId {
  void z
  const ax = Math.abs(x), a = x < 0
  if (y > 3.5 && ax >= 17.5 && ax <= 20.5) return a ? Zone.WallA : Zone.WallB
  if (y > 5 && ax > 12 && ax < 20) return a ? Zone.TowerA : Zone.TowerB
  if (ax >= 19.75) return a ? Zone.BaseA : Zone.BaseB
  return Zone.Mid
}

class MinHeap {
  private keys: number[] = []
  private vals: number[] = []
  get size(): number { return this.keys.length }
  clear(): void { this.keys.length = 0; this.vals.length = 0 }
  push(key: number, val: number): void {
    const k = this.keys, v = this.vals
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p]! <= key) break
      k[i] = k[p]!; v[i] = v[p]!; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): number {
    const k = this.keys, v = this.vals
    const top = v[0]!
    const lk = k.pop()!, lv = v.pop()!
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1]! < k[c]!) c++
        if (k[c]! >= lk) break
        k[i] = k[c]!; v[i] = v[c]!; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

export class NavGrid {
  readonly count: number
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  readonly cover: Uint8Array      // bitmask 8 hướng có tường che (hướng đó là phía có tường)
  readonly zone: Uint8Array
  readonly adj: NavEdge[][]
  private readonly cols = new Map<number, number[]>()   // khoá cột (ix, iz) → các node
  private readonly minX: number
  private readonly minZ: number
  // A* tái sử dụng
  private readonly g: Float64Array
  private readonly from: Int32Array
  private readonly stamp: Int32Array
  private readonly closedStamp: Int32Array
  private curStamp = 0
  private readonly heap = new MinHeap()
  readonly coverNodes: number[] = []

  constructor(
    private readonly world: CollisionWorld,
    xs: number[], ys: number[], zs: number[], cover: number[], zones: number[],
    adj: NavEdge[][], minX: number, minZ: number, colKeys: number[],
  ) {
    const n = xs.length
    this.count = n
    this.x = Float32Array.from(xs); this.y = Float32Array.from(ys); this.z = Float32Array.from(zs)
    this.cover = Uint8Array.from(cover); this.zone = Uint8Array.from(zones)
    this.adj = adj
    this.minX = minX; this.minZ = minZ
    for (let i = 0; i < n; i++) {
      const key = colKeys[i]!
      const list = this.cols.get(key)
      if (list) list.push(i); else this.cols.set(key, [i])
      if (cover[i]) this.coverNodes.push(i)
    }
    this.g = new Float64Array(n); this.from = new Int32Array(n); this.stamp = new Int32Array(n); this.closedStamp = new Int32Array(n)
  }

  static colKey(ix: number, iz: number): number { return (ix + 512) * 1024 + (iz + 512) }

  pos(i: number, out: Vec3 = [0, 0, 0]): Vec3 { out[0] = this.x[i]!; out[1] = this.y[i]!; out[2] = this.z[i]!; return out }

  /** Node gần nhất (ưu tiên cùng tầng: lệch cao bị phạt) trong bán kính `maxDist`; -1 nếu không có */
  nearest(px: number, py: number, pz: number, maxDist = 3): number {
    const ix = Math.floor((px - this.minX) / NAV_CELL), iz = Math.floor((pz - this.minZ) / NAV_CELL)
    const r = Math.ceil(maxDist / NAV_CELL)
    let best = -1, bestD = maxDist * maxDist
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const list = this.cols.get(NavGrid.colKey(ix + dx, iz + dz))
        if (!list) continue
        for (const i of list) {
          const ddx = this.x[i]! - px, ddz = this.z[i]! - pz
          let ddy = this.y[i]! - py
          if (ddy > 1.2) ddy *= 4   // node cao hơn nhiều so với chân: không với tới
          const d = ddx * ddx + ddz * ddz + ddy * ddy
          if (d < bestD) { bestD = d; best = i }
        }
      }
    }
    return best
  }

  /** Mọi node cách (px, pz) ≤ r theo mặt phẳng ngang và lệch cao ≤ dyMax */
  nodesNear(px: number, py: number, pz: number, r: number, dyMax = 2.5, out: number[] = []): number[] {
    out.length = 0
    const ix = Math.floor((px - this.minX) / NAV_CELL), iz = Math.floor((pz - this.minZ) / NAV_CELL)
    const c = Math.ceil(r / NAV_CELL)
    for (let dx = -c; dx <= c; dx++) {
      for (let dz = -c; dz <= c; dz++) {
        const list = this.cols.get(NavGrid.colKey(ix + dx, iz + dz))
        if (!list) continue
        for (const i of list) {
          if (Math.abs(this.y[i]! - py) > dyMax) continue
          if (Math.hypot(this.x[i]! - px, this.z[i]! - pz) <= r) out.push(i)
        }
      }
    }
    return out
  }

  /**
   * A* giữa hai node. `costFn(node)` cộng thêm chi phí khi bước vào node (≥ 0), vd. né tầm nhìn địch.
   * Trả danh sách node (gồm cả hai đầu) hoặc null.
   */
  findNodePath(start: number, goal: number, costFn?: (node: number) => number, ability?: NavAbility): number[] | null {
    if (start < 0 || goal < 0) return null
    if (start === goal) return [start]
    const stamp = ++this.curStamp
    const { g, from, heap } = this
    heap.clear()
    const gx = this.x[goal]!, gy = this.y[goal]!, gz = this.z[goal]!
    const h = (i: number) => Math.hypot(this.x[i]! - gx, this.y[i]! - gy, this.z[i]! - gz)
    this.stamp[start] = stamp; g[start] = 0; from[start] = -1
    heap.push(h(start), start)
    const closed = this.closedStamp
    while (heap.size > 0) {
      const cur = heap.pop()
      if (closed[cur] === stamp) continue
      closed[cur] = stamp
      if (cur === goal) {
        const out: number[] = []
        for (let i = goal; i >= 0; i = from[i]!) out.push(i)
        return out.reverse()
      }
      const gc = g[cur]!
      for (const e of this.adj[cur]!) {
        if (closed[e.to] === stamp || !allowed(e, ability)) continue
        const ng = gc + e.cost + (costFn ? costFn(e.to) : 0)
        if (this.stamp[e.to] !== stamp || ng < g[e.to]!) {
          this.stamp[e.to] = stamp; g[e.to] = ng; from[e.to] = cur
          heap.push(ng + h(e.to), e.to)
        }
      }
    }
    return null
  }

  /** Cạnh a → b (nếu có) */
  edge(a: number, b: number): NavEdge | undefined {
    for (const e of this.adj[a]!) if (e.to === b) return e
    return undefined
  }

  /**
   * Đường đi từ vị trí `from` tới vị trí `to` (làm mượt bằng cách bỏ node trung gian khi đi thẳng được).
   * Waypoint `jump` = bước vào nó cần nhảy (gờ thấp / nhảy xuống không cần nhảy: chỉ bước ra).
   */
  findPath(from: Vec3, to: Vec3, costFn?: (node: number) => number, ability?: NavAbility): Waypoint[] | null {
    const s = this.nearest(from[0], from[1], from[2]), t = this.nearest(to[0], to[1], to[2])
    const nodes = this.findNodePath(s, t, costFn, ability)
    if (!nodes) return null
    return this.smooth(nodes)
  }

  smooth(nodes: number[]): Waypoint[] {
    const out: Waypoint[] = []
    let i = 0
    // node đầu là chỗ đang đứng: bỏ nếu còn node sau
    if (nodes.length > 1) i = 1
    const first = nodes[0]!
    let anchor = first
    while (i < nodes.length) {
      const cur = nodes[i]!
      const prev = nodes[i - 1] ?? anchor
      const e = this.edge(prev, cur)
      const special = !e || e.kind !== EdgeKind.Walk
      if (special) {
        out.push({ x: this.x[cur]!, y: this.y[cur]!, z: this.z[cur]!, jump: e?.kind === EdgeKind.Jump, kind: e?.kind ?? EdgeKind.Walk, ...(e?.face ? { face: e.face } : null) })
        anchor = cur; i++
        continue
      }
      // đi bộ: kéo dài đoạn thẳng tới node xa nhất còn đi thẳng được qua các cạnh đi bộ
      let far = i
      for (let j = i + 1; j < nodes.length; j++) {
        const ej = this.edge(nodes[j - 1]!, nodes[j]!)
        if (!ej || ej.kind !== EdgeKind.Walk) break
        if (!this.straightWalkable(anchor, nodes[j]!)) break
        far = j
      }
      const n = nodes[far]!
      out.push({ x: this.x[n]!, y: this.y[n]!, z: this.z[n]!, jump: false, kind: EdgeKind.Walk })
      anchor = n; i = far + 1
    }
    return out
  }

  private readonly _o: Vec3 = [0, 0, 0]
  private readonly _d: Vec3 = [0, 0, 0]

  /** Đường thẳng a → b đi bộ được: quả cầu quét không chạm gì và mặt sàn dọc đường bám đường thẳng nối hai node */
  straightWalkable(a: number, b: number): boolean {
    const ax = this.x[a]!, ay = this.y[a]!, az = this.z[a]!
    const bx = this.x[b]!, by = this.y[b]!, bz = this.z[b]!
    return walkable(this.world, ax, ay, az, bx, by, bz, this._o, this._d)
  }
}

const DOWN: Vec3 = [0, -1, 0]

function sweepClear(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Vec3, d: Vec3, lift = SWEEP_LIFT): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) return true
  d[0] = dx / len; d[1] = dy / len; d[2] = dz / len
  o[0] = ax; o[1] = ay + lift; o[2] = az
  return world.castSphere(o, d, len, SWEEP_R) === null
}

/**
 * Đi bộ từ a tới b: mặt sàn dọc đường bám đường thẳng nối hai node (không gờ/vực giữa chừng), và quả cầu quét
 * theo từng đoạn ngắn sát mặt sàn thật không chạm gì (đường thẳng giữa hai node có thể cắt vào dốc).
 */
function walkable(world: CollisionWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Vec3, d: Vec3): boolean {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(2, Math.ceil(len / 0.5))
  let px = ax, py = ay, pz = az
  for (let k = 1; k <= n; k++) {
    const t = k / n
    let qx = bx, qy = by, qz = bz
    if (k < n) {
      qx = ax + (bx - ax) * t; qz = az + (bz - az) * t
      o[0] = qx; o[1] = Math.max(ay, by) + 1.2; o[2] = qz
      const hit = world.castRay(o, DOWN, 6)
      if (!hit) return false
      qy = o[1]! - hit.dist
      if (Math.abs(qy - (ay + (by - ay) * t)) > SURFACE_TOL) return false
    }
    if (!sweepClear(world, px, py, pz, qx, qy, qz, o, d)) return false
    px = qx; py = qy; pz = qz
  }
  return true
}

/** Sinh lưới cho map. `world` = world va chạm của map (bất kỳ người chơi nào), chỉ dùng truy vấn tĩnh. */
export function buildNav(world: CollisionWorld, map: LoadedMap, cfg: MovementConfig): NavGrid {
  // Phạm vi: bao các hộp có thể đi trên đó (bỏ hộp invisible: tường chắn trời)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0
  for (const b of map.boxes) {
    if (b.invisible) continue
    minX = Math.min(minX, b.pos[0] - b.size[0] / 2); maxX = Math.max(maxX, b.pos[0] + b.size[0] / 2)
    minZ = Math.min(minZ, b.pos[2] - b.size[2] / 2); maxZ = Math.max(maxZ, b.pos[2] + b.size[2] / 2)
    maxY = Math.max(maxY, b.pos[1] + b.size[1] / 2)
  }
  for (const r of map.ramps) {
    minX = Math.min(minX, r.from[0], r.to[0]); maxX = Math.max(maxX, r.from[0], r.to[0])
    minZ = Math.min(minZ, r.from[2] - r.width / 2, r.to[2] - r.width / 2); maxZ = Math.max(maxZ, r.from[2] + r.width / 2, r.to[2] + r.width / 2)
    maxY = Math.max(maxY, r.from[1], r.to[1])
  }
  minX = Math.floor(minX); minZ = Math.floor(minZ)
  const nx = Math.ceil(maxX) - minX, nz = Math.ceil(maxZ) - minZ

  const xs: number[] = [], ys: number[] = [], zs: number[] = [], colKeys: number[] = []
  const colNodes: number[][] = new Array(nx * nz)
  const o: Vec3 = [0, 0, 0], d: Vec3 = [0, 0, 0]
  const pos: Vec3 = [0, 0, 0]

  // 1. mọi mặt đứng: bắn tia xuống nhiều lần từ trên cao; mỗi lần trúng thì đi tiếp từ ngay dưới điểm trúng
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const px = minX + (ix + 0.5) * NAV_CELL, pz = minZ + (iz + 0.5) * NAV_CELL
      const list: number[] = []
      let startY = maxY + 3
      for (let layer = 0; layer < MAX_LAYERS; layer++) {
        o[0] = px; o[1] = startY; o[2] = pz
        const hit = world.castRay(o, DOWN, startY + 5)
        if (!hit) break
        const y = startY - hit.dist
        startY = y - 0.02
        if (hit.normal[1] < MIN_NORMAL_Y) continue
        pos[0] = px; pos[1] = y + STAND_LIFT; pos[2] = pz   // nâng nhẹ: trên dốc đáy capsule cắt mặt nghiêng cạnh chân
        if (!world.canStand(pos)) continue
        list.push(xs.length)
        xs.push(px); ys.push(y); zs.push(pz); colKeys.push(NavGrid.colKey(ix, iz))
      }
      colNodes[ix * nz + iz] = list
    }
  }
  const n = xs.length

  // 2. cạnh
  const adj: NavEdge[][] = Array.from({ length: n }, () => [])
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      for (const a of colNodes[ix * nz + iz]!) {
        for (let k = 0; k < 8; k++) {
          const jx = ix + Math.round(DIRS8[k]![0] * (k % 2 === 1 ? Math.SQRT2 : 1)), jz = iz + Math.round(DIRS8[k]![1] * (k % 2 === 1 ? Math.SQRT2 : 1))
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue
          const h = k % 2 === 1 ? Math.SQRT2 : 1
          const ax = xs[a]!, ay = ys[a]!, az = zs[a]!
          let walkTo = -1
          for (const b of colNodes[jx * nz + jz]!) {
            const dy = ys[b]! - ay
            const bx = xs[b]!, bz = zs[b]!
            // đi bộ (cả lên dốc nhẹ và xuống dốc). Cạnh đi bộ đối xứng: chỉ kiểm 4 hướng đầu rồi thêm cả hai chiều (nửa số truy vấn)
            if (Math.abs(dy) <= WALK_MAX_SLOPE * h) {
              if (k >= 4) {
                if (adj[a]!.some(e => e.to === b && e.kind === EdgeKind.Walk)) { walkTo = b; continue }   // đã thêm từ phía b
              } else if (walkable(world, ax, ay, az, bx, ys[b]!, bz, o, d)) {
                const len = Math.hypot(h, dy)
                adj[a]!.push({ to: b, cost: len * (dy < -0.3 ? 1.1 : 1), kind: EdgeKind.Walk })
                adj[b]!.push({ to: a, cost: len * (dy > 0.3 ? 1.1 : 1), kind: EdgeKind.Walk })
                walkTo = b
                continue
              }
            }
            // nhảy lên gờ/hộp thấp (chỉ 4 hướng chính để khỏi xuyên góc)
            if (k % 2 === 0 && dy > 0.3 && dy <= JUMP_MAX_DY && sweepClear(world, ax, ay + dy, az, bx, ys[b]!, bz, o, d)) {
              // chỗ bước lên: thẳng đứng từ a lên độ cao b phải thoáng
              o[0] = ax; o[1] = ay + 0.2; o[2] = az; d[0] = 0; d[1] = 1; d[2] = 0
              if (!world.castSphere(o, d, dy + 0.4, SWEEP_R)) {
                adj[a]!.push({ to: b, cost: h + 1.5 + dy, kind: EdgeKind.Jump })
              }
              continue
            }
          }
          // qua gờ thấp (vd. khe tường có lớp bê tông cao 0,5m): nhảy qua sang node cùng tầng
          if (k % 2 === 0) {
            for (const b of colNodes[jx * nz + jz]!) {
              const dy = ys[b]! - ay
              if (Math.abs(dy) > 0.3 || adj[a]!.some(e => e.to === b)) continue
              if (!sweepClear(world, ax, ay + 1.2, az, xs[b]!, ys[b]! + 1.2, zs[b]!, o, d, 0)) continue
              // gờ ở giữa phải thấp (≤ JUMP_MAX_DY)
              o[0] = (ax + xs[b]!) / 2; o[1] = ay + 1.6; o[2] = (az + zs[b]!) / 2
              const hit = world.castRay(o, DOWN, 3)
              if (hit && o[1]! - hit.dist - ay <= JUMP_MAX_DY && o[1]! - hit.dist - ay > 0.2) {
                adj[a]!.push({ to: b, cost: h + 2, kind: EdgeKind.Jump })
              }
            }
          }
          // nhảy xuống một chiều từ mép: node thấp hơn nhiều ở cột kế bên, đường ra khỏi mép và cột rơi thoáng
          for (const b of colNodes[jx * nz + jz]!) {
            const drop = ay - ys[b]!
            if (drop <= WALK_MAX_SLOPE * h + 0.05 || drop > DROP_MAX) continue
            if (walkTo >= 0 && colNodes[jx * nz + jz]!.includes(walkTo) && Math.abs(ys[walkTo]! - ay) < 1) continue
            if (adj[a]!.some(e => e.to === b)) continue
            const bx = xs[b]!, bz = zs[b]!
            if (!sweepClear(world, ax, ay, az, bx, ay, bz, o, d)) continue          // ra khỏi mép
            o[0] = bx; o[1] = ay + 0.5; o[2] = bz
            const down = world.castRay(o, DOWN, drop + 1)
            if (!down || Math.abs(o[1]! - down.dist - ys[b]!) > 0.1) continue         // cột rơi thoáng, đáp đúng node b
            adj[a]!.push({ to: b, cost: h + 1.5 + drop, kind: EdgeKind.Drop })
          }
        }
      }
    }
  }

  // 3. điểm núp + vùng
  const cover: number[] = new Array(n).fill(0)
  const zones: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    zones[i] = zoneOf(xs[i]!, ys[i]!, zs[i]!)
    let mask = 0
    for (let k = 0; k < 8; k++) {
      o[0] = xs[i]!; o[1] = ys[i]! + COVER_RAY_H; o[2] = zs[i]!
      d[0] = DIRS8[k]![0]; d[1] = 0; d[2] = DIRS8[k]![1]
      if (world.castRay(o, d, COVER_RAY_LEN)) mask |= 1 << k
    }
    cover[i] = mask
  }
  addZombieEdges({ world, xs, ys, zs, adj, colNodes, minX, minZ, nx, nz, gravity: cfg.gravity })
  return new NavGrid(world, xs, ys, zs, cover, zones, adj, minX, minZ, colKeys)
}
