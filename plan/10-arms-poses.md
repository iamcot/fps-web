# 10 – Tay nhân vật: cầm súng 2 tay (góc 3) và cánh tay trong góc 1

Mục tiêu:
- **Góc nhìn người khác (3rd person):** vũ khí 2 tay (AK47, M16, Sniper, Shotgun, SMG) thì **hai tay chụm lại cùng cầm súng**: tay phải ở tay cầm, tay trái đỡ ốp lót tay phía trước. Súng ngắn và dao giữ **như hiện tại**.
- **Góc nhìn của mình (1st person):** vẽ **hai cánh tay khối hộp** (tay phải nắm grip, tay trái đỡ súng) để có thể đẩy súng ra xa hơn, súng chiếm ít màn hình hơn.
- **Mọi con số nằm trong một file JSON** (`client/src/render/poses.json`), có bảng chỉnh F9, chỉnh xong bấm "Copy JSON" dán lại.

Ý tưởng chung: **không làm animation tay**. Súng được đặt theo JSON, hai bàn tay **tự bám vào các điểm neo trên súng** bằng IK 2 khớp (vai → khuỷu → bàn tay). Súng giật, lắc, nạp đạn thì tay tự đi theo.

Thứ tự task: P.1 → P.2 → P.3 → P.4 → P.5 → P.6. Task ⚠️ nên dùng model mạnh.

---

## Quy ước toạ độ (bắt buộc đọc)

- **Điểm neo trên súng:** tính trong hệ toạ độ của súng sau khi chuẩn hoá (task `tools-blend-to-glb.md`): gốc = tay cầm, nòng chĩa **−Z**, trên là **+Y**.
  - `hand_r`: chỗ tay phải nắm (thường là `[0,0,0]` vì gốc đã ở tay cầm)
  - `hand_l`: chỗ tay trái đỡ (ốp lót tay / tay cầm trước). Súng ngắn: ngay dưới-trước tay phải.
  - `mag`: tâm băng đạn (dùng khi nạp đạn)
- **3rd person:** tính từ **chân** nhân vật, nhân vật nhìn về **−Z**, bên phải là **+X**.
- **1st person:** tính trong không gian **camera viewmodel** (camera ở gốc, nhìn −Z, phải +X, trên +Y).
- Góc trong JSON là **độ**, thứ tự xoay `XYZ`.

---

## Task P.1 – Điểm neo trên súng

Làm:
- Mở rộng `tools/blender/gun_tool.py`: params nhận thêm `"anchors": { "hand_r": [...], "hand_l": [...], "mag": [...] }` (toạ độ **gốc của file**, giống `muzzle`). Mỗi anchor thành một Empty cùng tên trong glb.
- Cách ước lượng khi đọc kết quả `inspect`:
  - `hand_l`: tâm object có tên chứa `handguard`, `foregrip`, `fore`, `pump` (shotgun). Không có → điểm cách tay cầm **55–60%** quãng từ tay cầm tới đầu nòng, hạ xuống mép dưới thân súng.
  - `mag`: tâm object `mag` (đã đổi tên ở bước chuẩn hoá).
  - Không chắc → hỏi người dùng, đừng đoán.
- Client: khi load súng, đọc anchor từ glb (`getObjectByName`). **Ưu tiên anchor trong JSON** nếu JSON có ghi (để người dùng chỉnh tay), không có mới dùng anchor trong glb.

Nghiệm thu:
- [ ] Bật debug F9 (task P.6): mỗi súng hiện 3 chấm màu tại `hand_r` (đỏ), `hand_l` (xanh), `mag` (vàng), nằm đúng chỗ trên model.

---

## Task P.2 – Tay khối hộp + IK 2 khớp ⚠️

Tạo `client/src/render/blockArm.ts`:

```ts
export interface ArmStyle { upperLen: number; foreLen: number; thickness: number; handSize: number; }

export class BlockArm {
  constructor(style: ArmStyle, sleeveColor: number, skinColor: number);
  readonly root: THREE.Object3D;   // add vào scene/parent
  // shoulder, target, pole: toạ độ trong hệ của parent của root
  solve(shoulder: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3): { reached: boolean };
  setVisible(v: boolean): void;
  dispose(): void;
}
```

- Cấu tạo: **bắp tay** (box, màu áo), **cẳng tay** (box, màu áo hoặc màu da tuỳ `sleeveToElbow`), **bàn tay** (cube `handSize`, màu da). Box dài theo trục **local Z**, gốc box đặt ở đầu khớp (dùng `geometry.translate(0, 0, -len/2)` một lần lúc tạo).
- IK giải tích, **không cấp phát** trong `solve` (dùng biến tạm của class):

