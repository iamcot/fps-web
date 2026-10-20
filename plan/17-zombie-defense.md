# 17 – Thể thức **Thủ Thành**: cùng phe giữ thành chống zombie theo đợt

| Tên hiển thị | Mã |
|---|---|
| **Thủ Thành** | `defense` |

Tóm tắt: mọi người chơi cùng một phe, giữ **căn cứ A** của map "Hai thành". Zombie (bot) kéo tới theo **10 đợt**, đợt sau đông và mạnh hơn, có nhiều loại zombie khác nhau, đợt 10 là **boss**. Giữa các đợt được mua đồ và hồi sinh đồng đội. Trụ hết 10 đợt là thắng; cả đội chết cùng lúc là thua.

Yêu cầu trước:
- File 16, **phần ZF** (nền zombie) đã xong. Phần I (Lây Nhiễm) không bắt buộc.
- File 15: **B.0, B.1, B.2** (offline chạy Room, nav grid, hạ tầng bot).
- File 13: `MatchMode`, tạo phòng.

Thứ tự: T.1 → T.2 → T.3 → T.4 → T.5 → T.6 → T.7 → T.8 → T.9. Task ⚠️ nên dùng model mạnh.

---

## Cài đặt phòng

```ts
export interface DefenseSettings {
  mode: 'defense';
  difficulty: 'easy' | 'normal' | 'hard';   // 'normal'
  waves: number;                              // 10
  intermissionSec: number;                    // 25
  lighting: 'day' | 'night';                  // 'night'
}
```
`MODE_LABEL.defense = 'Thủ Thành'`. Chơi được 1–6 người (offline 1 người là chính).

---

## Task T.1 – Lớp thể thức `DefenseMode` (server) ⚠️

Các pha:

```
WARMUP ──(chủ phòng bấm Bắt đầu / offline tự bắt đầu)──► PREP (30s) ──► WAVE 1 ──► INTERMISSION ──► WAVE 2 ... ──► WAVE 10 (boss) ──► VICTORY
                                                                   │                                                     
                                                         (mọi người chơi đều chết cùng lúc) ──► DEFEAT
VICTORY / DEFEAT ──(20s)──► WARMUP
```

- Mọi người chơi ở đội A (Cớm hoặc Cướp tuỳ người chọn, chỉ là skin), spawn trong **căn cứ A**. Zombie là thực thể riêng (không phải người chơi), xem T.4.
- **PREP / INTERMISSION**: mua đồ trong khu mua căn cứ A, đồng đội chết được **hồi sinh** ở căn cứ với súng đã có, máu đầy. Đếm ngược hiện to.
- **WAVE n**: sinh zombie theo `waves.json` (T.3). Hết đợt khi đã sinh đủ và **toàn bộ zombie của đợt đã chết**. Thưởng hết đợt.
- **Người chết trong đợt**: không hồi sinh tới INTERMISSION; chuyển sang xem đồng đội (dùng lại M.5). Có thể được **cứu** (T.6).
- **DEFEAT**: tất cả người chơi đều đang chết (hoặc đang gục chờ cứu) cùng lúc.
- **VICTORY**: hạ boss đợt 10 và mọi zombie còn lại.
- **Kinh tế** (`ECONOMY_DEFENSE`):
  ```ts
  { startMoney: 1500, maxMoney: 16000, waveClearBonus: 800, waveClearPerWave: 100, // đợt n thưởng 800 + 100×n
    keepLoadoutOnDeath: true, infiniteReserve: true, sellRatio: 0.8 }
  ```
  Tiền hạ zombie theo từng loại (T.2). Không có truy nã.
- Không friendly fire. Lựu đạn của mình nổ vào mình vẫn mất 50% (luật G.3).

Message thêm:

```ts
  | { t: 140; phase: string; wave: number; waves: number; phaseEndsAt: number; zombiesLeft: number }  // DefenseState
  | { t: 141; wave: number; title: string; hint: string }                                          // WaveStart ("ĐỢT 4", "Cẩn thận zombie nhảy!")
  | { t: 142; wave: number; bonus: number }                                                        // WaveClear
  | { t: 143; result: 'victory' | 'defeat'; wave: number; stats: { id: number; kills: number; damage: number; revives: number }[] } // DefenseEnd
```

Nghiệm thu:
- [ ] Offline 1 người: PREP 30s → đợt 1 → hết zombie → INTERMISSION → đợt 2...
- [ ] Chết giữa đợt: xem đồng đội (nếu có), hồi sinh ở INTERMISSION; chơi một mình chết là DEFEAT.
- [ ] Lệnh debug: `/wave 9` nhảy tới đợt 9, `/clearwave` giết hết zombie đợt hiện tại.

