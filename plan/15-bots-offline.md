# 15 – Bot trong chế độ offline (Trung bình / Khó)

Mục tiêu:
- Chế độ offline có nút **+ Bot trung bình**, **+ Bot khó** ở góc trên bên trái. Bot mặc định ở **phe địch**.
- **Bot trung bình:** ít di chuyển, phản xạ chậm, ngắm lâu.
- **Bot khó:** di chuyển tích cực, biết núp, tìm cơ hội áp sát, đánh vòng, ngắm nhanh hơn — **nhưng không bách phát bách trúng**.
- Offline được **đổi phe**, mua hàng bình thường với **tiền vô hạn**.

Nguyên tắc vàng: **bot là người chơi bình thường**. Bot chỉ sinh ra `InputCmd` mỗi tick (phím + yaw/pitch), đi qua đúng `stepMovement`, `tryFire`, spread, recoil như người thật. Bot **không** được đặt vị trí, sửa máu, bắn trúng trực tiếp. Bot trượt vì toé, giật, ngắm lệch — tự nhiên như người.

Thứ tự: B.0 → B.1 → B.2 → B.3 → B.4 → B.5 → B.6 → B.7 → B.8. Task ⚠️ nên dùng model mạnh.

---

## Task B.0 – Offline chạy trên cùng code Room của server ⚠️

Kiểm tra trước: chế độ offline hiện chạy thế nào. Báo cáo cho người dùng rồi mới làm.

- **Nếu offline đang kết nối tới server local qua WebSocket** (một phòng riêng): giữ nguyên, bot chạy trên server. Bỏ qua phần còn lại của B.0.
- **Nếu offline chỉ chạy client** (không có Room): chuyển sang chạy **chính code `server/src/room.ts` trong một Web Worker** của trình duyệt:
  - Tách phần server không phụ thuộc Node (`room`, `simulation`, `modes`, `lagComp`, `bots`) khỏi phần Node-only (`ws`, `http`). Phần chung không được import `ws`, `fs`, `process`.
  - `LocalTransport` (cài đặt interface `Transport` của task 3.1) nói chuyện qua `postMessage` giữa main thread và worker, vẫn encode/decode msgpack như mạng thật.
  - Rapier chạy được trong worker (gọi `init()` trong worker).
  - Offline giờ là "một phòng chỉ có mình + bot", mọi tính năng (mua đồ, lựu đạn, chế độ chơi) chạy y như online.

Nghiệm thu:
- [ ] Offline vào được, đi lại bắn bia được như trước, không cần chạy server Node.
- [ ] Netsim (`?lat=`) không áp dụng cho offline (ping = 0).

---

## Task B.1 – Lưới di chuyển (nav grid) + tìm đường ⚠️

Tạo `server/src/bots/nav.ts`, sinh tự động khi load map (không cần người dùng vẽ tay):

1. **Lấy mẫu điểm đứng:** lưới 1m × 1m phủ toàn map, ở mỗi ô raycast từ trên cao xuống (chỉ collider map) để tìm **mọi mặt đứng** (mặt đất, mặt tường thành, đỉnh tháp, mặt ramp). Mặt có pháp tuyến y ≥ 0,7 và đủ chỗ cho capsule đứng (kiểm tra `canStand`) thì thành **node**.
2. **Nối cạnh:** node nối với 8 node lân cận nếu: chênh cao ≤ 0,45m (bước/ramp đi được) **và** quét capsule từ node này sang node kia không chạm tường (`castShape`). Cạnh lên/xuống ramp được nối tự nhiên nhờ chênh cao nhỏ giữa các ô.
3. **Cạnh nhảy xuống:** từ mép gờ tường/tháp được nối **một chiều** xuống node mặt đất ngay dưới nếu chênh cao ≤ 4,5m (bot được nhảy xuống, không leo lên).
4. **Điểm núp (cover):** với mỗi node mặt đất, raycast ngang ở độ cao 1,0m theo 8 hướng, dài 1,2m. Hướng nào chạm tường cao ≥ 1,2m → node là cover cho hướng đó. Lưu `coverDirs` (bitmask 8 hướng).
5. **Vùng:** gán mỗi node vào `baseA` / `baseB` / `wallA` / `wallB` / `mid` / `towerA` / `towerB` theo toạ độ (dùng cho hành vi).
6. **A\***: `findPath(from, to, costFn?)`, heuristic khoảng cách Euclid. `costFn` cho phép cộng thêm chi phí (B.6 dùng để né tầm nhìn địch). Kết quả làm mượt bằng cách bỏ node trung gian nếu đi thẳng được (string pulling bằng `castShape`).
7. Cache kết quả theo tên map (sinh một lần mỗi lần khởi động).