```ts
// a = độ dài bắp tay, b = độ dài cẳng tay
const toT = target - shoulder;
let d = |toT|;
const dir = toT / d;
d = clamp(d, |a - b| + 1e-4, a + b - 1e-4);      // với không tới thì duỗi thẳng
const x = (a*a - b*b + d*d) / (2*d);              // khoảng cách từ vai tới hình chiếu khuỷu
const h = sqrt(max(a*a - x*x, 0));
const p = pole - shoulder;
const perp = normalize(p - dir * dot(p, dir));    // hướng khuỷu, vuông góc với dir
const elbow = shoulder + dir * x + perp * h;
const hand  = shoulder + dir * d;                 // = target nếu với tới
// bắp tay: đặt tại shoulder, lookAt(elbow); cẳng tay: đặt tại elbow, lookAt(hand); bàn tay: tại hand, cùng hướng cẳng tay
reached = (|toT| <= a + b);
```

- `lookAt` cần trục up: dùng `perp` làm up để tay không xoắn khi xoay.
- Trường hợp `perp` gần 0 (pole nằm trên đường vai–tay): dùng trục up mặc định `(0,1,0)` hoặc `(1,0,0)` nếu trùng phương.

Nghiệm thu:
- [ ] Test (vitest, chỉ phần toán, tách thành hàm thuần `solveTwoBone`): target trong tầm → `|elbow − shoulder| = a`, `|hand − elbow| = b`, `hand = target` (sai số 1e-6).
- [ ] Test: target quá xa → hand nằm trên đường vai–target, cách vai `a + b`, `reached = false`.
- [ ] Test: khuỷu luôn nằm cùng phía với pole.
- [ ] Profiler: 10 nhân vật trên màn hình, `solve` không tạo object mới (kiểm tra bằng heap snapshot hoặc đếm `new` trong code).

---

## Task P.3 – File JSON tư thế

- Copy `plan/10-poses.default.json` vào `client/src/render/poses.json`.
- Tạo kiểu dữ liệu TypeScript tương ứng (`poses.ts`) và hàm `loadPoses()` có **kiểm tra hợp lệ**: thiếu trường thì lấy giá trị mặc định và `console.warn` một lần, không crash. Trường `_doc` bỏ qua.
- Dev mode: sửa file JSON thì Vite hot-reload tư thế ngay, không cần reload trang (dùng `import.meta.hot`).

Ý nghĩa các trường:

| Trường | Ý nghĩa |
|---|---|
| `style.third/first` | độ dài bắp tay, cẳng tay, độ dày, cỡ bàn tay cho từng góc nhìn |
| `style.sleeveColor.A/B` | màu tay áo theo đội (A = Cớm, B = Cướp) |
| `third.shoulderR/L` | vị trí vai, tính từ chân nhân vật |
| `third.aimPivot` | điểm xoay theo pitch (ngước lên/cúi xuống) của thân trên + súng |
| `third.poleR/L`, `first.poleR/L` | hướng khuỷu tay chĩa ra, **tính tương đối từ vai** |
| `first.fov` | FOV của camera viewmodel |
| `first.shoulderR/L` | vai trong không gian camera (thường ở dưới và hơi sau camera, ngoài màn hình) |
| `weapons.<key>.anchors` | điểm neo trên súng (ghi đè anchor trong glb) |
| `weapons.<key>.third.hold` | `twoHand` hoặc `oneHand` (oneHand = giữ nguyên code hiện tại) |
| `weapons.<key>.third.gunPos/gunRotDeg` | vị trí tay cầm súng tính từ `aimPivot` |
| `weapons.<key>.first.hold` | `twoHand`, `pistolSupport` (tay trái ôm dưới tay phải), `oneHand` (ẩn tay trái) |
| `weapons.<key>.first.gunPos/gunRotDeg/scale` | vị trí tay cầm súng trong không gian camera |
| `reloadLeftHand` | đường đi tay trái khi nạp đạn (task P.5) |

---

## Task P.4 – Góc nhìn thứ 3: hai tay cùng cầm súng