---

## Task T.2 – Các loại zombie (`shared/src/zombieTypes.json`)

```json
{
  "walker":   { "name": "Zombie thường", "hp": 150, "runSpeed": 4.5, "clawDamage": 15, "attackMs": 900,  "knockbackResist": 0.0, "reward": 50,
                "scale": 1.0,  "tintOverride": null,      "abilities": [] },
  "runner":   { "name": "Zombie chạy",   "hp": 90,  "runSpeed": 9.0, "clawDamage": 10, "attackMs": 600,  "knockbackResist": 0.0, "reward": 75,
                "scale": 0.92, "tintOverride": "#c9b28a", "abilities": [] },
  "crawler":  { "name": "Zombie bò",     "hp": 110, "runSpeed": 5.0, "clawDamage": 12, "attackMs": 800,  "knockbackResist": 0.0, "reward": 75,
                "scale": 0.95, "tintOverride": "#8f9f8a", "abilities": ["crawl_holes"] },
  "leaper":   { "name": "Zombie nhảy",   "hp": 160, "runSpeed": 7.0, "clawDamage": 18, "attackMs": 850,  "knockbackResist": 0.1, "reward": 100,
                "scale": 1.0,  "tintOverride": "#9a8fb0", "abilities": ["leap"] },
  "brute":    { "name": "Zombie trâu",   "hp": 900, "runSpeed": 3.8, "clawDamage": 40, "attackMs": 1400, "knockbackResist": 0.8, "reward": 300,
                "scale": 1.35, "tintOverride": "#a87a6a", "abilities": ["shove"] },
  "screamer": { "name": "Zombie gào",    "hp": 250, "runSpeed": 5.0, "clawDamage": 10, "attackMs": 1000, "knockbackResist": 0.2, "reward": 200,
                "scale": 1.05, "tintOverride": "#b0a060", "abilities": ["rally"] },
  "boss":     { "name": "Đại Ca Zombie", "hp": 12000, "runSpeed": 4.2, "clawDamage": 60, "attackMs": 1600, "knockbackResist": 0.95, "reward": 3000,
                "scale": 2.2,  "tintOverride": "#7a5050", "abilities": ["slam", "summon", "charge"], "headMult": 3 }
}
```

- `hp` là máu ở độ khó `normal`, 1 người chơi. Nhân hệ số ở T.3.
- `crawl_holes`: được đi đường qua lỗ bắn (cạnh nav đặc biệt, T.4). Mọi zombie khác **không** dùng đường qua lỗ.
- `leap`: dùng chiêu nhảy cao E của ZF.2 để lên gờ tường (cạnh nav nhảy lên, T.4).
- `shove`: cào trúng đẩy người lùi 4 m/s (đẩy người khỏi gờ tường xuống đất!).
- `rally`: mỗi 10s gào lên, zombie khác trong 12m tăng 25% tốc độ trong 5s (có hiệu ứng mắt sáng hơn). Ưu tiên hạ trước.
- Boss: T.5.
- Mỗi loại chọn model ngẫu nhiên từ `zombieModels.json` (ZF.1) trừ khi có `modelOverride`; `tintOverride` thay tint ngẫu nhiên để **nhìn màu là biết loại**. Nhóm người dùng có thêm model nào thì có thể gán riêng cho loại đó bằng `modelOverride: "z2"`.
- Zombie dùng **cùng hitbox** người (đầu ×2 mặc định, boss ×3), hitbox nhân theo `scale`.

---

## Task T.3 – Đợt zombie (`shared/src/waves.json`)