Debug **F11**: vẽ node (chấm xanh, cover là chấm vàng có gạch chỉ hướng tường), cạnh (đường mảnh), đường đi hiện tại của từng bot (đường đỏ).

Nghiệm thu:
- [ ] Map "Hai thành": có node trên mặt đất, mặt tường thành, đỉnh tháp; ramp nối liền đất với mặt tường.
- [ ] Test: `findPath` từ căn cứ A tới căn cứ B tồn tại, đi qua lỗ vòng ở mép hoặc qua khu giữa, không xuyên tường.
- [ ] Test: từ đất lên đỉnh tháp A: đường đi qua ramp lên gờ tường rồi lên tháp.
- [ ] Sinh lưới < 1 giây.

---

## Task B.2 – Hạ tầng bot

`server/src/bots/`:

```ts
type BotDifficulty = 'medium' | 'hard';

class BotController {
  constructor(player: Player, difficulty: BotDifficulty, params: BotParams);
  think(room: Room, nowMs: number): void;        // 10 lần/giây: nhận thức, chọn hành vi, tìm đường
  makeInput(room: Room, seq: number): InputCmd;  // mỗi tick: sinh phím + yaw/pitch từ hành vi hiện tại
}
```

- Bot là một `Player` bình thường trong `Room`, có cờ `isBot`, **không** có transport (không gửi gì). Server mỗi tick gọi `makeInput` rồi đưa cmd vào đúng đường xử lý như input người thật.
- **Đi theo đường:** từ hướng muốn đi (tới waypoint kế tiếp) và yaw hiện tại của bot (đang nhìn đâu), chiếu ra `forward`/`right` rồi chọn tổ hợp phím W/A/S/D gần nhất (8 hướng). Tới gần waypoint (< 0,6m) thì sang waypoint sau. Kẹt (không tiến được 1,5s) → tìm đường lại; kẹt lần 2 → nhảy một cái rồi tìm lại.
- **Mua đồ** (khi hồi sinh trong khu mua): theo `params.buy` (B.8). Offline tiền vô hạn nên bot cũng mua thoải mái.
- **Tên bot:** lấy ngẫu nhiên không trùng từ danh sách `["Tèo", "Tí", "Tủn", "Bin", "Bon", "Mít", "Xoài", "Bơ", "Sữa", "Cốm", "Bắp", "Gạo"]`, hiển thị `[BOT] Tèo` (bảng điểm và killfeed thêm chữ nhỏ `TB` hoặc `KHÓ`).
- Thêm/xoá bot: hàm `room.addBot(difficulty, team)` / `room.removeBot(id)` / `room.removeAllBots()`.
- Giới hạn: tổng người + bot ≤ `maxPlayers` của phòng (offline mặc định 10).
- Hiệu năng: `think` 10Hz rải đều theo id (không cho mọi bot nghĩ cùng một tick), raycast tối đa ~20 tia/bot/lần nghĩ.

Nghiệm thu:
- [ ] Thêm 1 bot: xuất hiện ở căn cứ địch, đi theo đường tới khu giữa không kẹt tường.
- [ ] 8 bot cùng lúc: server tick vẫn đủ 60/giây, FPS client không giảm rõ.

---

## Task B.3 – Nhận thức: nhìn, nghe, nhớ

