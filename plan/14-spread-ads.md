# 14 – Độ toé mới (theo tốc độ + bloom), tâm ngắm động, ngắm qua ống (tuỳ chọn)

Vấn đề hiện tại: spread chỉ có 4 mức cứng (`stand/move/air/crouch`), tốc độ > 1 m/s là nhảy thẳng lên mức `move` → nhích nhẹ cũng toé như đang chạy hết tốc.

Mục tiêu:
- Toé **tăng dần theo tốc độ**, đi chậm (≤ 3 m/s) gần như không bị phạt.
- **Viên đầu chính xác**, xả liên tục toé dần (**bloom**), ngừng bắn thì hồi.
- Trượt bắn chính xác như ngồi (thưởng chiêu trượt ra bắn).
- Chuyển một phần "phạt" sang độ giật (kiểm soát được) thay vì toé ngẫu nhiên.
- Tâm ngắm hiển thị **đúng** độ toé thật.
- (Tuỳ chọn, phần ADS) chuột phải ngắm qua ống cho mọi súng.

Thứ tự: S.1 → S.2 → S.3 → S.4 → S.5. Phần ADS (D.1 → D.3) làm sau, có thể bỏ qua.

---

## Task S.1 – Mô hình spread mới (shared) ⚠️

### Trường mới trong `WeaponDef` (thay `spreadDeg` cũ)

```ts
interface SpreadDef {
  standDeg: number;       // đứng yên, không bloom
  crouchDeg: number;      // ngồi hoặc đang trượt
  moveDeg: number;        // cộng thêm khi chạy hết tốc (runSpeed)
  accurateSpeed: number;  // m/s, dưới mức này không bị phạt di chuyển
  airDeg: number;         // cộng thêm khi trên không (thay cho moveDeg)
  bloomPerShotDeg: number;
  bloomMaxDeg: number;
  bloomRecoverDegPerSec: number;
  bloomRecoverDelayMs: number; // ngừng bắn bao lâu thì bloom mới bắt đầu hồi
}
interface WeaponDef { /* ... */ spread: SpreadDef; }
```

Giá trị khởi điểm:

| key | standDeg | crouchDeg | moveDeg | accurateSpeed | airDeg | bloomPerShot | bloomMax | bloomRecover | recoverDelayMs |
|---|---|---|---|---|---|---|---|---|---|
| ak47 | 0.35 | 0.20 | 1.0 | 3.0 | 3.0 | 0.25 | 2.0 | 6 | 150 |
| m16 | 0.25 | 0.15 | 0.8 | 3.0 | 2.5 | 0.18 | 1.5 | 7 | 150 |
| smg | 0.60 | 0.40 | 0.5 | 3.0 | 2.5 | 0.15 | 1.5 | 8 | 120 |
| shotgun | 0.0 | 0.0 | 0.6 | 3.0 | 2.0 | 0.0 | 0.0 | 0 | 0 |
| colt | 0.25 | 0.15 | 0.6 | 3.0 | 2.0 | 0.40 | 1.6 | 5 | 250 |
| rulo | 0.15 | 0.10 | 1.0 | 3.0 | 3.0 | 0.80 | 2.4 | 4 | 500 |
| sniper | xem dưới | | | | | | | | |

`recoverDelayMs` phải **lớn hơn khoảng cách giữa 2 phát** của súng tự động (AK 100ms, M16 85ms, SMG 70ms), nếu không bloom hồi kịp giữa 2 phát và xả liên tục không bao giờ toé thêm. Súng bán tự động đặt delay sao cho bấm nhanh hết cỡ vẫn tích bloom một chút.

- **Shotgun**: thêm `pelletConeDeg: 4.5` (hình nón cố định của các viên chì, không đổi theo di chuyển). Toé di chuyển ở bảng trên **dịch tâm** của cả chùm, không làm chùm to ra.
- **Sniper**: giữ cơ chế scope của task H.1: ngắm → `scope.spreadDeg` (0.05) + `moveDeg 3.0` theo tốc độ + `airDeg 10`; không ngắm → `unscopedSpreadDeg` (8) cố định. Không bloom (bắn 1 phát lại kéo khoá nòng).
- **Dao, lựu đạn**: không có `spread`.

