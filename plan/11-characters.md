# 11 – Nhân vật mới cho 2 phe (model có xương) + dùng chính đôi tay đó để cầm súng

Nguồn: 2 model đã rig, T-pose, ~8.300 tam giác, đủ 5 ngón:
- `assets/source/characters/Dust2_CT_v2.glb` → **Cớm** (đội A): đặc nhiệm, áo navy, giáp đen
- `assets/source/characters/Dust2_T_v2.glb` → **Cướp** (đội B): áo khoác nâu, mũ len, bao súng ở đùi

Mục tiêu:
1. Thay nhân vật khối hộp bằng 2 model này, có animation đi/chạy/ngồi/nhảy/chết.
2. **Góc 3:** dùng xương tay thật của model, IK đưa 2 bàn tay bám điểm neo trên súng (thay `BlockArm` của task 10), ngón tay nắm lại.
3. **Góc 1:** cắt riêng **đôi tay của chính model đó** (tay áo khoác nâu / tay áo navy) làm tay viewmodel, cũng IK bám súng.
4. Hitbox gameplay **không đổi** (AABB như cũ), chỉ chỉnh tỉ lệ model cho khớp hitbox.

Nguyên tắc giữ nguyên từ task 10: tay không có animation riêng khi cầm súng, **IK bám điểm neo** (`hand_r`, `hand_l`, `mag`), mọi con số chỉnh trong `poses.json` + bảng F9.

Thứ tự: C.0 → C.1 → C.2 (người dùng làm Mixamo) → C.3 → C.4 → C.5 → C.6 → C.7 → C.8. Task ⚠️ nên dùng model mạnh.

---

## Task C.0 – Kiểm tra đầu vào (Claude Code, không sửa gì)

Mở rộng `tools/blender/gun_tool.py` thành `tools/blender/asset_tool.py` (giữ nguyên các chế độ cũ) thêm chế độ `inspect-character`:
- Import glb vào scene trống, in JSON:
  - chiều cao (bbox z), toạ độ chân/đỉnh đầu, hướng mặt nhân vật (ước lượng: mũi/mặt ở phía nào; nếu không chắc, ghi "cần xác nhận")
  - danh sách mesh, số tam giác mỗi mesh, material, texture (kích thước từng ảnh)
  - armature: tên toàn bộ xương theo cây phân cấp, độ dài xương tay (upper arm, forearm, hand), có xương ngón không
  - animation có sẵn trong file (nếu có)
  - vertex group của mesh (để biết có tách được tay không)
- Render 2 ảnh PNG xem nhanh (workbench, nền xám): chính diện và nghiêng 90°, lưu `assets/source/characters/_preview/`.

Báo cáo cho người dùng:
- [ ] Chiều cao gốc, hướng mặt, tên xương tay/ngón trái phải.
- [ ] Bao súng ở đùi của Cướp là **mesh riêng** hay **dính chung** mesh thân.
- [ ] Tổng dung lượng texture, đề xuất mức nén.

---

## Task C.1 – Chuẩn hoá + xuất FBX để đưa lên Mixamo (Claude Code)

Hai model đang có xương riêng, tên xương lạ. Cách gọn nhất để có **bộ animation dùng chung cho cả 2 phe**: cho Mixamo **rig lại** cả hai (Mixamo tự gắn xương chuẩn `mixamorig:*`), rồi animation tải một lần dùng cho cả hai.

Làm (`asset_tool.py`, chế độ `prep-mixamo`):
- Import glb, **xoá armature cũ** (giữ mesh), apply mọi transform.
- Scale cho **chiều cao = 1,80m** (đỉnh đầu, tính cả mũ), đặt chân ở `z = 0`, tâm ngang ở gốc, **mặt quay về −Y** của Blender (Mixamo cần nhân vật nhìn thẳng ra trước).
- Gộp các mesh thân thành 1 object (trừ phụ kiện cần giữ riêng: bao súng đùi nếu là mesh riêng).
- Đảm bảo texture được đóng gói (`pack_all`) rồi xuất **FBX** (`path_mode='COPY'`, `embed_textures=True`) ra:
  - `assets/source/characters/mixamo_in/cop.fbx`
  - `assets/source/characters/mixamo_in/robber.fbx`

Nghiệm thu:
- [ ] Import lại FBX vào Blender trống: cao 1,80m, đứng trên mặt đất, nhìn về −Y, có texture.

---

## Task C.2 – Mixamo (NGƯỜI DÙNG làm tay, ~20 phút)