```json
{
  "spawnPoints": {
    "baseB": "toàn bộ node mặt đất trong căn cứ B",
    "laneLeft": "node mặt đất ở mép trái map, phía x > 0",
    "laneRight": "node mặt đất ở mép phải map, phía x > 0"
  },
  "scaling": {
    "countPerExtraPlayer": 0.6,
    "hpPerExtraPlayer": 0.35,
    "difficulty": { "easy": { "count": 0.7, "hp": 0.7, "damage": 0.7 },
                    "normal": { "count": 1.0, "hp": 1.0, "damage": 1.0 },
                    "hard": { "count": 1.3, "hp": 1.3, "damage": 1.25 } }
  },
  "maxAlive": 28,
  "waves": [
    { "title": "ĐỢT 1", "hint": "Làm quen nào",                 "groups": [ { "type": "walker", "count": 10, "from": ["baseB"], "everyMs": 1500 } ] },
    { "title": "ĐỢT 2", "hint": "Chúng chạy nhanh đấy",         "groups": [ { "type": "walker", "count": 10, "from": ["baseB"], "everyMs": 1200 },
                                                                            { "type": "runner", "count": 6,  "from": ["laneLeft","laneRight"], "everyMs": 2500, "delayMs": 8000 } ] },
    { "title": "ĐỢT 3", "hint": "Canh các lỗ bắn!",             "groups": [ { "type": "walker", "count": 12, "from": ["baseB"], "everyMs": 1000 },
                                                                            { "type": "crawler", "count": 8, "from": ["baseB"], "everyMs": 2000, "delayMs": 5000 } ] },
    { "title": "ĐỢT 4", "hint": "Cẩn thận zombie nhảy lên gờ",  "groups": [ { "type": "walker", "count": 12, "from": ["baseB","laneLeft"], "everyMs": 1000 },
                                                                            { "type": "leaper", "count": 6,  "from": ["baseB"], "everyMs": 3000, "delayMs": 6000 } ] },
    { "title": "ĐỢT 5", "hint": "Một con trâu đang tới",        "groups": [ { "type": "walker", "count": 14, "from": ["baseB"], "everyMs": 900 },
                                                                            { "type": "runner", "count": 8,  "from": ["laneLeft","laneRight"], "everyMs": 1800 },
                                                                            { "type": "brute",  "count": 1,  "from": ["baseB"], "delayMs": 15000 } ] },
    { "title": "ĐỢT 6", "hint": "Hạ con gào trước!",            "groups": [ { "type": "walker", "count": 14, "from": ["baseB","laneRight"], "everyMs": 800 },
                                                                            { "type": "screamer", "count": 2, "from": ["baseB"], "everyMs": 10000, "delayMs": 5000 },
                                                                            { "type": "crawler", "count": 8, "from": ["baseB"], "everyMs": 1500 } ] },
    { "title": "ĐỢT 7", "hint": "Chúng tới từ mọi phía",        "groups": [ { "type": "runner", "count": 14, "from": ["laneLeft","laneRight"], "everyMs": 1000 },
                                                                            { "type": "leaper", "count": 8,  "from": ["baseB"], "everyMs": 2000 },
                                                                            { "type": "brute",  "count": 2,  "from": ["baseB"], "everyMs": 12000, "delayMs": 10000 } ] },
    { "title": "ĐỢT 8", "hint": "Giữ vững!",                     "groups": [ { "type": "walker", "count": 20, "from": ["baseB","laneLeft","laneRight"], "everyMs": 600 },
                                                                            { "type": "crawler", "count": 10, "from": ["baseB"], "everyMs": 1200 },
                                                                            { "type": "screamer", "count": 2, "from": ["laneLeft","laneRight"], "everyMs": 8000 } ] },
    { "title": "ĐỢT 9", "hint": "Đợt cuối trước khi đại ca tới", "groups": [ { "type": "runner", "count": 16, "from": ["laneLeft","laneRight"], "everyMs": 700 },
                                                                            { "type": "leaper", "count": 10, "from": ["baseB"], "everyMs": 1500 },
                                                                            { "type": "brute",  "count": 3,  "from": ["baseB"], "everyMs": 9000 } ] },
    { "title": "ĐỢT 10", "hint": "ĐẠI CA ZOMBIE",               "groups": [ { "type": "boss",   "count": 1,  "from": ["baseB"] },
                                                                            { "type": "walker", "count": 16, "from": ["baseB","laneLeft","laneRight"], "everyMs": 2500, "delayMs": 10000 } ] }
  ]
}
```

- `spawnPoints`: các mô tả trên là **ý nghĩa**; code lấy node thật từ nav grid theo vùng (task B.1). Chọn ngẫu nhiên node **không nằm trong tầm nhìn** của người chơi nào (raycast), không thì dời sang node khác.
- Số lượng thực = `round(count × difficulty.count × (1 + countPerExtraPlayer × (số người − 1)))`. Máu thực tương tự.
- Đang có `maxAlive` zombie sống thì tạm dừng sinh, chờ bớt.
- Hot-reload file ở dev.

---

## Task T.4 – AI zombie (server) ⚠️

Zombie là **thực thể riêng** `ZombieEntity` (không phải `Player`), nhưng **dùng chung `stepMovement`** với movement zombie (ZF.2) để va chạm, đi ramp, nhảy giống hệt, và client vẽ bằng nội suy như người khác.

