# 16 – Zombie: phần nền chung + thể thức **Lây Nhiễm**

File này có 2 phần:
- **Phần ZF (nền zombie)**: model, nhân vật zombie, chiêu nhảy, bò, đẩy lùi, ban đêm, đèn pin, âm thanh. **Dùng chung cho cả Lây Nhiễm và Thủ Thành (file 17).** Làm phần này trước.
- **Phần I (Lây Nhiễm)**: luật chơi người vs người, zombie mẹ, lây nhiễm, anh hùng.

Yêu cầu trước: task 11 (nhân vật có xương), 13 (MatchMode, tạo phòng). File 17 cần thêm task 15 (bot, nav grid).

Thứ tự: ZF.1 → ZF.2 → ZF.3 → ZF.4 → ZF.5 → ZF.6 → ZF.7 → I.1 → I.2 → I.3 → I.4 → I.5. Task ⚠️ nên dùng model mạnh.

---

# PHẦN ZF – NỀN ZOMBIE (dùng chung)

## Task ZF.1 – Model zombie và các biến thể

Người dùng đã có 1 model zombie, sẽ thêm vài model nữa. Mỗi model đi đúng quy trình nhân vật của task 11:

1. **Claude Code**: `prep_mixamo.py` → `assets/source/zombies/mixamo_in/<tên>.fbx` (cao mặc định 1,8m; zombie to có thể `--height 2.1`).
2. **Người dùng (Mixamo)**: rig lại → `mixamo_out/<tên>_rigged.fbx`. Animation zombie **chỉ cần tải một lần** (dùng chung mọi zombie vì cùng bộ xương Mixamo), Without Skin, 30fps, In Place, lưu vào `assets/source/zombies/mixamo_out/anims/`:

| Lưu thành | Từ khoá Mixamo | Ghi chú |
|---|---|---|
| `z_idle.fbx` | zombie idle | |
| `z_walk.fbx` | zombie walk | |
| `z_run.fbx` | zombie running | |
| `z_attack_1.fbx` | zombie attack | cào tay |
| `z_attack_2.fbx` | zombie punching / zombie biting | biến thể đòn đánh |
| `z_scream.fbx` | zombie scream | lúc biến thành zombie, lúc nhảy cao |
| `z_crawl.fbx` | zombie crawl / crawling | bò qua lỗ |
| `z_jump.fbx` | jump | dùng cho chiêu nhảy cao |
| `z_death_1.fbx`, `z_death_2.fbx` | zombie dying / zombie death | |
| `z_hit.fbx` | zombie reaction hit / hit reaction | bị bắn giật lùi |
| `z_transform.fbx` | zombie stand up / getting up | người hoá zombie (đứng dậy) |

3. **Claude Code**: `build-character` (task C.3) → `client/public/models/zombies/<tên>.glb`.

**Danh sách model** `shared/src/zombieModels.json`:

```json
{
  "models": [
    { "id": "z1", "file": "zombies/z1.glb", "scale": 1.0, "eyeBone": "mixamorigHead", "eyeOffset": [0, 0.08, 0.09] }
  ],
  "variation": {
    "scaleJitter": 0.06,
    "tints": ["#9fb59a", "#b5a99a", "#8fa0a8", "#a89a9a"],
    "tintStrength": 0.35,
    "eyeGlow": "#ff3b2f"
  }
}
```

- Mỗi zombie khi sinh ra chọn ngẫu nhiên một model, scale lệch ±6%, nhân màu với một tint (giữ texture gốc, chỉ ngả màu), **mắt phát sáng đỏ** (2 sprite nhỏ additive gắn vào xương đầu tại `eyeOffset`). 1 model + 4 tint đã đủ nhìn khác nhau.
- **Zombie từ người bị lây nhiễm** (Lây Nhiễm): dùng luôn model Cớm/Cướp của người đó, áp tint xanh xám + mắt đỏ + animation zombie. Không cần model riêng mà vẫn nhận ra "ai vừa bị biến".
- Thiếu model zombie (chưa có file): dùng model Cướp + tint làm zombie tạm.

