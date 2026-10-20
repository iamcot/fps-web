# 13 – Hai thể thức chơi + tạo phòng

| Tên hiển thị | Mã trong code | Luật tóm tắt |
|---|---|---|
| **Sinh Tử** | `elimination` | Chơi theo ván, mỗi ván một mạng. Đội bị tiêu diệt hết thì thua ván. Đội nào thắng 10 ván trước thắng chung cuộc. |
| **Hỗn Chiến** | `tdm` | Hồi sinh liên tục, bắn tới giới hạn mạng hoặc hết giờ (chính là chế độ hiện tại của task 06). |

Thứ tự: M.1 → M.2 → M.3 → M.4 → M.5 → M.6 → M.7 → M.8. Task ⚠️ nên dùng model mạnh.

Nguyên tắc: **Hỗn Chiến phải chạy y hệt như hiện tại** sau khi tách code. Mọi chỗ khác nhau giữa 2 thể thức nằm trong class thể thức + config, không rải `if (mode === ...)` khắp nơi.

---

## Cài đặt phòng (`shared/src/roomConfig.ts`)

```ts
export type GameMode = 'elimination' | 'tdm';

export const MODE_LABEL: Record<GameMode, string> = {
  elimination: 'Sinh Tử',
  tdm: 'Hỗn Chiến',
};

export interface EliminationSettings {
  mode: 'elimination';
  roundsToWin: number;     // mặc định 10 → tối đa 19 ván
  roundTimeSec: number;    // 105 (1:45)
  freezeSec: number;       // 5 – đứng yên đầu ván
  buyTimeSec: number;      // 20 – tính từ lúc bắt đầu freeze
  roundEndSec: number;     // 5 – hiện kết quả ván
  halftimeSec: number;     // 10 – nghỉ giữa hiệp, đổi bên
}

export interface TdmSettings {
  mode: 'tdm';
  killLimit: number;       // 50
  timeLimitMin: number;    // 10
}

export interface RoomConfig {
  name: string;            // tên phòng, 1–32 ký tự
  map: string;             // 'hai-thanh'
  maxPlayers: number;      // 2–10, chẵn
  settings: EliminationSettings | TdmSettings;
}

export const DEFAULT_SETTINGS = {
  elimination: { mode: 'elimination', roundsToWin: 10, roundTimeSec: 105, freezeSec: 5, buyTimeSec: 20, roundEndSec: 5, halftimeSec: 10 },
  tdm: { mode: 'tdm', killLimit: 50, timeLimitMin: 10 },
} as const;

export const SETTINGS_LIMITS = {
  roundsToWin: [3, 16], roundTimeSec: [60, 300], killLimit: [10, 200], timeLimitMin: [3, 30],
};
```

Server **luôn** kẹp giá trị theo `SETTINGS_LIMITS`, không tin client.

## Kinh tế theo thể thức (`shared/src/economy.ts`)

Tách `ECONOMY` của task 09 thành 2 bộ, các hàm `quoteBuy`, `applyBuy`… nhận thêm tham số config:

```ts
export const ECONOMY_TDM = { ...ECONOMY };  // giữ nguyên như task 09

export const ECONOMY_ELIM = {
  startMoney: 800,
  maxMoney: 16000,
  killReward: 300,
  bountyStreak: 3,
  bountyReward: 600,
  sellRatio: 0.8,
  defaultResaleValue: 0,
  keepLoadoutIfSurvived: true,   // sống sót qua ván: giữ súng, lựu đạn
  roundWin: 3000,
  roundLossBase: 1500,
  roundLossStep: 400,            // thua liên tiếp: 1500, 1900, 2300, 2700, 3000
  roundLossMax: 3000,
  roundDraw: 1500,               // ván hoà: mỗi người +1500, chuỗi thua giữ nguyên
  resetAtHalftime: true,         // đổi bên: tiền về startMoney, súng về mặc định
};
```

- Chuỗi hạ (`killStreak`) ở Sinh Tử: **giữ qua các ván** nếu sống sót, về 0 khi chết (luật truy nã giữ nguyên ý nghĩa).
- `startMoney` của Sinh Tử là $800 (ván đầu chỉ đủ nâng cấp nhẹ, đúng kiểu ván "súng lục"), có thể đổi.

