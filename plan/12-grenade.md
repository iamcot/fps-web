# 12 – Lựu đạn M67: mua, cầm, rút chốt, ném, nảy, nổ

Làm sau task 09 (cửa hàng) và 11 (nhân vật có xương). Đụng `shared/`, server, client.

Thứ tự: G.0 → G.1 → G.2 → G.3 → G.4 → G.5 → G.6 → G.7 → G.8 → G.9. Task ⚠️ nên dùng model mạnh.

---

## Luật chơi

- Lựu đạn là **ô thứ 5** (phím **5**), không tính vào 4 dòng vũ khí. Mang tối đa **2 quả**, giá **$300/quả**, mua thêm từng quả tới khi đủ 2. **Không bán lại.**
- Chết thì mất lựu đạn (theo `keepLoadoutOnDeath = false` của task 09). Không có trong bộ mặc định.
- Thao tác:
  - Phím **5**: cầm lựu đạn. Phím **G**: cầm và vào thế ném luôn (ném nhanh), thả G là ném.
  - **Giữ chuột trái**: rút chốt, giơ tay → **thả ra là ném mạnh** (ném xa, bay cao).
  - **Giữ chuột phải**: rút chốt → thả ra là **ném thấp/lăn** (ném gần, lăn qua góc).
  - Giữ quá 0,35s mới rút xong chốt; thả trước thời điểm đó thì huỷ, không ném.
  - **Không "nướng" lựu đạn** (bản đầu): ngòi bắt đầu cháy **khi rời tay**, nổ sau **3 giây**.
- Nổ: sát thương tối đa **98** ở tâm (người đầy máu bị ném trúng chân vẫn sống sót với 2 máu, đúng kiểu CS), giảm dần tới 0 ở bán kính **7m**. Bị **tường chắn** thì giảm theo tỉ lệ phần thân bị che. Không sát thương đồng đội; **tự nổ vào mình 50%**. Hạ mạng bằng lựu đạn vẫn được thưởng tiền như thường (kể cả truy nã $1000).
- Lựu đạn **không va chạm với người chơi**, chỉ nảy với map (đơn giản cho netcode, xem G.2).

---

## Config (`shared/src/grenade.ts`)

```ts
export const GRENADE = {
  key: 'm67',
  price: 300,
  maxCarry: 2,
  pinPullMs: 350,          // giữ chuột tối thiểu để rút chốt
  fuseMs: 3000,            // tính từ lúc rời tay
  throwSpeed: { strong: 16, lob: 7 },   // m/s
  throwUpDeg: { strong: 6, lob: 2 },    // cộng thêm vào pitch
  inheritVelocity: 0.5,    // cộng 50% vận tốc người ném
  radius: 0.045,           // m, va chạm hình cầu
  gravity: 22,             // cùng gravity của MovementConfig
  restitution: 0.35,       // độ nảy
  friction: 0.6,           // ma sát tiếp tuyến mỗi lần chạm
  rollDrag: 2.5,           // m/s² giảm tốc khi lăn trên sàn
  restSpeed: 0.25,         // dưới tốc độ này thì nằm yên
  damageMax: 98,
  innerRadius: 1.0,        // trong bán kính này: full damage
  outerRadius: 7.0,
  selfDamageMult: 0.5,
  knockback: 3.0,          // m/s đẩy ra xa tâm nổ (0 = tắt)
  shakeRadius: 15,
  warnRadius: 8,           // hiện cảnh báo lựu đạn gần
  autoSwitchBackMs: 450,   // ném quả cuối xong tự đổi về súng trước đó
};
```

---

## Task G.0 – Chuẩn bị model lựu đạn (Claude Code + Blender)

File người dùng tải: `assets/source/grenades/m67.glb`, chứa **1 quả hoàn chỉnh** và **1 bộ đã tháo rời**.

Làm (`asset_tool.py`, chế độ `inspect` sẵn có, rồi chế độ mới `build-grenade`):
1. **Inspect**: liệt kê mọi object, vị trí, kích thước, số tam giác. Xác định:
   - Object nào là quả hoàn chỉnh, object nào thuộc bộ tháo rời (thường bộ tháo rời có nhiều object nhỏ nằm cách xa nhau).
   - Các bộ phận: **thân** (vỏ tròn), **đầu ngòi** (fuze), **cần an toàn / thìa** (spoon, lever), **chốt + vòng kéo** (pin, ring), **kẹp an toàn** (clip, nếu có).
   - Không chắc bộ phận nào → hỏi người dùng (kèm ảnh preview render từng object), không đoán.
