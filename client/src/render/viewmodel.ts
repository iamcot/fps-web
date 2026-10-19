import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// ── Hằng số ────────────────────────────────────────────────────────────────────
const GUN_DEFAULT_POS = new THREE.Vector3(0.28, -0.3, -0.45);
const GUN_HIDDEN_Y = -0.55;
const ANIM_HALF = 0.15; // 0.15 s mỗi chiều

// ── Thông số load model ────────────────────────────────────────────────────────
// Scale + rotation đã baked vào GunRoot node trong GLB → chỉ load, không re-apply
const WEAPON_FILES = [
  "/models/ak47.glb",
  "/models/m16.glb",
  "/models/colt.glb",
  "/models/rouleau.glb",
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

// ── ViewmodelHandle ────────────────────────────────────────────────────────────
export interface ViewmodelHandle {
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  readonly currentWeapon: number;
  updateAspect(aspect: number): void;
  switchWeapon(id: number): void;
  update(dt: number): void;
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
        loaded.set(wid, model);
        if (wid === currentWeapon && phase === "idle") {
          gunGroup.remove(currentMesh);
          currentMesh = model;
          gunGroup.add(currentMesh);
        }
      })
      .catch((err) => console.warn(`viewmodel: cannot load ${file}`, err));
  }

  // Animation
  type Phase = "idle" | "down" | "up";
  let phase: Phase = "idle";
  let animT = 0;
  let pendingId = -1;

  function getMesh(id: number): THREE.Object3D {
    return loaded.get(id) ?? buildPlaceholder(id);
  }

  function switchWeapon(id: number) {
    if (id === currentWeapon && phase === "idle") return;
    if (phase !== "idle") return;
    pendingId = id;
    phase = "down";
    animT = 0;
  }

  function update(dt: number) {
    if (phase === "idle") return;
    animT += dt;

    if (phase === "down") {
      const t = Math.min(animT / ANIM_HALF, 1);
      gunGroup.position.y =
        GUN_DEFAULT_POS.y + (GUN_HIDDEN_Y - GUN_DEFAULT_POS.y) * t;
      if (animT >= ANIM_HALF) {
        gunGroup.remove(currentMesh);
        currentWeapon = pendingId;
        currentMesh = getMesh(currentWeapon);
        gunGroup.add(currentMesh);
        phase = "up";
        animT = 0;
      }
    } else if (phase === "up") {
      const t = Math.min(animT / ANIM_HALF, 1);
      gunGroup.position.y =
        GUN_HIDDEN_Y + (GUN_DEFAULT_POS.y - GUN_HIDDEN_Y) * t;
      if (animT >= ANIM_HALF) {
        gunGroup.position.y = GUN_DEFAULT_POS.y;
        phase = "idle";
      }
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
    updateAspect,
    switchWeapon,
    update,
  };
}