- Mỗi zombie có `PlayerState` + `ZombieBrain`. Mỗi tick server: brain sinh `InputCmd` → `stepMovement`. Brain **nghĩ 5 lần/giây**, rải đều.
- **Chọn mục tiêu**: người chơi còn sống gần nhất **theo đường đi** (A* độ dài, cache 1s), ưu tiên người đang nhìn thấy. Zombie luôn biết vị trí người (zombie "đánh hơi"), không cần nhìn thấy — đây là PvE, mục đích là lao vào.
- **Cạnh nav đặc biệt** (thêm vào nav grid B.1, gắn cờ loại):
  - `hole`: xuyên qua mỗi lỗ bắn (node trước lỗ → node sau lỗ, đi bằng ngồi + nhảy). Chỉ zombie có `crawl_holes`.
  - `leapUp`: node mặt đất sát chân tường thành → node mặt tường ngay trên (chênh ≤ 4,2m). Chỉ zombie có `leap`, khi chiêu đã hồi.
  - `leapTower`: node gờ tường → đỉnh tháp gần đó (chênh ≤ 2,2m). Chỉ `leap`.
  - A* nhận danh sách cạnh được phép theo loại zombie.
- **Đi**: theo đường, chọn phím W/A/S/D như bot (B.2), nhìn về hướng đi (zombie luôn nhìn trước mặt).
- **Tách đám**: zombie không va chạm nhau (như người) nên dễ chồng lên nhau. Cộng lực đẩy nhẹ tránh nhau (separation): mỗi zombie lệch hướng đi ra xa các zombie khác trong bán kính 0,8m, để đám đông trông dàn ra.
- **Tấn công**: mục tiêu trong 1,6m và nhìn thấy (raycast) → quay mặt, dừng, cào (`attackMs` nhịp, có 0,25s vung tay báo trước, người lùi kịp thì hụt). Damage nhân hệ số độ khó.
- **Kẹt**: không tiến được 2s → nhảy một cái + tìm đường lại; kẹt 6s → nếu không ai nhìn thấy thì dịch chuyển về node hợp lệ gần nhất (tránh zombie kẹt góc làm đợt không kết thúc).
- **Rơi khỏi map / lọt chỗ lạ**: dưới y = −5 → chết, không tính tiền.
- **Đồng bộ mạng**: zombie gửi trong snapshot như `NetPlayer` rút gọn: `{ id, type, pos, vel, yaw, flags (attack, leap, crawl, hit, dead), hpPct }`. 28 zombie × 20Hz với msgpack vẫn nhỏ. Client nội suy giống người khác (task 3.5).
- **Hiệu năng**: 28 zombie, mỗi zombie một capsule Rapier; A* cache đường theo node đích; tìm lại đường khi mục tiêu đi xa đường cũ > 3m.

Nghiệm thu:
- [ ] Walker đi theo ramp lên gờ tường để tới người đang đứng trên gờ.
- [ ] Crawler chui qua lỗ bắn vào căn cứ A; walker không chui.
- [ ] Leaper nhảy từ chân tường lên gờ; từ gờ nhảy lên tháp.
- [ ] 28 zombie không chồng thành một cục, không con nào kẹt mãi.
- [ ] Server giữ 60 tick/giây với 28 zombie + 4 người.

---

## Task T.5 – Boss "Đại Ca Zombie"

- Model: zombie bất kỳ, `scale 2.2`, tint đỏ thẫm, mắt to sáng hơn. Thanh máu boss to ở trên cùng màn hình (`ĐẠI CA ZOMBIE` + máu %).
- Không chui lỗ, không nhảy lên gờ, đi đường ramp. **Đứng trên gờ hoặc tháp không an toàn** vì có chiêu:
- **Đập đất (`slam`)**: khi có người trong 7m, giơ hai tay 1,0s (vẽ **vòng tròn đỏ** trên mặt đất báo trước bán kính 6m) → đập: người trong vòng mất 35 máu và bị hất văng 9 m/s ra xa + 5 m/s lên trên. Hồi chiêu 8s.
- **Gọi đàn (`summon`)**: mỗi khi máu boss xuống qua mốc 75%, 50%, 25%: gào lên, sinh 6 runner quanh boss (bỏ qua `maxAlive`).
- **Lao tới (`charge`)**: mục tiêu ở 10–25m, cùng mặt phẳng: cúi đầu 0,8s báo trước (tiếng gầm) → lao thẳng 14 m/s trong 1,2s hoặc tới khi đâm tường; trúng người: 50 máu + hất văng. Đâm tường: choáng 2s, nhận ×1,5 damage (cơ hội xả đạn). Hồi chiêu 12s.
- Điểm yếu: đầu ×3.
- Chết: animation chết chậm, rơi tiền tượng trưng (hiệu ứng), banner `ĐÃ HẠ ĐẠI CA!`.

