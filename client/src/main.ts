import * as THREE from 'three'
import {
  loadMap, DT, Btn, WEAPONS, RESPAWN_DELAY_MS, makeWeaponState, makeRecoilState,
  stepWeaponCmd, shotSpread, computeShotDirs, MAX_PELLETS, recoverRecoil,
  CATEGORY_SLOT, DEFAULT_SLOT, TEAMS, ECONOMY, ECONOMY_ELIM, MODE_LABEL, SLOT_COUNT, GRENADE, GRENADE_ID, GRENADE_SLOT, TICK_RATE, defaultLoadout, inBuyZone, loadoutWeaponIds, moveSpeedMul, throwInitial, weaponByKey,
} from '@fps/shared'
import type { MapFile } from '@fps/shared'
import { createWorld, type CollisionWorld } from '@fps/shared/physics/world'
import { buildMapMesh } from './render/mapMesh'
import { initInput, setOverlayDim, applyCameraRotation, isLocked, yaw, pitch, setLook, sampleButtons, setSensScale, consumeWheel } from './input'
import { createScope } from './scope'
import { createSky, SKY_HORIZON } from './render/sky'
import { startLoop, initGameState, defaultMovement, setNetHooks, currentState, setWantedWeapon, wantedWeapon, setSpeedMul, setDead, setMatchPhase } from './loop'
import { initDebugOverlay } from './debug'
import { showLobby, BACK_KEY, type Session } from './net/lobby'
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
import { createKillfeed, createDeathScreen, createHurtIndicator, createBountyBanner, createSpectateLabel } from './hudNet'
import { createShop } from './shop'
import { createTopButtons, createConfirmPrompt, createToast, createLeaveButton, createRoomLabel, createCommandBox } from './hudButtons'
import { createSpectator, type SpecCandidate } from './spectate'
import { createMatchHud, createScoreboard } from './hudMatch'
import { MsgType, MatchPhase, NetFlag, type TeamId } from '@fps/shared'
import { initTuningPanel } from './tuning'
import { createViewmodel } from './render/viewmodel'
import { createPoseEditor } from './render/poseEditor'
import { createBloodFx } from './render/bloodFx'
import { createGrenades } from './render/grenades'
import { createGrenadeWarning } from './hudGrenadeWarn'
import { createGrenadeTrajectory } from './render/grenadeTrajectory'
import { createExplosionFx } from './render/explosionFx'
import { createTargets, updateTargets, flashTarget } from './targets'
import { fireHitscan } from './hitscan'
import { initHUD } from './hud'
import {
  initAudio, updateListener, playShot, playDry, playDraw, startReload, cancelReload,
  playHit, playHurt, setHealthForAudio, playShotOther, playFootstep, playLanding, StepTracker, FOOTSTEPS, playBuyOk, playBuyFail,
  playPin, playSpoon, playThrowSwish, playBounce, playExplode, playRoundStart, playRoundWin, playRoundLose, playTick,
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
scene.background = new THREE.Color(SKY_HORIZON)
scene.fog = new THREE.Fog(SKY_HORIZON, 70, 200)   // sương nhẹ, cùng màu chân trời của bầu trời

// ── Lights ────────────────────────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0x8ab4d4, 0x3a5a2a, 1.0)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffffff, 1.4)
sun.position.set(20, 40, 20)
sun.castShadow = true
sun.shadow.camera.near = 0.5
sun.shadow.camera.far = 120
sun.shadow.camera.left = -45     // vừa khít map (60×40): shadow map 2048 mịn hơn
sun.shadow.camera.right = 45
sun.shadow.camera.top = 35
sun.shadow.camera.bottom = -35
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)
const sky = createSky(scene, sun.position)

// ── Camera ────────────────────────────────────────────────────────────────────
const BASE_FOV = 75
const RECOIL_VIEW_TAU = 0.045   // s: độ mượt khi camera nhấc lên theo recoil
const recView = { pitch: 0, yaw: 0 }
const FOV_EASE = 16   // 1/giây: tốc độ zoom vào/ra
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 300)
camera.rotation.order = 'YXZ'

initInput(renderer.domElement)

// ── Map mesh ──────────────────────────────────────────────────────────────────
scene.add(buildMapMesh(loadedMap))

// ── Spawn arrows: chỉ hiện khi bật debug F4 (cùng chế độ vẽ collider) ──────────
const spawnMarkers = new THREE.Group()
spawnMarkers.visible = false
scene.add(spawnMarkers)
for (const sp of loadedMap.spawns.A) {
  const dir = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw))
  spawnMarkers.add(new THREE.ArrowHelper(dir, new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]), 2, 0x2266ff, 0.6, 0.4))
}
for (const sp of loadedMap.spawns.B) {
  const dir = new THREE.Vector3(-Math.sin(sp.yaw), 0, -Math.cos(sp.yaw))
  spawnMarkers.add(new THREE.ArrowHelper(dir, new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]), 2, 0xff4422, 0.6, 0.4))
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  vm.updateAspect(camera.aspect)
})