Nghiệm thu:
- [ ] Viewer chạy được mọi animation `z_*` trên mọi model zombie, đứng tại chỗ.
- [ ] 10 zombie cùng model nhìn vẫn khác nhau (tint, cỡ).

---

## Task ZF.2 – Vai trò zombie trong gameplay (shared + server) ⚠️

- `Player` thêm `role: 'human' | 'zombie'` và `zombieType: string | null` (Lây Nhiễm dùng `'mother'` / `'normal'`; Thủ Thành dùng các loại của file 17).
- **Vũ khí zombie** (`WEAPONS`, `category: 'claw'`, không mua được, không rơi):
  - Cào thường (chuột trái): melee hitscan tầm `1.8m`, `damage` lấy theo loại zombie, `fireIntervalMs 550`.
  - Cào mạnh (chuột phải): tầm `2.0m`, damage ×2, `fireIntervalMs 1100`, có 0,3s vung tay trước khi trúng (người kịp lùi).
  - Không spread, không recoil, có lag compensation như dao.
- **Movement zombie** (`MovementConfig` riêng, chọn theo `role` trong `stepMovement`, vẫn tất định):
  - `runSpeed` theo loại zombie (mặc định 9.5, nhanh hơn người 8.5).
  - `crouchHeight: 0.85` (nhỏ hơn người 1.2) → **bò lọt qua lỗ bắn** (lỗ cao 1,0m, đáy cách đất 1,0m): zombie nhảy khi đang ngồi để chui vào lỗ. Cho phép nhảy khi đang ngồi với zombie.
  - Không trượt (slide), không bunny hop (nhảy liên tục mất 30% tốc độ ngang mỗi lần chạm đất).
- **Chiêu nhảy cao** (phím **E**, bit mới `Btn.Ability`): `vel.y = 13.8` (đỉnh ≈ 4,3m: lên được **gờ tường 4m**, **không** lên được tháp 6m), cộng 5 m/s theo hướng nhìn, hồi chiêu `leapCooldownMs = 8000`. Hồi chiêu nằm trong `PlayerState` (tất định, có test).
- **Đẩy lùi khi trúng đạn** (server, mỗi phát trúng zombie):
  ```
  impulse = damage × knockbackPerDamage[weapon] × (1 − zombie.knockbackResist)
  vel += dirNgang(người bắn → zombie) × impulse + up × impulse × 0.25
  ```
  `knockbackPerDamage`: shotgun 0.06 mỗi viên (8 viên trúng = đẩy rất mạnh), sniper 0.05, rulô 0.05, AK47 0.025, M16 0.02, SMG 0.015, colt 0.02. Kẹp tổng vận tốc ngang sau đẩy ≤ 14 m/s. Zombie đang trên không thì đẩy ×1.5 (bắn văng khỏi gờ!).
  - Áp vào state server; client của zombie bị reconcile tự nhiên. Chấp nhận giật nhẹ (người làm zombie sẽ thấy mình bị "bắn văng" sau 1 ping).
- **Hồi máu zombie**: không bị trúng đạn trong `regenDelayMs` (4000) → hồi `regenPerSec` máu mỗi giây tới tối đa.
- Zombie **không** mua đồ, **không** nhặt súng, **không** ném lựu đạn. Cửa hàng ẩn với zombie.
- Người chơi (human): **đạn dự trữ vô hạn** trong các thể thức zombie (chỉ phải nạp băng). Thêm cờ `infiniteReserve` vào cài đặt thể thức.

Nghiệm thu:
- [ ] Zombie bò qua lỗ bắn trên tường thành được (ngồi + nhảy vào lỗ). Người thì không.
- [ ] Zombie nhảy E từ đất lên mặt tường thành được; nhảy từ đất lên đỉnh tháp **không** được; từ gờ tường nhảy lên đỉnh tháp được (chênh 2m).
- [ ] Bắn shotgun vào zombie đang leo ramp: nó văng ngược xuống.
- [ ] Test determinism movement pass với zombie (ngồi-nhảy, chiêu E).

---