2. **Chọn nguồn để xuất**, theo thứ tự ưu tiên:
   - (a) Quả hoàn chỉnh **đã tách sẵn** chốt và thìa thành object riêng → dùng luôn.
   - (b) Quả hoàn chỉnh là **một khối liền** → dùng **bộ tháo rời**: ghép các bộ phận về đúng vị trí lắp ráp (khớp theo bbox của quả hoàn chỉnh: thân trùng thân, ngòi trên đỉnh, thìa áp sát thân, chốt xuyên qua ngòi). Render ảnh so sánh với quả hoàn chỉnh để người dùng duyệt.
   - (c) Không ghép được → dùng quả hoàn chỉnh, **bỏ hiệu ứng chốt/thìa bay ra** (ghi rõ trong báo cáo).
3. Chuẩn hoá: cao **0,09m** (M67 thật cao khoảng 9cm, đường kính 6,4cm), gốc toạ độ ở **tâm thân**, ngòi hướng **+Y** trong three.js.
4. Đặt tên node: `body` (thân + ngòi), `spoon`, `pin` (chốt + vòng), `clip` (nếu có). Thêm Empty: `hand_r` (lòng bàn tay phải ôm thân, thìa nằm dưới lòng bàn tay), `pin_pull` (tâm vòng kéo, cho tay trái).
5. Xuất `client/public/models/grenades/m67.glb` (≤ 1MB, texture ≤ 1024px).
6. Render icon bóng trắng (task H.5): `client/public/icons/weapons/m67.png`.

Nghiệm thu:
- [ ] Viewer: một quả lựu đạn lắp ráp hoàn chỉnh, đứng thẳng, cỡ đúng 9cm so với thước.
- [ ] Ẩn lần lượt node `pin`, `spoon`: thấy đúng bộ phận biến mất.
- [ ] Icon trắng nền trong suốt.

---

## Task G.1 – Loadout, cửa hàng, kinh tế (shared)

- `CATEGORY` thêm `'grenade'`, ô số **4** (index 4, phím 5). `Loadout.slots` thành **5 phần tử**; ô lựu đạn lưu `{ key: 'm67', count: number }`.
- `economy.ts`:
  - `quoteBuy` cho hàng tiêu hao: không bán đổi, `refund = 0`; đủ `maxCarry` → `reason: 'max_carry'`.
  - `applyBuy`: `count + 1`.
  - Hàm mới `consumeGrenade(loadout)`: `count − 1`, về 0 thì ô trống.
- Thêm vào `WEAPONS` một mục `m67` (`category: 'grenade'`, `price: 300`, `buyable: true`, `moveSpeedMul: 1.0`, các trường bắn để 0 / không dùng).

Nghiệm thu (vitest):
- [ ] $2000 mua lựu đạn: $1700, count 1. Mua tiếp: $1400, count 2. Mua lần 3: `max_carry`.
- [ ] `consumeGrenade` 2 lần → ô trống.
- [ ] Test cũ của task 09 vẫn pass (sửa test nếu chỉ do số ô đổi 4 → 5).

---

## Task G.2 – Vật lý lựu đạn (shared, tất định) ⚠️

`shared/src/grenadePhysics.ts`:

```ts
export interface GrenadeState {
  id: number; ownerId: number; team: TeamId;
  pos: Vec3; vel: Vec3;
  spawnTick: number;        // tick server lúc rời tay
  resting: boolean;
}
export function throwInitial(owner: PlayerState, mode: 'strong' | 'lob', world: CollisionWorld): { pos: Vec3; vel: Vec3 };
export function stepGrenade(g: GrenadeState, world: CollisionWorld, dt: number): GrenadeEvent | null; // 'bounce' kèm tốc độ va chạm, hoặc null
```