Mỗi lần `think`:
- **Nhìn thấy** kẻ địch khi: trong `fovDeg` quanh hướng nhìn của bot, trong 80m, và raycast (chỉ map) từ mắt bot tới **đầu hoặc ngực** địch không bị chặn. Ngồi sau tường thấp chỉ lộ đầu thì vẫn thấy được đầu.
- **Phản xạ:** lần đầu thấy một kẻ địch (hoặc thấy lại sau khi mất dấu > 1s) → chờ `reactionMs` (ngẫu nhiên trong khoảng) rồi mới được ngắm/bắn. Đây là nguồn "chậm như người" quan trọng nhất.
- **Nghe:** tiếng súng trong `hearingRadius`, tiếng bước chân chạy trong 15m (chỉ bot khó) → ghi "nghi ngờ có địch ở vị trí X" (không biết chính xác ai), bot quay đầu về hướng đó.
- **Bị bắn trúng:** biết hướng đạn tới (từ vị trí người bắn, cộng sai lệch ngẫu nhiên ±20°), quay về hướng đó.
- **Nhớ:** vị trí cuối cùng thấy mỗi kẻ địch giữ `memoryMs`; hết thì quên.
- Bot **không bao giờ** biết vị trí địch qua tường trừ các nguồn trên.

Nghiệm thu:
- [ ] Đứng sau tường không bắn: bot không nhìn thẳng vào chỗ mình qua tường.
- [ ] Bắn một phát từ sau lưng bot: bot quay lại sau thời gian phản xạ.
- [ ] Bot trung bình phản ứng chậm hơn bot khó thấy rõ (đo bằng overlay F11, mục B.8).

---

## Task B.4 – Ngắm và bắn giống người ⚠️

Không dùng "xoay thẳng tới mục tiêu". Mô hình:

1. **Điểm nhắm:** chọn mỗi lần bắt đầu giao tranh: ngực (mặc định) hoặc đầu với xác suất `headChance`. Bám theo vị trí địch **trễ** `trackingLagMs` (bot nhắm vào chỗ địch vừa ở, không đoán trước hướng chạy) → địch chạy ngang nhanh thì bot dễ bắn sau lưng.
2. **Sai số ngắm:** khi bắt đầu nhắm một mục tiêu, cộng một **độ lệch ngẫu nhiên** `aimErrorDeg` (hướng ngẫu nhiên). Độ lệch giảm dần theo thời gian (`aimErrorDecayPerSec`) nhưng không bao giờ về đúng 0: luôn còn `aimJitterDeg` rung nhẹ ngẫu nhiên (nhiễu mượt, đổi hướng mỗi 150–300ms).
3. **Xoay chuột:** góc của bot tiến tới góc đích bằng chuyển động có giới hạn tốc độ (`aimSpeedDegPerSec`) và có quán tính (lò xo giảm chấn), nên vẩy tâm xa sẽ hơi vượt quá rồi chỉnh lại như tay người.
4. **Quyết định bắn:** chỉ bóp cò khi góc lệch giữa hướng nhìn và điểm nhắm < `fireThresholdDeg` **và** đã qua thời gian phản xạ.
5. **Bắn theo loạt:** súng tự động bắn loạt `burst` viên rồi nghỉ `burstPauseMs` (để bloom hồi), không giữ cò cả băng. Súng bán tự động: nhịp bấm ngẫu nhiên chậm hơn tốc độ tối đa của súng 20–60%.
6. **Ghìm giật:** bot chỉ bù được `recoilCompensation` phần trăm độ giật (trung bình 30%, khó 60%), phần còn lại làm tâm leo lên như người không ghìm được.
7. **Spread, bloom, recoil áp dụng y hệt người chơi** (bot gửi cmd qua `tryFire` chung).
8. Tầm xa: ngoài 40m bot trung bình không bắn súng tự động liên tục, chỉ bắn từng phát.