Claude Code không đăng nhập Mixamo được, bước này bạn làm trên trình duyệt (mixamo.com, tài khoản Adobe miễn phí).

### Rig 2 nhân vật

1. Upload `cop.fbx` → Mixamo hỏi đặt điểm: cằm, 2 cổ tay, 2 khuỷu, 2 đầu gối, háng. Chọn **Skeleton LOD: Standard Skeleton (65)** (có đủ xương ngón).
2. Xem thử animation bất kỳ, thấy ổn thì **Download**: Format `FBX Binary`, Skin `With Skin`, Pose `T-pose`. Lưu `mixamo_out/cop_rigged.fbx`.
3. Làm y hệt với `robber.fbx` → `mixamo_out/robber_rigged.fbx`.

### Tải animation (chỉ cần làm với 1 nhân vật, ví dụ cop)

Với mỗi animation dưới: tìm theo từ khoá, tick **In Place** (nếu có ô đó), Download: `FBX Binary`, Skin **Without Skin**, Frames per Second `30`. Đặt tên file đúng như cột "Lưu thành":

| Lưu thành | Từ khoá tìm trên Mixamo | Ghi chú |
|---|---|---|
| `rifle_idle.fbx` | rifle aiming idle | đứng ngắm súng dài |
| `rifle_walk_f.fbx` | rifle walk forward | |
| `rifle_walk_b.fbx` | rifle walk backward | |
| `rifle_walk_l.fbx` | rifle strafe left / walk left | |
| `rifle_walk_r.fbx` | rifle strafe right / walk right | |
| `rifle_run_f.fbx` | rifle run | |
| `rifle_crouch_idle.fbx` | rifle crouch idle / crouching aim | |
| `rifle_crouch_walk.fbx` | rifle crouch walk | |
| `pistol_idle.fbx` | pistol idle | cho súng ngắn và dao |
| `pistol_walk_f.fbx` | pistol walk | |
| `pistol_run_f.fbx` | pistol run | |
| `jump.fbx` | jump / rifle jump | chọn bản ít di chuyển thân |
| `slide.fbx` | baseball slide / slide | cho chiêu trượt; không có thì bỏ qua |
| `death_1.fbx`, `death_2.fbx` | dying / death from front / death from back | 2 kiểu chết |

Bỏ tất cả file vào `assets/source/characters/mixamo_out/anims/`. Không tìm được cái nào thì cứ bỏ qua, ghi lại tên để báo Claude Code.

---

## Task C.3 – Ghép animation + xuất glb cho game (Claude Code) ⚠️

Làm (`asset_tool.py`, chế độ `build-character`):
- Import `<team>_rigged.fbx`. Với từng file trong `anims/`: import, lấy action ra, **đổi tên action theo tên file** (bỏ `.fbx`), gán vào armature của nhân vật (cùng tên xương `mixamorig:*` nên khớp trực tiếp), xoá armature tạm.
- Action nào còn **trôi vị trí gốc** (root motion, do Mixamo không có ô In Place): xoá keyframe vị trí X/Y của xương `mixamorig:Hips` (giữ trục Z để còn nhún lên xuống).
- Đẩy mọi action vào NLA (mỗi action một strip, tắt hết) để exporter glTF xuất đủ.
- Nén texture: ảnh > 2048px giảm còn 2048; ảnh mặt/thân giữ 2048, phụ kiện 1024.
- Xuất `client/public/models/characters/cop.glb`, `robber.glb` (`export_animations=True`, `export_nla_strips=True`, `export_yup=True`).
- Sau đó chạy `gltf-transform optimize` (texture webp), như với súng.

Nghiệm thu:
- [ ] `inspect-character` trên file glb xuất ra: cao 1,80m, có đủ action theo tên file, mỗi file ≤ 8MB.
- [ ] Viewer (`client/viewer.html?model=characters/cop`) thêm dropdown chọn animation: mọi animation chạy đúng, nhân vật **đứng yên tại chỗ** (không trôi đi).
- [ ] Hai nhân vật dùng chung một danh sách animation.

Pitfall:
- Tên xương trong three.js **không có dấu hai chấm**: `mixamorig:LeftArm` thành `mixamorigLeftArm`. Mọi chỗ tra xương trong code dùng tên không dấu hai chấm.
- Mixamo xuất đơn vị centimet trong FBX, import Blender có thể ra scale 0,01 trên armature. Kiểm tra bằng chiều cao sau import, apply scale trước khi xuất.

