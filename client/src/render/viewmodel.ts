import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { TeamId } from "@fps/shared";
import { BlockArm } from "./blockArm";
import { FpArms } from "./fpArms";
import type { SkinId } from "./characterRig";
import { GrenadeAnim, pathSegment, type LogicPhase } from "./grenadeAnim";
import { GRENADE_ID, WEAPONS } from "@fps/shared";
import { KnifeAnim } from "./knifeAnim";
import { poses, weaponPose, getAnchor, scanModelAnchors, onPosesChange, colorOf, type Vec3 } from "./poses";

// ── Hằng số ────────────────────────────────────────────────────────────────────
const GUN_DEFAULT_POS = new THREE.Vector3(0.28, -0.3, -0.45);
const GUN_HIDDEN_Y = -0.55;
const ANIM_HALF = 0.15; // 0.15 s mỗi chiều

// ── Hiệu ứng viewmodel (thuần hình ảnh) ────────────────────────────────────────
const KICK_BACK = 0.04; // lùi súng 4cm
const KICK_PITCH = (3 * Math.PI) / 180; // hếch 3°
const KICK_TAU = 0.03; // hằng số thời gian hồi (~80ms về gần 0)
const BOB_FREQ = 1.3; // rad / mét đi được
const BOB_AMP_X = 0.012;
const BOB_AMP_Y = 0.008;
const BOB_REF_SPEED = 8.5; // tốc độ chạy: biên độ tối đa
const RELOAD_DROP = 0.15; // hạ 15cm
const RELOAD_TILT = (35 * Math.PI) / 180; // chúc 35°
const RELOAD_DOWN_END = 0.4; // hạ xong ở 40% thời gian reload
const RELOAD_UP_START = 0.8; // bắt đầu đưa lên ở 80%
// Vị trí đầu nòng (hệ gunGroup) khi model không có node 'muzzle' — bước nén glb xoá mất empty
// của colt/rouleau. Đo từ bbox + đỉnh gần mũi nòng của chính file glb đã nén (theo id súng).
export const MUZZLE_FALLBACK: THREE.Vector3[] = [
  new THREE.Vector3(0, 0.096, -0.63), // AK47 (trùng node muzzle)
  new THREE.Vector3(0, 0.111, -0.628), // M16 (trùng node muzzle)
  new THREE.Vector3(0, 0.093, -0.244), // COLT
  new THREE.Vector3(0, 0.078, -0.287), // ROULEAU
  new THREE.Vector3(0, 0.0495, -0.927), // SNIPER (trùng node muzzle)
  new THREE.Vector3(0, 0.06, -0.705), // SHOTGUN (glb không có node muzzle: mũi nòng đo từ geometry)
  new THREE.Vector3(0, 0, -0.3), // DAO (không có lửa nòng, chỉ để đủ phần tử)
  new THREE.Vector3(0, 0.07, -0.35), // SMG (đầu nòng theo bbox glb)
];
const FLASH_SIZE = 0.18;

// ── Ngắm (ADS) ─────────────────────────────────────────────────────────────────
const ADS_DIST = 0.45; // đầu ruồi cách mắt bấy nhiêu mét: xa hơn = súng/đầu ngắm nhỏ hơn
const ADS_BOB = 0.15; // lắc súng còn lại khi ngắm (so với bình thường)
// Hạ súng thêm khi ngắm (m) để khung ngắm/tay xách không che tầm nhìn (đầu ruồi nằm dưới tâm một chút).
// M16 có đầu ruồi cao + tay xách nên cần hạ nhiều hơn AK.
const ADS_DROP: Record<number, number> = { 0: 0.03 ,1: 0.1 };
const SIGHT_SLAB = 0.1; // vùng đầu ruồi: 10% chiều dài súng tính từ đầu nòng
const SIGHT_HALF_W = 0.008; // chỉ xét đỉnh gần trục giữa (x≈0) để bỏ qua các chi tiết bên hông

