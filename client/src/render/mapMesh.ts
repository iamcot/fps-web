import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { resolveBoxLook, type LoadedMap, type MapRamp } from '@fps/shared'

function makeGridTexture(): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'   // trung tính: màu thật do material.color nhân vào
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#999999'
  ctx.lineWidth = 2
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

const TILE = 1.0  // metres per texture tile

const RAMP_COLOR = 0x7a8a7a   // màu dốc (giữ như ô kẻ xanh xám cũ)
const CRATE_MODEL = '/models/crate.glb'

function makeMat(tex: THREE.Texture, ru: number, rv: number, color: THREE.ColorRepresentation = 0xffffff): THREE.MeshLambertMaterial {
  const t = tex.clone()
  t.needsUpdate = true
  t.repeat.set(ru, rv)
  return new THREE.MeshLambertMaterial({ map: t, color })
}

// Ảnh vật liệu (client/public/textures/<tên>.jpg): nạp một lần mỗi tên; chưa nạp xong thì material tự cập nhật khi ảnh về
const imageLoader = new THREE.TextureLoader()
const images = new Map<string, THREE.Texture>()
function getImage(name: string): THREE.Texture {
  let t = images.get(name)
  if (!t) {
    t = imageLoader.load(`/textures/${name}.jpg`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    images.set(name, t)
  }
  return t
}

// Quaternion rotating local X-axis to align with unit direction (dx, dy, dz)
function dirToQuatX(dx: number, dy: number, dz: number): THREE.Quaternion {
  const sinTheta = Math.sqrt(dy * dy + dz * dz)
  const cosTheta = dx
  if (sinTheta < 1e-9) {
    return cosTheta > 0
      ? new THREE.Quaternion()
      : new THREE.Quaternion(0, 1, 0, 0)
  }
  const half = Math.atan2(sinTheta, cosTheta) / 2
  const f = Math.sin(half) / sinTheta
  return new THREE.Quaternion(0, -dz * f, dy * f, Math.cos(half))
}

function rampLen(r: MapRamp): number {
  const dx = r.to[0] - r.from[0]
  const dy = r.to[1] - r.from[1]
  const dz = r.to[2] - r.from[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export function buildMapMesh(map: LoadedMap): THREE.Group {
  const group = new THREE.Group()
  const baseTex = makeGridTexture()

  const crateSlots: THREE.Mesh[] = []   // hộp tạm của các thùng, thay bằng model khi load xong (va chạm/đạn luôn theo hộp của map)
  for (const box of map.boxes) {
    const [sx, sy, sz] = box.size
    const look = resolveBoxLook(box)
    const geo = new THREE.BoxGeometry(sx, sy, sz)
    // Mỗi mặt một material để ảnh lặp theo đúng kích thước mặt đó (thứ tự: +x −x +y −y +z −z)
    const src = look.file ? getImage(look.file) : baseTex
    const tile = look.file ? look.tileM : TILE
    const faces: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]
    const mats = faces.map(([w, h]) => makeMat(src, w / tile, h / tile, look.color ?? 0xffffff))
    const mesh = new THREE.Mesh(geo, mats)
    mesh.position.set(box.pos[0], box.pos[1], box.pos[2])
    mesh.receiveShadow = true
    mesh.castShadow = true
    group.add(mesh)
    if (look.crate) crateSlots.push(mesh)
  }
  if (crateSlots.length) {
    new GLTFLoader().loadAsync(CRATE_MODEL).then(gltf => {
      gltf.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true } })
      for (const slot of crateSlots) {
        const crate = gltf.scene.clone(true)   // model là khối 1×1×1 tâm ở gốc: scale theo kích thước box
        crate.position.copy(slot.position)
        const p = (slot.geometry as THREE.BoxGeometry).parameters
        crate.scale.set(p.width, p.height, p.depth)
        group.add(crate)
        group.remove(slot)
        slot.geometry.dispose()
      }
    }).catch(err => console.warn(`mapMesh: cannot load ${CRATE_MODEL}, giữ hộp thay thế`, err))
  }

  for (const ramp of map.ramps) {
    const len = rampLen(ramp)
    const thick = 0.3
    const geo = new THREE.BoxGeometry(len, thick, ramp.width)
    const mat = makeMat(baseTex, len / TILE, ramp.width / TILE, RAMP_COLOR)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(
      (ramp.from[0] + ramp.to[0]) / 2,
      (ramp.from[1] + ramp.to[1]) / 2,
      (ramp.from[2] + ramp.to[2]) / 2,
    )
    const dx = ramp.to[0] - ramp.from[0]
    const dy = ramp.to[1] - ramp.from[1]
    const dz = ramp.to[2] - ramp.from[2]
    mesh.quaternion.copy(dirToQuatX(dx / len, dy / len, dz / len))
    mesh.receiveShadow = true
    mesh.castShadow = true
    group.add(mesh)
  }

  return group
}
