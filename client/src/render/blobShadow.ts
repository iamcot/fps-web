import * as THREE from 'three'

// Bóng tròn giả dưới chân nhân vật (nhân vật không đổ bóng thật cho nhẹ). Texture, geometry, material dùng chung mọi người.
const RADIUS = 0.5
const OPACITY = 0.45
let tex: THREE.CanvasTexture | null = null
let geo: THREE.CircleGeometry | null = null
let mat: THREE.MeshBasicMaterial | null = null

export function makeBlobShadow(): THREE.Mesh {
  if (!tex) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(0,0,0,1)')
    grad.addColorStop(0.5, 'rgba(0,0,0,0.6)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    tex = new THREE.CanvasTexture(c)
    geo = new THREE.CircleGeometry(RADIUS, 20)
    mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: OPACITY, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, fog: false,
    })
  }
  const m = new THREE.Mesh(geo!, mat!)
  m.rotation.x = -Math.PI / 2   // nằm phẳng trên sàn
  m.position.y = 0.02           // gốc rig ở chân
  m.renderOrder = 1
  return m
}