### Trạng thái bloom trong `WeaponState`

```ts
interface WeaponState {
  // ...
  bloomDeg: number;       // giá trị bloom ngay sau phát bắn gần nhất
  lastShotMs: number;     // thời điểm mô phỏng của phát gần nhất (từ seq, như task 4.1)
}
```

### Hàm tính (`shared/src/spread.ts`), thuần, không đọc thời gian thực

```ts
export function currentBloom(ws: WeaponState, def: WeaponDef, nowMs: number): number {
  const dt = Math.max(0, (nowMs - ws.lastShotMs - def.spread.bloomRecoverDelayMs) / 1000);
  return Math.max(0, ws.bloomDeg - def.spread.bloomRecoverDegPerSec * dt);
}

export function computeSpreadDeg(p: PlayerState, ws: WeaponState, def: WeaponDef, cfg: MovementConfig, nowMs: number): number {
  const s = def.spread;
  const lowStance = p.crouching || p.slideTimer > 0;
  let deg = lowStance ? s.crouchDeg : s.standDeg;
  if (!p.grounded) {
    deg += s.airDeg;
  } else {
    const speed = Math.hypot(p.vel[0], p.vel[2]);
    const t = clamp01((speed - s.accurateSpeed) / (cfg.runSpeed - s.accurateSpeed));
    deg += s.moveDeg * smoothstep(t);   // smoothstep(t) = t*t*(3-2t)
  }
  deg += currentBloom(ws, def, nowMs);
  return deg;
}

export function onShotBloom(ws: WeaponState, def: WeaponDef, nowMs: number): void {
  // gọi SAU khi đã lấy spread cho phát bắn này → viên đầu không bị bloom của chính nó
  ws.bloomDeg = Math.min(def.spread.bloomMaxDeg, currentBloom(ws, def, nowMs) + def.spread.bloomPerShotDeg);
  ws.lastShotMs = nowMs;
}
```

- Thứ tự trong `tryFire` (client và server): tính `spread = computeSpreadDeg(...)` → tạo hướng đạn với rng seed như cũ → `onShotBloom`.
- Đổi súng / nạp đạn: **không** reset bloom (nó tự hồi theo thời gian). Mỗi súng giữ bloom riêng.
- `runSpeed` dùng **sau khi** nhân `moveSpeedMul` của súng (task H.1), để chạy hết tốc với súng nào cũng ra `t = 1`.
- Xoá mọi chỗ dùng `spreadDeg.stand/move/air/crouch` cũ.

Nghiệm thu (vitest):
- [ ] AK47 đứng yên, chưa bắn: 0.35°. Đi 2,5 m/s: vẫn 0.35°. Chạy hết tốc: 1.35°. Trên không: 3.35°. Đang trượt: 0.20° + phần di chuyển.
- [ ] AK47 đứng yên bắn liên tục (100ms/phát): phát 1 = 0.35°, phát 2 = 0.60°, phát 3 = 0.85°, … từ phát 9 trở đi giữ ở 2.35° (bloom chạm trần 2.0°).
- [ ] Ngừng bắn 0,5s: bloom giảm (0.5 − 0.15) × 6 = 2.1° → về 0.
- [ ] Ngừng bắn 0,1s rồi bắn tiếp: bloom **chưa** hồi (vì còn trong `recoverDelayMs`).
- [ ] Shotgun chạy: tâm chùm lệch, nhưng góc giữa các viên chì so với tâm chùm vẫn ≤ 4.5°.
- [ ] Cùng chuỗi InputCmd, client và server tính ra **cùng hướng đạn** cho từng phát (test chạy hàm shared 2 lần với 2 bản state riêng).

---

## Task S.2 – Chỉnh độ giật

Tăng `recoilPitchDeg` khoảng 12% cho súng tự động (bù phần toé đã giảm, để xả liên tục vẫn phải kéo chuột):

| key | recoilPitchDeg cũ | mới |
|---|---|---|
| ak47 | 0.85 | 0.95 |
| m16 | 0.50 | 0.56 |
| smg | 0.40 | 0.45 |

Súng bán tự động giữ nguyên. Không đổi `recoilYawDeg`, `recoilRecoverDegPerSec`.