Nghiệm thu:
- [ ] Mọi chiêu đều có báo trước đủ để người chơi tỉnh táo né được.
- [ ] Boss đâm tường bị choáng, xả đạn vào đầu thấy máu tụt nhanh.

---

## Task T.6 – Gục và cứu đồng đội

- Trong đợt, người chơi máu về 0 → **gục** (không chết hẳn): nằm xuống, bò chậm 1 m/s, bắn được bằng súng ngắn (nếu có), 30 giây sau mới chết hẳn. Zombie vẫn tấn công người gục.
- Đồng đội đứng cạnh (≤ 1,5m) **giữ phím E 3 giây** → cứu dậy với 40 máu. Bị đánh trúng trong lúc cứu thì phải giữ lại từ đầu.
- Chơi một mình: không có gục, máu 0 là chết luôn (để không phải chờ 30s vô nghĩa).
- HUD: người gục có icon chữ thập đỏ hiện xuyên tường với đồng đội, kèm vòng thời gian còn lại.

Nghiệm thu:
- [ ] 2 tab: tab A gục, tab B tới cứu được; zombie cào B trong lúc cứu thì vòng cứu reset.

---

## Task T.7 – HUD Thủ Thành

- Trên giữa: `ĐỢT 4 / 10  ·  Còn 23 zombie` (trong đợt) hoặc `Đợt tiếp theo sau 0:18` (giữa đợt).
- Banner đầu đợt (3s): tiêu đề + gợi ý trong `waves.json` (`ĐỢT 4` / `Cẩn thận zombie nhảy lên gờ`).
- Banner hết đợt: `HẾT ĐỢT 4 · +$1200`.
- Thanh máu boss khi có boss.
- **Máu zombie**: thanh máu nhỏ trên đầu zombie bị bắn trong 3s gần nhất (để biết sắp hạ được chưa). Brute/screamer/boss luôn hiện tên loại màu tương ứng.
- **Số damage nổi** (mặc định bật ở Thủ Thành).
- Mũi tên mép màn hình chỉ hướng zombie đang tấn công **đồng đội** gần nhất (không chỉ mình), để biết cứu ai.
- Hết trận: bảng thống kê từng người: zombie hạ, damage, số lần cứu, đợt cao nhất.

---

## Task T.8 – Không khí và dọn dẹp

- Dùng preset đêm + đèn pin của ZF.3.
- Zombie chết: nằm lại 4s rồi chìm xuống đất (không mờ, đỡ tốn shader), tối đa 30 xác cùng lúc (xác cũ nhất biến trước).
- Giữa các đợt: âm thanh nền dịu xuống; 5 giây trước đợt mới: tiếng gào xa vọng lại từ hướng zombie sẽ ra.
- Đợt boss: đổi nhạc nền căng hơn (nếu có file `boss_theme.ogg`, không có thì bỏ qua).

---

## Task T.9 – Cân bằng

Chơi thử và chỉnh `zombieTypes.json`, `waves.json`. Mục tiêu (độ khó `normal`):
- [ ] **1 người** chơi khá, mua đồ hợp lý: trụ được tới khoảng đợt 7–8, qua được cả 10 đợt nếu chơi rất tốt.
- [ ] **4 người**: qua 10 đợt nếu phối hợp, thua nếu mỗi người chạy một nơi.
- [ ] Tiền đủ để tới đợt 5 mua được súng dài tốt + lựu đạn, không thừa tới mức mua hết mọi thứ từ đợt 2.
- [ ] Mỗi loại zombie đặc biệt đều buộc người chơi đổi cách thủ (canh lỗ, canh gờ, ưu tiên hạ con gào).
- Ghi lại số liệu mỗi lần thử (đợt thua, thời gian mỗi đợt, tiền) vào `plan/notes/defense-balance.md` để so sánh.

---

## Ghi chú cho người dùng

- Map "Hai thành" giờ đóng vai pháo đài: căn cứ A là nhà, tường thành A là tuyến thủ, tháp A là chỗ thủ cuối, căn cứ B và hai lối mép là cửa zombie tràn vào.
- Có thêm model zombie: gán vào loại zombie mình muốn bằng `modelOverride` trong `zombieTypes.json` (ví dụ model to con cho `brute`, model gầy cho `runner`). Không gán thì zombie chọn ngẫu nhiên.
- Sau này dễ mở rộng: thêm đợt 11–20 cho chế độ "vô tận", thêm loại zombie mới chỉ là thêm một mục JSON + một khả năng trong code.