- `throwInitial`:
  - Điểm xuất phát = mắt + `right × 0,15` + `forward × 0,3` − `up × 0,05`. Raycast từ mắt tới điểm đó: nếu bị tường chắn thì xuất phát ngay tại mắt (không để lựu đạn chui qua tường khi đứng sát tường).
  - Hướng = từ `yaw`, `pitch + throwUpDeg[mode]`. Vận tốc = hướng × `throwSpeed[mode]` + vận tốc người ném × `inheritVelocity`.
- `stepGrenade` mỗi tick (dt = 1/60), **chỉ va chạm với collider map** (collision group riêng):
  1. `resting` → không làm gì.
  2. `vel.y −= gravity × dt`.
  3. `castShape` hình cầu bán kính `radius` từ `pos` theo `vel × dt`. Không chạm → `pos += vel × dt`.
  4. Chạm: dời tới điểm chạm (lùi 1mm theo pháp tuyến), tách vận tốc thành pháp tuyến `vn` và tiếp tuyến `vt`: `vel = −vn × restitution + vt × (1 − friction)`. Phát sự kiện `bounce` nếu `|vn| > 1 m/s`. Phần thời gian còn lại của tick: lặp lại tối đa 3 lần.
  5. Đang lăn trên sàn (chạm sàn pháp tuyến y > 0,7, `|vn|` nhỏ): giảm tốc tiếp tuyến theo `rollDrag × dt`. Tốc độ < `restSpeed` và đang trên sàn → `resting = true`, `vel = 0`.
- Hướng xoay (lộn vòng khi bay) **không** nằm ở đây, client tự vẽ (G.4).

Nghiệm thu (vitest, chạy Rapier thật trên map "Hai thành"):
- [ ] Ném mạnh từ căn cứ, pitch 20°: bay qua tường thành (cao 4m) rơi xuống khu giữa.
- [ ] Ném thẳng vào tường cách 2m: nảy ngược lại, không xuyên tường.
- [ ] Thả rơi từ 2m: nảy vài lần thấp dần rồi nằm yên trong < 2 giây.
- [ ] Determinism: 2 world riêng, cùng đầu vào, 300 tick → vị trí giống hệt từng số.
- [ ] Ném vào khe lỗ bắn (rộng 1,2m) ở giữa: đi lọt qua.

Pitfall:
- Lựu đạn nhỏ, nhanh → nếu chỉ kiểm tra chồng lấn mỗi tick sẽ **xuyên tường**. Bắt buộc dùng `castShape` theo quãng đường của tick (continuous), không dùng intersection.
- Kẹt rung trong góc tường: nếu sau 3 lần lặp vẫn còn va chạm, đặt `vel = 0` tick đó.

---

## Task G.3 – Server: cầm, rút chốt, ném, nổ ⚠️

### Input

- Dùng bit có sẵn: `Fire` (chuột trái) = ném mạnh, `Scope` (chuột phải) = ném thấp. Thêm bit `QuickNade` (phím G).
- Trạng thái ném của người chơi (shared, chạy cả client để dự đoán):
  ```ts
  interface ThrowState { phase: 'idle' | 'pulling' | 'ready'; mode: 'strong' | 'lob'; pressSeq: number; }
  ```
  - `idle` + nhấn Fire/Scope (cạnh lên) khi đang cầm lựu đạn → `pulling`, ghi `pressSeq`, `mode`.
  - `pulling` → `ready` khi `seq − pressSeq ≥ pinPullMs` (đổi ra tick).
  - Thả nút: nếu `ready` → **ném** (tick này); nếu `pulling` → huỷ, về `idle`.
  - Đổi súng / chết khi đang `pulling`: huỷ. Khi `ready` mà chết: **lựu đạn rơi tại chỗ** (vận tốc = vận tốc người chết), vẫn nổ sau `fuseMs` — giống CS, có thể giết người giết mình.
  - `QuickNade`: nhấn G → tự chuyển sang ô lựu đạn và vào `pulling` (mode strong); thả G → ném nếu `ready`, rồi tự đổi về súng trước đó.

### Ném và nổ

