# 09 – HUD mới, 4 ô vũ khí, cửa hàng và kinh tế

Làm sau khi core đã xong (phase 0–5 + task âm thanh). Đụng tới `shared/` (súng, kinh tế) và server, nên **làm đúng thứ tự task**, mỗi task test xong mới qua task sau.

Thứ tự: H.0 → H.1 → H.2 → H.3 → H.4 → H.5 → H.6 → H.7 → H.8. Task ⚠️ nên dùng model mạnh.

---

## Tóm tắt luật chơi mới

- Mỗi người mang tối đa **4 dòng vũ khí**, mỗi dòng **đúng 1 cây**:

| Ô (phím) | Dòng | Các súng trong dòng |
|---|---|---|
| 1 | Dao | Dao (luôn có, không mua/bán) |
| 2 | Súng ngắn | Colt, Rulô |
| 3 | Súng vừa | Shotgun, SMG |
| 4 | Súng dài | AK47, M16, Sniper |

- Vào trận: **$2000**, dao + 1 súng ngắn + 1 súng dài theo phe:
  - Cớm: Dao, **Colt**, **M16**
  - Cướp: Dao, **Rulô**, **AK47**
- Hạ 1 mạng: **+$500**. Nếu nạn nhân đang có **chuỗi hạ ≥ 3** thì **+$1000** (tiền thưởng truy nã). Bị giết thì chuỗi hạ của nạn nhân về 0.
- Tiền tối đa **$16000**, vượt thì phần dư mất.
- Chỉ mua được khi **đứng trong khu căn cứ phe mình, sau tường thành, ở mặt đất** (không tính gờ tường, không tính đỉnh tháp).
- Mua súng cùng dòng với súng đang có: **tự bán súng cũ được 80% số tiền đã trả**, rồi mua súng mới.

### Quyết định tạm (đổi bằng config, xem H.2)

- **Súng được cấp sẵn đầu trận không bán lại được** (giá bán lại = $0). Lý do: tránh lỗi "chết → hồi sinh có M16 miễn phí → bán lấy $2480" lặp vô hạn.
- **Chết thì mất súng đã mua**, hồi sinh với bộ mặc định của phe (tiền giữ nguyên). Lý do: tiền thưởng mới có ý nghĩa suốt trận. Hồi sinh ở căn cứ nên mua lại được ngay.
- Cửa hàng bán **mọi súng cho cả hai phe** (Cớm mua được AK47, Cướp mua được M16).
- Trận mới (sau ENDED) hoặc người vào giữa trận: tiền về $2000, bộ mặc định, chuỗi hạ = 0.

---

## Task H.0 – Dọn map

Làm:
- Bỏ các hình nhân/bia ở khu giữa khỏi map. Giữ code bia để luyện tập: chỉ hiện khi mở bằng `?dummies=1`.
- Bỏ các mũi tên/dấu hiệu spawn khỏi map khi chơi. Chỉ vẽ khi bật debug F4 (cùng chế độ vẽ collider).

Nghiệm thu:
- [ ] Vào trận bình thường: không còn hình nhân giữa map, không còn dấu spawn trong căn cứ.
- [ ] `?dummies=1`: hình nhân hiện lại, bắn được như cũ. F4: thấy lại mũi tên spawn.

---

## Task H.1 – Mở rộng bộ vũ khí ⚠️

### H.1.1 Trường mới trong `WeaponDef` (`shared/src/weapons.ts`)

```ts
export type WeaponCategory = 'knife' | 'pistol' | 'mid' | 'long';
export const CATEGORY_SLOT: Record<WeaponCategory, 0 | 1 | 2 | 3> = { knife: 0, pistol: 1, mid: 2, long: 3 };
export const CATEGORY_LABEL: Record<WeaponCategory, string> = {
  knife: 'Dao', pistol: 'Súng ngắn', mid: 'Súng vừa', long: 'Súng dài',
};

interface WeaponDef {
  // ...các trường cũ...
  key: string;               // 'knife' | 'colt' | 'rulo' | 'shotgun' | 'smg' | 'ak47' | 'm16' | 'sniper' — dùng cho tên file icon/âm thanh/model
  category: WeaponCategory;
  price: number;             // USD; dao = 0
  buyable: boolean;          // dao = false
  pellets?: number;          // shotgun: số tia mỗi phát (mặc định 1)
  falloff?: { startM: number; endM: number; minMult: number }; // giảm damage theo khoảng cách
  melee?: boolean;           // dao: không đạn, không reload, tầm ngắn
  scope?: { fov: number; spreadDeg: number }; // sniper: chuột phải ngắm
  unscopedSpreadDeg?: number; // sniper khi không ngắm
  moveSpeedMul: number;      // hệ số tốc độ chạy khi cầm súng này
}
```

