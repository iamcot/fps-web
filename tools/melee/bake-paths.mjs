// Bake cung quét từ clip (plan 19 mục 4.4). Chạy: node --import tsx tools/melee/bake-paths.mjs
// Mỗi chiêu có clip: dựng bộ xương nhân vật (cop.glb, bỏ texture) ở tư thế T, phát clip thân trên co giãn đúng như client
// (clipTimeAt), lấy mẫu 60 Hz cổ tay phải và mũi vũ khí trong hệ nhân vật (gốc ở chân, nhìn -Z), tự dò cửa sổ đánh.
// Xuất shared/src/meleePaths.json. Mũi vũ khí tạm tính = cổ tay + trục ngón tay × độ dài vũ khí (BLADE_LEN) cho tới khi có điểm neo grip_r / hit_tip.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MELEE_SETS, moveDurationMs } from '@fps/shared'

// client là gói CJS: tsx nạp .ts qua interop nên lấy export qua namespace
const mc = await import('../../client/src/render/meleeClips.ts')
const { MOVE_CLIP, clipTimeAt } = mc.MOVE_CLIP ? mc : mc.default

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TICK = 1 / 60
const SPEED_MIN = 3        // m/s: mũi vũ khí nhanh hơn mức này = đang quét
const PEAK_FRAC = 0.5      // đồng thời phải đạt nửa tốc độ đỉnh của chiêu (clip bị nén nên vẫn còn nhiều đoạn > 3 m/s ngoài nhát đánh)
const GAP_TICKS = 2        // khe ngắn hơn thế thì gộp hai cửa sổ
const BLADE_LEN = { knife: 0.3, machete: 0.6, hammer: 1.2, spear: 2.0, staff: 1.7 }
const mm = v => Math.round(v * 1000)

// glb → bỏ ảnh / texture để GLTFLoader chạy được trong Node
function loadSkeleton(file) {
  const b = fs.readFileSync(file)
  const jlen = b.readUInt32LE(12)
  const json = JSON.parse(b.subarray(20, 20 + jlen).toString('utf8'))
  const binStart = 20 + jlen + 8
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jlen))
  delete json.images; delete json.textures; delete json.samplers
  for (const m of json.materials ?? []) { delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture } }
  const text = Buffer.from(JSON.stringify(json)); const pad = (4 - (text.length % 4)) % 4
  const jb = Buffer.concat([text, Buffer.alloc(pad, 0x20)])
  const bp = (4 - (bin.length % 4)) % 4
  const body = Buffer.concat([bin, Buffer.alloc(bp)])
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + body.length, 8)
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jb.length, 0); jh.write('JSON', 4)
  const bh = Buffer.alloc(8); bh.writeUInt32LE(body.length, 0); bh.write('BIN\0', 4)
  const all = Buffer.concat([head, jh, jb, bh, body])
  return new Promise((res, rej) => new GLTFLoader().parse(all.buffer.slice(all.byteOffset, all.byteOffset + all.length), '', g => res(g.scene), rej))
}

const clipJson = JSON.parse(fs.readFileSync(path.join(root, 'client/public/anims/combat.json'), 'utf8'))
const clipHash = name => crypto.createHash('sha1').update(JSON.stringify(clipJson[name])).digest('hex').slice(0, 12)
const meleeClip = name => {
  const d = clipJson[name]
  const tracks = Object.entries(d.tracks).map(([bone, k]) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, k.t, k.q))
  return { name, clip: new THREE.AnimationClip(name, d.dur, tracks), win0: d.win[0], hit: d.hit, win1: d.win[1] }
}

const scene = await loadSkeleton(path.join(root, 'client/public/models/characters/cop.glb'))
const model = new THREE.Group(); model.add(scene); model.rotation.y = Math.PI   // như SkelCharacter: nhìn -Z
const world = new THREE.Group(); world.add(model)
const mixer = new THREE.AnimationMixer(scene)
const hand = scene.getObjectByName('mixamorigRightHand')
if (!hand) throw new Error('cop.glb thiếu mixamorigRightHand')
world.updateMatrixWorld(true)
const footY = Math.min(...(() => { const ys = []; scene.traverse(o => { if (o.isBone) ys.push(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y) }); return ys })())
const fingerAxis = new THREE.Vector3(0, 1, 0)   // Mixamo: +Y của xương bàn tay chỉ về phía ngón
const wp = new THREE.Vector3(), tp = new THREE.Vector3()