// Chỉnh model glb chưa chuẩn hoá theo tay cầm (knife_1.glb gốc nhỏ ~19cm). scale/pos/rot áp lên root của model.
export const MODEL_ADJUST: Record<number, { scale?: number; pos?: [number, number, number]; rotX?: number; rotY?: number; rotZ?: number }> = {
  6: { scale: 2.2, pos: [-0.02, 0.12, 0.05], rotX: 0.45 },   // dao
};
export function adjustModel(id: number, model: THREE.Object3D): void {
  const a = MODEL_ADJUST[id];
  if (!a) return;
  if (a.scale) model.scale.multiplyScalar(a.scale);
  if (a.pos) model.position.add(new THREE.Vector3(...a.pos));
  if (a.rotX) model.rotation.x += a.rotX;
  if (a.rotY) model.rotation.y += a.rotY;
  if (a.rotZ) model.rotation.z += a.rotZ;
}

export function makeFlashTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,230,1)");
  grad.addColorStop(0.35, "rgba(255,190,80,0.9)");
  grad.addColorStop(1, "rgba(255,120,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // vài tia để sprite xoay ngẫu nhiên nhìn khác nhau
  g.strokeStyle = "rgba(255,220,120,0.9)";
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.3;
    g.beginPath();
    g.moveTo(32, 32);
    g.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

// ── Thông số load model ────────────────────────────────────────────────────────
// Scale + rotation đã baked vào GunRoot node trong GLB → chỉ load, không re-apply
const WEAPON_FILES = [
  "/models/ak47.glb",
  "/models/m16.glb",
  "/models/colt.glb",
  "/models/rouleau.glb",
  "/models/sniper.glb",
  "/models/shotgun.glb",
  "/models/knife_1.glb",
  "/models/submachine.glb",
  "/models/grenades/m67.glb",   // id 8: lựu đạn (node body/spoon/pin + empty hand_r/pin_pull)
] as const;

// ── Placeholder box (dùng khi model chưa load xong) ───────────────────────────
function buildPlaceholder(id: number): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x3c3c3c });
  if (id === 0) {
    // AK47
    g.add(
      Object.assign(
        new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.42), mat),
      ),
    );
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.022, 0.18),
      new THREE.MeshLambertMaterial({ color: 0x222 }),
    );
    barrel.position.set(0, 0.005, -0.3);
    g.add(barrel);
  } else if (id === 1) {
    // M16
    g.add(
      Object.assign(
        new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.038, 0.38), mat),
      ),
    );
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x222 }),
    );
    barrel.position.set(0, 0.003, -0.29);
    g.add(barrel);
  } else if (id === 2) {
    // COLT
    g.add(
      Object.assign(
        new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.038, 0.38), mat),
      ),
    );
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x222 }),
    );
    barrel.position.set(0, 0.003, -0.29);
    g.add(barrel);
  } else if (id === 3) {
    // ROULEAU
    g.add(
      Object.assign(
        new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.038, 0.38), mat),
      ),
    );
    const barrel = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x222 }),
    );
    barrel.position.set(0, 0.003, -0.29);
    g.add(barrel);
  }
  return g;
}

// ── Load GLB (scale/rotation đã có trong GunRoot node, chỉ tắt shadow) ──────
function prepareModel(scene: THREE.Group): THREE.Group {
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  return scene;
}

// Đỉnh đầu ruồi (hệ gunGroup): điểm cao nhất, gần trục giữa, trong đoạn đầu nòng. Dùng để đặt súng sao cho
// đầu ruồi nằm đúng tâm màn hình khi ngắm. Chạy một lần mỗi model lúc load.
function measureSight(model: THREE.Object3D): THREE.Vector3 | null {
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let zMin = Infinity, zMax = -Infinity;
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  for (const m of meshes) {
    const p = m.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.z < zMin) zMin = v.z;
      if (v.z > zMax) zMax = v.z;
    }
  }
  if (!(zMax > zMin)) return null;
  const zLimit = zMin + (zMax - zMin) * SIGHT_SLAB;
  let best: THREE.Vector3 | null = null;
  for (const m of meshes) {
    const p = m.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.z <= zLimit && Math.abs(v.x) <= SIGHT_HALF_W && (!best || v.y > best.y)) best = best ? best.copy(v) : v.clone();
    }
  }
  return best;
}