## Task ZF.3 – Ban đêm + đèn pin

- Cài đặt phòng thêm `lighting: 'day' | 'night'` (mặc định `night` cho 2 thể thức zombie).
- **Preset đêm**: hemisphere light rất tối (xanh đen), directional "trăng" yếu ánh xanh nhạt, `scene.fog` (FogExp2, mật độ ~0.035, màu xanh đen), skybox tối có vài ngôi sao, vài bóng đèn đường vàng cam đặt cố định trên tường thành (PointLight, **không đổ bóng**, tối đa 6 cái) để map không tối mù.
- **Đèn pin** (người, phím **F**, mặc định bật): `SpotLight` gắn theo camera (góc 25°, tầm 30m, tắt đổ bóng), viewmodel có vệt sáng. Người khác cũng thấy vệt đèn pin của mình: SpotLight gắn theo hướng nhìn trên model 3rd person, **tối đa 4 đèn pin của người khác** được bật đồng thời (gần mình nhất), còn lại chỉ vẽ một hình nón sáng giả (mesh cone additive, không phải đèn thật) để giữ FPS.
- **Zombie nhìn đêm**: khi mình là zombie, màn hình có lớp lọc ngả đỏ nhẹ và độ sáng chung tăng (ambient ×3 chỉ phía client của zombie). Zombie không có đèn pin. Mắt đỏ của zombie khác **luôn thấy** trong bóng tối (sprite không bị ánh sáng ảnh hưởng).

Nghiệm thu:
- [ ] Ban đêm vẫn đọc được map nhờ đèn đường, ngoài vùng sáng thì phải dùng đèn pin.
- [ ] 8 người bật đèn pin: vẫn ≥ 60 FPS.
- [ ] Làm zombie: nhìn rõ hơn người, màu ngả đỏ.

---

## Task ZF.4 – Góc nhìn zombie (1st/3rd person)

- **1st person zombie**: cắt đôi tay từ model zombie (hoặc model người bị lây nhiễm + tint) bằng `build-fp-arms` (task C.6). Không có súng. Hai tay để thấp hai bên màn hình, đung đưa khi chạy.
  - Cào thường: một tay vung chéo qua màn hình (đường cong bezier, 180ms, keyframe trong `poses.json → zombie.swipe`), xen kẽ trái/phải.
  - Cào mạnh: hai tay giơ lên (0,3s) rồi bổ xuống.
  - Nhảy E: hai tay vung ra sau.
- **3rd person zombie**: dùng animation `z_*`. Chạy → `z_run`, đi → `z_walk`, ngồi/bò → `z_crawl`, cào → `z_attack_1/2` chỉ thân trên (mask như G.6), bị trúng → `z_hit` trộn 30% thân trên, nhảy → `z_jump`, chết → `z_death_*`.
- **Biến thành zombie**: người bị lây nhiễm ngã xuống (0,5s) → `z_transform` (1,5s, bất tử, không di chuyển được) → thành zombie. Màn hình người đó: chớp xanh, méo hình nhẹ, tiếng gào.

Nghiệm thu:
- [ ] Làm zombie thấy đôi tay zombie, cào có cảm giác vung tay thật.
- [ ] Người khác thấy zombie chạy, cào, bò, nhảy đúng animation.

---

## Task ZF.5 – Âm thanh zombie

Thêm vào hệ âm thanh (task 08). Ưu tiên file, thiếu thì dùng âm tổng hợp thô:

| Âm | Khi nào |
|---|---|
| `growl_01..05` | zombie gầm gừ ngẫu nhiên mỗi 3–8s, phát theo vị trí (người nghe được zombie tới từ hướng nào) |
| `scream` | biến thành zombie, zombie mẹ xuất hiện, nhảy E |
| `claw_swing`, `claw_hit` | cào hụt / cào trúng |
| `zombie_step` | bước chân nặng (to hơn bước chân người 4dB) |
| `zombie_hurt_01..03` | trúng đạn (giới hạn 1 lần/0,3s mỗi zombie) |
| `zombie_death` | chết |
| `infect_sting` | nhạc hiệu ngắn khi có người bị lây nhiễm (cả phòng nghe, nhỏ) |
| `ambient_night` | nền đêm: gió, côn trùng, tiếng vọng xa, lặp |
| `heartbeat` | người: khi zombie trong 8m mà không nhìn thấy nó (cảnh báo mơ hồ) |