Bỏ trường `slot` cũ (dùng `category` thay thế). Bỏ việc chọn súng theo id ở phím 1–4 (thay bằng H.4).

### H.1.2 Bảng súng và giá (giá tạm, người dùng sẽ chỉnh)

| key | Tên | Dòng | Giá | Ghi chú |
|---|---|---|---|---|
| knife | Dao | knife | 0 | mặc định, không mua/bán |
| colt | Colt | pistol | $300 | mặc định Cớm |
| rulo | Rulô | pistol | $700 | mặc định Cướp |
| shotgun | Shotgun | mid | $1100 | |
| smg | SMG | mid | $1250 | |
| ak47 | AK47 | long | $2700 | mặc định Cướp |
| m16 | M16 | long | $3100 | mặc định Cớm |
| sniper | Sniper | long | $4750 | |

Thông số súng mới (AK47, M16, Colt, Rulô giữ nguyên như task A.1, chỉ thêm các trường mới):

```ts
{ key: 'knife', name: 'Dao', category: 'knife', price: 0, buyable: false, melee: true, auto: true,
  damage: 55, headMult: 2, legMult: 1, fireIntervalMs: 450, magSize: 0, reloadMs: 0, reloadEmptyMs: 0,
  range: 2.2, spreadDeg: { stand: 0, move: 0, air: 0, crouch: 0 },
  recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0, moveSpeedMul: 1.1 },

{ key: 'shotgun', name: 'Shotgun', category: 'mid', price: 1100, buyable: true, auto: false, pellets: 8,
  damage: 14, headMult: 1.5, legMult: 0.75, falloff: { startM: 6, endM: 20, minMult: 0.3 },
  fireIntervalMs: 850, magSize: 6, reloadMs: 2400, reloadEmptyMs: 2400, range: 40,
  spreadDeg: { stand: 4.5, move: 5.5, air: 7, crouch: 4 },
  recoilPitchDeg: 4, recoilYawDeg: 0.6, recoilRecoverDegPerSec: 9, moveSpeedMul: 0.95 },

{ key: 'smg', name: 'SMG', category: 'mid', price: 1250, buyable: true, auto: true,
  damage: 20, headMult: 3, legMult: 0.75, falloff: { startM: 15, endM: 40, minMult: 0.6 },
  fireIntervalMs: 70, magSize: 30, reloadMs: 1800, reloadEmptyMs: 2200, range: 100,
  spreadDeg: { stand: 0.7, move: 1.2, air: 3.5, crouch: 0.5 },
  recoilPitchDeg: 0.4, recoilYawDeg: 0.35, recoilRecoverDegPerSec: 10, moveSpeedMul: 1.0 },

{ key: 'sniper', name: 'Sniper', category: 'long', price: 4750, buyable: true, auto: false,
  damage: 95, headMult: 2, legMult: 0.75,
  fireIntervalMs: 1400, magSize: 5, reloadMs: 3000, reloadEmptyMs: 3600, range: 300,
  scope: { fov: 25, spreadDeg: 0.05 }, unscopedSpreadDeg: 8,
  spreadDeg: { stand: 0.05, move: 3, air: 10, crouch: 0.05 },
  recoilPitchDeg: 5, recoilYawDeg: 0.3, recoilRecoverDegPerSec: 6, moveSpeedMul: 0.85 },
```

`moveSpeedMul` cho súng cũ: Colt 1.0, Rulô 1.0, AK47 0.92, M16 0.93.

### H.1.3 Logic bắn cho súng mới (shared + server)