---

## Task C.4 – Nhân vật trong game: animation thân dưới, thân trên ngắm theo pitch

Làm (`client/src/render/characterRig.ts`):
- Load `cop.glb` / `robber.glb` một lần, mỗi người chơi `SkeletonUtils.clone()` một bản (bắt buộc dùng `SkeletonUtils.clone`, không dùng `.clone()` thường, không thì xương dùng chung).
- `AnimationMixer` mỗi nhân vật. Bộ trạng thái thân dưới, chọn theo **vận tốc nội suy** (không theo input):
  - `grounded` + tốc độ < 0,3 m/s → idle (hoặc crouch idle)
  - đi: blend 4 hướng (`walk_f/b/l/r`) theo hướng vận tốc **trong hệ của nhân vật**, trọng số theo cos góc; tốc độ > 6 m/s dùng `run_f` (phát nhanh/chậm theo tốc độ thực)
  - ngồi + di chuyển → `crouch_walk`
  - trên không → `jump` (giữ ở frame giữa khi đang rơi)
  - đang trượt → `slide` (nếu có), không có thì `crouch_idle` + hạ thấp thân
  - chuyển trạng thái `crossFadeTo` 0,15s
- Bộ súng dài (`third.hold = twoHand`) dùng bộ `rifle_*`; súng ngắn và dao dùng bộ `pistol_*`.
- **Ngắm theo pitch:** sau `mixer.update`, cộng thêm góc xoay quanh trục ngang cho `mixamorigSpine`, `Spine1`, `Spine2` (chia đều pitch cho 3 xương, giới hạn ±60°), và một phần cho `Head`.
- Kích thước khớp hitbox: model cao 1,80m; ngồi (crouch) phải hạ đỉnh đầu xuống khoảng `crouchHeight` (1,2m). Nếu animation ngồi cao hơn, hạ cả model xuống thêm cho khớp (`poses.json: character.crouchDrop`).
- Đội A dùng `cop.glb`, đội B dùng `robber.glb`. Đổi đội thì đổi model.
- Bỏ nhân vật khối hộp cũ (giữ code ở chế độ `?blocky=1` để so sánh khi debug).

Nghiệm thu:
- [ ] Người khác chạy các hướng: chân bước đúng hướng di chuyển, không trượt chân như trượt băng quá rõ.
- [ ] Ngước lên/cúi xuống: thân trên và đầu xoay theo.
- [ ] Bật F7 (debug hitbox): hộp đầu ôm đầu model, hộp thân ôm thân, cả khi đứng và khi ngồi.
- [ ] 10 nhân vật cùng lúc vẫn ≥ 60 FPS trên máy văn phòng.

---

## Task C.5 – Góc 3: hai bàn tay thật bám súng (thay BlockArm) ⚠️

Làm (`client/src/render/skeletonArm.ts`), cùng interface với `BlockArm` để code task 10 dùng lại:

```ts
export class SkeletonArm {
  constructor(upper: THREE.Bone, fore: THREE.Bone, hand: THREE.Bone, fingers: FingerBones, side: 'L' | 'R');
  solve(target: THREE.Vector3, targetQuat: THREE.Quaternion, pole: THREE.Vector3, weight: number): { reached: boolean };
}
```

- Vai = vị trí thế giới của xương `upper` (`mixamorigRightArm` / `LeftArm`), **không** lấy từ JSON nữa. Độ dài bắp tay, cẳng tay đo từ xương lúc load.
- Dùng lại hàm `solveTwoBone` (task P.2) để ra vị trí khuỷu và bàn tay mong muốn, rồi **xoay xương** cho khớp:
  1. Với `upper`: tính hướng hiện tại (vai → khuỷu hiện tại) và hướng mong muốn (vai → khuỷu mới), lấy quaternion xoay giữa 2 hướng trong **hệ thế giới**, đổi về hệ của parent, nhân vào `upper.quaternion`. Cập nhật matrixWorld.
  2. Làm tương tự với `fore` (khuỷu → cổ tay).
  3. `hand`: đặt hướng thế giới = `targetQuat` (hướng của Empty neo trên súng) nhân với `handRotOffsetDeg` trong JSON, đổi về hệ parent.
