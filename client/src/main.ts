import * as THREE from 'three'
import {
  loadMap, DT, Btn, WEAPONS, RESPAWN_DELAY_MS, makeWeaponState, makeRecoilState,
  stepWeaponCmd, shotSpread, spreadFor, computeShot, recoverRecoil,
} from '@fps/shared'
import type { MapFile } from '@fps/shared'
import { createWorld } from '@fps/shared/physics/world'
import { buildMapMesh } from './render/mapMesh'
import { initInput, applyCameraRotation, isLocked, yaw, pitch, setLook } from './input'
import { startLoop, initGameState, defaultMovement, setNetHooks, currentState, setWantedWeapon, setDead, setMatchPhase } from './loop'
import { initDebugOverlay } from './debug'
import { showLobby, type Session } from './net/lobby'
import { startPing, type PingStats } from './net/ping'
import { clock } from './net/clock'
import { attachSnapshots, type SnapshotStore } from './net/snapshots'
import { createPlayersRenderer } from './render/players'
import { Interpolator, InterpDelay, interp } from './net/interpolation'
import { reconcileWeapon } from './net/weaponSync'
import { Prediction } from './net/prediction'
import { createGhosts } from './render/ghosts'
import { createTracers } from './render/tracers'
import { createDebugShots } from './render/debugShots'
import { createKillfeed, createDeathScreen, createHurtIndicator } from './hudNet'
import { createMatchHud, createScoreboard } from './hudMatch'
import { MsgType, MatchPhase } from '@fps/shared'
import { initTuningPanel } from './tuning'
import { createViewmodel } from './render/viewmodel'
import { createTargets, updateTargets, flashTarget } from './targets'
import { fireHitscan } from './hitscan'
import { initHUD } from './hud'
import {
  initAudio, updateListener, playShot, playDry, playDraw, startReload, cancelReload,
  playHit, playHurt, setHealthForAudio, playShotOther, playFootstep, playLanding, StepTracker, FOOTSTEPS,
} from './audio'
import { initAudioTuning } from './audio/tuning'
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

initAudio(() => playDraw(ws.current))   // vào màn chơi: súng mặc định cũng phát tiếng rút súng
initAudioTuning()

// ── Logic súng (shared) ───────────────────────────────────────────────────────
let playerId = 1   // offline = 1; online = id server cấp (seed spread phải trùng server)
const steps = new StepTracker()
const ws  = makeWeaponState()
const rec = makeRecoilState()
const shotDir: [number, number, number] = [0, 0, 0]
const eyeTmp:  [number, number, number] = [0, 0, 0]
let simMs = 0
let wantedWeapon = 0
let lastBtns = 0
const MOVE_KEYS = Btn.Forward | Btn.Back | Btn.Left | Btn.Right
// Tốc độ dùng cho spread: nhả hết phím di chuyển thì tính là đứng yên dù quán tính còn
// ~0.3s (ma sát giảm dần theo hàm mũ); đang trượt vẫn tính là di chuyển
const spreadSpeed = (speed: number, slideTimer: number) =>
  (lastBtns & MOVE_KEYS) || slideTimer > 0 ? speed : 0

document.addEventListener('keydown', (e) => {
  const m = /^Digit([1-4])$/.exec(e.code)
  if (m) {
    const id = Number(m[1]) - 1
    if (id !== wantedWeapon && vm.switchWeapon(id)) {
      wantedWeapon = id   // logic súng đổi ở tick kế tiếp qua cmd.weapon
      setWantedWeapon(id)
      cancelReload()   // đổi súng giữa lúc nạp: im ngay
      playDraw(id)
    }
  }
  if (e.code === 'F4' && debugLines) { debugLines.visible = !debugLines.visible; e.preventDefault() }
})

// ── Physics world + game loop ─────────────────────────────────────────────────
const cfg = { ...defaultMovement }
const spawn = loadedMap.spawns.A[0] ?? { pos: [0, 2, 0] as [number,number,number], yaw: 0 }