Làm (`client/src/render/players.ts`):
- Mỗi nhân vật có node `aimPivot` (đặt tại `third.aimPivot`), xoay theo **pitch** của người đó (nội suy, task 3.5). Toàn bộ nhân vật xoay theo yaw như cũ.
- Vũ khí `third.hold = twoHand`:
  1. **Gỡ súng khỏi xương/khối tay phải** (code cũ), gắn súng làm con của `aimPivot` tại `gunPos`, `gunRotDeg`.
  2. Mỗi frame: lấy toạ độ thế giới của `hand_r`, `hand_l` trên súng → đổi về hệ của nhân vật → `armR.solve(shoulderR, hand_r, shoulderR + poleR)`, `armL.solve(shoulderL, hand_l, shoulderL + poleL)`.
  3. Ẩn khối tay cũ của model, dùng 2 `BlockArm` mới (style `third`, màu áo theo đội).
- Vũ khí `oneHand` (súng ngắn, dao): **giữ nguyên code hiện tại**, hiện lại khối tay cũ, ẩn `BlockArm`.
- Đổi súng: chuyển chế độ ngay trong frame đổi súng, không có frame nào súng lơ lửng không tay.
- Hiệu ứng có sẵn (lửa đầu nòng, ShotFx) vẫn lấy vị trí `muzzle` của súng như cũ.
- Nhân vật đang **chết** (khối tách ra bay, task 6.2): tắt IK, để tay rơi theo hiệu ứng.

Nghiệm thu (dùng camera debug F10, task P.6):
- [ ] Cầm AK47/M16/Sniper/Shotgun/SMG: hai tay chụm lại, tay phải ở tay cầm, tay trái ở ốp trước, không có tay nào duỗi thẳng đơ hoặc đâm xuyên thân.
- [ ] Ngước lên/cúi xuống: súng và hai tay xoay theo, tay vẫn bám súng.
- [ ] Cầm Colt/Rulô/Dao: giống hệt trước khi làm task này.
- [ ] Đổi súng liên tục 1–4: không giật, không có frame súng không tay.
- [ ] Hai đội: tay áo đúng màu đội.

Pitfall:
- Tay phải "với không tới" (`reached = false`, debug hiện đỏ) → tăng `upperLen/foreLen` hoặc kéo `gunPos` lại gần vai, **không** sửa code IK.
- Khuỷu gập ngược vào trong thân → `pole` sai phía: tay phải pole có x **dương**, tay trái x **âm**.

---

## Task P.5 – Góc nhìn thứ nhất: hai cánh tay + đẩy súng ra xa ⚠️

Làm (`client/src/render/viewmodel.ts`):
- Thêm `vmRoot` (con của `viewScene`) — **mọi hiệu ứng có sẵn** (sway khi đi, recoil lò xo, hạ súng khi đổi, chúc súng khi nạp) giờ áp vào `vmRoot` hoặc vào súng, **không** áp vào vai. Vai đứng yên trong không gian camera → tay tự co duỗi theo súng, nhìn tự nhiên.
- Súng là con của `vmRoot`, đặt theo `weapons.<key>.first.gunPos/gunRotDeg/scale`.
- `viewCam.fov = first.fov` (mặc định 54). Thay số FOV cũ.
- Hai `BlockArm` (style `first`, màu áo theo đội), giải IK mỗi frame **sau khi** đã áp mọi hiệu ứng lên súng:
  - `twoHand`: tay phải → `hand_r`, tay trái → `hand_l`.
  - `pistolSupport`: tay phải → `hand_r`, tay trái → `hand_l` (anchor súng ngắn nằm ngay dưới tay phải, tạo dáng hai tay ôm báng).
  - `oneHand` (dao): chỉ tay phải; tay trái ẩn.
- Đèn cho `viewScene`: 1 hemisphere + 1 directional riêng (tay không bị phẳng màu như ảnh chụp hiện tại).
- Ẩn toàn bộ viewmodel (súng + tay) khi đang ngắm Sniper (đã có), khi chết, và khi bật camera debug F10.

### Nạp đạn bằng tay trái (`reloadLeftHand`)

- `t = tiến độ nạp đạn (0..1)` theo thời gian nạp thực tế (`reloadMs` hoặc `reloadEmptyMs`).
- `keys`: danh sách mốc `{ t, to, offset? }`. `to` là tên anchor (`hand_l` hoặc `mag`), `offset` cộng thêm theo **hệ camera** (để kéo tay xuống ra khỏi màn hình). Giữa 2 mốc: nội suy vị trí đích, easing `smoothstep`.
- Băng đạn: từ `magDetachT` đến `magAttachT` mesh `mag` **đi theo tay trái** (đổi parent sang bàn tay, giữ nguyên toạ độ thế giới lúc đổi), hết khoảng đó gắn lại vào súng ở vị trí gốc. Đoạn tay ở ngoài màn hình chính là lúc "thay băng mới".
- `gunTiltDeg`: súng nghiêng `roll`/`pitch` trong khoảng `inT..outT` (vào/ra bằng smoothstep 0,1). Thay cho kiểu "chúc súng xuống" cũ đối với súng có `hold = twoHand`.
- Súng không có mesh `mag` (hoặc Rulô): bỏ qua phần mang băng đạn, tay trái chỉ đi theo `keys`.
- Đồng bộ với âm thanh: các mốc `at` trong profile âm thanh (task A.6) nên trùng các mốc `t` ở đây; không bắt buộc code tự đồng bộ, chỉ ghi chú trong bảng F9.