Nghiệm thu (bài kiểm tra tự động, `npm run bot-bench`, chạy offline không cần giao diện):
- [ ] Bot vs bia người **đứng yên** ở 20m, AK47, 300 viên: tỉ lệ trúng **trung bình 25–40%**, **khó 40–55%**; tỉ lệ trúng đầu trong số viên trúng: trung bình ≤ 15%, khó ≤ 30%.
- [ ] Bot vs bia **chạy ngang qua lại** 6 m/s ở 20m: trung bình 10–20%, khó 20–35%.
- [ ] Thời gian từ lúc thấy tới phát bắn đầu tiên (bia đứng yên, ló ra đột ngột): trung bình 700–1100ms, khó 300–550ms.
- [ ] Không có lần nào bot bắn trúng 10 viên liên tiếp vào đầu.
- Nếu số đo nằm ngoài khoảng: chỉnh `bots.json`, **không** sửa code ngắm để ép kết quả.

---

## Task B.5 – Hành vi bot Trung bình

Máy trạng thái đơn giản:

| Trạng thái | Làm gì |
|---|---|
| `Patrol` | Đi bộ chậm (giữ tốc độ ~50%, như đi bộ) tới một node ngẫu nhiên trong nửa map của mình hoặc khu giữa, đứng đó 3–8 giây nhìn quanh, rồi đi tiếp. |
| `Engage` | Thấy địch → **đứng lại** (thỉnh thoảng ngồi xuống, xác suất `crouchChance`), ngắm và bắn theo B.4. Thỉnh thoảng (mỗi 3–5s) bước ngang 1–2 bước rồi đứng lại. |
| `Search` | Mất dấu → đi chậm tới vị trí nhớ cuối cùng, nhìn quanh, hết `memoryMs` thì về `Patrol`. |
| `Reload` | Hết đạn → đứng nạp tại chỗ (không tìm chỗ núp). |

- Không đánh vòng, không chủ động áp sát, không ném lựu đạn.

Nghiệm thu:
- [ ] Bot trung bình thường đứng một chỗ khá lâu, bắn từ xa, dễ bị đánh vòng sau lưng.
- [ ] Người chơi trung bình thắng bot trung bình 1v1 phần lớn số lần.

---

## Task B.6 – Hành vi bot Khó ⚠️

Thêm các trạng thái và kỹ năng:

| Trạng thái | Làm gì |
|---|---|
| `Hunt` | Không thấy ai: di chuyển tới vị trí địch nhớ/nghe được, hoặc tới khu giữa, **nhảy cóc từ chỗ núp này sang chỗ núp khác** (chọn đường có nhiều node cover), chạy tốc độ đầy. |
| `Engage` | Thấy địch: **di chuyển ngang qua lại** (A–D) với tốc độ ≤ `accurateSpeed` để vẫn bắn chuẩn (biết luật spread), đổi hướng ngẫu nhiên mỗi 0,3–0,8s. Thỉnh thoảng ngồi xuống giữa loạt bắn. |
| `TakeCover` | Khi: máu < 50, đang nạp đạn, hoặc thua đấu súng (bị trúng ≥ 2 phát trong 1s mà chưa trúng lại) → tìm node cover gần nhất (≤ 12m) **mà địch không nhìn thấy** (raycast từ vị trí địch nhớ tới node), chạy tới, nạp đạn ở đó. |
| `Peek` | Đang núp, nạp xong → ló ra ngang 1–1,5m (hoặc đứng dậy nếu núp sau tường thấp), bắn một loạt, lùi lại; lặp tối đa 3 lần, sau đó đổi chỗ núp. |
| `Flank` | Địch đứng yên một chỗ > 4s (ví dụ cắm trên tháp/gờ tường) → tìm đường tới gần địch với **chi phí cao cho các node địch nhìn thấy được** (dùng `costFn` của A*), đi vòng qua lối mép map. |
| `Push` | Áp sát khi có cơ hội: địch đang nạp đạn (nghe tiếng nạp trong 20m), địch máu thấp (đã bắn trúng ≥ 60 damage), hoặc mình có shotgun/SMG → chạy thẳng tới, có thể trượt (crouch khi đang chạy) vào tầm gần. |