// ── Viewmodel ─────────────────────────────────────────────────────────────────
const vm = createViewmodel(window.innerWidth / window.innerHeight)
const poseEditor = createPoseEditor(vm, () => vm.currentWeapon, id => {
  // F9 chọn súng → cầm luôn (chỉ offline; online súng do server cấp). Nhét vào ô theo dòng của nó rồi đổi sang ô đó
  if (sessionRef || dead) return
  const slot = CATEGORY_SLOT[WEAPONS[id]!.category]
  ws.slots[slot] = id; ws.slot = slot; ws.current = id; ws.wantSlot = slot; ws.reloadEndMs = 0
  setWantedWeapon(slot)
})   // F9 bảng chỉnh tư thế tay/súng, F10 camera quỹ đạo
let vmTeam: TeamId | undefined

initAudio(() => playDraw(ws.current))   // vào màn chơi: súng mặc định cũng phát tiếng rút súng
initAudioTuning()

// ── Logic súng (shared) ───────────────────────────────────────────────────────
let playerId = 1   // offline = 1; online = id server cấp (seed spread phải trùng server)
const steps = new StepTracker()
// Offline: bộ mặc định của Cớm; thử súng khác bằng ?loadout=knife,colt,smg,sniper (mỗi súng vào đúng ô theo dòng của nó)
function offlineSlots(): number[] {
  const slots = loadoutWeaponIds(defaultLoadout('A'))
  for (const key of (new URLSearchParams(location.search).get('loadout') ?? '').split(',')) {
    const def = weaponByKey(key.trim())
    if (def) slots[CATEGORY_SLOT[def.category]] = def.id
  }
  return slots
}
const ws  = makeWeaponState(offlineSlots())
if ((ws.slots[GRENADE_SLOT] ?? -1) >= 0) ws.ammo[GRENADE_ID] = 2   // offline ?loadout=m67: có 2 quả để thử ném
vm.snapTo(ws.current)
const rec = makeRecoilState()
const shotDirs: [number, number, number][] = Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])
const eyeTmp:  [number, number, number] = [0, 0, 0]
let simMs = 0
let lastBtns = 0
const MOVE_KEYS = Btn.Forward | Btn.Back | Btn.Left | Btn.Right
setSpeedMul(buttons => moveSpeedMul(ws, buttons))   // offline; online truyền qua hook step của Prediction

// Đổi súng theo ô (H.4): cmd.weapon = ô; logic súng đổi ở tick kế tiếp (client và server như nhau), viewmodel đi theo ws.current
let dead = false
let prevSlot = -1      // ô cầm trước đó, cho phím Q
let seenSlot = ws.slot
function requestSlot(slot: number): void {
  if (dead || slot === wantedWeapon()) return
  if ((ws.slots[slot] ?? -1) < 0) return   // ô trống: bỏ qua
  setWantedWeapon(slot)
}
function cycleSlot(dir: number): void {
  let s = wantedWeapon()
  for (let i = 0; i < SLOT_COUNT; i++) {
    s = (s + dir + SLOT_COUNT) % SLOT_COUNT
    if ((ws.slots[s] ?? -1) >= 0) { requestSlot(s); return }
  }
}
const slotKeysBuf: (string | null)[] = [null, null, null, null, null]
const slotCountsBuf: (number | null)[] = [null, null, null, null, null]