- Ném: `throwInitial`, tạo `GrenadeState` với id tăng dần, `consumeGrenade`, gửi `GrenadeSpawn` cho cả phòng.
- Mỗi tick: `stepGrenade` mọi lựu đạn đang bay. Đủ `fuseMs` → **nổ**:
  1. Với mỗi người chơi còn sống, khác đội người ném (hoặc chính người ném): khoảng cách `d` từ tâm nổ tới **ngực**.
  2. `base = damageMax` nếu `d ≤ innerRadius`; 0 nếu `d ≥ outerRadius`; giữa thì giảm tuyến tính.
  3. Che chắn: raycast (chỉ map) từ tâm nổ (nâng lên 0,1m) tới 3 điểm **đầu, ngực, chân**; `exposure = số điểm không bị chặn / 3`. `damage = round(base × exposure)` (× `selfDamageMult` nếu là chính người ném).
  4. Áp damage như đạn (bỏ qua người đang bất tử), hạ mạng → Kill với `weapon: 'm67'`, thưởng tiền như thường.
  5. Đẩy lùi: nếu `knockback > 0` và `damage > 0`: cộng vào vận tốc người đó `hướng(tâm → ngực) × knockback × (base/damageMax)`, thành phần y ≥ 1 m/s.
  6. Gửi `GrenadeExplode` cho cả phòng, xoá lựu đạn.
- Người ném rời phòng: lựu đạn vẫn nổ, vẫn gây sát thương nhưng **không** ai nhận tiền thưởng.

### Message

```ts
// S2C
  | { t: 116; id: number; ownerId: number; mode: 'strong' | 'lob'; pos: Vec3; vel: Vec3; spawnTick: number; throwSeq: number } // GrenadeSpawn
  | { t: 117; id: number; pos: Vec3; hits: { id: number; damage: number }[] }                                                  // GrenadeExplode
  | { t: 118; playerId: number; phase: 'pulling' | 'throw' | 'cancel' }                                                         // GrenadeAnim (cho người khác thấy động tác)
// NetPlayer bản thân thêm: throwPhase, grenadeCount
```

Nghiệm thu:
- [ ] Ném vào chân kẻ địch đầy máu: còn khoảng 2–10 máu, không chết.
- [ ] Ném sau lưng tường dày, địch nấp hẳn: không mất máu. Địch ló nửa người: mất khoảng 1/3–2/3.
- [ ] Đồng đội đứng sát chỗ nổ: không mất máu. Mình đứng sát: mất khoảng 49.
- [ ] Rút chốt xong bị bắn chết: lựu đạn rơi tại chỗ và nổ sau 3 giây.
- [ ] Giữ chuột 0,2s rồi thả: không ném, vẫn còn đủ lựu đạn.
- [ ] Hạ người có chuỗi 3 bằng lựu đạn: +$1000.
- [ ] Spam ném (sửa tạm client gửi Fire liên tục): không ném quá số lựu đạn đang có.

---

## Task G.4 – Client: mô phỏng và vẽ lựu đạn

- Vì `stepGrenade` tất định và lựu đạn không chạm người: client **tự mô phỏng mọi lựu đạn** từ `GrenadeSpawn`, server không cần gửi vị trí lựu đạn trong snapshot.
  - Nhận `GrenadeSpawn` của người khác: tạo lựu đạn, **tua nhanh** từ `spawnTick` tới tick hiện tại (chạy `stepGrenade` nhiều lần), rồi vẽ trễ `INTERP_DELAY_MS` như người chơi khác cho khớp hình.
  - Lựu đạn của **chính mình**: tạo ngay khi client dự đoán ném (không chờ server), gắn `throwSeq`. Khi `GrenadeSpawn` về với cùng `throwSeq`: nếu lệch vị trí < 0,2m thì giữ nguyên và chỉ nhận id; lệch nhiều thì chuyển dần về quỹ đạo server trong 0,2s. Server không xác nhận trong 500ms (bị từ chối) → xoá lựu đạn dự đoán.
  - `GrenadeExplode` là **nguồn chân lý**: nổ đúng vị trí server gửi, xoá lựu đạn local dù local chưa tới giờ.
- Vẽ: model `m67.glb` (đã có `spoon` và `pin` tách riêng). Lộn vòng khi bay: xoay quanh trục vuông góc với vận tốc, tốc độ quay tỉ lệ tốc độ bay; khi lăn trên sàn: xoay theo hướng lăn (`ω = v / radius`); nằm yên thì đứng yên.
- Hiệu ứng rời tay: `spoon` tách ra bay chéo lên-ra sau (vận tốc ngẫu nhiên nhỏ), xoay, rơi xuống sàn, biến mất sau 5 giây. `pin` thì đã nằm ở tay trái từ lúc rút chốt (G.5), rời tay trái khi ném.