// ── ViewmodelHandle ────────────────────────────────────────────────────────────
export interface ViewmodelHandle {
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  readonly currentWeapon: number;
  /** Súng đang hiện hoặc sắp hiện (khác currentWeapon lúc đang animation đổi súng) */
  readonly targetWeapon: number;
  updateAspect(aspect: number): void;
  switchWeapon(id: number): boolean;
  /** Đặt súng ngay, không animation (lúc khởi động) */
  snapTo(id: number): void;
  update(dt: number): void;
  /** Gọi mỗi phát bắn: giật súng + lửa nòng (melee: chém, không có lửa nòng) */
  onFire(melee?: boolean): void;
  /** Tốc độ ngang (m/s) + đang chạm đất, để lắc súng */
  setMotion(speed: number, grounded: boolean): void;
  /** Dao: vận tốc ngang theo trục phải (m/s, + = sang phải) và vận tốc Y. Gọi trước setMotion */
  setMove(strafe: number, vy: number): void;
  /** Dao: yaw/pitch camera hiện tại, để dao trễ theo chuột */
  setLook(yaw: number, pitch: number): void;
  /** Dao: múa dao (phím xem dao). Không có tác dụng với vũ khí khác */
  inspect(): void;
  /** Tiến độ reload 0..1, hoặc -1 nếu không reload */
  setReload(progress: number): void;
  /** Mức ngắm 0..1 (adsT của movement: đã mượt theo inMs/outMs). Chỉ có tác dụng khi đang cầm súng ở trạng thái idle */
  setAim(adsT: number, scoped: boolean): void;
  /** 0 (hông) … 1 (ngắm xong) */
  readonly aimAmount: number;
  /** Màu tay áo theo đội */
  setTeam(team: TeamId): void;
  /** Skin tay xương theo bộ nhân vật của phòng (tải khi cần) */
  setSkin(skin: SkinId): void;
  /** true: dùng tay khối thay tay xương (bộ nhân vật robot) */
  setBlockArms(v: boolean): void;
  /** Lựu đạn: trạng thái logic mỗi frame (pha, chế độ, tiến độ rút chốt 0..1, còn quả sau khi ném không) */
  setGrenade(phase: LogicPhase, mode: 'strong' | 'lob', pullFrac: number, hasMore: boolean): void;
  /** Lựu đạn vừa rời tay (logic ném): vung tay, quả trong tay biến mất */
  onGrenadeThrow(): void;
  /** Pha hoạt hình lựu đạn (debug) */
  readonly grenadePhase: string;
  /** Ẩn cả súng lẫn tay (camera debug F10, chết) */
  setHidden(hidden: boolean): void;
  /** Cho bảng F9: tay + súng + trạng thái giải IK của frame vừa rồi */
  readonly debug: ViewmodelDebug;
}

export interface ViewmodelDebug {
  gunGroup: THREE.Group;
  armR: BlockArm;
  armL: BlockArm;
  shoulderR: THREE.Vector3;
  shoulderL: THREE.Vector3;
  /** Đích IK trong không gian camera (valid* = frame vừa rồi có giải tay đó) */
  targetR: THREE.Vector3;
  targetL: THREE.Vector3;
  validR: boolean;
  validL: boolean;
  /** Tiến độ nạp đạn đã dừng hình (0..1), -1 = không ép */
  freezeReload: number;
  /** Tô đỏ tay không với tới súng */
  showReach: boolean;
  /** Điểm ngắm (đầu ruồi) của súng đang cầm, trong không gian của gunGroup (nhân gunGroup.matrix ra không gian camera); null nếu chưa đo được */
  sight: THREE.Vector3 | null;
}