- Từ khoá tìm file: `zombie growl`, `zombie scream`, `monster roar`, `claw swipe`, `flesh hit`, `night ambience`.
- Âm tổng hợp dự phòng cho `growl`: noise lowpass 400Hz + tone sawtooth 70–110Hz rung (LFO 6Hz), 0,8s. Chỉ để không im lặng, có file thì thay.

Nghiệm thu:
- [ ] Nhắm mắt nghe đoán được zombie đang ở trái/phải/sau lưng.

---

## Task ZF.6 – HUD zombie

- **Khi là zombie**: thay ô vũ khí/đạn bằng **thanh máu lớn** (máu zombie hàng nghìn, hiện số), icon chiêu nhảy E có vòng hồi chiêu, tâm ngắm đổi thành hình móng vuốt nhỏ. Ẩn tiền, giỏ hàng.
- **Khi là người**: đạn hiện `25 / ∞`.
- Zombie trúng đạn: hitmarker của người bắn hiện thêm số damage nhỏ (mặc định bật trong thể thức zombie, vì máu zombie lớn, cần thấy mình đang gây bao nhiêu).

---

## Task ZF.7 – Kiểm tra hiệu năng

- 20 zombie (model có xương) + 8 người + đèn pin + sương mù: ≥ 60 FPS trên máy văn phòng. Nếu không đạt:
  - Zombie ở xa > 25m: cập nhật animation 30Hz thay vì mỗi frame, tắt mắt phát sáng ngoài 40m.
  - Dùng chung material theo tint (không tạo material mới mỗi zombie).

---

# PHẦN I – THỂ THỨC LÂY NHIỄM

| Tên hiển thị | Mã |
|---|---|
| **Lây Nhiễm** | `infection` |

Tóm tắt: ai cũng là người lúc đầu, sau 20 giây vài người thành **zombie mẹ**. Zombie cào người → người thành zombie. Người trụ tới hết giờ thì thắng ván, zombie lây hết thì zombie thắng. Người cuối cùng thành **anh hùng**.

## Cài đặt (`roomConfig.ts`)

```ts
export interface InfectionSettings {
  mode: 'infection';
  rounds: number;          // 8
  prepSec: number;         // 20 – mọi người là người, tìm chỗ, mua súng
  roundTimeSec: number;    // 180
  roundEndSec: number;     // 6
  lighting: 'day' | 'night';  // 'night'
}
```
`MODE_LABEL.infection = 'Lây Nhiễm'`. Tối thiểu 3 người để bắt đầu (bot tính là người, xem I.5).

## Config thể thức (`shared/src/infection.ts`)

```ts
export const INFECTION = {
  startMoney: 6000,            // mỗi ván, không mang sang ván sau
  buyAnywhereDuringPrep: true, // trong pha chuẩn bị mua ở đâu cũng được
  motherCount: (players: number) => (players >= 8 ? 2 : 1),
  mother:  { hpBase: 3000, hpPerHuman: 400, runSpeed: 10.0, clawDamage: 60, knockbackResist: 0.3, regenPerSec: 80 },
  normal:  { hpBase: 1500, hpPerHuman: 150, runSpeed: 9.5,  clawDamage: 45, knockbackResist: 0.0, regenPerSec: 50 },
  regenDelayMs: 4000,
  zombieRespawnMs: 5000,       // zombie bị hạ thì hồi sinh lại (vẫn là zombie)
  transformMs: 1500,
  hero: { hp: 200, damageMult: 1.5, speedMult: 1.1 },
  points: { surviveRound: 3, infect: 1, killZombie: 2, killAsHero: 3, mother: 1 },
  sniff: { cooldownMs: 15000, radius: 18, durationMs: 2500 }, // chiêu "đánh hơi" của zombie (I.3)
};
```