Nghiệm thu:
- [ ] Hai tab: tab B thấy lựu đạn tab A ném bay đúng đường, nảy đúng chỗ, nổ đúng chỗ.
- [ ] Ném ở `?lat=150`: lựu đạn rời tay ngay khi thả chuột, không trễ.
- [ ] Thấy thìa văng ra khi ném.

---

## Task G.5 – Góc 1: cầm, rút chốt, ném (viewmodel)

Dùng lại hệ IK + `poses.json` của task 10/11. Thêm vào `poses.json → weapons.m67`:

```json
"m67": {
  "anchors": { "hand_r": [0, 0, 0], "pin_pull": [0.025, 0.045, 0] },
  "first": {
    "hold": "grenade",
    "idlePos": [0.16, -0.18, -0.38], "idleRotDeg": [0, 10, 0],
    "pullLeftHandPath": [
      { "t": 0.0, "to": "rest" },
      { "t": 0.45, "to": "pin_pull" },
      { "t": 0.75, "to": "pin_pull", "offset": [-0.10, 0.02, 0.05] },
      { "t": 1.0, "to": "rest", "offset": [-0.18, -0.05, -0.10] }
    ],
    "leftRest": [-0.25, -0.40, -0.30],
    "readyPos": { "strong": [0.20, -0.02, -0.18], "lob": [0.10, -0.30, -0.42] },
    "readyRotDeg": { "strong": [-20, 15, 10], "lob": [30, 5, 0] },
    "throwPos": { "strong": [0.02, -0.05, -0.75], "lob": [0.05, -0.35, -0.70] },
    "windupMs": 120, "throwMs": 110, "recoverMs": 250
  },
  "third": { "hold": "grenade" }
}
```

- `hold: 'grenade'`: tay phải nắm lựu đạn (IK tới `hand_r`), tay trái ở `leftRest` (ngoài màn hình hoặc mép dưới).
- **Rút chốt** (pha `pulling`, kéo dài `pinPullMs`): tay trái đi theo `pullLeftHandPath`. Tại mốc t = 0,75: node `pin` đổi parent sang bàn tay trái (giữ vị trí thế giới), âm "tinh" của chốt. Đồng thời tay phải đưa lựu đạn từ `idlePos` tới `readyPos[mode]` (smoothstep).
- **Giữ** ở `ready`: lựu đạn lắc nhẹ theo nhịp thở, tay trái giơ ra trước (với `strong`, như tay ngắm) — dùng điểm cuối của `pullLeftHandPath`.
- **Ném** (khi thả nút): `windupMs` kéo về sau thêm 5cm → `throwMs` vung tới `throwPos[mode]`; **đúng lúc bắt đầu `throwMs`** ẩn lựu đạn trong tay (lựu đạn thật được tạo ở G.4); `recoverMs` hai tay hạ xuống khỏi màn hình.
- Còn lựu đạn: tay đưa quả mới lên (như animation rút súng). Hết: sau `autoSwitchBackMs` tự đổi về súng trước đó.
- **Đường bay dự kiến** (setting, mặc định bật): khi `ready`, vẽ chuỗi chấm trắng mờ theo quỹ đạo `throwInitial` + `stepGrenade` (tối đa 2 giây, dừng ở lần nảy đầu tiên), chấm cuối là vòng tròn nhỏ trên mặt chạm.

Nghiệm thu:
- [ ] Giữ chuột trái: tay trái rút chốt (thấy vòng chốt rời đi theo tay trái), tay phải giơ lựu đạn ra sau vai.
- [ ] Thả: vung tay, lựu đạn bay ra từ đúng vị trí bàn tay (không bị "dịch chuyển" sang chỗ khác).
- [ ] Chuột phải: tư thế thấp, ném lăn.
- [ ] Đường bay dự kiến trùng với đường bay thật (thử 10 lần, sai lệch điểm rơi < 0,3m khi đứng yên).

---

## Task G.6 – Góc 3: người khác thấy mình ném