- **Shotgun (pellets):** mỗi phát tạo `pellets` tia. Spread của tia thứ `k` dùng seed `hashSeed(playerId, shotSeq, k)`. Server cộng damage của mọi tia trúng cùng một người thành **một** sự kiện trúng (HitConfirm gửi tổng damage, `headshot = true` nếu có ít nhất 1 tia trúng đầu). Damage mỗi tia nhân hệ số `falloff` theo khoảng cách.
- **Falloff:** `mult = 1` nếu `d ≤ startM`; `minMult` nếu `d ≥ endM`; giữa thì nội suy tuyến tính.
- **Dao (melee):** không tiêu đạn, không reload, HUD đạn hiện `—`. Bắn tia hitscan dài `range` (2,2m) từ mắt; **không có spread, không recoil**. Lag compensation vẫn áp dụng như súng.
- **Sniper (scope):** thêm bit `Btn.Scope` (chuột phải) vào `InputCmd`. Đang giữ Scope → spread = `scope.spreadDeg`, client đổi FOV về `scope.fov` (nội suy 120ms), che màn hình bằng khung ống ngắm (HTML/CSS: vòng tròn trong suốt, ngoài đen, chữ thập mảnh), ẩn viewmodel, giảm sensitivity theo tỉ lệ FOV. Không giữ Scope → spread = `unscopedSpreadDeg`. Bắn xong tự thoát scope 0,3s rồi vào lại nếu vẫn giữ chuột phải.
- **moveSpeedMul:** `stepMovement` nhân `runSpeed`/`crouchSpeed` với `moveSpeedMul` của súng **đang cầm** (lấy từ loadout + slot trong cmd). Ngắm sniper: nhân thêm 0,5.

Nghiệm thu:
- [ ] Test: shotgun 1 phát ở 3m vào thân → 8 tia, tổng damage ≈ 8 × 14 nếu tất cả trúng; ở 25m giảm còn khoảng 30%.
- [ ] Test: cùng `playerId, shotSeq` → 8 hướng tia giống hệt giữa 2 lần chạy.
- [ ] Test determinism movement (task 1.6) vẫn pass sau khi thêm `moveSpeedMul` và đổi súng giữa chừng.
- [ ] Dao: chém trúng ở 2m, đứng 3m chém không trúng. 2 nhát chết.
- [ ] Sniper: không ngắm bắn toé, ngắm thì trúng chính xác; 1 phát thân còn 5 máu, headshot chết.
- [ ] Cầm dao chạy nhanh hơn cầm AK47 (đo trên debug overlay).
- [ ] Test reconcile (task 3.7): 1 phút đổi súng liên tục khi chạy, sai số reconcile vẫn ≈ 0.

Pitfall:
- Đổi súng làm đổi tốc độ chạy → nếu client và server lệch slot ở cùng một `seq` là reconcile giật. Slot phải đi trong `InputCmd` (đã có trường `weapon`, đổi ý nghĩa thành **slot 0–3**) và server dùng đúng giá trị đó.
- Model/âm thanh cho Shotgun, SMG, Sniper, Dao chưa có: viewmodel dùng hộp tạm, âm thanh dùng profile tạm (copy Colt cho dao với gain −30dB thay bằng tiếng "vụt" tổng hợp: noise bandpass quét 800→3000Hz trong 120ms, −10dB). Không chặn task vì thiếu asset.

---

## Task H.2 – Logic kinh tế và loadout (shared, thuần) ⚠️

Tạo `shared/src/economy.ts`. **Không** import gì ngoài `shared/`. Đây là nơi duy nhất chứa luật mua/bán/thưởng, cả client (hiển thị) và server (quyết định) đều gọi.

