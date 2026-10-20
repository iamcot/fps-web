# 00 – Tổng quan: FPS Web "Cớm vs Cướp"

## Cách dùng bộ plan này (dành cho người dùng)

- Copy cả thư mục `plan/` và file `CLAUDE.md` vào gốc repo mới.
- **Mỗi phiên Claude Code chỉ giao một task** (ví dụ "làm task 1.3"). Prompt mẫu:
  > Đọc CLAUDE.md, plan/00-overview.md và plan/02-phase1-movement.md. Làm task 1.3. Xong thì báo cáo theo mẫu trong CLAUDE.md.
- Sau mỗi task, **tự test tay theo checklist** của task đó rồi mới giao task tiếp. Đừng giao 3 task một lúc.
- Task có đánh dấu ⚠️ là task khó. Nên dùng model mạnh nhất bạn có cho các task này.
- Nếu Claude sửa bug 2 lần không xong: mở phiên mới, dán mô tả bug + kết quả debug overlay, không tiếp tục phiên cũ (context bị rối).
- Repo con MOBA có netcode reconcile bằng input replay đã chạy ổn. Ở task 3.6, điền đường dẫn vào đây để Claude đọc tham khảo: `MOBA_REPO = <điền đường dẫn>`

## Mục tiêu

FPS trên trình duyệt, chơi nội bộ. Team Deathmatch hai đội **Cớm** và **Cướp**, nhân vật khối hộp kiểu Krunker, di chuyển nhanh (trượt, bunny hop), súng không tay, bắn hitscan, respawn nhanh.

Nguyên tắc: gameplay "đã tay" trước, đẹp sau.

## Chủ đề

- Phe hư cấu. **Không dùng quân phục, huy hiệu, quân hàm thật** của lực lượng nào.
- Cớm: xanh dương, mũ kê-pi. Cướp: đen/sọc, khăn trùm mặt, túi tiền sau lưng.
- Tên, màu đội trong `shared/src/teams.ts`, để sau đổi cặp phe chỉ cần sửa config.

## Stack (chỉ dùng những thư viện này)

| Việc | Thư viện |
|---|---|
| Ngôn ngữ / runtime | TypeScript, Node 24 |
| Client build | Vite |
| Render | `three` |
| Vật lý / va chạm | `@dimforge/rapier3d-compat` (client **và** server) |
| Mạng | `ws` (server), WebSocket trình duyệt (client) |
| Mã hoá message | `@msgpack/msgpack` |
| Test | `vitest` |
| Chạy server dev | `tsx` |

Ghi version cứng trong `package.json` (không dùng `^`), client và server **cùng một version Rapier**.

## Cấu trúc repo

```
fps-web/
  CLAUDE.md
  plan/
  package.json            # npm workspaces
  shared/src/
    constants.ts          # tick rate, interp delay...
    math.ts               # vec helpers, lerp góc, rng có seed
    movement.ts           # stepMovement (thuần)
    movementConfig.ts
    weapons.ts            # thông số súng
    teams.ts
    protocol.ts           # kiểu message + encode/decode
    map/types.ts
    map/loadMap.ts        # đọc JSON, xử lý mirror
    physics/world.ts      # tạo Rapier world từ map (dùng chung)
    hitbox.ts             # hitbox từ PlayerState, ray-AABB
  server/src/
    main.ts
    transport.ts
    room.ts
    simulation.ts
    lagComp.ts
    match.ts              # luật TDM
  client/src/
    main.ts
    input.ts
    loop.ts
    net/transport.ts
    net/clock.ts
    net/prediction.ts
    net/interpolation.ts
    render/scene.ts
    render/mapMesh.ts
    render/players.ts
    render/viewmodel.ts
    hud/  (HTML/CSS)
    audio.ts
    debug/overlay.ts
  assets/
    maps/hai-thanh.json
    models/  textures/  sounds/
```

## Hằng số chính (`shared/src/constants.ts`)