---

## Task I.1 – Lớp thể thức `InfectionMode` (server) ⚠️

Cài đặt `MatchMode` (task M.1). Các pha:

```
WARMUP ──(≥ 3 người)──► PREP (prepSec) ──► PICK (2s) ──► LIVE (roundTimeSec) ──► ROUND_END ──► PREP ván sau
                                                                                    │
                                                              (hết `rounds` ván) ──► MATCH_END ──(15s)──► WARMUP
```

- **PREP**: mọi người là `human`, tiền = `startMoney`, mua được ở bất kỳ đâu, hồi sinh ngay nếu chết (không có ai giết ai). Spawn rải đều khắp map (chọn node mặt đất của nav grid task B.1 xa nhau, không chỉ ở căn cứ). Không có đội Cớm/Cướp trong thể thức này: mọi người cùng phe "Người".
- **PICK**: chọn `motherCount` người ngẫu nhiên làm zombie mẹ, **không chọn lại người vừa làm zombie mẹ ván trước** nếu còn lựa chọn khác. Họ biến hình tại chỗ (`transformMs`, bất tử), cả phòng nghe `scream` + banner.
- **LIVE**:
  - Zombie cào trúng người: trừ máu `clawDamage`; máu ≤ 0 → người bị **lây nhiễm** tại chỗ (thành zombie `normal`, máu theo công thức, `transformMs`), **không** tính là chết, không rơi súng.
  - Người hạ zombie (máu zombie ≤ 0): zombie ngã, `zombieRespawnMs` sau hồi sinh lại thành zombie ở điểm **xa người nhất**. Người hạ được `points.killZombie`.
  - Máu zombie tính lại mỗi khi số người còn sống thay đổi: `hpMax = hpBase + hpPerHuman × sốNgườiCònSống` (máu hiện tại giữ tỉ lệ %).
  - Còn đúng 1 người → **anh hùng** (`hero`): máu lên 200, damage ×1.5, tốc độ ×1.1, banner cho cả phòng.
  - Hết người → zombie thắng ván. Hết giờ còn ≥ 1 người → người thắng ván; mỗi người sống `+surviveRound`.
- **Không có friendly fire** giữa người với người; zombie không cào được zombie.
- **Người rời giữa ván**: nếu là zombie mẹ duy nhất và không còn zombie nào → chọn ngay một người làm zombie mẹ mới.
- **Người vào giữa ván**: vào luôn với vai **zombie** (normal) nếu đang LIVE; vào trong PREP thì là người.
- **Điểm**: bảng điểm xếp theo điểm cá nhân (`points`), thắng chung cuộc là người nhiều điểm nhất sau `rounds` ván.

Message thêm:

```ts
  | { t: 130; playerId: number; byId: number | null; kind: 'mother' | 'infected' }  // Infected
  | { t: 131; playerId: number }                                                    // HeroChosen
  | { t: 132; humans: number; zombies: number }                                     // InfectionCount (khi đổi)
```

Nghiệm thu (dùng lệnh debug M.8, thêm `/zombie` biến mình thành zombie, `/human`):
- [ ] 3 tab: sau 20s một người thành zombie mẹ, cả phòng thấy banner.
- [ ] Zombie cào 2 lần → người thành zombie tại chỗ, đứng dậy sau 1,5s, cào được người khác.
- [ ] Bắn zombie đến chết: 5s sau nó hồi sinh ở xa.
- [ ] Còn 1 người: thành anh hùng, máu 200.
- [ ] Hết giờ còn người: người thắng ván; lây hết: zombie thắng ván.
- [ ] Hết 8 ván: màn hình kết thúc theo điểm cá nhân.

---

## Task I.2 – Cân bằng chống cắm tháp