document.addEventListener('keydown', (e) => {
  if (e.repeat) return
  const m = /^Digit([1-9])$/.exec(e.code)
  if (m) {
    const n = Number(m[1])
    if (shop.digit(n)) return   // menu đang mở: phím số dùng để mua
    if (n <= SLOT_COUNT) requestSlot(n - 1)
  }
  if (e.code === 'KeyQ' && prevSlot >= 0) requestSlot(prevSlot)
  if (e.code === 'KeyB') shop.toggle()
  if (e.code === 'Backquote') { e.preventDefault(); askSwitchTeam() }
  if (e.code === 'F4' && debugLines) { debugLines.visible = !debugLines.visible; spawnMarkers.visible = debugLines.visible; e.preventDefault() }
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
  characterSet: () => sessionRef?.characterSet ?? '',
})
const explosionFx = createExplosionFx(scene, () => (worldRef ? (o, d, m) => worldRef!.castRay(o, d, m) : null))
const grenades = createGrenades(scene, {
  world: () => worldRef,
  onExplode: pos => { explosionFx.explode(pos, [camera.position.x, camera.position.y, camera.position.z]); playExplode(pos, !dead) },
  onBounce: (pos, speed) => playBounce(pos, speed),
  onRelease: (pos, own) => playSpoon(own ? undefined : pos),
  localFuse: () => !sessionRef,   // offline không có server: tự nổ khi hết ngòi
  releaseDelayMs: (id, mode) => playersRenderer.grenadeReleaseDelayMs(id, mode),
})
const nadeTrajectory = createGrenadeTrajectory(scene)
const nadeWarn = createGrenadeWarning()
const nadeAimState = { pos: [0, 0, 0] as [number, number, number], vel: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 0, grounded: true, crouching: false, slideTimer: 0, slideCooldown: 0 }
if (import.meta.env.DEV) Object.assign(globalThis, { __players: playersRenderer, __renderer: renderer, __grenades: grenades, __camera: camera, __nadeTraj: nadeTrajectory, __explosionFx: explosionFx })   // debug: script kiểm tra từ trình duyệt
const interpolator = new Interpolator()
const interpDelay = new InterpDelay()
let prediction: Prediction | null = null
let hudRef: ReturnType<typeof initHUD> | null = null
let worldRef: CollisionWorld | null = null
const HOLE_EPS = 0.05   // sai số khi xác định tia kết thúc ở tường (không phải ở người)
const ghosts = createGhosts(scene)
const tracers = createTracers(scene)
// Máu trắng khi trúng người: giọt va chạm với map qua castRay của physics world (offline cũng có world)
const bloodCast = (o: [number, number, number], d: [number, number, number], m: number) => worldRef?.castRay(o, d, m) ?? null
const blood = createBloodFx(scene, () => (worldRef ? bloodCast : null))
let lastSampled: ReturnType<Interpolator['sample']> = []   // người khác ở frame vẽ gần nhất (đích của HitConfirm)
const lastFireOrigin: [number, number, number] = [0, 0, 0]
const lastFireDir: [number, number, number] = [0, 0, -1]
const hitCenter: [number, number, number] = [0, 0, 0]
const debugShots = createDebugShots(scene)
const killfeed = createKillfeed()
const deathScreen = createDeathScreen()
const hurtIndicator = createHurtIndicator()
const bountyBanner = createBountyBanner()
let sideSwapped = false
let matchPhaseNow: MatchPhase = MatchPhase.Playing
let buyEndsAt: number | null = null   // Sinh Tử: hết giờ mua (serverTime); null = không giới hạn
let deadAt = 0                        // performance.now() lúc chết, để chờ 2 giây trước khi chuyển sang xem đồng đội
// Cửa hàng (H.7): chỉ hiển thị/gửi lệnh; server quyết định tiền, loadout, khu mua
const shop = createShop({
  money: () => snapStore?.money ?? 0,
  loadout: () => snapStore?.loadout ?? [],
  eco: () => (sessionRef?.config.settings.mode === 'elimination' ? ECONOMY_ELIM : ECONOMY),
  canShop: () => {
    const s = sessionRef, pos = prediction?.predicted.pos
    if (!s || !pos || dead || matchPhaseNow === MatchPhase.Ended || matchPhaseNow === MatchPhase.Halftime) return false
    if (buyEndsAt !== null && clock.serverNow() >= buyEndsAt) return false
    const team = s.teams.get(s.yourId)
    return team !== undefined && inBuyZone(loadedMap, team, sideSwapped, pos)
  },
  send: key => sessionRef?.transport.send({ t: MsgType.Buy, key }),
  sounds: { ok: playBuyOk, fail: playBuyFail },
})
const matchHud = createMatchHud({ start: playRoundStart, win: playRoundWin, lose: playRoundLose, tick: playTick })
const spectator = createSpectator(() => (worldRef ? (o, d, m) => worldRef!.castRay(o, d, m) : null))
let spectatingId = -2   // -2 = không xem; -1 = camera bay trên cao; ≥0 = đang xem người đó
const specBuf: SpecCandidate[] = []
const specLabel = createSpectateLabel()
let hudShown = true
const specNext = () => { if (spectatingId !== -2) spectator.next(specBuf) }
document.addEventListener('mousedown', e => { if (e.button === 0) specNext() })
document.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat) specNext() })
const scoreboard = createScoreboard()
let tabHeld = false
let scoreToggle = false   // nút "Xem thành tích" bật/tắt bảng điểm
let topButtons: ReturnType<typeof createTopButtons> | null = null
let askSwitchTeam: () => void = () => {}
const teamPrompt = createConfirmPrompt()
const toast = createToast()
// Về phòng chờ: tải lại trang (đóng kết nối nên server cho rời phòng), lobby bỏ qua bước nhập tên
createLeaveButton(() => {
  if (teamPrompt.isOpen) return
  teamPrompt.open('Về phòng chờ? Bạn sẽ rời trận này.', () => {
    try { sessionStorage.setItem(BACK_KEY, '1') } catch { /* bỏ qua */ }
    location.reload()
  })
})
document.addEventListener('keydown', e => { if (e.code === 'Tab') { e.preventDefault(); tabHeld = true } })
document.addEventListener('keyup', e => { if (e.code === 'Tab') { e.preventDefault(); tabHeld = false } })
window.addEventListener('blur', () => { tabHeld = false })
let lastHp = 100
const selfDebug = { id: 0, pos: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 0, flags: 0, weapon: 0 }   // F10
const sessionP = showLobby()
sessionP.then(session => {
  if (!session) {
    setOverlayDim(false)
    topButtons = createTopButtons({ onScores: () => { scoreToggle = !scoreToggle; topButtons?.setScoresActive(scoreToggle) }, onSwitch: () => {} }, false)
    return
  }
  topButtons = createTopButtons({
    onScores: () => { scoreToggle = !scoreToggle; topButtons?.setScoresActive(scoreToggle) },
    onSwitch: () => askSwitchTeam(),
  }, true)
  let lastTeam = session.teams.get(session.yourId)
  let pendingSwitch = false
  askSwitchTeam = () => {
    const mine = session.teams.get(session.yourId)
    if (!mine || teamPrompt.isOpen) return
    const other = mine === 'A' ? 'B' : 'A'
    teamPrompt.open(`Đổi sang phe ${TEAMS[other].name}?`, () => { pendingSwitch = true; session.transport.send({ t: MsgType.ChooseTeam, team: other }) })
  }
  session.transport.onMessage(msg => {
    if (msg.t !== MsgType.TeamAssigned || msg.id !== session.yourId) return
    const changed = lastTeam !== undefined && lastTeam !== msg.team
    if (pendingSwitch) { pendingSwitch = false; toast(changed ? `Đã sang phe ${TEAMS[msg.team].name}` : 'Không đổi được: phe kia đã đông hơn') }
    else if (changed) toast(`Bạn được chuyển sang phe ${TEAMS[msg.team].name} để cân bằng`)
    lastTeam = msg.team
  })
  playerId = session.yourId
  sessionRef = session
  matchHud.setConfig(session.config)
  createRoomLabel(`${MODE_LABEL[session.config.settings.mode]} · ${session.mapName} · ${session.roomName}`,
    `${location.origin}/?room=${encodeURIComponent(session.roomName)}`, () => toast('Đã sao chép link phòng'))
  if (import.meta.env.DEV) {   // lệnh debug (M.8): phím / mở ô lệnh; server bỏ qua khi chạy production
    const cmdBox = createCommandBox(cmd => session.transport.send({ t: MsgType.DebugCmd, cmd }))
    document.addEventListener('keydown', e => { if (e.code === 'Slash' && !e.repeat && !cmdBox.isOpen && !teamPrompt.isOpen) { e.preventDefault(); cmdBox.open() } })
  }
  startPing(session.transport, netStats)
  session.transport.onMessage(msg => {
    if (msg.t === MsgType.HitConfirm) {
      hudRef?.showHitmarker(msg.headshot)   // chỉ hiện khi server xác nhận
      // Máu: server không gửi điểm trúng nên lấy điểm trên tia vừa bắn gần thân/đầu mục tiêu nhất
      const tgt = lastSampled.find(o => o.id === msg.targetId)
      if (tgt) {
        hitCenter[0] = tgt.pos[0]; hitCenter[1] = tgt.pos[1] + (msg.headshot ? 1.62 : 1.1); hitCenter[2] = tgt.pos[2]
        const t = Math.max(0, (hitCenter[0] - lastFireOrigin[0]) * lastFireDir[0] + (hitCenter[1] - lastFireOrigin[1]) * lastFireDir[1] + (hitCenter[2] - lastFireOrigin[2]) * lastFireDir[2])
        const hx = lastFireOrigin[0] + lastFireDir[0] * t, hy = lastFireOrigin[1] + lastFireDir[1] * t, hz = lastFireOrigin[2] + lastFireDir[2] * t
        const off = Math.hypot(hx - hitCenter[0], hy - hitCenter[1], hz - hitCenter[2])
        if (off < 0.5) { hitCenter[0] = hx; hitCenter[1] = hy; hitCenter[2] = hz }
        blood.spawn(hitCenter, lastFireDir, msg.headshot)
      }
      playHit(msg.headshot ? 'head' : 'body')
    } else if (msg.t === MsgType.ShotFx) {
      const ray = (dir: [number, number, number], dist: number) => {
        tracers.add(msg.origin, dir, dist)
        // Server chỉ gửi điểm kết thúc tia; raycast lại map: nếu tia dừng đúng ở tường thì có vết đạn, nếu trúng người thì không
        const wh = worldRef?.castRay(msg.origin, dir, dist + HOLE_EPS)
        if (wh && wh.dist >= dist - HOLE_EPS) {
          hudRef?.addBulletHole([msg.origin[0] + dir[0] * wh.dist, msg.origin[1] + dir[1] * wh.dist, msg.origin[2] + dir[2] * wh.dist], wh.normal)
        } else if (dist < (WEAPONS[msg.weapon]?.range ?? 0) - 0.5) {
          // Tia dừng giữa trời trước tầm bắn = trúng người. Bỏ qua nếu trúng mình (điểm ngay sát camera)
          const hx = msg.origin[0] + dir[0] * dist, hy = msg.origin[1] + dir[1] * dist, hz = msg.origin[2] + dir[2] * dist
          if (Math.hypot(hx - camera.position.x, hy - camera.position.y, hz - camera.position.z) > 1.2) blood.spawn([hx, hy, hz], dir, false)
        }
      }
      if (!WEAPONS[msg.weapon]?.melee) {   // dao: không vệt đạn/lửa nòng, chỉ có tiếng vụt
        ray(msg.dir, msg.dist)
        if (msg.extra) for (const e of msg.extra) ray(e.dir, e.dist)
        playersRenderer.muzzleFlash(msg.shooterId)
      }
      playShotOther(msg.weapon, msg.origin)
    } else if (msg.t === MsgType.DebugShot) {
      debugShots.add(msg.origin, msg.dir, msg.boxes)
    } else if (msg.t === MsgType.Kill) {
      playersRenderer.markKill(msg.victimId, msg.headshot)
      const name = (id: number) => session.names.get(id) ?? `#${id}`
      const me = session.yourId
      killfeed.add(name(msg.killerId), WEAPONS[msg.weapon]?.name ?? '?', name(msg.victimId), msg.headshot,
        msg.killerId === me, msg.victimId === me, msg.reward)
      if (msg.killerId === me && msg.victimId !== me) {
        playHit(msg.headshot ? 'killHead' : 'kill')
        if (msg.victimStreak >= ECONOMY.bountyStreak) {   // hạ người bị truy nã
          bountyBanner.show(name(msg.victimId), msg.victimStreak)
          playBuyOk()
        }
      }
      if (msg.victimId === me) {
        dead = true
        deadAt = performance.now()
        setDead(true)
        deathScreen.show(msg.killerId === me ? '' : name(msg.killerId), matchHud.mode === 'elimination' ? -1 : RESPAWN_DELAY_MS - clock.oneWayMs)
      }
    } else if (msg.t === MsgType.GrenadeSpawn) {
      // serverTime của tick 0 suy từ snapshot (serverTime = start + tick·TICK_MS); chưa có snapshot thì dùng giờ server ước lượng
      const origin = snapStore && snapStore.serverTime > 0 ? snapStore.serverTime - snapStore.tick * 1000 / TICK_RATE : clock.serverNow() - msg.spawnTick * 1000 / TICK_RATE
      grenades.onSpawn(msg, origin, session.yourId, session.teams.get(msg.ownerId) ?? 'A')
    } else if (msg.t === MsgType.GrenadeAnim) {
      const who = lastSampled.find(o => o.id === msg.playerId)
      if (who && msg.playerId !== session.yourId) {   // âm của người khác (chốt chỉ nghe được khi ở gần)
        if (msg.phase === 'pulling') playPin([who.pos[0], who.pos[1] + 1.4, who.pos[2]])
        else if (msg.phase === 'throw') playThrowSwish([who.pos[0], who.pos[1] + 1.4, who.pos[2]])
      }
      if (msg.playerId !== session.yourId || poseEditor.orbitOn) playersRenderer.grenadeAnim(msg.playerId, msg.phase, msg.mode)   // của mình chỉ để xem ở F10
    } else if (msg.t === MsgType.GrenadeExplode) {
      grenades.onExplode(msg)
    } else if (msg.t === MsgType.Respawn && msg.id === session.yourId) {
      // Hồi sinh: teleport (không làm mượt), đạn đầy, nhìn theo hướng spawn
      dead = false
      setDead(false)
      deathScreen.hide()
      spectator.reset(); spectatingId = -2
      prediction?.teleport({
        pos: [msg.pos[0], msg.pos[1], msg.pos[2]], vel: [0, 0, 0], yaw: msg.yaw, pitch: 0,
        grounded: false, crouching: false, slideTimer: 0, slideCooldown: 0,
      })
      setLook(msg.yaw, 0)
      // Chết thì mất súng đã mua: về bộ mặc định của đội, cầm súng dài (server cũng vậy, snapshot kế tiếp sẽ khớp lại)
      const ids = loadoutWeaponIds(defaultLoadout(session.teams.get(session.yourId) ?? 'A'))
      for (let i = 0; i < ids.length; i++) ws.slots[i] = ids[i]!
      ws.slot = DEFAULT_SLOT; ws.current = ids[DEFAULT_SLOT]!
      setWantedWeapon(DEFAULT_SLOT)
      for (const w of WEAPONS) ws.ammo[w.id] = w.magSize
      ws.reloadEndMs = 0; ws.nextFireMs = 0; ws.triggerHeld = false
      ws.nade.phase = 'idle'; ws.nade.quick = false; ws.quickHeld = false; ws.switchBackAtMs = 0
      cancelReload()
    } else if (msg.t === MsgType.MatchState) {
      matchHud.setMatch(msg)
      setMatchPhase(msg.phase)
      matchPhaseNow = msg.phase
      sideSwapped = msg.sideSwapped
      buyEndsAt = msg.buyEndsAt
    } else if (msg.t === MsgType.RoundEnd) {
      matchHud.onRoundEnd(msg, session.teams.get(session.yourId))
    } else if (msg.t === MsgType.RoundReset) {
      // Ván mới: xoá lựu đạn đang bay, vết cháy, đường đạn, máu
      grenades.clear(); explosionFx.clear(); blood.clear()
    } else if (msg.t === MsgType.MatchEnd) {
      matchHud.onMatchEnd(msg, msg.mvpId !== null ? session.names.get(msg.mvpId) ?? '' : '')
    } else if (msg.t === MsgType.Scoreboard) {
      scoreboard.setRows(msg.rows, session.yourId)
    } else if (msg.t === MsgType.BuyResult) {
      shop.onBuyResult(msg.ok, msg.key)
      const def = weaponByKey(msg.key)
      if (msg.ok && def && !def.consumable) setWantedWeapon(CATEGORY_SLOT[def.category])   // server đã cho cầm súng vừa mua: cmd tiếp theo mang đúng ô (lựu đạn thì không tự cầm)
    } else if (msg.t === MsgType.MoneyEvent) {
      matchHud.onMoney(msg.delta, msg.reason)
      if (msg.reason === 'kill' || msg.reason === 'bounty') hudRef?.bottom.floatMoney(msg.delta, msg.reason === 'bounty')
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
    hudRef?.bottom.setMoney(s.money)
    if (matchHud.mode === 'elimination') {   // Sinh Tử: server là nguồn chân lý về sống/chết (cờ Dead trong snapshot)
      const srvDead = (s.flags & NetFlag.Dead) !== 0
      if (srvDead && !dead) { dead = true; deadAt = performance.now() - 2000; setDead(true) }   // vào giữa ván: chỉ xem
      else if (!srvDead && dead) { dead = false; setDead(false); deathScreen.hide(); spectator.reset() }   // lỡ mất tin Respawn: không kẹt ở chế độ xem
    }
    if (s.self) prediction?.onSnapshot(s.ack, s.self, s.wpn)
    if (s.wpn && prediction) reconcileWeapon(ws, s.wpn, prediction.pending)
  })
  session.transport.onClose(() => {
    setNetHooks(null); snapStore = null; prediction = null
    dead = false; matchPhaseNow = MatchPhase.Playing; buyEndsAt = null; shop.close(); spectator.reset(); spectatingId = -2
    setDead(false); deathScreen.hide(); setMatchPhase(MatchPhase.Playing); matchHud.clear(); sessionRef = null
    interpolator.push(0, []); playersRenderer.clear(); ghosts.clear(); grenades.clear()
  })
})
const updateDebug = initDebugOverlay(netStats, () => snapStore, () => prediction)
initTuningPanel(cfg)

let debugLines: THREE.LineSegments | null = null

createWorld(loadedMap, cfg.standHeight, cfg.crouchHeight, cfg.radius).then(world => {
  worldRef = world
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
        return pred.step(cmd, moveSpeedMul(ws, cmd.buttons))   // tốc độ theo súng đang cầm trước cmd này, như server
      },
      visualOffset: () => pred.decayOffset(),
    })
  })

  // Bia + HUD
  const targets = new URLSearchParams(location.search).has('dummies') ? createTargets(scene) : []   // hình nhân luyện bắn: chỉ khi mở ?dummies=1
  const hud     = initHUD(scene)
  hudRef = hud

  let eyeY   = cfg.eyeStand
  let zoomLevel = 0
  const scopeOverlay = createScope()
  let lastMs = performance.now()

  hud.setHealth(100)
  hud.bottom.setMoneyVisible(false)   // offline không có tiền; online hiện khi vào phòng (bên dưới)
  sessionP.then(session => { hud.bottom.setMoneyVisible(!!session) })

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
    // (recView đuổi theo rec theo hàm mũ để camera giật mượt thay vì bật cứng; hướng đạn vẫn dùng rec thật)
    const recK = 1 - Math.exp(-dt / RECOIL_VIEW_TAU)
    recView.pitch += (rec.pitch - recView.pitch) * recK
    recView.yaw += (rec.yaw - recView.yaw) * recK
    camera.rotation.y += recView.yaw
    camera.rotation.x += recView.pitch
    explosionFx.update(dt)   // chỉ camera chính rung (viewmodel có camera riêng nên không bị rung mạnh)
    camera.position.x += explosionFx.shake.x; camera.position.y += explosionFx.shake.y
    camera.rotation.z += explosionFx.shake.rot
    updateListener(camera.position.x, camera.position.y, camera.position.z, camera.rotation.y, camera.rotation.x)

    const def   = WEAPONS[ws.current]!
    const speed = Math.hypot(state.vel[0], state.vel[2])

    // Ngắm: giữ chuột phải (súng có `ads`), không ngắm khi đang nạp / đổi súng / đã chết. Lăn chuột đổi mức zoom (sniper)
    const ads = def.ads
    const aiming = !!ads && vm.currentWeapon === ws.current && ws.reloadEndMs === 0 && lastHp > 0 && isLocked() &&
      (sampleButtons() & Btn.Aim) !== 0
    const wheel = consumeWheel()
    if (!aiming) zoomLevel = 0
    if (wheel !== 0) {
      // Con lăn: đang ngắm súng nhiều mức zoom thì đổi zoom, còn lại đổi sang ô kế tiếp/trước có súng
      if (aiming && ads!.fovs.length > 1) zoomLevel = Math.max(0, Math.min(ads!.fovs.length - 1, zoomLevel - Math.sign(wheel)))
      else cycleSlot(Math.sign(wheel))
    }
    const fovTarget = aiming ? ads!.fovs[Math.min(zoomLevel, ads!.fovs.length - 1)]! : BASE_FOV
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * FOV_EASE)
      camera.updateProjectionMatrix()
    }
    // Zoom càng sâu chuột càng chậm (cùng góc quay trên màn hình)
    setSensScale(Math.tan(camera.fov * Math.PI / 360) / Math.tan(BASE_FOV * Math.PI / 360))
    vm.setAim(aiming, !!ads?.scope)
    const scoped = !!ads?.scope && aiming && vm.aimAmount > 0.9
    scopeOverlay.setVisible(scoped)
    hud.setCrosshairVisible(!scoped && spectatingId === -2)   // súng trường ngắm vẫn giữ tâm; chỉ scope mới ẩn
    hud.setCrosshairFov(camera.fov)

    // Viewmodel đi theo súng đang cầm của logic (ws.current), dù đổi do phím, con lăn, mua hay hồi sinh
    if (vm.targetWeapon !== ws.current && vm.switchWeapon(ws.current)) { cancelReload(); playDraw(ws.current) }
    if (ws.slot !== seenSlot) { prevSlot = seenSlot; seenSlot = ws.slot }
    for (let i = 0; i < SLOT_COUNT; i++) { const id = ws.slots[i]!; slotKeysBuf[i] = id >= 0 ? WEAPONS[id]!.key : null }
    {   // cảnh báo lựu đạn địch/của mình gần (bỏ qua đồng đội)
      const myId = sessionRef?.yourId ?? -1, myT = sessionRef?.teams.get(myId)
      nadeWarn.update(dt, camera.position, yaw, grenades.list(), g => g.pos,
        g => dead || (g.ownerId !== myId && !!myT && sessionRef?.teams.get(g.ownerId) === myT))
    }
    slotCountsBuf[GRENADE_SLOT] = slotKeysBuf[GRENADE_SLOT] ? (ws.ammo[GRENADE_ID] ?? 0) : null
    hud.bottom.setSlots(slotKeysBuf, ws.slot, slotCountsBuf)
    shop.tick()

    vm.setMotion(speed, state.grounded)
    vm.setReload(ws.reloadEndMs > 0 && def.reloadMs > 0 ? 1 - (ws.reloadEndMs - simMs) / def.reloadMs : -1)
    {   // lựu đạn: pha + tiến độ rút chốt cho viewmodel
      const n = ws.nade
      const pull = n.phase === 'ready' ? 1 : n.phase === 'pulling' ? Math.min(1, Math.max(0, (simMs - n.pressSeq * 1000 / TICK_RATE) / GRENADE.pinPullMs)) : 0
      vm.setGrenade(n.phase === 'idle' ? 'idle' : n.phase === 'pulling' ? 'pulling' : 'ready', n.mode, pull, (ws.ammo[GRENADE_ID] ?? 0) > 0)
    }
    hud.setSpread(shotSpread(def, state, (lastBtns & MOVE_KEYS) | (aiming ? Btn.Aim : 0)), dt * 1000)   // cùng công thức với lúc bắn
    hud.setAmmo(def.name, ws.ammo[def.id]!, def.magSize, ws.reloadEndMs > 0, !!def.melee, !!def.consumable)

    updateTargets(targets, dt)
    const myTeamNow = sessionRef?.teams.get(sessionRef.yourId) ?? 'A'
    vm.setBlockArms(sessionRef?.characterSet === 'robot')
    if (myTeamNow !== vmTeam) { vmTeam = myTeamNow; vm.setTeam(myTeamNow) }
    poseEditor.tick(dt)
    vm.update(dt)
    hud.tick(dt * 1000)

    {   // Sinh Tử: chết thì sau 2 giây xem đồng đội còn sống (không xem được địch); hết người thì camera bay trên cao
      const sess = sessionRef
      const specNow = !!sess && dead && matchHud.mode === 'elimination' && matchPhaseNow !== MatchPhase.Waiting && performance.now() - deadAt >= 2000
      if (specNow) {
        const myT = sess.teams.get(sess.yourId)
        specBuf.length = 0
        for (const o of lastSampled) if (o.id !== sess.yourId && sess.teams.get(o.id) === myT && (o.flags & NetFlag.Dead) === 0) specBuf.push(o)
        spectatingId = spectator.apply(camera, specBuf, dt, performance.now())
        deathScreen.hide()
        const tgt = snapStore?.players.find(p => p.id === spectatingId)
        specLabel.set(spectatingId >= 0 ? sess.names.get(spectatingId) ?? `#${spectatingId}` : null, tgt?.hp ?? 0)
      } else { spectatingId = -2; specLabel.set(undefined, 0) }   // luôn ẩn nhãn (đã có kiểm tra trùng chữ): hồi sinh đặt spectatingId trực tiếp nên không dựa vào việc nó đổi
      const showHud = spectatingId === -2
      if (showHud !== hudShown) { hudShown = showHud; hud.bottom.setVisible(showHud) }
      if (sess) {
        let na = 0, nb = 0
        for (const t of sess.teams.values()) { if (t === 'A') na++; else nb++ }
        matchHud.setTeamSizes(na, nb)
      }
      const now = clock.serverNow()
      const inBuyPhase = matchPhaseNow === MatchPhase.Freeze || matchPhaseNow === MatchPhase.Playing || matchPhaseNow === MatchPhase.RoundEnd
      shop.setBuyLeft(buyEndsAt !== null && inBuyPhase && !dead && now < buyEndsAt ? buyEndsAt - now : null)
    }
    sky.update(camera.position)
    renderer.clear()
    if (poseEditor.orbitOn) poseEditor.applyOrbit(camera, state.pos[0], state.pos[1], state.pos[2])   // F10: camera quanh người mình
    renderer.render(scene, camera)
    renderer.clearDepth()
    if (!poseEditor.orbitOn && spectatingId === -2) renderer.render(vm.scene, vm.cam)

    // Người khác: vẽ trễ (INTERP_DELAY_MS + trễ một chiều) bằng nội suy; chưa vào phòng thì danh sách rỗng
    if (snapStore) ghosts.update(snapStore.players, snapStore.yourId)
    if (poseEditor.orbitOn) {
      // F10: dựng thêm model 3rd person của chính mình (bình thường không vẽ) với súng đang cầm
      const others = snapStore ? interpolator.sample(clock.serverNow(), interpDelay.update(clock.oneWayMs)) : []
      selfDebug.id = playerId; selfDebug.pos = state.pos; selfDebug.yaw = state.yaw; selfDebug.pitch = state.pitch
      selfDebug.flags = (state.grounded ? NetFlag.Grounded : 0) | (state.crouching ? NetFlag.Crouching : 0) | (state.slideTimer > 0 ? NetFlag.Sliding : 0)
      selfDebug.weapon = ws.current
      playersRenderer.update([...others.filter(o => o.id !== playerId), selfDebug], -1)
    } else if (snapStore) {
      lastSampled = interpolator.sample(clock.serverNow(), interpDelay.update(clock.oneWayMs))
      playersRenderer.update(lastSampled)
    }
    {   // đường bay dự kiến khi giữ ở trạng thái ready (dùng đúng hàm ném thật)
      const s = nadeAimState
      s.pos[0] = state.pos[0]; s.pos[1] = state.pos[1]; s.pos[2] = state.pos[2]
      s.vel[0] = state.vel[0]; s.vel[1] = state.vel[1]; s.vel[2] = state.vel[2]
      s.yaw = yaw; s.pitch = pitch; s.crouching = state.crouching
      nadeTrajectory.update(ws.current === GRENADE_ID && ws.nade.phase === 'ready' && !dead, worldRef, s, ws.nade.mode)
    }
    grenades.update(dt, interp.currentRenderTime > 0 ? interp.currentRenderTime : clock.serverNow(), netStats.rttMs)
    tracers.update(dt * 1000)
    blood.update(dt)
    debugShots.update(dt * 1000)
    deathScreen.tick()
    matchHud.tick(clock.serverNow())
    scoreboard.show(tabHeld || scoreToggle || (snapStore !== null && matchHud.phase === MatchPhase.Ended))
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
      const pellets = computeShotDirs(shotDirs, rec, def, playerId, ws.shotSeq - 1, cmd.yaw, cmd.pitch, shotSpread(def, state, cmd.buttons))
      vm.onFire(def.melee)
      lastFireDir[0] = shotDirs[0]![0]; lastFireDir[1] = shotDirs[0]![1]; lastFireDir[2] = shotDirs[0]![2]   // cho điểm máu khi HitConfirm về
      hud.kickSpread(def.recoilPitchDeg * 2)   // tâm giãn theo độ giật của súng (hiển thị)
      playShot(def.id, ws.ammo[def.id]!)

      eyeTmp[0] = state.pos[0]; eyeTmp[1] = state.pos[1] + eyeY; eyeTmp[2] = state.pos[2]
      lastFireOrigin[0] = eyeTmp[0]; lastFireOrigin[1] = eyeTmp[1]; lastFireOrigin[2] = eyeTmp[2]
      let hitHead = false, hitBody = false
      for (let k = 0; k < pellets; k++) {
        const result = fireHitscan(eyeTmp, shotDirs[k]!, def.range, world, cfg, targets)
        if (result?.kind === 'target') {
          flashTarget(targets[result.idx]!)
          hitCenter[0] = eyeTmp[0] + shotDirs[k]![0] * result.dist; hitCenter[1] = eyeTmp[1] + shotDirs[k]![1] * result.dist; hitCenter[2] = eyeTmp[2] + shotDirs[k]![2] * result.dist
          blood.spawn(hitCenter, shotDirs[k]!, result.part === 'head')
          if (result.part === 'head') hitHead = true; else hitBody = true
        } else if (result?.kind === 'wall' && !def.melee) {
          hud.addBulletHole(result.hitPos, result.normal)
        }
      }
      if (hitHead || hitBody) {   // một hitmarker + một tiếng cho cả phát
        hud.showHitmarker(hitHead)
        playHit(hitHead ? 'head' : 'body')
      }
    } else if (ev === 'dry') {
      playDry(def.id)
      startReload(def.id, 0, def.reloadMs)   // hết đạn: cạch rồi tự nạp
    } else if (ev === 'reloadStart') {
      startReload(def.id, ws.ammo[def.id]!, def.reloadMs)
    }
    if (ev === 'switched' || ev === 'pull') {
      // Đổi súng do logic (tự về súng cũ sau khi ném, G): nhận ô hiện tại làm ô muốn để phím số/Q hoạt động tiếp
      if (ws.slot !== wantedWeapon()) setWantedWeapon(ws.slot)
    }
    if (ev === 'pull') playPin()   // rút chốt: chỉ mình nghe
    if (ev === 'threw') {
      playThrowSwish()
      // Dự đoán ném: quả của mình bay ngay (không chờ server); server xác nhận bằng throwSeq
      const t = throwInitial(state, ws.nade.mode, world, cfg)
      vm.onGrenadeThrow()
      grenades.spawnLocal(ws.throwSeq, playerId, sessionRef?.teams.get(playerId) ?? 'A', t.pos, t.vel, ws.nade.mode)
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