```ts
export const ECONOMY = {
  startMoney: 2000,
  maxMoney: 16000,
  killReward: 500,
  bountyStreak: 3,          // nạn nhân có chuỗi hạ >= số này
  bountyReward: 1000,
  sellRatio: 0.8,
  defaultResaleValue: 0,    // giá bán lại súng được cấp sẵn (0 = không bán được)
  keepLoadoutOnDeath: false,
};

export const DEFAULT_LOADOUT: Record<TeamId, string[]> = {
  A: ['knife', 'colt', 'm16'],   // Cớm
  B: ['knife', 'rulo', 'ak47'],  // Cướp
};

export interface OwnedWeapon { key: string; paid: number; }   // paid = số tiền đã trả (súng cấp sẵn = 0)
export interface Loadout { slots: (OwnedWeapon | null)[]; }    // luôn đúng 4 phần tử, theo CATEGORY_SLOT

export function defaultLoadout(team: TeamId): Loadout;
export function resaleValue(w: OwnedWeapon): number;           // Math.floor(w.paid * sellRatio)
export function quoteBuy(money: number, loadout: Loadout, key: string):
  | { ok: true; price: number; refund: number; net: number; slot: number }
  | { ok: false; reason: 'not_buyable' | 'already_owned' | 'not_enough_money'; price: number; refund: number; net: number };
export function applyBuy(money: number, loadout: Loadout, key: string): { money: number; loadout: Loadout } | null;
export function killReward(victimStreak: number): number;      // victimStreak >= bountyStreak ? bountyReward : killReward
export function addMoney(money: number, delta: number): number; // kẹp [0, maxMoney]
```

Quy tắc:
- `refund` = giá bán lại súng đang có ở cùng dòng (0 nếu trống). `net = price − refund`.
- Đủ tiền khi `money ≥ net` (tiền bán súng cũ được tính vào). `net` có thể âm (bán súng đắt mua súng rẻ) → được cộng tiền, vẫn kẹp `maxMoney`.
- Súng mới mua có `paid = price`.
- Mua súng **đang có** → `already_owned`.
- Hàm **không** sửa object đầu vào, trả object mới.

Nghiệm thu (vitest):
- [ ] Cớm $2000 mua SMG: còn $750, slot 3 = SMG (paid 1250).
- [ ] Tiếp đó mua Shotgun: refund 1000 (80% của 1250), net 100, còn $650.
- [ ] Cớm $2000 mua Sniper: `not_enough_money` (M16 cấp sẵn bán được $0, net 4750).
- [ ] Cướp mua AK47 khi đang có AK47: `already_owned`.
- [ ] Có $15800 và Sniper (paid 4750 → refund 3800), mua M16 ($3100): net = −700 → tiền cộng 700 nhưng kẹp còn $16000.
- [ ] `killReward(2) = 500`, `killReward(3) = 1000`, `killReward(7) = 1000`.
- [ ] `addMoney(15800, 500) = 16000`.
- [ ] Mua dao: `not_buyable`.

---

## Task H.3 – Server: tiền, loadout, khu mua, thưởng ⚠️

### Message mới (`protocol.ts`)

```ts
// C2S
  | { t: 5; key: string }                                   // Buy

// S2C
  | { t: 114; ok: boolean; reason?: string; key: string }   // BuyResult (riêng người mua)
  | { t: 115; delta: number; reason: 'kill' | 'bounty' | 'buy' | 'sell' | 'reset' } // MoneyEvent (riêng người nhận)

// Kill (t: 107) thêm: reward: number, victimStreak: number
// NetPlayer thêm: killStreak (mọi người thấy, để hiện truy nã)
// Riêng bản thân trong Snapshot thêm: money, loadout (mảng 4 phần tử key|null), slot
```

### Khu mua (buy zone)

- Map JSON thêm: `"buyZoneA": { "min": [x, y, z], "max": [x, y, z] }` cho căn cứ phía x âm; `loadMap` mirror ra `buyZoneB` (lật x, đổi min/max cho đúng).
- Map "Hai thành": căn cứ x −30 → mặt trong tường thành (≈ −19,75), z −20..20, **y từ −1 đến 2,5** (chân phải ở mặt đất; đứng trên gờ tường 4m hoặc đỉnh tháp 6m là ngoài khu).
- Đội nào ở căn cứ nào phụ thuộc `sideSwapped` (task 5.4). Viết hàm `shared`: `inBuyZone(map, team, sideSwapped, pos): boolean` (dùng vị trí chân).

### Xử lý ở server