**Người dùng tải thêm trên Mixamo** (giống C.2, Without Skin, 30fps, In Place):

| Lưu thành | Từ khoá | |
|---|---|---|
| `grenade_throw.fbx` | throw grenade / grenade throw | ném mạnh, tay qua vai |
| `grenade_toss.fbx` | underhand toss / toss | ném thấp (không có thì dùng chung `grenade_throw`) |

Claude Code chạy lại `build-character` (task C.3) để thêm 2 action vào `cop.glb` / `robber.glb`.

Làm:
- Cầm lựu đạn: dùng bộ animation `pistol_*` cho thân dưới; lựu đạn gắn vào `mixamorigRightHand` (theo anchor `hand_r`), tay trái theo animation.
- Nhận `GrenadeAnim`:
  - `pulling`: tay trái IK chạm vòng chốt (dùng lại `SkeletonArm`), 0,3s rồi buông.
  - `throw`: phát `grenade_throw` hoặc `grenade_toss` **chỉ cho thân trên** (mask: các xương từ `mixamorigSpine` trở lên, gồm cả hai tay), trộn với chân đang chạy. Ẩn lựu đạn trong tay tại khoảng 40% animation (chỉnh bằng `poses.json: weapons.m67.third.releaseT`).
  - `cancel`: về tư thế cầm.

Nghiệm thu:
- [ ] F10 hoặc tab thứ hai: thấy nhân vật rút chốt và vung tay ném, chân vẫn chạy bình thường.
- [ ] Lựu đạn biến khỏi tay đúng lúc lựu đạn thật xuất hiện trên không.

---

## Task G.7 – Hiệu ứng nổ

Tất cả bằng code (sprite/particle, không cần file):
- **Chớp sáng**: sprite trắng-vàng additive, to 4m → 0 trong 80ms; một `PointLight` cam cường độ cao giảm về 0 trong 150ms.
- **Cầu lửa**: 6–8 sprite cam-đỏ additive, nở từ 0,5m → 2,5m trong 250ms rồi mờ.
- **Khói**: 15–20 sprite xám, bay lên chậm, nở dần, mờ hết trong 2,5s (giới hạn tổng số sprite khói trên map 200).
- **Mảnh vụn/tia lửa**: 25 hạt sáng nhỏ bắn tung theo hướng ngẫu nhiên nửa cầu trên, có trọng lực, sống 0,6s.
- **Vết cháy**: decal đen tròn 2,5m trên mặt sàn/tường gần nhất (raycast xuống), mờ dần sau 20s, tối đa 10 vết.
- **Rung màn hình**: biên độ theo khoảng cách (`1 − d/shakeRadius`), 0,4s, không rung viewmodel quá mạnh (chỉ camera chính).
- Hiệu ứng nổ của lựu đạn **sau tường**: vẫn vẽ (người chơi thấy khói bốc lên sau tường), chỉ chớp sáng bị che tự nhiên.
- Mọi texture sprite sinh bằng canvas lúc khởi động (gradient tròn), không tải file.

Nghiệm thu:
- [ ] Nổ trông có lực, có khói đọng lại vài giây, có vết cháy trên sàn.
- [ ] 5 quả nổ cùng lúc: không tụt dưới 60 FPS.

---

## Task G.8 – Âm thanh lựu đạn

Thêm vào hệ âm thanh của task 08 (`synth.ts`, master compressor, panner cho âm ở xa). File tuỳ chọn trong `client/public/sounds/grenade/`; không có file thì dùng âm tổng hợp:

| Âm | Khi nào | Tổng hợp dự phòng |
|---|---|---|
| `pin` | rút chốt (chỉ mình nghe, người khác trong 6m nghe nhỏ) | tone sine 3200Hz decay 120ms −14dB + noise highpass 5000Hz 10ms −16dB |
| `spoon` | lựu đạn rời tay | tone sine 2400→1800Hz decay 200ms −16dB ("toinggg") |
| `throw` | vung tay | noise bandpass quét 400→1500Hz trong 150ms −16dB (tiếng gió) |
| `bounce` | mỗi lần nảy (`bounce` event, âm lượng theo tốc độ va chạm) | noise bandpass 1800Hz q=3 decay 40ms + tone sine 900Hz decay 60ms, −10 → −24dB theo tốc độ |
| `explode` | nổ | xem dưới |