- Kiểm tra bằng chơi thử: 3–4 người đứng trên tháp, 2 zombie. Mục tiêu: zombie **có cơ hội** (dùng gờ tường + nhảy E lên tháp + cào mạnh), người giỏi vẫn giữ được nếu phối hợp.
- Công cụ cân bằng (đã có sẵn trong config, chỉ chỉnh số): `leapCooldownMs`, `knockbackPerDamage`, `hpPerHuman`, `clawDamage`.
- Nếu tháp vẫn quá mạnh sau khi chỉnh số: thêm luật **"tháp sập"** (tuỳ chọn, cờ `towerDecay`): người đứng trên đỉnh tháp quá 40s liên tục bị trừ 2 máu/giây (khói độc bốc lên, có hiệu ứng). Báo người dùng trước khi bật.

Nghiệm thu:
- [ ] 4 người thủ tháp vs 2 zombie mẹ, chơi 5 ván: zombie thắng ít nhất 1–2 ván.

---

## Task I.3 – Chiêu "đánh hơi" của zombie

- Zombie bấm **Q**: trong `sniff.durationMs`, mọi người trong `sniff.radius` hiện **viền đỏ mờ xuyên tường** trên màn hình của zombie đó (outline shader hoặc vẽ lại mesh với material đỏ trong suốt, `depthTest: false`). Hồi chiêu `sniff.cooldownMs`.
- Người bị đánh hơi nghe tiếng `growl` gần + icon "mũi" nhỏ hiện trên HUD 2 giây (biết mình bị lộ).
- Mục đích: người không thể núp một góc tối suốt 3 phút.

Nghiệm thu:
- [ ] Zombie bấm Q thấy người sau tường trong 18m, ngoài 18m không thấy.

---

## Task I.4 – HUD và thông báo Lây Nhiễm

- Trên giữa: `🧍 5  ·  2:13  ·  🧟 3` (số người / thời gian / số zombie), dòng nhỏ `Ván 3/8`.
- Banner giữa màn hình (2,5s): `ZOMBIE MẸ ĐÃ XUẤT HIỆN`, `[tên] ĐÃ BỊ LÂY NHIỄM` (chữ nhỏ, góc trên, như killfeed), `BẠN ĐÃ BỊ LÂY NHIỄM!` (to, màu xanh, chỉ người đó), `[tên] LÀ NGƯỜI CUỐI CÙNG – ANH HÙNG!`, `NGƯỜI THẮNG` / `ZOMBIE THẮNG`.
- Pha PREP: đếm ngược to `Zombie xuất hiện sau 0:12`, giỏ hàng sáng ở mọi nơi.
- Killfeed: `Tèo 🧟→ Mít` cho lây nhiễm, súng như cũ cho người hạ zombie.
- Bảng điểm: một cột điểm, cột lây nhiễm, cột hạ zombie, cột vai hiện tại (người/zombie).

---

## Task I.5 – Bot trong Lây Nhiễm (offline)

Bot (task 15) chơi được Lây Nhiễm để luyện một mình:
- **Bot là người**: hành vi "giữ chỗ": chọn một vị trí thủ (đỉnh tháp, gờ tường, góc có tường sau lưng) gần nhất, đứng đó bắn zombie gần nhất; zombie tới quá gần (< 4m) thì lùi về phía đồng đội. Không đánh vòng, không áp sát.
- **Bot là zombie**: dùng hành vi zombie của file 17 (task T.4: tìm đường tới người gần nhất, dùng cạnh nhảy E và cạnh bò qua lỗ, cào khi tới gần). Bot zombie dùng đánh hơi khi không thấy người trong 10s.
- Nút offline (B.7) dùng được trong Lây Nhiễm; "phe" bỏ qua, bot tham gia như người chơi bình thường.

Nghiệm thu:
- [ ] Offline 1 người + 5 bot: chơi trọn một ván Lây Nhiễm, bot biến zombie và đi săn được.

---

## Ghi chú cho người dùng

- Làm xong phần ZF là có sẵn 70% cho Thủ Thành (file 17).
- Muốn có thêm model zombie cho đa dạng: tìm các model zombie có rig hoặc chưa rig đều được (đằng nào cũng rig lại qua Mixamo). Chỉ cần là hình người hai tay hai chân, có texture. Mỗi model mới chỉ tốn khoảng 5 phút (chạy script + upload Mixamo + build), animation dùng chung.
