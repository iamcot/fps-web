import * as THREE from 'three'
import { loadMap } from '@fps/shared'
import type { MapFile } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { buildMapMesh } from './render/mapMesh'
import { initInput, applyCameraRotation, isLocked, yaw, pitch } from './input'
import { startLoop, initGameState, defaultMovement } from './loop'
import { initDebugOverlay } from './debug'
import { initTuningPanel } from './tuning'
import { createViewmodel } from './render/viewmodel'
import { createTargets, updateTargets, flashTarget } from './targets'
import { fireHitscan } from './hitscan'
import { initHUD } from './hud'
import mapFileRaw from '@assets/maps/deathmatch.json'

const mapFile   = mapFileRaw as unknown as MapFile
const loadedMap = loadMap(mapFile)

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.autoClear = false   // manual clear để render viewmodel pass riêng
document.body.style.margin = '0'
document.body.appendChild(renderer.domElement)

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x4a6a8a)
scene.fog = new THREE.Fog(0x4a6a8a, 80, 160)

// ── Lights ────────────────────────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0x8ab4d4, 0x3a5a2a, 1.0)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffffff, 1.4)
sun.position.set(20, 40, 20)
sun.castShadow = true
sun.shadow.camera.near = 0.5
sun.shadow.camera.far = 200
sun.shadow.camera.left = -70
sun.shadow.camera.right = 70
sun.shadow.camera.top = 50
sun.shadow.camera.bottom = -50
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)

// ── Camera ────────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300)
camera.rotation.order = 'YXZ'

initInput(renderer.domElement)

// ── Map mesh ──────────────────────────────────────────────────────────────────
scene.add(buildMapMesh(loadedMap))

// ── Spawn arrows ──────────────────────────────────────────────────────────────
for (const sp of loadedMap.spawns.A) {
  const dir = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw))
  scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]), 2, 0x2266ff, 0.6, 0.4))
}
for (const sp of loadedMap.spawns.B) {
  const dir = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw))
  scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]), 2, 0xff4422, 0.6, 0.4))
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  vm.updateAspect(camera.aspect)
})

// ── Viewmodel ─────────────────────────────────────────────────────────────────
const vm = createViewmodel(window.innerWidth / window.innerHeight)

document.addEventListener('keydown', (e) => {
  if (e.code === 'Digit1') vm.switchWeapon(0)
  if (e.code === 'Digit2') vm.switchWeapon(1)
  if (e.code === 'Digit3') vm.switchWeapon(2)
  if (e.code === 'Digit4') vm.switchWeapon(3)
  if (e.code === 'F4' && debugLines) { debugLines.visible = !debugLines.visible; e.preventDefault() }
})

// ── Physics world + game loop ─────────────────────────────────────────────────
const cfg = { ...defaultMovement }
const spawn = loadedMap.spawns.A[0] ?? { pos: [0, 2, 0] as [number,number,number], yaw: 0 }

const updateDebug = initDebugOverlay()
initTuningPanel(cfg)

let debugLines: THREE.LineSegments | null = null

createWorld(loadedMap, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(world => {
  // Debug wireframe (F4)
  const { vertices, colors } = world.debugRender()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 4))
  debugLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }))
  debugLines.visible = false
  scene.add(debugLines)

  initGameState(spawn.pos, spawn.yaw)

  // Bia + HUD
  const targets = createTargets(scene)
  const hud     = initHUD(scene)

  // Vị trí mắt mới nhất (để mousedown handler dùng)
  let latestEyePos: [number, number, number] = [spawn.pos[0], spawn.pos[1] + cfg.eyeStand, spawn.pos[2]]

  renderer.domElement.addEventListener('mousedown', e => {
    if (e.button !== 0 || !isLocked()) return
    const result = fireHitscan(latestEyePos, yaw, pitch, 300, world, cfg, targets)
    if (!result) return
    if (result.kind === 'target') {
      flashTarget(targets[result.idx]!)
      hud.showHitmarker(result.part === 'head')
    } else {
      hud.addBulletHole(result.hitPos, result.normal)
    }
  })

  let eyeY   = cfg.eyeStand
  let lastMs = performance.now()

  startLoop(world, cfg, state => {
    const now  = performance.now()
    const dt   = (now - lastMs) / 1000
    const fps  = 1 / dt
    lastMs     = now

    const targetEye = state.crouching ? cfg.eyeCrouch : cfg.eyeStand
    eyeY += (targetEye - eyeY) * Math.min(1, 10 / 60)

    camera.position.set(state.pos[0], state.pos[1] + eyeY, state.pos[2])
    latestEyePos = [camera.position.x, camera.position.y, camera.position.z]
    applyCameraRotation(camera)

    updateTargets(targets, dt)
    vm.update(dt)
    hud.tick(dt * 1000)

    renderer.clear()
    renderer.render(scene, camera)
    renderer.clearDepth()
    renderer.render(vm.scene, vm.cam)

    updateDebug(state, fps)
  })
})