**Tiếng nổ** (nhiều lớp, giống tiếng súng):
- `crack`: noise highpass 1500Hz, decay 60ms, −2dB
- `body`: noise lowpass 900Hz, decay 600ms, 0dB
- `thump`: tone sine 70→30Hz, decay 450ms, 0dB
- `tail`: noise lowpass 400Hz, attack 40ms, decay 2,5s, −10dB (tiếng vọng)
- `debris`: 8 tiếng "lạch cạch" nhỏ ngẫu nhiên trong 0,3–1,2s sau nổ, −22dB
- Có file `explode_01..03.ogg` thì phát file thay `crack` + `body`, vẫn giữ `thump` + `tail` tổng hợp.
- Ở xa: lowpass theo khoảng cách như tiếng súng người khác; ngoài 40m chỉ còn `thump` + `tail`.

**Ù tai** khi đứng trong 4m lúc nổ (và còn sống):
- Tone sine 3500Hz, −18dB, tắt dần trong 2s.
- Master đi qua một lowpass, cutoff tụt xuống 700Hz rồi mở dần về 20kHz trong 2s (mọi âm khác bị "bịt").
- Có setting tắt hiệu ứng ù tai.

Nghiệm thu:
- [ ] Nghe được lựu đạn nảy lạch cạch tới gần trước khi nổ.
- [ ] Nổ gần: tiếng to, có bass, sau đó ù tai và mọi âm bị bịt rồi trở lại.
- [ ] Nổ xa sau tường: chỉ nghe "ùng" trầm.
- [ ] Bảng F8 có tab "Grenade" chỉnh các lớp trên.

---

## Task G.9 – HUD, cửa hàng, cảnh báo

- **Ô vũ khí thứ 5** (cạnh 4 ô cũ, cùng kiểu): icon `m67`, số `5` ở góc dưới trái, **badge số lượng** `×2` ở góc trên phải. Hết lựu đạn: ô mờ.
- Khi cầm lựu đạn, chỗ hiện đạn bên phải hiện `×2` thay cho `25 / 30`.
- **Cửa hàng**: thêm nhóm mới dưới cùng (đường kẻ + nhãn nhỏ `Lựu đạn`), dòng `(8) [icon] Lựu đạn M67  $300`; đang có 2 quả hiện `Đã đủ (2/2)`, có 1 quả hiện `1/2` cạnh giá. Footer thêm dòng: `Lựu đạn mang tối đa 2 quả, không bán lại.`
- **Cảnh báo lựu đạn gần**: lựu đạn của **địch** (hoặc của chính mình) đang bay/nằm trong `warnRadius`: hiện icon lựu đạn đỏ ở giữa màn hình hơi dưới tâm ngắm, kèm **mũi tên** chỉ hướng lựu đạn (quay quanh tâm theo góc so với hướng nhìn). Càng gần càng đậm và nhấp nháy nhanh.
- **Killfeed**: hạ bằng lựu đạn hiện icon lựu đạn thay icon súng.
- Phím G và 5 hiện trong màn hình hướng dẫn phím (nếu có).

Nghiệm thu:
- [ ] Mua 2 quả: ô 5 hiện `×2`. Ném 1 quả: `×1`. Ném hết: ô mờ, tự về súng trước.
- [ ] Địch ném lựu đạn rơi sau lưng mình: mũi tên chỉ về phía sau.
- [ ] Cửa hàng: mua quả thứ 3 bị từ chối, dòng hiện `Đã đủ (2/2)`.

---

## Ghi chú cho người dùng

- Bạn cần làm 2 việc tay: **tải 2 animation ném** trên Mixamo (G.6) và (tuỳ chọn) tìm file **tiếng nổ** thật (`explosion`, `grenade explosion` trên freesound / Sonniss). Không có file nổ thì âm tổng hợp vẫn đủ "ùng".
- Muốn lựu đạn ác hơn/hiền hơn: chỉnh `damageMax`, `outerRadius`, `fuseMs` trong `GRENADE`. Muốn có "nướng lựu đạn" (giữ lâu cho nổ sớm) thì báo, đó là một task riêng vì đụng logic ngòi và cảnh báo.