---

## Task M.1 – Tách code thể thức (server) ⚠️

Tạo `server/src/modes/`:

```ts
export interface MatchMode {
  readonly mode: GameMode;
  start(room: Room): void;
  tick(room: Room, nowMs: number): void;
  onPlayerJoin(room: Room, p: Player): void;     // gán đội, quyết định spawn ngay hay xem
  onPlayerLeave(room: Room, p: Player): void;
  onKill(room: Room, killer: Player | null, victim: Player, weapon: string): void;
  canRespawn(room: Room, p: Player): boolean;
  canBuy(room: Room, p: Player, nowMs: number): boolean; // ngoài inBuyZone
  canMove(room: Room, p: Player): boolean;        // false trong freeze
  canDealDamage(room: Room): boolean;
  economy(): typeof ECONOMY_TDM;
  stateMessage(room: Room): MatchStateMsg;
}
```

- `TdmMode`: chuyển **nguyên** logic hiện có trong `match.ts` (task 06) vào đây, đọc `killLimit`, `timeLimitMin` từ settings.
- `EliminationMode`: task M.3.
- `Room` giữ `config: RoomConfig` và `mode: MatchMode`, mọi chỗ cũ gọi `match.*` chuyển sang gọi qua `room.mode`.

Nghiệm thu:
- [ ] Tạo phòng Hỗn Chiến: chơi một trận 2 tab, mọi luật như trước (hồi sinh, tiền, truy nã, đổi bên, bảng điểm).
- [ ] Các test cũ pass, không sửa logic test (chỉ sửa import nếu cần).
- [ ] `grep` không còn `mode === 'tdm'` / `mode === 'elimination'` nằm ngoài thư mục `modes/` và UI.

---

## Task M.2 – Tạo phòng, danh sách phòng

### Message

```ts
// C2S
  | { t: 6; config: RoomConfig }                         // CreateRoom
  | { t: 7 }                                             // ListRooms
  | { t: 1; name: string; room: string }                 // Join (giữ như cũ, room = mã phòng)

// S2C
  | { t: 119; code: string }                             // RoomCreated
  | { t: 120; rooms: RoomSummary[] }                     // RoomList
interface RoomSummary {
  code: string; name: string; map: string; mode: GameMode;
  players: number; maxPlayers: number;
  status: string;            // "Đang chờ" | "Ván 5/19 · 3–2" | "Còn 06:12 · 23–18"
}
```

- Mã phòng: 5 ký tự in hoa dễ đọc (bỏ `0`, `O`, `1`, `I`). Phòng trống > 60s thì xoá (như cũ).
- URL `?room=ABCDE` vào thẳng phòng (để gửi link cho bạn bè qua ngrok).

### Màn hình (client)

- **Sảnh**: nhập tên người chơi (nhớ localStorage), danh sách phòng (tên, thể thức, map, số người, trạng thái), tự làm mới mỗi 3s, nút **Vào**, nút **Tạo phòng**, ô nhập mã phòng.
- **Tạo phòng**:
  - Tên phòng, map (dropdown, hiện chỉ "Hai thành"), số người tối đa (2–10).
  - Chọn thể thức bằng 2 thẻ lớn: **Sinh Tử** (mô tả 1 dòng: "Mỗi ván một mạng. Thắng 10 ván trước.") và **Hỗn Chiến** ("Hồi sinh liên tục. Bắn tới 50 mạng hoặc hết giờ.").
  - Phần cài đặt đổi theo thể thức: Sinh Tử (số ván thắng, thời gian mỗi ván); Hỗn Chiến (giới hạn mạng, thời gian trận). Có nút "Mặc định".
  - Tạo xong vào phòng luôn, hiện mã phòng + nút copy link.
- Trong game: góc trên bên trái nhỏ `Sinh Tử · Hai thành · ABCDE`.

Nghiệm thu:
- [ ] Tab A tạo phòng Sinh Tử, tab B thấy phòng trong danh sách, vào được.
- [ ] Mở link `?room=ABCDE` ở tab C: vào thẳng phòng đó.
- [ ] Sửa tạm client gửi `roundsToWin: 999`: server kẹp về 16.

---

## Task M.3 – Thể thức Sinh Tử (server) ⚠️

### Các pha