Nghiệm thu:
- [ ] Cầm AK47: thấy cả hai cánh tay từ mép dưới màn hình lên, súng nằm xa hơn trước, nhìn thấy được gần hết thân súng.
- [ ] Bắn: súng giật, hai tay giật theo, không tay nào tuột khỏi súng.
- [ ] Đi/chạy: súng lắc, tay lắc theo, vai không trồi vào màn hình.
- [ ] Nạp AK47: tay trái tới băng đạn, kéo băng xuống khỏi màn hình, đưa lên lắp lại, về ốp trước.
- [ ] Colt/Rulô: hai tay ôm báng. Dao: chỉ tay phải.
- [ ] Đứng sát tường: súng và tay không bị tường che (vẫn render pass riêng).
- [ ] Tay áo đúng màu đội.

Pitfall:
- Vai lọt vào khung hình → đẩy `first.shoulderR/L` xuống (y âm hơn) hoặc ra sau (z dương hơn), hoặc giảm `first.fov`.
- Tay trái với không tới ốp trước khi súng đẩy xa → tăng `first.upperLen/foreLen`, không thu súng lại.
- Thứ tự cập nhật mỗi frame **phải** là: hiệu ứng súng → cập nhật matrixWorld của súng (`updateMatrixWorld(true)`) → đọc anchor → giải IK. Sai thứ tự là tay trễ súng 1 frame, nhìn như tay bị dính keo chậm.

---

## Task P.6 – Bảng chỉnh tư thế F9 + camera debug F10

### F9 – Pose editor

- Chọn súng (dropdown), chọn tab `First` / `Third` / `Anchors` / `Style` / `Reload`.
- Mỗi số trong JSON có một slider + ô nhập số. Kéo là thấy ngay.
- Chấm debug: `hand_r` đỏ, `hand_l` xanh, `mag` vàng, vai trắng, khuỷu tím; tay nào `reached = false` thì tô **đỏ**.
- Tab Reload: thanh kéo `t` (0..1) để **dừng hình** ở một thời điểm nạp đạn và chỉnh từng mốc; nút "Phát thử nạp đạn".
- Nút **"Copy JSON"** (copy toàn bộ file), **"Copy súng này"** (chỉ mục `weapons.<key>`), **"Reset về file"**.
- Khi F9 mở: nhả khoá chuột để kéo slider; đóng F9 thì click lại để chơi.

### F10 – Camera nhìn chính mình

- Camera quỹ đạo quanh nhân vật của mình (chuột kéo để xoay, con lăn để zoom), hiện **model 3rd person của chính mình** cầm súng đang cầm. Dùng để chỉnh tab `Third` mà không cần mở tab thứ hai.
- Bật F10 thì ẩn viewmodel, tắt thì trở lại bình thường.

Nghiệm thu:
- [ ] Kéo `first.gunPos.z` thấy súng tiến/lùi, tay co duỗi theo ngay.
- [ ] Copy JSON → dán vào `poses.json` → reload trang: tư thế giữ nguyên.
- [ ] F10 xoay quanh nhân vật thấy rõ hai tay cầm AK47.

---

## Ghi chú cho người dùng

- File `10-poses.default.json` là **giá trị khởi điểm đoán theo tỉ lệ thường gặp**; kích thước nhân vật và súng thật của bạn có thể khác, nên chắc chắn phải chỉnh bằng F9. Thứ tự chỉnh dễ nhất: `anchors` (cho chấm đúng chỗ trên súng) → `first.gunPos` (đặt súng chỗ ưng mắt) → `first.shoulderR/L` + độ dài tay (cho tay với tới, vai không lọt khung) → `pole` (khuỷu đẹp) → tab `Third` với F10.
- Muốn súng "đưa ra" xa nữa: tăng `|gunPos.z|` (âm hơn) **và** tăng `first.foreLen` cùng lúc.
- Muốn tay to/thô kiểu Krunker hơn: tăng `first.thickness` lên 0,09–0,1.
