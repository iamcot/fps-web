// Công cụ một lần (không thuộc build của game): chạy trong thư mục tạm đã 'npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp'
// rồi 'node build-melee.mjs'. Kết quả: client/public/models/{hammer,machete,spear,staff}.glb (plan 19 P6).
// Chuẩn hoá model vũ khí cận chiến (plan 19 mục 7): gốc tại điểm nắm tay phải, mũi/đầu hướng −Z, Y lên, kích thước thật,
// thêm node hand_r / hand_l / hit_base / hit_tip, texture ≤1024 webp.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { transformMesh, textureCompress, prune, dedup, weld } from '@gltf-transform/functions'
import sharp from 'sharp'
const SRC = '/home/user/fps-web/assets/source/melee_glb/', OUT = '/home/user/fps-web/client/public/models/'
// basis: ảnh của trục x, y, z nguồn trong hệ đích. along: trục dài nguồn ('x'|'y'), grip/l/base/tip: toạ độ dọc trục dài (đơn vị nguồn)
const W = {
  hammer:  { src: 'frostbite_axe.glb',     basis: [[0, 1, 0], [0, 0, -1], [-1, 0, 0]],  along: 1, len: 1.1, r: -0.42, l: -0.78, base: -0.3, tip: 0.85 },
  machete: { src: 'machette_decor_5k.glb', basis: [[0, 0, -1], [0, 1, 0], [1, 0, 0]],   along: 0, len: 0.65, r: -0.38, l: null, base: -0.22, tip: 0.5 },
  spear:   { src: 'rift_spear.glb',        basis: [[0, -1, 0], [0, 0, -1], [1, 0, 0]],  along: 1, len: 2.0, r: -0.62, l: -0.1, base: 0.45, tip: 0.95 },
  staff:   { src: 'staff_A.glb',           basis: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],   along: 1, len: 1.7, r: -0.3, l: 0.3, base: -1.07, tip: 1.07 },
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
for (const [key, w] of Object.entries(W)) {
  const doc = await io.read(SRC + w.src)
  const root = doc.getRoot()
  // gom điểm để tìm tâm tay cầm (trung bình vùng quanh điểm nắm trên trục dài)
  const pts = []
  for (const n of root.listNodes()) { const m = n.getMesh(); if (!m) continue
    const wm = n.getWorldMatrix()
    for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'), v = [0, 0, 0]
      for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); pts.push(mul(wm, v)) } } }
  const lo = Math.min(...pts.map(p => p[w.along])), hi = Math.max(...pts.map(p => p[w.along]))
  const s = w.len / (hi - lo)
  const center = t => { const sl = pts.filter(p => Math.abs(p[w.along] - t) < 0.04); const c = [0, 0, 0]
    for (const p of sl) for (let k = 0; k < 3; k++) c[k] += p[k] / sl.length
    c[w.along] = t; return c }
  const g = center(w.r)
  const xf = v => { const d = [v[0] - g[0], v[1] - g[1], v[2] - g[2]]; const o = [0, 0, 0]
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) o[j] += w.basis[k][j] * d[k] * s
    return o }
  // ma trận cột (glTF): o = s·B·(v − g)
  const M = new Array(16).fill(0)
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) M[k * 4 + j] = w.basis[k][j] * s
  const t = xf([0, 0, 0]); M[12] = t[0]; M[13] = t[1]; M[14] = t[2]; M[15] = 1
  const scene = root.listScenes()[0]
  for (const n of root.listNodes()) { const m = n.getMesh(); if (!m) continue
    const wm = n.getWorldMatrix(); transformMesh(m, matMul(M, wm)) }
  for (const n of root.listNodes()) { n.setMatrix([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) }
  const add = (name, p) => { const n = doc.createNode(name).setTranslation(p.map(x => +x.toFixed(4))); scene.addChild(n); return p }
  const out = { key, hand_r: add('hand_r', xf(g)) }
  if (w.l !== null) { const c = [...g]; c[w.along] = w.l; out.hand_l = add('hand_l', xf(c)) }   // cán thẳng: tay trái cùng trục với tay phải
  out.hit_base = add('hit_base', xf(center(w.base))); out.hit_tip = add('hit_tip', xf(center(w.tip)))
  await doc.transform(dedup(), weld(), prune({ keepLeaves: true }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }))
  doc.getRoot().getAsset().generator = 'fps-web melee build (glTF-Transform)'
  await io.write(OUT + key + '.glb', doc)
  console.log(JSON.stringify(out, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v))
}
function mul(m, v) { return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]] }
function matMul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]; return o }