// Mạng: vào phòng qua màn hình lobby; chơi offline nếu bỏ qua. Ping chạy sau khi vào phòng
const netStats: PingStats = { rttMs: 0, outOfOrder: 0 }
let snapStore: SnapshotStore | null = null
let sessionRef: Session | null = null
const playersRenderer = createPlayersRenderer(scene, {
  teamOf: id => sessionRef?.teams.get(id),
  nameOf: id => sessionRef?.names.get(id),
  myTeam: () => sessionRef?.teams.get(sessionRef.yourId),
})
const interpolator = new Interpolator()
const interpDelay = new InterpDelay()
let prediction: Prediction | null = null
let hudRef: ReturnType<typeof initHUD> | null = null
const ghosts = createGhosts(scene)
const tracers = createTracers(scene)
const debugShots = createDebugShots(scene)
const killfeed = createKillfeed()
const deathScreen = createDeathScreen()
const hurtIndicator = createHurtIndicator()
const matchHud = createMatchHud()
const scoreboard = createScoreboard()
let tabHeld = false
document.addEventListener('keydown', e => { if (e.code === 'Tab') { e.preventDefault(); tabHeld = true } })
document.addEventListener('keyup', e => { if (e.code === 'Tab') { e.preventDefault(); tabHeld = false } })
window.addEventListener('blur', () => { tabHeld = false })
let lastHp = 100
const sessionP = showLobby()
sessionP.then(session => {
  if (!session) return
  playerId = session.yourId
  sessionRef = session
  startPing(session.transport, netStats)
  session.transport.onMessage(msg => {
    if (msg.t === MsgType.HitConfirm) {
      hudRef?.showHitmarker(msg.headshot)   // chỉ hiện khi server xác nhận
      playHit(msg.headshot ? 'head' : 'body')
    } else if (msg.t === MsgType.ShotFx) {
      tracers.add(msg.origin, msg.dir, msg.dist)
      playShotOther(msg.weapon, msg.origin)
    } else if (msg.t === MsgType.DebugShot) {
      debugShots.add(msg.origin, msg.dir, msg.boxes)
    } else if (msg.t === MsgType.Kill) {
      const name = (id: number) => session.names.get(id) ?? `#${id}`
      const me = session.yourId
      killfeed.add(name(msg.killerId), WEAPONS[msg.weapon]?.name ?? '?', name(msg.victimId), msg.headshot,
        msg.killerId === me, msg.victimId === me)
      if (msg.killerId === me && msg.victimId !== me) playHit(msg.headshot ? 'killHead' : 'kill')
      if (msg.victimId === me) {
        setDead(true)
        deathScreen.show(name(msg.killerId), RESPAWN_DELAY_MS - clock.oneWayMs)
      }
    } else if (msg.t === MsgType.Respawn && msg.id === session.yourId) {
      // Hồi sinh: teleport (không làm mượt), đạn đầy, nhìn theo hướng spawn
      setDead(false)
      deathScreen.hide()
      prediction?.teleport({
        pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [0, 0, 0], yaw: msg.yaw, pitch: 0,
        grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0,
      })
      setLook(msg.yaw, 0)
      for (const w of WEAPONS) ws.ammo[w.id] = w.magSize
      ws.reloadEndMs = 0; ws.nextFireMs = 0; ws.triggerHeld = false
      cancelReload()
    } else if (msg.t === MsgType.MatchState) {
      matchHud.setMatch(msg.phase, msg.phaseEndsAt, msg.scoreA, msg.scoreB, msg.sideSwapped)
      setMatchPhase(msg.phase)
    } else if (msg.t === MsgType.Scoreboard) {
      scoreboard.setRows(msg.rows, session.yourId)
    } else if (msg.t === MsgType.Hurt) {
      const dx = msg.origin[0] - camera.position.x, dy = msg.origin[1] - camera.position.y, dz = msg.origin[2] - camera.position.z
      hurtIndicator.show(dx, dz, yaw)
      playHurt(dx, dy, dz)
    }
  })
  // F7: server gửi DebugShot (tia + hitbox đã tua) cho mỗi phát của mình
  let debugOn = false
  document.addEventListener('keydown', e => {
    if (e.code !== 'F7') return
    e.preventDefault()
    debugOn = !debugOn
    session.transport.send({ t: MsgType.SetDebug, shots: debugOn })
  })
  snapStore = attachSnapshots(session.transport, session.yourId, s => {
    interpolator.push(s.serverTime, s.players, s.yourId)
    if (s.hp !== lastHp) { lastHp = s.hp; hudRef?.setHealth(s.hp); setHealthForAudio(s.hp) }
    if (s.self) prediction?.onSnapshot(s.ack, s.self)
    if (s.wpn && prediction) reconcileWeapon(ws, s.wpn, prediction.pending)
  })
  session.transport.onClose(() => {
    setNetHooks(null); snapStore = null; prediction = null
    setDead(false); deathScreen.hide(); setMatchPhase(MatchPhase.Playing); matchHud.clear(); sessionRef = null
    interpolator.push(0, []); playersRenderer.clear(); ghosts.clear()
  })
})
const updateDebug = initDebugOverlay(netStats, () => snapStore, () => prediction)
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

  // Online: prediction giữ state; loop chỉ gửi cmd + chạy dự đoán
  sessionP.then(session => {
    if (!session) return
    const pred = new Prediction(world, cfg, currentState())
    prediction = pred
    setNetHooks({
      current: () => pred.predicted,
      step: cmd => {
        if (cmd.buttons & Btn.Fire) cmd.fireRenderTime = interp.currentRenderTime   // 4.3: server tua hitbox về đây
        session.transport.send({ t: MsgType.Inputs, cmds: [cmd] })
        return pred.step(cmd)
      },
      visualOffset: () => pred.decayOffset(),
    })
  })

  // Bia + HUD
  const targets = createTargets(scene)
  const hud     = initHUD(scene)
  hudRef = hud

  let eyeY   = cfg.eyeStand
  let lastMs = performance.now()

  hud.setHealth(100)

  startLoop(world, cfg, state => {
    const now  = performance.now()
    const dt   = (now - lastMs) / 1000
    const fps  = 1 / dt
    lastMs     = now

    const targetEye = state.crouching ? cfg.eyeCrouch : cfg.eyeStand
    eyeY += (targetEye - eyeY) * Math.min(1, 10 / 60)

    camera.position.set(state.pos[0], state.pos[1] + eyeY, state.pos[2])
    applyCameraRotation(camera)
    // Recoil chỉ cộng vào camera hiển thị, không đụng yaw/pitch của chuột
    camera.rotation.y += rec.yaw
    camera.rotation.x += rec.pitch
    updateListener(camera.position.x, camera.position.y, camera.position.z, camera.rotation.y, camera.rotation.x)

    const def   = WEAPONS[ws.current]!
    const speed = Math.hypot(state.vel[0], state.vel[2])
    vm.setMotion(speed, state.grounded)
    vm.setReload(ws.reloadEndMs > 0 ? 1 - (ws.reloadEndMs - simMs) / def.reloadMs : -1)
    hud.setSpread(spreadFor(def, state.grounded, spreadSpeed(speed, state.slideTimer), state.crouching), dt * 1000)
    hud.setAmmo(def.name, ws.ammo[def.id]!, def.magSize, ws.reloadEndMs > 0)

    updateTargets(targets, dt)
    vm.update(dt)
    hud.tick(dt * 1000)

    renderer.clear()
    renderer.render(scene, camera)
    renderer.clearDepth()
    renderer.render(vm.scene, vm.cam)

    // Người khác: vẽ trễ (INTERP_DELAY_MS + trễ một chiều) bằng nội suy; chưa vào phòng thì danh sách rỗng
    if (snapStore) ghosts.update(snapStore.players, snapStore.yourId)
    if (snapStore) playersRenderer.update(interpolator.sample(clock.serverNow(), interpDelay.update(clock.oneWayMs)))
    tracers.update(dt * 1000)
    debugShots.update(dt * 1000)
    deathScreen.tick()
    matchHud.tick(clock.serverNow())
    scoreboard.show(tabHeld || (snapStore !== null && matchHud.phase === MatchPhase.Ended))
    hurtIndicator.tick(dt * 1000)
    clock.tick()
    updateDebug(state, fps)
  }, (state, cmd, nowMs) => {
    // Mỗi tick mô phỏng: logic súng + bước chân
    simMs = nowMs
    lastBtns = cmd.buttons
    const def    = WEAPONS[ws.current]!
    const speed  = Math.hypot(state.vel[0], state.vel[2])

    const ev = stepWeaponCmd(ws, cmd)
    if (ev === 'fired') {
      computeShot(shotDir, rec, def, playerId, ws.shotSeq - 1, cmd.yaw, cmd.pitch, shotSpread(def, state, cmd.buttons))
      vm.onFire()
      hud.kickSpread(def.recoilPitchDeg * 2)   // tâm giãn theo độ giật của súng (hiển thị)
      playShot(def.id, ws.ammo[def.id]!)

      eyeTmp[0] = state.pos[0]; eyeTmp[1] = state.pos[1] + eyeY; eyeTmp[2] = state.pos[2]
      const result = fireHitscan(eyeTmp, shotDir, def.range, world, cfg, targets)
      if (result?.kind === 'target') {
        flashTarget(targets[result.idx]!)
        hud.showHitmarker(result.part === 'head')
        playHit(result.part === 'head' ? 'head' : 'body')
      } else if (result?.kind === 'wall') {
        hud.addBulletHole(result.hitPos, result.normal)
      }
    } else if (ev === 'dry') {
      playDry(def.id)
      startReload(def.id, 0, def.reloadMs)   // hết đạn: cạch rồi tự nạp
    } else if (ev === 'reloadStart') {
      startReload(def.id, ws.ammo[def.id]!, def.reloadMs)
    }
    recoverRecoil(rec, def, ws, nowMs, DT)

    const stepEv = steps.update(
      state.grounded, state.vel[1], speed, state.slideTimer > 0, DT,
      FOOTSTEPS.stepDistM, FOOTSTEPS.landing.minFallSpeed, FOOTSTEPS.minSpeed,
    )
    if (stepEv === 'step') playFootstep(state.crouching)
    else if (stepEv === 'land') playLanding()
  })
})