```
WARMUP ──(mỗi đội ≥ 1 người)──► FREEZE ──(freezeSec)──► LIVE
   ▲                               ▲                      │
   │                               │      (một đội chết hết / hết roundTimeSec)
   │                               │                      ▼
   │                               └──(roundEndSec)── ROUND_END
   │                                                      │
   │                 (vừa xong ván roundsToWin − 1) ──► HALFTIME ──(halftimeSec)──► FREEZE
   │                                                      │
   └──(một đội không còn ai kết nối)        (đội đạt roundsToWin / hết maxRounds)
                                                          ▼
                                                     MATCH_END ──(15s)──► WARMUP (trận mới)
```

- `maxRounds = 2 × roundsToWin − 1`.
- **WARMUP**: chơi tự do, hồi sinh ngay, không tính điểm, mua thoải mái (giống Hỗn Chiến), tiền không đổi.
- **FREEZE** (đầu mỗi ván):
  1. Xoá mọi lựu đạn đang bay, xoá vết cháy/xác (gửi `RoundReset`).
  2. Mọi người đang kết nối (kể cả người xem chờ vào) hồi sinh tại căn cứ đội mình, **mỗi người một điểm spawn khác nhau** (không chọn trùng), máu 100, đạn đầy.
  3. Loadout: ai **còn sống cuối ván trước** giữ nguyên loadout (`keepLoadoutIfSurvived`), ai chết thì về mặc định của phe.
  4. Không di chuyển được (`canMove = false`), vẫn xoay chuột, mua được.
- **Thời gian mua**: `canBuy` đúng khi `now < freezeStart + buyTimeSec` (và vẫn phải trong khu mua). Hết giờ mua: giỏ hàng tắt, menu tự đóng.
- **LIVE**: `canRespawn = false`. Người chết chuyển sang xem (M.5).
- **Kết thúc ván** (kiểm tra mỗi tick trong LIVE):
  1. Một đội không còn ai sống → đội kia thắng, lý do `elimination`.
  2. Cả hai đội cùng chết hết trong cùng tick (lựu đạn) → **hoà**, lý do `draw`.
  3. Hết giờ → đội còn **nhiều người sống hơn** thắng (`time_alive`); bằng nhau → đội có **tổng máu** cao hơn thắng (`time_hp`); vẫn bằng → **hoà** (`draw`).
- **ROUND_END**: vẫn bắn nhau được (đúng kiểu CS) nhưng không đổi kết quả ván. Cộng tiền cuối ván (M.4). Người sống tới cuối pha ROUND_END mới tính là "sống sót" để giữ súng.
- **HALFTIME**: sau ván thứ `roundsToWin − 1` (mặc định ván 9). Hiện banner, đổi bên (`sideSwapped = !sideSwapped`), nếu `resetAtHalftime` thì tiền về `startMoney`, loadout về mặc định, chuỗi thua về 0.
- **MATCH_END**: đội đạt `roundsToWin` trước thắng. Hết `maxRounds` mà không ai đạt (do có ván hoà) → đội nhiều ván thắng hơn thắng, bằng nhau → hoà chung cuộc. Sau 15s: reset điểm, tiền, loadout, đội giữ nguyên, quay về FREEZE ván 1 (nếu đủ người) hoặc WARMUP.
- **Người vào giữa trận**: vào đội ít người hơn, **xem** cho tới FREEZE ván sau thì được chơi, tiền = `startMoney` (hoặc nếu đang ở hiệp 2: vẫn `startMoney`).
- **Người rời giữa ván**: tính như chết (kiểm tra điều kiện kết thúc ván ngay). Một đội không còn ai kết nối: ván hiện tại xử thua cho đội đó, sau đó về WARMUP, **giữ tỉ số**; đủ người lại thì chơi tiếp từ ván kế.
- Bỏ "bất tử sau spawn" trong Sinh Tử (ai cũng spawn cùng lúc ở căn cứ, không cần).

### Message