- Chọn hành vi bằng điểm ưu tiên (utility), không phải cây if/else dài: mỗi hành vi có hàm chấm điểm 0..1 theo tình huống, chọn cao nhất, có độ "dính" (đang làm hành vi nào thì cộng 0,15 điểm cho hành vi đó) để bot không đổi ý liên tục.
- (Tuỳ chọn) có lựu đạn: địch núp sau cover và bot đã thấy địch trong 3s gần nhất → ném lựu đạn vào sau cover (dùng `throwInitial` + mô phỏng `stepGrenade` để chọn góc ném rơi gần địch nhất, thử 5 góc pitch). Tối đa 1 quả mỗi 20s.
- Bot khó **vẫn** dùng B.4 với tham số khó: phản xạ nhanh hơn, ngắm nhanh hơn, nhưng vẫn có sai số, vẫn bị giật, vẫn trượt.

Nghiệm thu:
- [ ] Bắn bot khó tới dưới nửa máu: nó chạy vào chỗ núp, nạp đạn, ló ra bắn lại.
- [ ] Ngồi cắm trên tháp: bot khó đánh vòng qua mép map tới gần thay vì đứng giữa bắn lên.
- [ ] Nạp đạn khi bot khó ở gần: nó lao vào.
- [ ] Người chơi khá thắng được bot khó 1v1 nhưng phải chơi nghiêm túc; 1 vs 3 bot khó thì rất khó.
- [ ] Bot khó không "dính tâm" vào đầu: xem F11 thấy tâm của nó vẫn lệch, rung, vượt quá.

---

## Task B.7 – Giao diện offline

**Góc trên bên trái** (chỉ ở chế độ offline), bảng nhỏ nền tối mờ:

```
[ + Bot trung bình ]  [ + Bot khó ]
[ Đổi phe: Cớm ⇄ Cướp ]   [ Xoá hết bot ]
Bot: Tèo (TB) ✕ · Mít (KHÓ) ✕ · ...
Tiền vô hạn ☑
```

- Bot mới vào **phe địch** của người chơi. Giữ **Shift** khi bấm nút → thêm bot **phe mình** (đồng đội).
- **Đổi phe**: người chơi sang phe kia, hồi sinh ở căn cứ mới; **mọi bot phe địch cũ chuyển sang phe địch mới** (vẫn là địch của mình), bot đồng đội cũng đổi theo (vẫn là đồng đội). Đổi phe thì loadout về mặc định của phe mới.
- ✕ cạnh tên: xoá bot đó.
- Phím tắt (khi đang khoá chuột vẫn dùng được): `[` thêm bot trung bình, `]` thêm bot khó, `\` xoá hết bot, `` ` `` + `T` đổi phe. Hiện chữ nhỏ dưới nút.
- Nút bấm được khi chuột tự do (Esc để nhả chuột), như giỏ hàng.
- **Tiền vô hạn** (mặc định bật): HUD tiền hiện `$ ∞`, mua không trừ tiền (cho cả bot). Tắt thì về kinh tế bình thường với $16000 mỗi lần hồi sinh. Khu mua và luật mỗi dòng 1 súng **giữ nguyên** (mua bình thường như yêu cầu).
- Chế độ chơi offline: **Hỗn Chiến không giới hạn** (không giới hạn mạng, không giới hạn thời gian), bảng điểm vẫn chạy. (Sau này có thể cho chọn Sinh Tử với bot, vì bot là người chơi bình thường nên luật Sinh Tử chạy được luôn.)

Nghiệm thu:
- [ ] Bấm "+ Bot khó" 3 lần: 3 bot phe địch xuất hiện, tên khác nhau, nhãn KHÓ.
- [ ] Đổi phe: mình sang căn cứ kia, bot vẫn là địch, bắn được bot, bot bắn mình.
- [ ] Shift + "+ Bot trung bình": có đồng đội bot, đạn mình không làm nó mất máu.
- [ ] Tiền vô hạn: mua Sniper liên tục không trừ tiền; tắt đi thì trừ tiền như thường.