```ts
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3;      // 20 snapshot/giây
export const INTERP_DELAY_MS = 100;
export const MAX_REWIND_MS = 250;
export const HITBOX_HISTORY_MS = 1000;
export const MAX_INPUT_QUEUE = 10;
export const MAX_INPUTS_PER_TICK = 2;
export const RESPAWN_DELAY_MS = 3000;
export const SPAWN_INVULN_MS = 2000;
```

## Map 1 "Hai thành"

Hai đội chia theo trục **X**: đội A (Cớm) ở phía **x âm**, đội B (Cướp) ở phía **x dương**. Mặt phẳng đối xứng là `x = 0`. Map rộng 60m (x: −30..30) × 40m (z: −20..20).

Bố cục một nửa (x từ −30 đến 0), số liệu là **giá trị khởi điểm**, chơi thử rồi chỉnh:

| Thành phần | Vị trí / kích thước gợi ý |
|---|---|
| Tường bao ngoài | cao 8m quanh toàn map |
| Căn cứ A (spawn) | x −30..−20, 6–8 điểm spawn rải trong khu này |
| Tường thành A | tâm x = −19, dày 1,5m, cao 4m, chạy z −16..16 (hở 2 đầu làm lối vòng) |
| Lỗ bắn | 3–4 lỗ trên tường thành, rộng 1,2m, đáy cách đất 1,0m, cao 1,0m |
| Gờ trên tường | mặt trên tường đi được; lan can thấp 0,8m phía khu giữa |
| Cầu thang lên gờ | ramp từ đất lên mặt tường (4m), dài ~8m, nằm sát tường phía căn cứ |
| Tháp A | khối 4×4m, đỉnh cao 6m, gần góc căn cứ; **một lối lên duy nhất**: ramp nối từ gờ tường lên đỉnh tháp |
| Khu giữa | x −18..0: vài tường thấp cao 1,2–2m, một khối lớn ở tâm (x = 0, đánh dấu `noMirror`) |

Quy tắc phải giữ khi chỉnh map:
- Tháp hở các mặt, bắn tới được từ gờ tường đối diện.
- Spawn **không nằm trong tầm nhìn** từ lỗ bắn, gờ tường, tháp của đội kia.
- Lối vòng ở hai mép z luôn đi được.
- Người chơi **không thể nhảy từ đất lên mặt tường** (4m) — chỉ lên bằng ramp.

## Phase

| File | Nội dung |
|---|---|
| `01-phase0-setup.md` | Khung dự án, map, render tĩnh |
| `02-phase1-movement.md` | Đi lại offline |
| `03-phase2-weapons.md` | Súng offline |
| `04-phase3-netcode-move.md` ⚠️ | Multiplayer di chuyển |
| `05-phase4-netcode-shoot.md` ⚠️ | Bắn online, lag compensation |
| `06-phase5-tdm.md` | Luật Team Deathmatch |
| `07-phase6-polish.md` | Làm đẹp (chọn lẻ) |
| `08-task-gun-audio.md` | Bộ súng + âm thanh từng súng |
| `09-hud-shop-economy.md` ⚠️ | HUD mới, 4 ô vũ khí, cửa hàng, kinh tế |
| `tools-blend-to-glb.md` | Chuyển model .blend sang .glb |
| `11-characters.md` ⚠️ | Nhân vật có xương cho 2 phe, IK tay thật, tay viewmodel cắt từ model |
| `12-grenade.md` ⚠️ | Lựu đạn M67: mua, rút chốt, ném, nảy, nổ |
| `13-game-modes.md` ⚠️ | Thể thức Sinh Tử (theo ván) / Hỗn Chiến (hồi sinh), tạo phòng |

## Định nghĩa "xong" bản đầu tiên

4–6 người chia 2 đội trên "Hai thành", chạy nhảy trượt mượt, leo lên gờ bắn qua lỗ được, bắn nhau trúng đúng cảm giác, không bắn được đồng đội, chết – hồi sinh ở căn cứ – hết trận – bảng điểm – đổi bên.
