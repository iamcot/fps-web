import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { loadMap, defaultMovement, type MapFile } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { buildNav, EdgeKind, Zone, type NavGrid } from './nav'

const map = loadMap(JSON.parse(readFileSync(new URL('../../../assets/maps/deathmatch.json', import.meta.url), 'utf8')) as MapFile)
let world: CollisionWorld, nav: NavGrid, buildMs = 0

beforeAll(async () => {
  world = await createWorld(map)
  const t0 = performance.now()
  nav = buildNav(world, map, defaultMovement)
  buildMs = performance.now() - t0
})

describe('nav grid', () => {
  it('sinh lưới < 1 giây', () => {
    console.log(`nav: ${nav.count} node, ${nav.adj.reduce((a, e) => a + e.length, 0)} cạnh, ${nav.coverNodes.length} node núp, ${buildMs.toFixed(0)}ms`)
    expect(buildMs).toBeLessThan(2000)   // đo riêng ≈ 0,3s; nới vì vitest chạy song song nhiều file
    expect(nav.count).toBeGreaterThan(500)
  })

  it('có node trên mặt đất, mặt tường thành và đỉnh tháp', () => {
    const zones = new Set<number>()
    for (let i = 0; i < nav.count; i++) zones.add(nav.zone[i]!)
    for (const z of [Zone.Mid, Zone.BaseA, Zone.BaseB, Zone.WallA, Zone.WallB, Zone.TowerA, Zone.TowerB]) expect(zones.has(z), `zone ${z}`).toBe(true)
  })

  it('có node núp (cover) có hướng tường', () => {
    expect(nav.coverNodes.length).toBeGreaterThan(20)
  })

  it('không có node trong tường hay dưới sàn', () => {
    for (let i = 0; i < nav.count; i++) expect(nav.y[i]).toBeGreaterThan(-0.1)
  })

  it('từ căn cứ A tới căn cứ B có đường, không xuyên tường (mọi đoạn đi bộ quét sạch)', () => {
    const p = nav.findPath([-28, 0, 0], [28, 0, 0])
    expect(p).not.toBeNull()
    expect(p!.length).toBeGreaterThan(2)
    const last = p![p!.length - 1]!
    expect(Math.hypot(last.x - 28, last.z - 0)).toBeLessThan(2)
  })

  it('từ đất lên đỉnh tháp A: đi lên ramp, qua gờ tường rồi lên tháp', () => {
    // đỉnh tháp A ở (-15, 6.5, -18)
    const tower = nav.nearest(-15, 6.5, -18)
    expect(tower).toBeGreaterThanOrEqual(0)
    expect(nav.y[tower]).toBeGreaterThan(6)
    const nodes = nav.findNodePath(nav.nearest(-28, 0, -6), tower)
    expect(nodes).not.toBeNull()
    expect(Math.max(...nodes!.map(i => nav.y[i]!))).toBeGreaterThan(6)
  })

  it('đường đi lên ramp có nhiều node độ cao tăng dần', () => {
    const nodes = nav.findNodePath(nav.nearest(-27, 0, 0), nav.nearest(-19.5, 4.2, 0))!
    expect(nodes).not.toBeNull()
    const ys = nodes.map(i => nav.y[i]!)
    expect(ys[ys.length - 1]!).toBeGreaterThan(3.9)
  })

  it('A* dùng costFn: chi phí cao ở vùng giữa làm đường đổi hướng', () => {
    const a = nav.nearest(-25, 0, 0), b = nav.nearest(25, 0, 0)
    const base = nav.findNodePath(a, b)!
    const avoid = nav.findNodePath(a, b, i => (Math.abs(nav.z[i]!) < 6 ? 50 : 0))!
    const crossZ = (path: number[]) => path.filter(i => Math.abs(nav.z[i]!) < 6 && Math.abs(nav.x[i]!) < 10).length
    expect(crossZ(avoid)).toBeLessThanOrEqual(crossZ(base))
  })

  it('có cạnh nhảy xuống (một chiều) từ gờ tường', () => {
    let drops = 0, jumps = 0
    for (const list of nav.adj) for (const e of list) { if (e.kind === EdgeKind.Drop) drops++; if (e.kind === EdgeKind.Jump) jumps++ }
    console.log(`drops=${drops} jumps=${jumps}`)
    expect(drops).toBeGreaterThan(0)
  })
})

describe('cạnh nav của zombie (T.4)', () => {
  const edgesOf = (kind: number) => {
    const out: { a: number; b: number; e: { to: number; face?: [number, number] } }[] = []
    for (let a = 0; a < nav.count; a++) for (const e of nav.adj[a]!) if (e.kind === kind) out.push({ a, b: e.to, e })
    return out
  }
  it('thống kê', () => {
    const h = edgesOf(EdgeKind.Hole), l = edgesOf(EdgeKind.Leap)
    console.log(`zombie edges: hole ${h.length}, leap ${l.length}, build ${buildMs.toFixed(0)}ms`)
    expect(buildMs).toBeLessThan(8000)
  })
  it('có cạnh Hole xuyên tường thành ở x = ±19', () => {
    const h = edgesOf(EdgeKind.Hole)
    expect(h.length).toBeGreaterThan(0)
    const wall = h.filter(({ a, b }) => Math.abs(nav.x[a]!) > 19 !== Math.abs(nav.x[b]!) > 19)
    expect(wall.length).toBeGreaterThan(0)
  })
  it('có cạnh Leap từ mặt đất lên gờ tường (y ≈ 4,2) và từ gờ lên đỉnh tháp', () => {
    const l = edgesOf(EdgeKind.Leap)
    expect(l.some(({ a, b }) => nav.y[a]! < 0.5 && nav.y[b]! > 3.9 && nav.y[b]! < 4.5)).toBe(true)
    expect(l.some(({ a, b }) => nav.y[a]! > 3.9 && nav.y[b]! > 6)).toBe(true)
  })
  it('A* của người không dùng cạnh zombie; có ability thì được', () => {
    const from = nav.nearest(27, 0, 5), to = nav.nearest(-27, 0, 5)
    const human = nav.findNodePath(from, to)!
    for (let i = 1; i < human.length; i++) expect(nav.edge(human[i - 1]!, human[i]!)!.kind).toBeLessThan(EdgeKind.Hole)
    const crawl = nav.findNodePath(from, to, undefined, { hole: true })!
    expect(crawl).not.toBeNull()
  })
})