```ts
// S2C, MatchState (t: 111) mở rộng:
  { t: 111; mode: GameMode; phase: string; phaseEndsAt: number;
    round: number; maxRounds: number; scoreA: number; scoreB: number;   // Sinh Tử: số ván thắng; Hỗn Chiến: số mạng
    aliveA: number; aliveB: number;                                    // chỉ Sinh Tử
    buyEndsAt: number | null; sideSwapped: boolean }
  | { t: 121; round: number; winner: TeamId | null; reason: 'elimination' | 'time_alive' | 'time_hp' | 'draw' }   // RoundEnd
  | { t: 122; round: number }                                                                                     // RoundReset
  | { t: 123; winner: TeamId | null; scoreA: number; scoreB: number; mvpId: number | null }                       // MatchEnd
```

Nghiệm thu (dùng lệnh debug M.8 cho nhanh):
- [ ] 2 tab, 1v1: A hạ B → banner "CỚM THẮNG VÁN 1", 5s sau cả hai hồi sinh ở căn cứ, tỉ số 1–0.
- [ ] Trong LIVE bị chết: không hồi sinh, chuyển sang xem.
- [ ] Hết giờ ván, 2v2 còn 2 vs 1 → đội 2 người thắng. 1 vs 1, máu 80 vs 40 → đội máu 80 thắng.
- [ ] Freeze: không đi được, mua được; sau 20s từ đầu freeze không mua được nữa.
- [ ] Sống sót qua ván với Sniper → ván sau vẫn cầm Sniper. Chết → ván sau về M16/AK47 mặc định.
- [ ] Sau ván 9: banner đổi bên, căn cứ đổi, tiền về $800.
- [ ] Đội đạt 10 ván: màn hình kết thúc, 15s sau trận mới từ 0–0.
- [ ] Người vào giữa ván: xem, ván sau được chơi.
- [ ] Lựu đạn ném lúc cuối ván không nổ sang ván sau.

---

## Task M.4 – Tiền cuối ván (Sinh Tử)

Khi vào ROUND_END:
- Đội thắng: mỗi người `+roundWin`, chuỗi thua của đội về 0.
- Đội thua: `lossStreak++`, mỗi người `+min(roundLossBase + (lossStreak − 1) × roundLossStep, roundLossMax)`.
- Ván hoà: mỗi người `+roundDraw`, chuỗi thua giữ nguyên.
- Áp dụng cho **mọi người trong đội**, kể cả người đã chết; người đang xem chờ vào thì không.
- Gửi `MoneyEvent` với `reason: 'round_win' | 'round_loss' | 'round_draw'`.
- Hạ mạng trong Sinh Tử dùng `ECONOMY_ELIM.killReward` / `bountyReward`.

Nghiệm thu (vitest cho hàm tính tiền, `shared`):
- [ ] Thua 1, 2, 3, 4, 5, 6 ván liên tiếp: 1500, 1900, 2300, 2700, 3000, 3000.
- [ ] Thua 2 ván, thắng 1, thua 1: lần thua cuối nhận 1500.
- [ ] Hoà giữa chuỗi thua 2: nhận 1500, ván thua tiếp theo nhận 2300.
- [ ] Tiền không vượt 16000.

---

## Task M.5 – Chế độ xem khi chết (Sinh Tử)

- Chết trong LIVE → sau 2 giây (xem cảnh mình ngã), camera chuyển sang **theo sau lưng đồng đội còn sống** (góc 3, cao ngang vai, lệch phải, có chống xuyên tường như task camera F10).
- **Click chuột trái / phím Space**: đổi sang đồng đội kế tiếp. Đồng đội đang xem bị hạ → tự chuyển người khác sau 1,5s.
- Góc nhìn camera đi theo **yaw/pitch nội suy** của người được xem (thấy họ đang ngắm đâu).
- HUD khi xem: dòng dưới giữa `Đang xem: [tên]` + máu của người đó; ẩn ô vũ khí, tiền, giỏ hàng của mình.
- Người vào giữa ván (chưa có đội sống để xem, hoặc trước ván đầu): camera bay cố định trên cao nhìn xuống toàn map, chậm rãi quay vòng.
- **Không** được xem kẻ địch (tránh lộ vị trí khi ngồi chung phòng).

Nghiệm thu:
- [ ] 3 tab 2v1: người chết đầu tiên xem được đồng đội, Space đổi người được.
- [ ] Không thể chuyển sang xem đội địch bằng bất kỳ phím nào.

---

## Task M.6 – HUD Sinh Tử