export function createViewmodel(aspect: number): ViewmodelHandle {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.01, 20);

  cam.fov = poses.first.fov;
  cam.updateProjectionMatrix();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a4036, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(1, 2, 1);
  scene.add(dl);

  const gunGroup = new THREE.Group();
  gunGroup.position.copy(GUN_DEFAULT_POS);
  scene.add(gunGroup);

  // ── Hai cánh tay khối hộp ─────────────────────────────────────────────────
  // Vai đứng yên trong không gian camera; hiệu ứng (lắc, giật, hạ súng, nạp) chỉ áp lên súng, tay IK bám theo hai điểm neo.
  let sleeve = colorOf(poses.style.sleeveColor.A);
  const skin = colorOf(poses.style.skinColor);
  const armR = new BlockArm(() => poses.style.first, sleeve, skin);
  const armL = new BlockArm(() => poses.style.first, sleeve, skin);
  scene.add(armR.root, armL.root);
  // Tay bằng model nhân vật (C.6): có rồi thì thay tay khối; tay khối vẫn giải IK (ẩn) để bảng F9 và làm dự phòng khi glb không load được
  const fp = new FpArms();
  scene.add(fp.root);
  fp.setSkin('saber');   // bộ mặc định; main.ts đổi theo bộ nhân vật của phòng
  let blockArms = false;   // bộ nhân vật khối hộp (robot): tay viewmodel cũng là tay khối
  const fpActive = () => fp.ready && !blockArms;
  const shoulderR = new THREE.Vector3(), shoulderL = new THREE.Vector3();
  const poleR = new THREE.Vector3(), poleL = new THREE.Vector3();
  const targetR = new THREE.Vector3(), targetL = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  let hidden = false;
  const _off = new THREE.Vector3();
  const DEG = Math.PI / 180;
  // Băng đạn đi theo tay trái giữa magDetachT..magAttachT (chỉ khi model có mesh tên 'mag'; các glb hiện tại chưa có)
  let magHeld: { mesh: THREE.Object3D; parent: THREE.Object3D; weapon: number; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null = null;
  function restoreMag(): void {
    if (!magHeld) return;
    const h = magHeld;
    h.parent.add(h.mesh);
    h.mesh.position.copy(h.pos); h.mesh.quaternion.copy(h.quat); h.mesh.scale.copy(h.scale);
    magHeld = null;
  }
  function updateMag(rp: number): void {
    const rl = poses.reloadLeftHand;
    const want = rp >= rl.magDetachT && rp < rl.magAttachT && dbg.validL;
    if (magHeld && (!want || magHeld.weapon !== currentWeapon)) restoreMag();
    if (!want || magHeld) return;
    const mesh = currentMesh.getObjectByName("mag");
    if (!mesh || !mesh.parent) return;
    magHeld = { mesh, parent: mesh.parent, weapon: currentWeapon, pos: mesh.position.clone(), quat: mesh.quaternion.clone(), scale: mesh.scale.clone() };
    (fpActive() ? fp.leftHand()! : armL.handMesh).attach(mesh);
  }
  const dbg: ViewmodelDebug = { gunGroup, armR, armL, shoulderR, shoulderL, targetR, targetL, validR: false, validL: false, freezeReload: -1, showReach: false, sight: null };
  onPosesChange(() => { cam.fov = poses.first.fov; cam.updateProjectionMatrix(); });

  // Trạng thái
  let currentWeapon = 0;
  let currentMesh: THREE.Object3D = buildPlaceholder(0);
  gunGroup.add(currentMesh);

  // Cache model đã load
  const loaded = new Map<number, THREE.Group>();
  const sights = new Map<number, THREE.Vector3>();

  // Load cả 2 model song song
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder); // bắt buộc cho EXT_meshopt_compression
  for (let id = 0; id < WEAPON_FILES.length; id++) {
    const file = WEAPON_FILES[id]!;
    const wid = id;
    loader
      .loadAsync(file)
      .then((gltf) => {
        const model = prepareModel(gltf.scene);
        adjustModel(wid, model);
        scanModelAnchors(wid, model);
        loaded.set(wid, model);
        const sight = measureSight(model);
        if (sight) sights.set(wid, sight);
        if (wid === currentWeapon && phase === "idle") {
          gunGroup.remove(currentMesh);
          currentMesh = model;
          gunGroup.add(currentMesh);
        }
      })
      .catch((err) => console.warn(`viewmodel: cannot load ${file}`, err));
  }

  // ── Flash đầu nòng ─────────────────────────────────────────────────────────
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeFlashTexture(),
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  flash.scale.set(FLASH_SIZE, FLASH_SIZE, 1);
  flash.renderOrder = 10;
  flash.visible = false;
  gunGroup.add(flash);
  let flashEndMs = 0;   // performance.now() khi flash tắt; 0 = tắt
  const _tmp = new THREE.Vector3();

  // Animation
  type Phase = "idle" | "down" | "up";
  let phase: Phase = "idle";
  let animT = 0;
  let pendingId = -1;
  let switchOffY = 0; // lệch Y do animation đổi súng

  let kick = 0; // 1 ngay sau khi bắn, hồi về 0
  let bobPhase = 0;
  let bobAmp = 0;
  let moveSpeed = 0;
  let moveGrounded = false;
  let reloadProgress = -1;
  let aimWant = 0;   // adsT từ movement
  let aimScoped = false;
  let aimT = 0;
  const knife = new KnifeAnim();
  const isKnife = (id: number): boolean => WEAPONS[id]?.category === "knife";

  // ── Lựu đạn (G.5) ──────────────────────────────────────────────────────────
  const nadeAnim = new GrenadeAnim(() => weaponPose(GRENADE_ID).first.grenade!);
  const nadeLeft = new THREE.Vector3();          // tay trái làm mượt (rest ↔ vòng chốt)
  let nadeLeftInit = false;
  let pinState: "onGrenade" | "onLeftHand" | "hidden" = "onGrenade";
  let pinHome: { parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null = null;
  function setPin(state: "onGrenade" | "onLeftHand" | "hidden"): void {
    if (state === pinState) return;
    const pin = currentMesh.getObjectByName("pin");
    if (!pin) { pinState = state; return; }
    if (state === "onLeftHand") {
      if (!pinHome) pinHome = { parent: pin.parent!, pos: pin.position.clone(), quat: pin.quaternion.clone(), scale: pin.scale.clone() };
      (fpActive() ? fp.leftHand()! : armL.handMesh).attach(pin);   // attach giữ vị trí thế giới: chốt đi theo bàn tay trái
      pin.visible = true;
    } else {
      if (pinHome) { pinHome.parent.add(pin); pin.position.copy(pinHome.pos); pin.quaternion.copy(pinHome.quat); pin.scale.copy(pinHome.scale); }
      pin.visible = state === "onGrenade";
    }
    pinState = state;
  }
  function nadeEnter(): void { nadeAnim.reset(); pinHome = null; pinState = "onGrenade"; nadeLeftInit = false; currentMesh.visible = true; }
  function nadeLeave(): void { setPin("onGrenade"); currentMesh.visible = true; }   // đổi sang súng khác: trả chốt về quả, quả hiện lại

  // Vị trí tay cầm súng ở hông: poses.json (first.gunPos), thiếu thì mặc định cũ
  const _base = new THREE.Vector3();
  function basePos(id: number): THREE.Vector3 {
    const g = weaponPose(id).first.gunPos;
    return g ? _base.set(g[0], g[1], g[2]) : _base.copy(GUN_DEFAULT_POS);
  }

  function getMesh(id: number): THREE.Object3D {
    return loaded.get(id) ?? buildPlaceholder(id);
  }

  function switchWeapon(id: number): boolean {
    if (id === currentWeapon && phase === "idle") return false;
    if (phase !== "idle") return false;
    pendingId = id;
    phase = "down";
    animT = 0;
    return true;
  }

  function snapTo(id: number) {
    currentWeapon = id;
    pendingId = id;
    phase = "idle";
    switchOffY = 0;
    gunGroup.remove(currentMesh);
    currentMesh = getMesh(id);
    gunGroup.add(currentMesh);
    if (id === GRENADE_ID) nadeEnter();
  }

  function onFire(melee = false) {
    kick = melee ? 3 : 1;   // dao: vung mạnh hơn
    knife.interrupt();
    if (melee) return;
    // Vị trí muzzle theo hệ toạ độ gunGroup
    const m = currentMesh.getObjectByName("muzzle");
    if (m) {
      gunGroup.updateMatrixWorld(true);
      m.getWorldPosition(_tmp);
      gunGroup.worldToLocal(_tmp);
      flash.position.copy(_tmp);
    } else {
      flash.position.copy(MUZZLE_FALLBACK[currentWeapon] ?? MUZZLE_FALLBACK[0]!);
    }
    flash.material.rotation = Math.random() * Math.PI * 2;
    flash.visible = true;
    flashEndMs = performance.now() + 50;
  }

  function setMotion(speed: number, grounded: boolean) {
    moveSpeed = speed;
    moveGrounded = grounded;
    knife.setMotion(speed, grounded);
  }

  function setReload(progress: number) {
    reloadProgress = progress;
  }

  function setAim(adsT: number, scoped: boolean) {
    aimWant = adsT;
    aimScoped = scoped;
  }

  function update(dt: number) {
    // Đổi súng
    if (phase === "down") {
      animT += dt;
      const t = Math.min(animT / ANIM_HALF, 1);
      switchOffY = (GUN_HIDDEN_Y - basePos(currentWeapon).y) * t;
      if (animT >= ANIM_HALF) {
        gunGroup.remove(currentMesh);
        if (currentWeapon === GRENADE_ID) nadeLeave();
        currentWeapon = pendingId;
        currentMesh = getMesh(currentWeapon);
        gunGroup.add(currentMesh);
        if (currentWeapon === GRENADE_ID) nadeEnter();
        if (isKnife(currentWeapon)) knife.startDraw();
        phase = "up";
        animT = 0;
      }
    } else if (phase === "up") {
      animT += dt;
      const t = Math.min(animT / ANIM_HALF, 1);
      switchOffY = (GUN_HIDDEN_Y - basePos(currentWeapon).y) * (1 - t);
      if (animT >= ANIM_HALF) {
        switchOffY = 0;
        phase = "idle";
      }
    }

    // Giật: giảm theo hàm mũ
    kick *= Math.exp(-dt / KICK_TAU);
    if (kick < 1e-3) kick = 0;

    // Lắc hình số 8: x theo sin(φ), y theo sin(2φ); biên độ ∝ tốc độ
    const wantAmp = moveGrounded ? Math.min(1, moveSpeed / BOB_REF_SPEED) : 0;
    bobAmp += (wantAmp - bobAmp) * Math.min(1, dt * 10);
    if (moveGrounded) bobPhase += moveSpeed * dt * BOB_FREQ;

    // Reload. Súng 1 tay / ôm báng: hạ + chúc xuống (0..40%), giữ, đưa lên (80..100%). Súng 2 tay: nghiêng theo
    // poses.json (gunTiltDeg) và tay trái đi theo reloadLeftHand.keys
    const pose = weaponPose(currentWeapon).first;
    const rl = poses.reloadLeftHand;
    const rp = dbg.freezeReload >= 0 ? dbg.freezeReload : reloadProgress;
    const two = pose.hold === "twoHand";
    let r = 0;
    if (rp >= 0 && !two) {
      r = rp < RELOAD_UP_START ? smooth(rp / RELOAD_DOWN_END) : 1 - smooth((rp - RELOAD_UP_START) / (1 - RELOAD_UP_START));
    }
    let tiltRoll = 0, tiltPitch = 0;
    if (rp >= 0 && two) {
      const g = rl.gunTiltDeg;
      const w = smooth((rp - g.inT) / 0.15) * (1 - smooth((rp - (g.outT - 0.15)) / 0.15));
      tiltRoll = g.roll * w * DEG; tiltPitch = g.pitch * w * DEG;
    }

    // Ngắm: kéo súng vào giữa, thân súng thẳng trực diện, đầu ruồi trùng tâm màn hình
    aimT = phase === "idle" ? aimWant : 0;   // adsT đã mượt sẵn (inMs/outMs), không làm mượt lần nữa
    const a = smooth(aimT);
    const base = basePos(currentWeapon);
    const bx = base.x, by = base.y, bz = base.z;
    const sight = sights.get(currentWeapon);
    dbg.sight = sight ?? null;
    const adsX = sight ? -sight.x : 0;
    const adsY = sight ? -sight.y - (ADS_DROP[currentWeapon] ?? 0) : by + 0.2;
    const adsZ = sight ? -(pose.adsEyeDist ?? ADS_DIST) - sight.z : bz;
    const bob = 1 - a * (1 - ADS_BOB);   // lắc khi đi giảm 85% lúc ngắm
    const kickMul = 1 - 0.5 * a;          // giật hình (lùi/ngóc súng) giảm 50% lúc ngắm
    knife.update(dt, isKnife(currentWeapon) && !hidden, phase === "idle", Math.min(1, moveSpeed / BOB_REF_SPEED), bobPhase, bobAmp);
    const kf = knife.fx;
    const nadeCfg = currentWeapon === GRENADE_ID ? pose.grenade : undefined;
    const nadeOut = nadeCfg ? nadeAnim.update(dt * 1000) : null;
    if (nadeOut && nadeCfg) {
      // Lựu đạn: vị trí/xoay theo hoạt hình rút chốt → ném (grenadeAnim); đổi súng vẫn dùng switchOffY
      gunGroup.visible = !hidden;
      gunGroup.position.set(nadeOut.pos[0], nadeOut.pos[1] + switchOffY, nadeOut.pos[2]);
      gunGroup.rotation.set(nadeOut.rotDeg[0] * DEG, nadeOut.rotDeg[1] * DEG, nadeOut.rotDeg[2] * DEG);
      gunGroup.scale.setScalar(pose.scale);
      currentMesh.visible = nadeOut.show;
      setPin(nadeOut.pin);
    } else {
      gunGroup.visible = !(aimScoped && aimT > 0.6) && !hidden;
      gunGroup.position.set(
        bx + (adsX - bx) * a + Math.sin(bobPhase) * BOB_AMP_X * bobAmp * bob + kf.px,
        by + (adsY - by) * a + switchOffY + Math.sin(bobPhase * 2) * BOB_AMP_Y * bobAmp * bob - RELOAD_DROP * r + kf.py,
        bz + (adsZ - bz) * a + KICK_BACK * kick * kickMul + kf.pz,
      );
      const hip = 1 - a;   // góc đặt súng của poses.json mất dần khi ngắm (thân súng thẳng)
      gunGroup.rotation.set(
        pose.gunRotDeg[0] * DEG * hip + (pose.adsRotDeg?.[0] ?? 0) * DEG * a + KICK_PITCH * kick * kickMul - RELOAD_TILT * r + tiltPitch + kf.rx,
        pose.gunRotDeg[1] * DEG * hip + (pose.adsRotDeg?.[1] ?? 0) * DEG * a + kf.ry,
        pose.gunRotDeg[2] * DEG * hip + (pose.adsRotDeg?.[2] ?? 0) * DEG * a + tiltRoll + kf.rz,
      );
      gunGroup.scale.setScalar(pose.scale);
    }

    // Tay: giải IK SAU khi mọi hiệu ứng đã áp lên súng (thứ tự này tránh tay trễ súng một frame)
    gunGroup.updateMatrix();
    const M = gunGroup.matrix;
    const f = poses.first;
    shoulderR.set(f.shoulderR[0], f.shoulderR[1], f.shoulderR[2]);
    shoulderL.set(f.shoulderL[0], f.shoulderL[1], f.shoulderL[2]);
    poleR.set(shoulderR.x + f.poleR[0], shoulderR.y + f.poleR[1], shoulderR.z + f.poleR[2]);
    poleL.set(shoulderL.x + f.poleL[0], shoulderL.y + f.poleL[1], shoulderL.z + f.poleL[2]);
    const showArms = gunGroup.visible;
    const useFp = fpActive();
    armR.setVisible(showArms && !useFp);
    getAnchor(currentWeapon, "hand_r", targetR).applyMatrix4(M);
    armR.solve(shoulderR, targetR, poleR);
    dbg.validR = true;
    const leftOn = showArms && pose.hold !== "oneHand";
    armL.setVisible(leftOn && !useFp);
    dbg.validL = leftOn;
    let nadeRotR: Vec3 | undefined, nadeRotL: Vec3 | undefined;
    if (leftOn && nadeOut && nadeCfg) {
      // Tay trái: 'rest' (ngoài màn hình) hoặc đường rút chốt tới vòng chốt (hệ lựu đạn) + offset (không gian camera); làm mượt để không giật khi đổi đích
      const keyPoint = (k: { to: "rest" | "pin_pull"; offset?: Vec3 }, out: THREE.Vector3) => {
        if (k.to === "rest") out.set(nadeCfg.leftRest[0], nadeCfg.leftRest[1], nadeCfg.leftRest[2]);
        else getAnchor(currentWeapon, "pin_pull", out).applyMatrix4(M);
        if (k.offset) out.add(_off.set(k.offset[0], k.offset[1], k.offset[2]));
      };
      if (nadeOut.leftS < 0) targetL.set(nadeCfg.leftRest[0], nadeCfg.leftRest[1], nadeCfg.leftRest[2]);
      else {
        const seg = pathSegment(nadeCfg.pullLeftHandPath, nadeOut.leftS);
        keyPoint(seg.a, _a); keyPoint(seg.b, _b);
        targetL.lerpVectors(_a, _b, seg.u);
      }
      if (!nadeLeftInit) { nadeLeft.copy(targetL); nadeLeftInit = true; }
      nadeLeft.lerp(targetL, 1 - Math.exp(-dt / 0.05));
      targetL.copy(nadeLeft);
      armL.solve(shoulderL, targetL, poleL);
      nadeRotR = nadeCfg.handRotDegR; nadeRotL = nadeCfg.handRotDegL;
    } else if (leftOn) {
      const keys = rl.keys;
      if (rp >= 0 && keys.length >= 2) {
        let i = 0;
        while (i < keys.length - 2 && rp >= keys[i + 1]!.t) i++;
        const k0 = keys[i]!, k1 = keys[i + 1]!;
        const u = smooth(k1.t > k0.t ? (rp - k0.t) / (k1.t - k0.t) : 1);
        getAnchor(currentWeapon, k0.to, _a).applyMatrix4(M);
        getAnchor(currentWeapon, k1.to, _b).applyMatrix4(M);
        if (k0.offset) _a.add(_off.set(k0.offset[0], k0.offset[1], k0.offset[2]));
        if (k1.offset) _b.add(_off.set(k1.offset[0], k1.offset[1], k1.offset[2]));
        targetL.lerpVectors(_a, _b, u);
      } else {
        getAnchor(currentWeapon, "hand_l", targetL).applyMatrix4(M);
      }
      armL.solve(shoulderL, targetL, poleL);
    }
    if (!useFp) fp.setVisible(false)
    else {
      fp.setVisible(showArms)
      fp.setLeftVisible(leftOn)
      fp.place()
      fp.solve(targetR, leftOn ? targetL : null, gunGroup.quaternion, nadeRotR, nadeRotL)
    }
    updateMag(rp);
    armR.setReachedColor(dbg.showReach);
    armL.setReachedColor(dbg.showReach);

    // Flash tắt sau 50ms (timestamp-based, ổn định hơn frame-count)
    if (flash.visible && performance.now() >= flashEndMs) flash.visible = false;
  }

  function updateAspect(a: number) {
    cam.aspect = a;
    cam.updateProjectionMatrix();
  }

  const handle: ViewmodelHandle = {
    scene,
    cam,
    get currentWeapon() {
      return currentWeapon;
    },
    get targetWeapon() {
      return phase === "idle" ? currentWeapon : pendingId;
    },
    updateAspect,
    switchWeapon,
    snapTo,
    update,
    onFire,
    setMotion,
    setReload,
    setMove: knife.setMove.bind(knife),
    setLook: knife.setLook.bind(knife),
    inspect: () => { if (phase === "idle" && isKnife(currentWeapon) && !knife.flourishing) knife.inspect(); },
    setAim,
    get aimAmount() {
      return aimT;
    },
    setTeam(team: TeamId) {
      sleeve = colorOf(poses.style.sleeveColor[team]);
      armR.setColors(sleeve, skin);
      armL.setColors(sleeve, skin);
      fp.setTeam(team);
    },
    setGrenade(phase, mode, pullFrac, hasMore) { nadeAnim.setLogic(phase, mode, pullFrac, hasMore); },
    onGrenadeThrow() { nadeAnim.onThrow(); },
    get grenadePhase() { return nadeAnim.phase; },
    setSkin(skin: SkinId) { fp.setSkin(skin); },
    setBlockArms(v: boolean) { blockArms = v; },
    setHidden(h: boolean) { hidden = h; },
    debug: dbg,
  };
  if (import.meta.env?.DEV) (globalThis as { __vm?: ViewmodelHandle }).__vm = handle;   // debug: script kiểm tra từ trình duyệt
  return handle;
}
