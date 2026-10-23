// Đổi clip Mixamo (assets/source/combat_anims/*.fbx) thành client/public/anims/combat.json
// Chạy: node tools/melee/convert-clips.mjs
// Chỉ giữ xoay thân trên (bỏ Hips và hai chân): chân do clip đi/chạy chung lo, không dính root motion.
// `win` = [giây bắt đầu, giây kết thúc] đoạn tay chuyển động, `hit` = giây tay quơ nhanh nhất; client co giãn clip sao cho `hit` rơi đúng lúc nhát đánh của chiêu.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const src = path.join(root, 'assets/source/combat_anims')
const out = path.join(root, 'client/public/anims/combat.json')
const LOWER = /^mixamorig:?(Hips|(Left|Right)(UpLeg|Leg|Foot|ToeBase|Toe_End))\./
const SKIP = new Set(['run', 'walk', 'm1_walk_back'])   // loco dùng clip có sẵn trong glb nhân vật
const ARM_BONES = ['mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigSpine1']
const PEAK_FRAC = 0.2   // đoạn chuyển động = nơi tốc độ xoay tay > 20% đỉnh

function angSpeeds(t) {
  const v = t.values, out = [0]
  for (let i = 1; i < t.times.length; i++) {
    const o0 = (i - 1) * 4, o1 = i * 4
    const dot = Math.abs(v[o0] * v[o1] + v[o0 + 1] * v[o1 + 1] + v[o0 + 2] * v[o1 + 2] + v[o0 + 3] * v[o1 + 3])
    out.push(2 * Math.acos(Math.min(1, dot)) / (t.times[i] - t.times[i - 1]))   // rad / s
  }
  return out
}
const r4 = v => Math.round(v * 1e4) / 1e4
const clips = {}
for (const f of fs.readdirSync(src).filter(f => f.endsWith('.fbx')).sort()) {
  const name = f.replace(/\.fbx$/, '')
  if (SKIP.has(name)) continue
  const b = fs.readFileSync(path.join(src, f))
  const grp = new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  const a = grp.animations[0]
  const tracks = {}
  let from = Infinity, to = 0
  const speeds = []
  let hit = 0   // giây tay quơ nhanh nhất = lúc đánh trúng
  for (const t of a.tracks) {
    if (!t.name.endsWith('.quaternion') || LOWER.test(t.name)) continue
    const bone = t.name.replace(/\.quaternion$/, '').replace('mixamorig:', 'mixamorig')
    tracks[bone] = { t: Array.from(t.times, r4), q: Array.from(t.values, r4) }
    if (ARM_BONES.includes(bone)) speeds.push({ t: t.times, s: angSpeeds(t) })
  }
  {
    const peak = Math.max(...speeds.flatMap(x => x.s))
    let best = -1
    for (const x of speeds) for (let i = 1; i < x.t.length; i++) if (x.s[i] > best) { best = x.s[i]; hit = x.t[i] }
    for (const x of speeds) for (let i = 1; i < x.t.length; i++) if (x.s[i] > peak * PEAK_FRAC) { from = Math.min(from, x.t[i - 1]); to = Math.max(to, x.t[i]) }
  }
  if (!isFinite(from)) { from = 0; to = a.duration }
  clips[name] = { dur: r4(a.duration), win: [r4(from), r4(to)], hit: r4(hit), tracks }
  console.log(name.padEnd(14), 'dur', a.duration.toFixed(2), 'win', from.toFixed(2), to.toFixed(2), 'hit', hit.toFixed(2), 'tracks', Object.keys(tracks).length)
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(clips))
console.log('→', path.relative(root, out), (fs.statSync(out).size / 1024).toFixed(0) + ' KB')