Nghiệm thu:
- [ ] Xả AK47 30 viên vào tường 15m không kéo chuột: vết đạn leo lên rõ; kéo chuột xuống đều tay thì gom được thành cụm.

---

## Task S.3 – Tâm ngắm động khớp độ toé thật

- Mỗi frame client tính `spreadDeg` hiện tại bằng **cùng hàm** `computeSpreadDeg` (state dự đoán của mình, `nowMs` = thời gian mô phỏng hiện tại).
- Khoảng hở từ tâm tới mỗi vạch (pixel):
  ```ts
  const halfH = canvas.clientHeight / 2;
  const gapPx = Math.tan(deg2rad(spreadDeg)) * halfH / Math.tan(deg2rad(camera.fov / 2));
  ```
  cộng thêm khoảng hở tối thiểu 3px (để tâm không dính lại khi spread ≈ 0).
- Làm mượt hiển thị: nội suy tới giá trị mới với hằng số thời gian 30ms (chỉ cho đẹp, không ảnh hưởng đạn).
- Shotgun: vẽ thêm một **vòng tròn mờ** bán kính tương ứng `pelletConeDeg` + toé hiện tại.
- Sniper không ngắm: ẩn 4 vạch, chỉ hiện một chấm nhỏ (bắn không ngắm là may rủi). Đang ngắm: ẩn tâm ngắm HUD (đã có khung scope).
- Setting: "Tâm ngắm động" bật/tắt (tắt thì vạch đứng yên, khoảng hở cố định 6px).

Nghiệm thu:
- [ ] Đứng bắn từng phát vào tường: vết đạn luôn nằm **trong** vòng do 4 vạch tạo thành.
- [ ] Chạy rồi dừng: vạch co lại mượt theo tốc độ giảm, không giật.
- [ ] Đổi FOV trong setting: khoảng hở vẫn khớp vết đạn.

---

## Task S.4 – Bảng chỉnh + công cụ thử

- Bảng F6: thêm tab **Spread**, chọn súng, slider cho mọi trường của `SpreadDef` và `recoilPitchDeg`, nút "Copy JSON súng này".
- Overlay F3 thêm dòng: `spread 0.54° = base 0.35 + move 0.00 + air 0.00 + bloom 0.19`.
- `?dummies=1`: thêm **bia tập bắn**: một tấm bảng 2×2m có vòng tròn đồng tâm ở 10m, 20m, 40m trong khu giữa; nút R + giữ Shift (dev) xoá hết vết đạn trên bảng.

Nghiệm thu:
- [ ] Kéo slider `moveDeg` của AK về 0: chạy bắn không toé thêm (thấy ngay trên bảng tập).

---

## Task S.5 – Kiểm tra đồng bộ online

- Chạy lại nghiệm thu cuối của phase 4 (3 tab, ping 20/80/150, bắn nhau 5 phút) với spread mới.
- F7 (debug tia bắn của server): tia server và vết đạn client **trùng hướng** cả khi đang chạy và đang xả liên tục.

Nghiệm thu:
- [ ] Không có ca vết đạn client một chỗ, tia server một nẻo.

---

# Phần tuỳ chọn: ngắm qua ống (ADS)

Làm khi S.1–S.5 đã ổn và bạn muốn cảm giác Krunker/CoD hơn. Sniper đã có scope, phần này mở rộng cho mọi súng.

## Task D.1 – Logic ADS (shared) ⚠️

- Đổi tên bit `Btn.Scope` thành `Btn.Aim` (chuột phải). Cầm lựu đạn thì chuột phải vẫn là ném thấp (task G.3), không bị ảnh hưởng.
- `WeaponDef` thêm:
  ```ts
  ads?: {
    spreadMult: number;   // nhân vào toàn bộ spread khi ngắm hẳn (ví dụ 0.25)
    moveMult: number;     // nhân tốc độ chạy khi ngắm (ví dụ 0.7)
    fovMult: number;      // FOV camera chính khi ngắm (ví dụ 0.8 = zoom nhẹ)
    inMs: number;         // thời gian vào ngắm
    outMs: number;
  };
  ```
  Giá trị gợi ý: AK47/M16 `{0.25, 0.7, 0.8, 180, 120}`; SMG `{0.35, 0.8, 0.85, 140, 100}`; Colt/Rulô `{0.4, 0.85, 0.88, 120, 90}`; Shotgun `{0.7, 0.8, 0.9, 160, 120}` (chỉ thu nhỏ chùm chút ít). Sniper chuyển cơ chế scope cũ sang dùng `ads` (`spreadMult` đưa spread về 0.05°, `fovMult` = 25/FOV).