// Mốc `hit` của mỗi clip: giây mũi vũ khí (cổ tay + 0,5 m theo ngón) quơ nhanh nhất trong cửa sổ chuyển động. Chính xác hơn mốc tool convert-clips
// ước từ tốc độ xoay xương; ghi ngược vào combat.json để client co giãn clip theo cùng mốc với bản bake.
{
  let changed = false
  const t0 = new THREE.Vector3(), t1 = new THREE.Vector3()
  for (const name of Object.keys(clipJson)) {
    const d = clipJson[name]; const c = meleeClip(name)
    const act = mixer.clipAction(c.clip); act.play(); act.timeScale = 0
    let best = -1, bt = d.hit, prev = null
    for (let t = d.win[0]; t <= d.win[1] + 1e-6; t += TICK) {
      act.time = t; mixer.update(0); world.updateMatrixWorld(true)
      t1.copy(fingerAxis).transformDirection(hand.matrixWorld).multiplyScalar(0.5).add(wp.setFromMatrixPosition(hand.matrixWorld))
      if (prev) { const v = t1.distanceTo(prev); if (v > best) { best = v; bt = t } }
      prev = (prev ?? new THREE.Vector3()).copy(t1)
    }
    act.stop(); mixer.uncacheAction(c.clip)
    bt = Math.round(bt * 1e4) / 1e4
    if (bt !== d.hit) { console.log('hit', name, d.hit, '→', bt); d.hit = bt; changed = true }
  }
  if (changed) fs.writeFileSync(path.join(root, 'client/public/anims/combat.json'), JSON.stringify(clipJson))
}

const out = {}
for (const [setKey, set] of Object.entries(MELEE_SETS)) {
  const len = BLADE_LEN[setKey]
  for (const m of set.moves) {
    const cn = MOVE_CLIP[m.key]
    if (!cn || !clipJson[cn]) { console.warn('bỏ qua', m.key, '(không có clip)'); continue }
    const c = meleeClip(cn)
    const act = mixer.clipAction(c.clip); act.play(); act.timeScale = 0
    const total = moveDurationMs(m)
    const ticks = Math.ceil(total / 1000 / TICK) + 1
    const wrist = [], tip = [], speed = []
    for (let i = 0; i < ticks; i++) {
      act.time = clipTimeAt(c, i * TICK * 1000, m.windupMs, total)
      mixer.update(0); world.updateMatrixWorld(true)
      wp.setFromMatrixPosition(hand.matrixWorld)
      tp.copy(fingerAxis).transformDirection(hand.matrixWorld).multiplyScalar(len).add(wp)
      wrist.push(mm(wp.x), mm(wp.y - footY), mm(wp.z)); tip.push(mm(tp.x), mm(tp.y - footY), mm(tp.z))
      if (i > 0) { const a = i * 3; speed.push(Math.hypot(tip[a] - tip[a - 3], tip[a + 1] - tip[a - 2], tip[a + 2] - tip[a - 1]) / 1000 / TICK) } else speed.push(0)
    }
    act.stop(); mixer.uncacheAction(c.clip)
    // cửa sổ đánh: tốc độ mũi > SPEED_MIN, gộp khe ngắn
    let wins = []
    const thr = Math.max(SPEED_MIN, PEAK_FRAC * Math.max(...speed))
    for (let i = 0; i < ticks; i++) if (speed[i] > thr) { const last = wins[wins.length - 1]; if (last && i - last[1] <= GAP_TICKS + 1) last[1] = i; else wins.push([i, i]) }
    wins = wins.map(([a, b]) => [a, b + 1])
    // chiêu có `hitCount` nhát thì giữ đúng chừng đó cửa sổ nhanh nhất (phần còn lại là gồng / thu tay)
    const peak = w => Math.max(...speed.slice(w[0], w[1]))
    wins = wins.sort((x, y) => peak(y) - peak(x)).slice(0, m.hitCount).sort((x, y) => x[0] - y[0])
    let maxReach = 0
    for (let i = 0; i < ticks; i++) maxReach = Math.max(maxReach, Math.hypot(tip[i * 3], tip[i * 3 + 2]) / 1000)
    out[m.key] = { clip: cn, clipHash: clipHash(cn), tickCount: ticks, windows: wins, windupMs: m.windupMs, activeMs: wins.length ? Math.round((wins[wins.length - 1][1] - wins[0][0]) * TICK * 1000) : 0, recoveryMs: m.recoverMs, maxReach: Math.round(maxReach * 1000) / 1000, wrist, tip }
    console.log(m.key.padEnd(14), cn.padEnd(10), 'ticks', String(ticks).padStart(3), 'cửa sổ', JSON.stringify(wins), 'tầm xa nhất', maxReach.toFixed(2), 'm (cung server', Math.max(...m.arc.reach), ')')
  }
}
const dest = path.join(root, 'shared/src/meleePaths.json')
fs.writeFileSync(dest, JSON.stringify(out))
console.log('→', path.relative(root, dest), (fs.statSync(dest).size / 1024).toFixed(0) + ' KB')