- Nhận Buy: kiểm tra `alive`, `inBuyZone` (vị trí server hiện tại), pha trận không phải ENDED, rồi `applyBuy`. Thành công: cập nhật tiền + loadout, **tự chuyển sang slot vừa mua**, đạn đầy, huỷ reload đang chạy; gửi BuyResult + MoneyEvent (`buy` âm, và `sell` dương nếu có hoàn tiền).
- Giới hạn chống spam: tối đa 5 lệnh Buy mỗi giây mỗi người.
- Hạ gục: `reward = killReward(victim.killStreak)`, cộng cho người hạ (`addMoney`), `killer.killStreak++`, `victim.killStreak = 0`. Gửi MoneyEvent (`kill` hoặc `bounty`).
- Chết: nếu `keepLoadoutOnDeath = false` → khi hồi sinh loadout = `defaultLoadout(team)`, slot = súng dài. Tiền giữ nguyên.
- Trận mới / người vào giữa trận / đổi đội: tiền = `startMoney`, loadout mặc định, `killStreak = 0`, gửi MoneyEvent `reset`.
- `InputCmd.weapon` giờ là **slot 0–3**. Slot trống → server giữ slot cũ (không cho cầm "không khí").

Nghiệm thu:
- [ ] Đứng trong căn cứ mua SMG: tiền giảm, cầm SMG ngay. Leo lên gờ tường bấm mua: server từ chối (`out_of_zone`).
- [ ] Sửa tạm client gửi Buy khi đứng giữa map: server từ chối.
- [ ] Hạ người có chuỗi 3: nhận +$1000; người đó hồi sinh với chuỗi 0.
- [ ] Mua Sniper, chết, hồi sinh: về lại bộ mặc định (Cớm: Colt + M16).
- [ ] Hết trận, trận mới: mọi người $2000, bộ mặc định.
- [ ] Đổi bên (trận thứ 2): Cớm mua được ở căn cứ mới, căn cứ cũ thì không.

Pitfall:
- Tiền và loadout **chỉ server quyết định**. Client không tự trừ tiền khi bấm mua; chờ BuyResult (ping nội bộ thấp nên không thấy trễ).
- Client vẫn được tự tính `inBuyZone` để làm sáng/mờ giỏ hàng, nhưng đó chỉ là hiển thị.

---

## Task H.4 – Đổi vũ khí theo ô

Làm (client):
- Phím **1–4** chọn ô tương ứng (bỏ qua nếu ô trống). Con lăn chuột: ô kế tiếp/trước đó có súng (vòng tròn).
- Phím **Q**: đổi nhanh về ô vừa cầm trước đó.
- Khi menu cửa hàng đang mở (H.7), phím số dùng để **mua**, không đổi súng; con lăn và Q vẫn đổi súng bình thường.
- Đổi súng: animation hạ/đưa súng 0,3s (đã có từ task 2.1), huỷ reload, huỷ scope.

Nghiệm thu:
- [ ] Bấm 3 khi chưa có súng vừa: không có gì xảy ra.
- [ ] Con lăn bỏ qua ô trống.
- [ ] Q chuyển qua lại giữa dao và súng dài.

---

## Task H.5 – Icon vũ khí (render từ model bằng Blender)

Icon kiểu **bóng trắng phẳng** (silhouette), nền trong suốt, nòng chĩa sang **trái**, khớp phong cách HUD viền trắng.

Làm `tools/blender/render_icon.py` (chạy giống `gun_tool.py`, xem `tools-blend-to-glb.md`):
- Đầu vào: file `.glb` **đã chuẩn hoá** (nòng +Y, trên +Z trong Blender sau khi import), đầu ra PNG 512×256.
- Import glb vào scene trống. Camera **orthographic** đặt ở phía **−X** nhìn về +X, trục lên +Z (khi đó +Y hiện ở bên trái màn hình → nòng chĩa trái). `ortho_scale` = cạnh dài nhất của bbox × 1,1; căn giữa theo bbox.
- Engine `BLENDER_WORKBENCH`: `shading.light = 'FLAT'`, `shading.color_type = 'SINGLE'`, `shading.single_color = (1, 1, 1)`, `render.film_transparent = True`, tắt outline/shadow/cavity. Kết quả: bóng trắng đặc.
- Xuất: `client/public/icons/weapons/<key>.png`.
- Súng chưa có model (dao, shotgun, smg, sniper): Claude Code **vẽ tạm SVG silhouette đơn giản** cùng kích thước tỉ lệ 2:1, lưu `<key>.svg`; HUD ưu tiên PNG, không có thì SVG.