- `PlayerState` thêm `adsT` (0..1): mỗi tick tăng `DT×1000/inMs` khi giữ Aim, giảm `DT×1000/outMs` khi thả. Đây là state của **movement** (vì đổi tốc độ chạy) → nằm trong `stepMovement`, gửi trong snapshot, có test determinism.
- Hiệu lực theo `adsT`: `spread × lerp(1, spreadMult, adsT)`, `runSpeed × lerp(1, moveMult, adsT)`.
- Không ngắm được khi: đang nạp đạn, đang trượt, trên không (adsT tự giảm), đang đổi súng.

Nghiệm thu:
- [ ] Test determinism movement vẫn pass với Aim bật tắt ngẫu nhiên.
- [ ] AK47 ngắm hẳn khi đứng: spread 0.09°; ngắm khi chạy: chạy chậm lại, spread nhỏ hơn hẳn chạy không ngắm.

## Task D.2 – Viewmodel và camera khi ngắm

- Mỗi súng cần thêm điểm neo `sight` (điểm ngắm, trên khe ngắm/điểm ruồi phía sau) — thêm vào params của `gun_tool.py` (task P.1).
- `poses.json → weapons.<key>.first` thêm `adsEyeDist` (khoảng cách từ mắt tới `sight`, ví dụ 0.12m) và `adsRotDeg` (thường `[0,0,0]`). Vị trí súng khi ngắm tính sao cho `sight` nằm đúng trên **trục giữa camera** tại `(0, 0, −adsEyeDist)`; nội suy giữa vị trí thường và vị trí ngắm theo `adsT` (smoothstep).
- Khi ngắm: tay vẫn bám súng bằng IK (task 10/11), sway khi đi giảm 70%, recoil hình (lùi súng) giảm 50%.
- FOV camera chính: `lerp(fov, fov × fovMult, adsT)`; sensitivity nhân tỉ lệ `tan(fovHiện/2) / tan(fov/2)` để cảm giác kéo chuột không đổi.
- Tâm ngắm HUD mờ dần theo `adsT` (ngắm hẳn thì ẩn, nhìn qua khe ngắm của súng).
- Sniper: khi `adsT > 0.9` chuyển sang khung scope đen như cũ, ẩn viewmodel.

Nghiệm thu:
- [ ] Giữ chuột phải với AK47: súng đưa vào giữa, khe ngắm thẳng tâm màn hình, viên đạn trúng đúng chỗ khe ngắm chỉ.
- [ ] Bảng F9 có slider `adsEyeDist`, `adsRotDeg`, chấm debug tại `sight`.

## Task D.3 – Người khác thấy mình ngắm

- `NetPlayer` gửi `adsT` (làm tròn 0.1).
- Góc 3: khi `adsT > 0.5` đưa súng lên cao hơn và sát má (`poses.json → weapons.<key>.third.adsGunPos/adsGunRotDeg`), tay IK tự theo.

Nghiệm thu:
- [ ] F10: thấy nhân vật đưa súng lên má khi ngắm.

---

## Ghi chú cho người dùng

- Chỉnh theo thứ tự: `standDeg` (độ chuẩn viên đầu) → `bloomPerShot` + `bloomRecover` + `recoverDelayMs` (xả liên tục khó cỡ nào, bắn từng loạt ngắn được thưởng cỡ nào) → `moveDeg` + `accurateSpeed` (chạy bắn bị phạt cỡ nào) → `airDeg`.
- Muốn giống CS hơn: tăng `moveDeg` lên 3–5°, giảm `accurateSpeed` xuống 2. Muốn giống Krunker hơn: làm thêm phần ADS và giữ `moveDeg` thấp.
- Có ADS rồi thì có thể tăng nhẹ toé khi không ngắm (bắn không ngắm cho tầm gần, ngắm cho tầm xa), như CoD.
