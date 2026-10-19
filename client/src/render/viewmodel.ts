import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

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
const FLASH_SIZE = 0.14;

// ── Ngắm (ADS) ─────────────────────────────────────────────────────────────────
const ADS_DIST = 0.45; // đầu ruồi cách mắt bấy nhiêu mét: xa hơn = súng/đầu ngắm nhỏ hơn
const ADS_RATE = 14; // 1/giây: tốc độ chuyển vào/ra tư thế ngắm
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
  /** Tiến độ reload 0..1, hoặc -1 nếu không reload */
  setReload(progress: number): void;
  /** Đang giữ ngắm không (scoped: che súng khi vào scope). Chuyển mượt trong update */
  setAim(aiming: boolean, scoped: boolean): void;
  /** 0 (hông) … 1 (ngắm xong) */
  readonly aimAmount: number;
}

export function createViewmodel(aspect: number): ViewmodelHandle {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, aspect, 0.01, 20);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(1, 2, 1);
  scene.add(dl);

  const gunGroup = new THREE.Group();
  gunGroup.position.copy(GUN_DEFAULT_POS);
  scene.add(gunGroup);

  // ── Cánh tay trái (sleeve) ─────────────────────────────────────────────────
  // Dựng cánh tay đi từ cạnh dưới màn hình vươn lên ôm lấy thân súng
  // const armMesh = new THREE.Mesh(
  //   new THREE.BoxGeometry(0.15, 0.7, 0.3), // [rộng, chiều dài, độ dày]
  //   new THREE.MeshLambertMaterial({ color: 0x1e2840 }), // màu tay áo tối
  // )

  // // Dịch sang phải và tiến lên phía trước (Z âm nhiều hơn) để khớp với ống lót tay của súng
  // armMesh.position.set(-0.18, -0.28, -0.38)

  // // Xoay nhẹ để tay ôm tự nhiên vào thân súng
  // armMesh.rotation.z = -0.25;
  // armMesh.rotation.x = 0.35;

  // gunGroup.add(armMesh)

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
  let flashShown = false;
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
  let aimWant = false;
  let aimScoped = false;
  let aimT = 0;

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
  }

  function onFire(melee = false) {
    kick = melee ? 3 : 1;   // dao: vung mạnh hơn
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
    flashShown = false;
  }

  function setMotion(speed: number, grounded: boolean) {
    moveSpeed = speed;
    moveGrounded = grounded;
  }

  function setReload(progress: number) {
    reloadProgress = progress;
  }

  function setAim(aiming: boolean, scoped: boolean) {
    aimWant = aiming;
    aimScoped = scoped;
  }

  function update(dt: number) {
    // Đổi súng
    if (phase === "down") {
      animT += dt;
      const t = Math.min(animT / ANIM_HALF, 1);
      switchOffY = (GUN_HIDDEN_Y - GUN_DEFAULT_POS.y) * t;
      if (animT >= ANIM_HALF) {
        gunGroup.remove(currentMesh);
        currentWeapon = pendingId;
        currentMesh = getMesh(currentWeapon);
        gunGroup.add(currentMesh);
        phase = "up";
        animT = 0;
      }
    } else if (phase === "up") {
      animT += dt;
      const t = Math.min(animT / ANIM_HALF, 1);
      switchOffY = (GUN_HIDDEN_Y - GUN_DEFAULT_POS.y) * (1 - t);
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

    // Reload: hạ + chúc xuống (0..40%), giữ, đưa lên (80..100%)
    let r = 0;
    if (reloadProgress >= 0) {
      r =
        reloadProgress < RELOAD_UP_START
          ? smooth(reloadProgress / RELOAD_DOWN_END)
          : 1 - smooth((reloadProgress - RELOAD_UP_START) / (1 - RELOAD_UP_START));
    }

    // Ngắm: kéo súng vào giữa, thân súng thẳng trực diện, đầu ruồi trùng tâm màn hình
    aimT += ((aimWant && phase === "idle" ? 1 : 0) - aimT) * Math.min(1, dt * ADS_RATE);
    if (Math.abs(aimT - (aimWant ? 1 : 0)) < 1e-3) aimT = aimWant ? 1 : 0;
    const a = smooth(aimT);
    const sight = sights.get(currentWeapon);
    const adsX = sight ? -sight.x : 0;
    const adsY = sight ? -sight.y - (ADS_DROP[currentWeapon] ?? 0) : GUN_DEFAULT_POS.y + 0.2;
    const adsZ = sight ? -ADS_DIST - sight.z : GUN_DEFAULT_POS.z;
    const bob = 1 - a * (1 - ADS_BOB);
    gunGroup.visible = !(aimScoped && aimT > 0.6);
    gunGroup.position.set(
      GUN_DEFAULT_POS.x + (adsX - GUN_DEFAULT_POS.x) * a + Math.sin(bobPhase) * BOB_AMP_X * bobAmp * bob,
      GUN_DEFAULT_POS.y + (adsY - GUN_DEFAULT_POS.y) * a + switchOffY + Math.sin(bobPhase * 2) * BOB_AMP_Y * bobAmp * bob - RELOAD_DROP * r,
      GUN_DEFAULT_POS.z + (adsZ - GUN_DEFAULT_POS.z) * a + KICK_BACK * kick,
    );
    gunGroup.rotation.x = KICK_PITCH * kick - RELOAD_TILT * r;

    // Flash hiện đúng 1 frame render
    if (flash.visible) {
      if (flashShown) flash.visible = false;
      else flashShown = true;
    }
  }

  function updateAspect(a: number) {
    cam.aspect = a;
    cam.updateProjectionMatrix();
  }

  return {
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
    setAim,
    get aimAmount() {
      return aimT;
    },
  };
}