Nghiệm thu:
- [ ] 4 icon AK47, M16, Colt, Rulô: trắng, nền trong suốt, nòng chĩa trái, không bị cắt mép.
- [ ] Icon các súng còn lại có bản SVG tạm, nhìn ra được loại súng.

---

## Task H.6 – HUD dưới màn hình

Bố cục (HTML/CSS đè canvas, tất cả nằm cách đáy 24px):

```
                                                           
 $ 2000                                                     
 ♥ 100          [1 dao] [2 ngắn] [3 vừa] [4 dài]        25 / 30
                                                         M16
```

- **Trái dưới:**
  - Dòng trên: `$ 2000` — chữ trắng đậm 22px, ký hiệu `$` màu xanh lá `#5fd16b`. Khi tiền đổi: số chạy dần tới giá trị mới trong 400ms; tăng thì nháy xanh, giảm thì nháy đỏ.
  - Dòng dưới: **icon trái tim đỏ** `#ff3b3b` (SVG, 28px) + số máu trắng đậm 32px. Máu < 30: trái tim đập nhẹ (scale 1 → 1.15, 0,9s/nhịp).
- **Giữa dưới, ngang hàng máu và đạn:** 4 ô vuông vũ khí.
  - Mỗi ô 72×72px, cách nhau 10px, bo góc 10px, viền 2px trắng, nền `rgba(0,0,0,0.35)`.
  - Số ô (1–4) ở **góc dưới bên trái trong ô**, 12px đậm, trắng.
  - Bên trong: icon súng (H.5), `object-fit: contain`, đệm 8px. Thiếu icon → hiện tên súng chữ nhỏ.
  - **Ô trống: cả ô mờ** (`opacity: 0.35`), không có icon.
  - **Ô đang cầm:** viền 3px trắng sáng, nền `rgba(255,255,255,0.15)`, nhích lên 4px. Đổi ô có transition 120ms.
- **Phải dưới:** đạn `25 / 30` (trắng đậm 32px, số còn lại ≤ 25% băng thì chuyển màu cam), bên dưới tên súng chữ nhỏ. Dao: hiện `—`.
- Dùng `pointer-events: none` cho toàn bộ HUD, **trừ** giỏ hàng (H.7).
- Mọi kích thước dùng biến CSS ở `:root` để dễ chỉnh; thu nhỏ 15% khi chiều cao cửa sổ < 700px.

Nghiệm thu:
- [ ] Đổi súng thấy ô sáng đúng ô. Mua súng vừa: ô 3 từ mờ thành có icon.
- [ ] Bị bắn còn 25 máu: tim đập. Hạ người: tiền chạy lên và nháy xanh.
- [ ] Cửa sổ 1280×720 và 1920×1080 đều không đè chữ lên nhau.

---

## Task H.7 – Giỏ hàng và menu cửa hàng

### Giỏ hàng

- Vị trí: **giữa cạnh trái màn hình** (`left: 24px; top: 50%`).
- Icon giỏ hàng SVG màu trắng 36px, bên phải là chữ `(B)` 14px.
- Trong khu mua: sáng rõ (`opacity: 1`) + viền phát sáng nhẹ nhấp nháy chậm. Ngoài khu / đang chết / trận ENDED: mờ (`opacity: 0.3`), không mở được menu.
- Mở/đóng: **phím B** (bật/tắt), hoặc **click vào giỏ** khi chuột đang tự do (không khoá pointer).

### Menu

- Trượt ra **từ cạnh trái**, rộng 340px, cao tối đa 70vh, `top: 15%`, nền `rgba(10,12,16,0.88)`, bo góc phải 12px. Animation `transform: translateX(-100%) → 0` trong 200ms. Bấm B lần nữa: trượt vào.
- Đang mở mà người chơi **ra khỏi khu mua** hoặc chết: tự trượt vào.
- Đầu menu: tiêu đề `CỬA HÀNG` và số tiền hiện tại.
- Danh sách, nhóm theo dòng (bỏ qua dao):