- `weight` (0..1) để trộn giữa tư thế animation và IK (dùng khi đổi súng, chết: giảm về 0 trong 0,15s).
- **Ngón tay nắm súng:** đặt góc gập cố định cho từng đốt ngón (`Index1..3`, `Middle1..3`, `Ring1..3`, `Pinky1..3`, `Thumb1..3`) theo `poses.json: grip`. Tay phải ngón trỏ gập ít hơn (đặt ở cò).
- Thứ tự mỗi frame (bắt buộc): `mixer.update` → xoay spine theo pitch → `updateMatrixWorld` → đặt súng theo `third.gunPos` (gắn vào `aimPivot` là con của `mixamorigSpine2`) → `updateMatrixWorld` → đọc anchor → `armR.solve` → `armL.solve` → ngón tay.
- Súng ngắn / dao (`oneHand`): gắn súng vào `mixamorigRightHand`, tay phải theo animation `pistol_*`, IK chỉ áp cho tay trái nếu `third.leftSupport = true` (mặc định false).

Thêm vào `poses.json`:

```json
"character": {
  "crouchDrop": 0.0,
  "aimPivotBone": "mixamorigSpine2",
  "spinePitchBones": ["mixamorigSpine", "mixamorigSpine1", "mixamorigSpine2"],
  "spinePitchLimitDeg": 60,
  "headPitchShare": 0.3,
  "poleR": [0.35, -0.6, 0.3],
  "poleL": [-0.35, -0.6, 0.1],
  "handRotOffsetDegR": [0, 0, 0],
  "handRotOffsetDegL": [0, 0, 0]
},
"grip": {
  "R": { "thumb": [10, 20, 15], "index": [15, 20, 10], "middle": [55, 70, 40], "ring": [60, 75, 45], "pinky": [65, 75, 45] },
  "L": { "thumb": [15, 25, 20], "index": [45, 55, 35], "middle": [55, 65, 40], "ring": [60, 70, 45], "pinky": [65, 70, 45] },
  "axis": "x"
}
```

- `grip.*.<ngón>` = 3 góc gập (độ) cho đốt 1, 2, 3. `axis` = trục gập của xương ngón (Mixamo thường là trục X cục bộ; nếu ngón gập ngang sang bên thay vì gập vào lòng bàn tay → đổi sang `z` và kiểm tra lại, đổi dấu nếu gập ngược).
- `weapons.<key>.third.gunPos/gunRotDeg` giữ nguyên ý nghĩa nhưng giờ tính từ `aimPivotBone`. Giá trị cũ của task 10 sẽ phải chỉnh lại bằng F9 + F10.

Nghiệm thu (F10):
- [ ] Cớm và Cướp cầm AK47/M16/Sniper/Shotgun/SMG: tay phải nắm tay cầm, tay trái đỡ ốp trước, ngón tay cong ôm súng.
- [ ] Đi, chạy, ngồi, ngước lên/cúi xuống: hai tay vẫn bám súng, không xoắn cổ tay, khuỷu không gập ngược.
- [ ] Bắn: súng giật, tay theo.
- [ ] Đổi súng dài ↔ súng ngắn: chuyển mượt 0,15s, không có frame tay vặn vẹo.
- [ ] Bảng F9 tab `Character` và `Grip` chỉnh được mọi trường mới.

Pitfall:
- Cổ tay/khuỷu xoắn như dây thừng → đang xoay xương bằng hệ toạ độ sai (thế giới vs parent). Luôn: quaternion thế giới mong muốn → `parentWorldQuat.invert() * desiredWorldQuat`.
- Tay giật 1 frame sau súng → sai thứ tự cập nhật, xem danh sách thứ tự ở trên.
- `SkinnedMesh` bị cắt khi đi gần camera (frustum culling sai vì bbox lúc T-pose) → `mesh.frustumCulled = false` cho nhân vật.

---

## Task C.6 – Góc 1: cắt đôi tay của model làm tay viewmodel ⚠️

### C.6.1 Tách tay (Blender, `asset_tool.py`, chế độ `build-fp-arms`)

- Từ `<team>_rigged.fbx` (đã có xương Mixamo):
  - Giữ lại các đỉnh có tổng trọng số skin trên các xương **tay** ≥ 0,5: `LeftArm`, `LeftForeArm`, `LeftHand*`, `RightArm`, `RightForeArm`, `RightHand*` (kể cả mọi xương ngón). Xoá các đỉnh còn lại.
  - Cắt thêm phần bắp tay gần vai (đỉnh có trọng số `LeftArm`/`RightArm` > 0,8 **và** cách vai < 40% chiều dài bắp tay) để mép cắt không lọt vào màn hình. Tham số `--keep-upper=0.6` (giữ 60% bắp tay phía khuỷu).
  - Giữ nguyên armature, xoá mọi action.
  - Xuất `client/public/models/characters/cop_fparms.glb`, `robber_fparms.glb`.