- **Trên giữa**:
  ```
          [●●○○○]  Cớm 3  ·  1:24  ·  2 Cướp  [●●●○○]
                         Ván 6 / 19
  ```
  - Chấm tròn: mỗi chấm một người của đội, sáng = còn sống, mờ = đã chết (màu đội).
  - Đồng hồ: thời gian còn lại của pha hiện tại; trong FREEZE hiện `0:05` màu vàng; dưới 10 giây của LIVE chuyển đỏ.
- **Thời gian mua**: cạnh giỏ hàng hiện `Mua: 0:14` khi còn giờ mua; hết thì ẩn.
- **Banner kết thúc ván** (giữa màn hình, 3s): `CỚM THẮNG VÁN 5` / `CƯỚP THẮNG VÁN 5` / `VÁN HOÀ`, dòng nhỏ dưới là lý do: `Tiêu diệt toàn bộ` / `Hết giờ · còn nhiều người hơn` / `Hết giờ · còn nhiều máu hơn`. Kèm số tiền cuối ván mình nhận: `+$3000`.
- **Banner đổi bên**: `HẾT HIỆP 1 · ĐỔI BÊN`, hiện cả tỉ số.
- **Màn hình kết thúc trận**: đội thắng, tỉ số, MVP (nhiều mạng nhất, bằng thì ít chết hơn), bảng điểm tự mở, đếm ngược tới trận mới.
- **Âm thanh**: bắt đầu ván (tiếng còi ngắn tổng hợp), thắng ván (2 nốt đi lên), thua ván (2 nốt đi xuống), 10 giây cuối mỗi giây một tiếng "tích" nhỏ.
- Hỗn Chiến giữ HUD cũ (task 5.3); chỉ dùng chung khung trên giữa nhưng hiện số mạng và thời gian trận, không có chấm sống/chết, không có số ván.

Nghiệm thu:
- [ ] Đọc được tỉ số, ván, thời gian, số người còn sống của mỗi đội trong 1 cái liếc.
- [ ] Banner kết thúc ván ghi đúng lý do trong cả 3 trường hợp.

---

## Task M.7 – Hỗn Chiến: cài đặt + hoà

- Đọc `killLimit`, `timeLimitMin` từ cài đặt phòng thay cho hằng số `MATCH` của task 06.
- Hết giờ mà điểm bằng nhau → **hoà**, màn hình kết thúc ghi `HOÀ`.
- HUD trên giữa (khung chung với Sinh Tử): `Cớm 23 · 06:12 · 18 Cướp`, dòng dưới nhỏ `Mục tiêu: 50 mạng`.

Nghiệm thu:
- [ ] Tạo phòng Hỗn Chiến 10 mạng, 3 phút: kết thúc đúng khi đạt 10 mạng hoặc hết 3 phút.

---

## Task M.8 – Lệnh debug (chỉ bật khi chạy dev)

Gõ vào ô chat/console trong game (phím `~` mở ô lệnh), server chỉ nhận khi `NODE_ENV !== 'production'`:

| Lệnh | Tác dụng |
|---|---|
| `/endround A` hoặc `/endround B` / `/endround draw` | kết thúc ván ngay với kết quả đó |
| `/setround 9` | nhảy tới ván 9 (để test đổi bên) |
| `/time 10` | đặt thời gian còn lại của pha hiện tại thành 10 giây |
| `/money 16000` | đặt tiền của mình |
| `/hp 30` | đặt máu của mình |
| `/kill` | tự sát (test chế độ xem) |

Nghiệm thu:
- [ ] Mọi lệnh hoạt động ở dev; build production gửi lệnh thì server bỏ qua.

---

## Ghi chú cho người dùng

- Số liệu kinh tế Sinh Tử ($800 khởi điểm, thắng $3000, thua $1500 tăng dần, hạ mạng $300) lấy theo tinh thần CS, chỉnh trong `ECONOMY_ELIM`.
- 1v1 Sinh Tử chơi rất căng, test với 2 tab là đủ thấy. Nhóm 3v3 trở lên mới thấy rõ cái hay của chế độ xem đồng đội.
- Chưa có **bom / gỡ bom** như CS gốc. Muốn thêm thì đó là một thể thức thứ 3, làm sau khi 2 thể thức này ổn.