---

## Task B.8 – File tham số + debug

`server/src/bots/bots.json` (hot-reload ở dev):

```json
{
  "medium": {
    "reactionMs": [700, 1100],
    "fovDeg": 90,
    "hearingRadius": 25,
    "memoryMs": 2500,
    "aimSpeedDegPerSec": 180,
    "aimErrorDeg": [3.0, 6.0],
    "aimErrorDecayPerSec": 2.5,
    "aimJitterDeg": 0.6,
    "trackingLagMs": 180,
    "headChance": 0.1,
    "fireThresholdDeg": 1.6,
    "burst": [3, 5],
    "burstPauseMs": [350, 600],
    "recoilCompensation": 0.3,
    "moveSpeedMul": 0.5,
    "crouchChance": 0.25,
    "skills": { "strafe": false, "cover": false, "peek": false, "flank": false, "push": false, "grenade": false },
    "buy": { "long": ["ak47", "m16"], "pistol": ["colt", "rulo"], "mid": [], "grenades": 0 }
  },
  "hard": {
    "reactionMs": [300, 500],
    "fovDeg": 110,
    "hearingRadius": 40,
    "memoryMs": 6000,
    "aimSpeedDegPerSec": 360,
    "aimErrorDeg": [1.5, 3.5],
    "aimErrorDecayPerSec": 4.0,
    "aimJitterDeg": 0.35,
    "trackingLagMs": 90,
    "headChance": 0.3,
    "fireThresholdDeg": 1.0,
    "burst": [4, 7],
    "burstPauseMs": [150, 320],
    "recoilCompensation": 0.6,
    "moveSpeedMul": 1.0,
    "crouchChance": 0.3,
    "skills": { "strafe": true, "cover": true, "peek": true, "flank": true, "push": true, "grenade": true },
    "buy": { "long": ["ak47", "m16", "sniper"], "pistol": ["rulo"], "mid": ["smg", "shotgun"], "grenades": 1 }
  }
}
```

- `buy.long/mid/pistol`: danh sách để bot chọn ngẫu nhiên khi mua; danh sách rỗng = giữ súng mặc định. Bot khó chọn `mid` hoặc `long` ngẫu nhiên (đi kèm hành vi `Push` khi cầm `mid`).
- Mọi khoảng `[min, max]` lấy ngẫu nhiên đều mỗi lần dùng.

Debug **F11** (thêm vào phần vẽ nav của B.1), hiện trên đầu mỗi bot:
- Tên + độ khó + trạng thái hiện tại (`Engage`, `TakeCover`...).
- Đường thẳng từ mắt bot tới **điểm nó đang nhắm** (xanh) và tới **điểm nó định nhắm** (đỏ) — thấy rõ độ lệch.
- Đường đi đang theo.

Nghiệm thu:
- [ ] Sửa `bots.json` lúc đang chơi: bot đổi cách chơi ngay (dev).
- [ ] `npm run bot-bench` in bảng tỉ lệ trúng / thời gian phản xạ cho cả 2 độ khó, đối chiếu với khoảng ở B.4.

---

## Ghi chú cho người dùng

- Muốn bot khó "hiền" hơn: tăng `reactionMs`, `aimErrorDeg`, giảm `recoilCompensation`. Muốn bot trung bình "ngu" hơn: giảm `fovDeg` (dễ bị đánh lén), tăng `trackingLagMs` (chạy ngang là nó bắn trượt sau lưng).
- Tỉ lệ trúng của người chơi FPS bình thường khoảng 20–30%, giỏi khoảng 35–45%. Khoảng mục tiêu ở B.4 bám theo đó, nên bot khó ngang người chơi khá, không phải hack.
- Bot chạy được ở cả online: sau này có thể cho chủ phòng thêm bot vào phòng online cho đủ người (chỉ cần thêm nút, logic đã có).