- Tay áo tự động đúng phe: Cớm tay áo navy + găng (nếu model có), Cướp tay áo khoác nâu.

Nghiệm thu:
- [ ] Viewer: chỉ còn 2 cánh tay (bắp tay đến bàn tay), không còn mảnh thân/vai lơ lửng, mép cắt gọn.
- [ ] Mỗi file ≤ 2MB.

### C.6.2 Dùng trong viewmodel

- Thay 2 `BlockArm` trong `viewmodel.ts` bằng 2 `SkeletonArm` trên model `<team>_fparms.glb` (con của `viewScene`).
- Vị trí vai: đặt **root của armature** sao cho xương `RightArm`/`LeftArm` nằm ở `first.shoulderR/L` (có thể không trùng hoàn toàn cả hai cùng lúc: đặt root theo trung điểm hai vai, xoay theo hướng nhìn của camera, rồi chỉnh `first.armsRootOffset` / `first.armsRootRotDeg` trong JSON).
- IK, ngón tay, nạp đạn tay trái (`reloadLeftHand`): **dùng y hệt** logic của task 10 / C.5.
- `mesh.frustumCulled = false`; ánh sáng của `viewScene` giữ như task P.5.
- Đổi đội → đổi model tay.
- Giữ `BlockArm` làm dự phòng khi file `_fparms.glb` không load được (log cảnh báo).

Thêm vào `poses.json` → `first`:

```json
"armsRootOffset": [0.0, -0.35, 0.10],
"armsRootRotDeg": [0, 0, 0],
"armsScale": 1.0
```

Nghiệm thu:
- [ ] Cướp: thấy 2 tay áo khoác nâu, bàn tay da người, ngón tay ôm súng. Cớm: tay áo navy.
- [ ] Không thấy mép cắt, không thấy vai trong khung hình ở FOV 54 khi đứng, chạy, bắn, nạp đạn.
- [ ] Nạp đạn: tay trái cầm băng đạn kéo xuống, lắp lại, ngón tay vẫn nắm.

---

## Task C.7 – Chết, đổi đội, dọn dẹp

- Chết: dừng IK (weight → 0), phát ngẫu nhiên `death_1`/`death_2` (không lặp, giữ frame cuối), súng tách khỏi tay rơi xuống đất (vật lý đơn giản: rơi thẳng + xoay, dừng khi chạm sàn), 3 giây sau mờ dần. Thay cho hiệu ứng "khối tách bay" của task 6.2 khi dùng model có xương.
- Hồi sinh: reset mixer, IK weight về 1 trong 0,15s.
- Đổi đội / rời phòng: `dispose` geometry, material, texture của bản clone (texture dùng chung thì **không** dispose), không rò bộ nhớ (kiểm tra `renderer.info.memory` trước và sau 20 lần vào/ra).

Nghiệm thu:
- [ ] Bị bắn chết: ngã theo 1 trong 2 kiểu, súng rơi.
- [ ] 20 lần vào/ra phòng: `renderer.info.memory.geometries/textures` không tăng mãi.

---

## Task C.8 – Ghi chú bản quyền (người dùng kiểm tra)

- Kiểm tra license của 2 model trong thư viện nơi bạn clone (Community). Dùng nội bộ thường không sao; nếu sau này public game thì phải chắc license cho phép, và **đổi tên file/tên hiển thị** khỏi "Dust2", "T", "CT" (tên gắn với Counter-Strike), dùng `cop`/`robber` như trong plan.

---

## Ghi chú cho người dùng

- Bao súng ở đùi của Cướp: nếu C.0 báo là mesh riêng, giữ hay bỏ tuỳ bạn (giữ khá hợp chất "cướp"). Nếu dính chung mesh thân thì cứ để, không đáng công tách.
- 8.300 tam giác mỗi nhân vật là ổn cho máy tính bàn; chỉ đáng lo nếu sau này chơi trên điện thoại.
- Phong cách giờ là **người thật + di chuyển kiểu Krunker** (trượt, bunny hop). Nhìn người thật nhảy liên tục có thể hơi buồn cười; nếu thấy kỳ, chỉnh animation `jump`/`slide` hoặc giảm tốc độ trong `MovementConfig`.