```
────────────────────────────
Súng ngắn
(1) [icon Colt]   Colt        $300
(2) [icon Rulô]   Rulô        $700
────────────────────────────
Súng vừa
(3) [icon]        Shotgun    $1100
(4) [icon]        SMG        $1250
────────────────────────────
Súng dài
(5) [icon]        AK47       $2700
(6) [icon]        M16        $3100
(7) [icon]        Sniper     $4750
────────────────────────────
Mỗi dòng súng chỉ mang được 1 loại. Mua trùng dòng sẽ
tự động bán súng đang có với giá 80%.
```

- Mỗi nhóm: **đường kẻ ngang mảnh** (`1px rgba(255,255,255,0.25)`), ngay dưới là **tên dòng chữ nhỏ** (11px, xám nhạt, viết hoa).
- Mỗi dòng súng: `(i)` (badge phím), icon 96×40, tên, giá căn phải. Số thứ tự `i` đánh liên tục từ 1 theo thứ tự hiển thị.
- **Phím số `i` mua súng thứ `i`** (khi menu mở). Click vào dòng cũng mua (khi chuột tự do).
- Trạng thái dòng (tính bằng `quoteBuy` ở client, chỉ để hiển thị):
  - Đang có: chữ `Đang dùng` thay cho giá, dòng mờ nhẹ, không mua được.
  - Không đủ tiền: giá màu đỏ, dòng mờ.
  - Mua sẽ bán súng cũ: dưới giá thêm dòng nhỏ, ví dụ `bán SMG +$1000 · trả $100`. Súng cũ là súng cấp sẵn (bán lại $0): ghi `Colt cấp sẵn, không bán lại`.
- Mua thành công: dòng nháy xanh, phát âm "ka-ching" (tổng hợp: 2 tone triangle 1320Hz rồi 1760Hz cách 60ms, decay 150ms, −12dB). Thất bại: dòng rung ngang 150ms, âm "bíp" thấp (tone square 220Hz, 120ms, −16dB).
- Footer luôn hiện câu chú thích như trên, chữ 12px xám.
- Menu mở **không khoá chuột/di chuyển**: vẫn chạy và nhìn được, chỉ các phím số bị dùng cho mua.

Nghiệm thu:
- [ ] Trong căn cứ bấm B: menu trượt ra; B lần nữa: trượt vào.
- [ ] Bấm 4 (SMG) với $2000: mua được, ô 3 có SMG, menu vẫn mở, tiền còn $750, dòng SMG thành `Đang dùng`.
- [ ] Bấm 3 (Shotgun) ngay sau đó: thấy `bán SMG +$1000 · trả $100`, mua xong còn $650.
- [ ] Đi ra khỏi căn cứ khi menu đang mở: menu tự đóng, giỏ hàng mờ, bấm B không mở.
- [ ] Đổi bên ở trận sau: giỏ hàng sáng ở căn cứ mới.
- [ ] Bấm Esc nhả chuột, click giỏ hàng: menu mở; click dòng súng: mua được.

---

## Task H.8 – Phản hồi tiền thưởng

Làm:
- MoneyEvent `kill`: chữ `+$500` bay lên cạnh số tiền rồi mờ đi (600ms).
- MoneyEvent `bounty`: chữ `+$1000` to hơn, màu vàng, kèm dòng giữa màn hình `TRUY NÃ! Hạ [tên] (chuỗi 3)` trong 1,5s; âm thanh: hạ gục + thêm tiếng "ka-ching".
- Killfeed: thêm `+$500` / `+$1000` nhỏ cuối dòng **chỉ ở dòng do chính mình hạ**.
- **Dấu truy nã:** người có `killStreak ≥ 3` hiện biểu tượng ngọn lửa/ngôi sao nhỏ trên đầu (thấy được cả với kẻ địch), để mọi người biết ai đang "đáng giá" $1000.
- Bảng điểm (Tab): thêm cột tiền **chỉ cho đồng đội** (đối phương hiện `—`).

Nghiệm thu:
- [ ] Hạ 3 người liên tiếp: phía địch thấy biểu tượng truy nã trên đầu mình.
- [ ] Địch hạ mình lúc đó: họ thấy dòng TRUY NÃ và +$1000; biểu tượng trên đầu mình biến mất khi hồi sinh.
- [ ] Bảng điểm không lộ tiền của phe địch.
