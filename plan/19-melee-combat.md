# 19 – Cận chiến: combo dao, va chạm vũ khí, vũ khí mới, nhặt/vứt, chế độ cận chiến

Bản chính để đọc và comment nằm ở Claude Docs ("Plan: Combo dao và vũ khí cận chiến"). File này là bản trong repo, người dùng đã duyệt ngày 22/10/2026. Mọi con số damage, thời gian là **đề xuất**, sẽ nằm trong config của `shared/` và chỉnh khi playtest.

## Quyết định đã chốt (22/10)

- Chuột trái đầu tiên chém ngang. Chuột phải = xoay dao dọc, cầm ngược, **đâm thật**.
- Đánh bằng **va chạm vũ khí** (cung quét), không hitscan. Có đỡ, parry, choáng, thể lực.
- Góc nhìn thứ ba ở ô cận chiến, phím `V`, trong mọi chế độ.
- Animation toàn thân đi **đường A** (theo đường vũ khí, IK, không cần clip mocap). Không có lăn né.
- Chỉ dùng ô 1 (`slots[0]`) cho vũ khí cận chiến. Cho phép sửa `shared/`.
- Nhặt/vứt áp dụng mọi chế độ. `G` = vứt. Vũ khí rơi biến mất sau 1 phút, trừ vũ khí spawn trên map ở chế độ cận chiến.
- Dùng lại map và điểm xuất phát thường. Không làm đấu trường riêng. Góc nhìn thứ ba không bị hạn chế ở chế độ nào.
- Model vũ khí do người dùng tự kiếm (yêu cầu ở mục 7).
- Phím đỡ là `Shift` trái (không dùng `Q` vì `Q` là đổi nhanh ô súng và đánh hơi zombie). Phím múa dao là `T` (`F` là đèn pin). Chốt 22/10.

**Còn mở:**
- "Tay không" hiểu là đang cầm ô 2–4: đi ngang vũ khí dưới đất thì nhặt vào ô 1 mà không đổi ô; `G` ở ô 2–4 vẫn là lựu đạn; ở ô 1 `G` vứt vũ khí nhặt. Cần người dùng xác nhận. Đang đứng trên vũ khí khác mà bấm `G` có đổi luôn không.
- Chế độ cận chiến mặc định đấu theo đội.

## 1. Hiện trạng

- Dao = `WEAPONS[6]`: hitscan 2,2 m từ mắt, damage 55, interval 450 ms, auto. Dùng chung `tryFire` và `resolveShot` (`server/src/shooting.ts`) với súng, kể cả lag compensation.
- Animation tay: `onFire(melee)` chỉ đặt `kick = 3` (lùi 12 cm, ngóc 9°, tắt trong ~80 ms). Có bob số 8 khi chạy. `Btn.Aim` với dao không làm gì.
- Hitbox người = 3 AABB (chân, thân, đầu) trong `shared/src/hitbox.ts`.
- Nhân vật dùng bộ xương Mixamo 65 xương; đã có clip chỉ thân trên (ném lựu đạn, cào zombie).
- `CATEGORY_SLOT`: knife và claw cùng ô 0, nên chỉ có một vũ khí cận chiến.
- Trạng thái vũ khí phải tính theo `seq` (client dự đoán, server xác nhận): thêm trường vào `WeaponState` phải sửa `copyWeaponState`, `weaponStatesEqual` và snapshot.
- `shared/` bị khoá theo CLAUDE.md: mọi thay đổi ở đây đã được người dùng đồng ý (mục "đã chốt").

## 2. Animation di chuyển cho dao (P1, chỉ client)

Làm trong `client/src/render/knifeAnim.ts` (thuần, có test) cộng vào gunGroup:

| Hiệu ứng | Mô tả |
|---|---|
| Thở | Nhấp nhô rất nhẹ khi đứng yên, chu kỳ 4 s |
| Đi bộ | Bob số 8 hiện có, thêm nghiêng cổ tay theo nhịp bước |
| Chạy nước rút | Dao hạ thấp, chúc mũi, lắc rộng hơn |
| Quán tính chuột | Dao trễ theo camera rồi hồi về |
| Đi ngang | Nghiêng dao theo chiều đi |
| Nhảy, tiếp đất | Nhấc lên khi nhảy, nhún xuống khi chạm đất |
| Rút dao | Tung lên, xoay đúng một vòng (~0,5 s) |
| Múa dao | Tự động sau 7 s đứng yên, hoặc bấm `T`. 3 kiểu: xoay lưỡi, tung xoay, xoay quanh trục dọc |

## 3. Hệ thống combo

- Chuột trái (L) = chém ngang. Chuột phải (R) = xoay dao dọc cầm ngược, đâm xuống.
- **Đổi 22/10/2026 (người dùng chọn):** luôn cầm xuôi, không lật dao cầm ngược. R1 = đâm thẳng mạnh về trước, RR = đâm thẳng 2 nhát; LR / LLR vẫn giáng xuống nhưng cầm xuôi. Các mô tả "cầm ngược" bên dưới không còn áp dụng.
- Sau mỗi chiêu có cửa sổ nối ~300 ms. Bấm trong cửa sổ thì sang chiêu kế của cây combo; bấm muộn hoặc sai nhánh thì quay về chiêu cơ bản. Đệm input ~150 ms.
- Chiêu nối nhanh hơn bấm lẻ. Chiêu kết có hồi chiêu dài, đánh trượt bị phạt.
- Chiêu và cây combo là **dữ liệu** trong `shared/`.

Cân bằng gốc (kiểu CS): L chém 40 damage, ~380 ms; R đâm 65 damage, ~700 ms.

| # | Tên | Input | Chiêu | Damage thân | Ý tưởng animation |
|---|---|---|---|---|---|
| K1 | Ba nhịp | L L L | Chém ngang, chém ngược (nhanh hơn), đâm liên hoàn 4 nhát | 40 + 40 + 4×20 | Hai nhát quét bằng cổ tay, nhát cuối dao chúc mũi, tay phóng tới 4 lần, thân nhích tới 0,8 m |
| K2 | Chém rồi lật | L R | Chém ngang, lật dao cầm ngược, đâm dọc xuống | 40 + 65 | Dao quay nửa vòng quanh ngón cái, tay giơ cao rồi giáng |
| K3 | Xoáy kép | R R | Hai lần xoay dọc cầm ngược, lần hai nhanh hơn và trúng 2 khung | 65 + 2×30 | Dao quay như bánh xe quanh cổ tay |
| K4 | Tam tấu | L R L | Chém, đâm xuống cầm ngược, hất dao từ dưới lên | 40 + 65 + 50 | Nhát cuối khoét từ thấp lên cao, cung nghiêng lên nên dễ trúng đầu (đầu ×2,5) |
| K5 | Lật tay | R L | Đâm xuống cầm ngược, đổi lại cầm xuôi, chém cực nhanh | 65 + 45 | Dao tung nhẹ rồi bắt lại ngược tay, chém ngay |
| K6 | Bão dao | L L R L | Hai chém, một đâm xuống, kết bằng xoay 360° quanh người | 40 + 40 + 65 + 60 | Kết thúc xoay toàn thân, trúng nhiều người xung quanh |

Tham khảo ý tưởng (từ kiến thức về game, chưa tra web): CS (chém nhanh yếu, đâm chậm mạnh, múa dao khi rảnh), Chivalry/Mordhau (chuỗi đòn, feint, hướng đánh), Dying Light (đòn nhẹ/nặng, đẩy lùi), Devil May Cry (cây combo nhiều nhánh), Assassin's Creed (lật cầm ngược). Ý tưởng thêm cho bản sau: huỷ chiêu (feint) khi bấm sai nhánh.

## 4. Chiến đấu bằng va chạm kiểu Elden Ring

### 4.1 Góc nhìn thứ ba
- Phím `V` đổi giữa góc nhìn thứ nhất và thứ ba khi cầm ô cận chiến. Lưu lựa chọn. Chế độ cận chiến mặc định thứ ba. Đổi sang súng thì về góc nhìn thứ nhất.
- Camera sau vai, cách ~2,5 m, lệch phải 0,4 m, quét tia vào bản đồ để không xuyên tường (`castRay`).
- Điều khiển giữ như cũ (nhân vật luôn quay theo yaw, WASD theo camera). Không chọn kiểu nhân vật tự quay theo hướng chạy vì phải sửa `stepMovement`. Khoá mục tiêu để sau.
- Ẩn viewmodel, vẽ nhân vật của mình. Hit và tầm nhìn tính từ nhân vật, không từ camera.

### 4.2 Cung quét theo dữ liệu
- Mỗi chiêu có **đường vũ khí**: vị trí gốc và mũi lưỡi (hoặc tâm đầu búa) tại mỗi tick 60 Hz của khung đánh, trong hệ nhân vật, cộng bán kính lưỡi (dao ~4 cm, búa ~12 cm). Dữ liệu trong `shared/`, vẽ keyframe tay (đường A).
- Mỗi tick đánh, server nội suy 4–6 mẫu giữa hai tick, thử với 3 hitbox AABB hiện có mở rộng theo bán kính lưỡi. Trúng hộp nào tính theo phần đó. Tường chặn bằng một tia từ mắt tới điểm trúng.
- Một chiêu có một hoặc nhiều cửa sổ đánh; mỗi nạn nhân ăn một lần mỗi cửa sổ.
- Chi phí nhỏ (vài trăm phép thử mỗi tick, ít hơn một phát shotgun 8 tia). Server không cần xương.
- Thêm overlay debug vẽ cung quét và hitbox (theo kiểu `debugShots.ts`).

### 4.3 Netcode
- Trạng thái đòn (chiêu, thời điểm bắt đầu, đang đỡ, thể lực, choáng) nằm trong `WeaponState`, tính theo `seq`; client dự đoán như server.
- Vị trí đối thủ tua về `fireRenderTime` như súng nhưng giới hạn tua cận chiến ~250 ms. Đỡ và parry tính theo giờ server hiện tại (bên thủ có lợi) cộng ân hạn ~80 ms.
- Client dự đoán ngay việc ra chiêu và hiệu ứng trúng thân; kết quả đỡ/parry/choáng lấy từ server.
- `ShotFxMsg` thêm `moveId`, `startSeq` để người khác phát animation đúng nhịp.

### 4.4 Animation toàn thân (đường A đã chọn)
- Đường vũ khí → IK hai tay bám cán (đã có `SkeletonArm`), hông và ngực xoay theo hướng đánh.
- Chỉ cần 3 clip dùng chung: bị trúng, choáng, vỡ thế thủ (tự làm hoặc tạm dùng clip có sẵn).
- Đường B (clip mocap, ~60 clip) để sau nếu muốn đẹp hơn, +8–12 ngày và tool đo cung quét 2–3 ngày. Dữ liệu cung quét dùng chung nên không phải sửa server.

Danh sách clip nếu làm đường B: mỗi vũ khí `<key>_idle`, `_move`, `_draw`, `_guard`, `_guard_hit`, `_parry` (30 clip); dao 7 chiêu (`knife_l1`, `l2`, `l3`, `r1`, `r2`, `rise`, `spin`); búa 5 (`hammer_l1`, `l2`, `r1`, `r2`, `spin`); mã tấu 4 (`machete_l1`, `r1`, `l2`, `chop`); thương 5 (`spear_l1`, `l2`, `l3`, `r1`, `r2`); gậy 6 (`staff_l1`, `l2`, `l4`, `r1`, `sweep`, `head`); dùng chung `hit_react`, `stagger`, `guard_break`.

### 4.5 Đỡ, parry, choáng, thể lực (đề xuất)

| Cơ chế | Quy tắc |
|---|---|
| Thể lực | 100, hồi 25/s sau 0,8 s không dùng. Chiêu nhẹ 15, nặng hoặc đòn kết 25–35. Hết thì không ra chiêu |
| Đỡ (giữ phím) | Chắn nón trước ±60°, giảm 85% damage, chạy ×0,6, không ra chiêu khi đang đỡ. Đỡ trúng tốn thể lực = 0,5 × damage gốc. Đòn từ sau không đỡ được |
| Parry | Đòn trúng trong 180 ms đầu sau khi bấm đỡ: không mất máu, không mất thể lực, kẻ đánh choáng 0,9 s, nhận đòn phản công ×1,8 trong 1,2 s. Hồi 600 ms |
| Vỡ thế thủ | Đang đỡ mà thể lực về 0: choáng 1,2 s, nhận đòn kết |
| Choáng (poise) | Mỗi đòn có sát thương choáng; mỗi người 100 điểm, hồi 30/s sau 2 s; về 0 thì choáng 0,7 s. Búa cao nhất, gậy thấp nhất |
| Bị trúng lúc khởi động | Chiêu bị huỷ. Chưa có siêu giáp ở bản đầu |
| Đòn bị đỡ | Người đánh bị khựng thêm ~150 ms |

### 4.6 Chế độ chỉ cận chiến
- **22/10/2026:** người dùng chọn làm phần bot + thể thức chỉ có dao (P7a) trước P5.
- Một chế độ "Cận chiến" với tuỳ chọn phòng `nguồn vũ khí`: chọn lúc hồi sinh, hoặc nhặt trên map (4.9).
- Không súng, không lựu đạn, không shop. Đấu theo đội. Góc nhìn thứ ba bật sẵn.
- Bot cần AI cận chiến: áp sát, đánh combo ngẫu nhiên, đỡ khi đối thủ khởi động đòn, lùi khi hết thể lực.
- HUD: thanh thể lực, chỉ báo đang đỡ, bước combo.

### 4.7 Có nặng không?
Server không nặng (số phép thử nhỏ, không xương). Phần nặng là nội dung animation (nếu chọn mocap), cảm giác độ trễ khi đỡ/parry, cân bằng, và bot AI.

### 4.8 Nhặt và vứt vũ khí
- Ô 1 (`slots[0]`) luôn có dao gốc (id 6, không bao giờ mất). Nhặt vũ khí thì đặt `slots[0]` = id vũ khí đó (dao ẩn). Vứt hoặc chết thì đặt lại = 6. Giống đường mua súng nên ít sửa `WeaponState`.
- `G` vứt vũ khí nhặt khi đang ở ô 1; cầm dao gốc thì không làm gì. Ở ô 2–4, `G` vẫn là lựu đạn.
- Đi ngang vũ khí dưới đất khi đang cầm dao gốc thì tự nhặt (server phát hiện mỗi tick, bán kính ~1 m). Nhặt khoá đòn 300 ms.
- Vứt: vũ khí rơi cách 1,5 m về phía trước, lấy độ cao sàn bằng `castRay`, không cần vật lý. Người vứt không nhặt lại trong 1,5 s. Vứt giữa đòn thì huỷ chiêu. Chết thì vũ khí rơi tại chỗ.
- Vũ khí rơi do chết hoặc vứt biến mất sau 1 phút. Ở chế độ cận chiến, vũ khí spawn trên map không biến mất.
- Mạng: `room.worldWeapons` ở server; hai thông điệp mới `WorldWeaponSpawn`, `WorldWeaponRemove` theo mẫu `GrenadeSpawn`, cộng danh sách đầy đủ cho người vào giữa trận. Vũ khí cầm của người khác đã có trong `NetPlayer.weapon`.
- Client: vật thế giới dùng cùng file glb, xoay chậm, bồng bềnh, có vòng sáng; đứng gần hiện tên và gợi ý.

### 4.9 Chế độ nhặt vũ khí
- Hai phe dùng điểm xuất phát bình thường của map. Vũ khí rải ngẫu nhiên trên các điểm `weaponSpots` (danh sách mới trong dữ liệu map, 16–24 điểm; đề xuất vị trí rồi người dùng sửa).
- Đầu trận rải ~10 vũ khí, loại chọn theo trọng số (gậy 30%, mã tấu 30%, thương 20%, búa 20%; dao không spawn). Giữ tối thiểu ~8 vật trong thế giới, thiếu thì mỗi 15 s bù một vật ở điểm trống cách mọi người ≥ 5 m. RNG có seed theo phòng.
- Chết là mất vũ khí, hồi sinh về dao gốc. Cân bằng: người cầm búa/thương có lợi lớn so với dao; có thể làm dao mạnh hơn chút hoặc cho vài giây bất tử sau hồi sinh.
- Bot biết đi nhặt khi đang cầm dao gốc.

## 5. Thay đổi kỹ thuật chung (shared/)

1. `shared/src/meleeConfig.ts`: `MeleeMove` (khởi động, cửa sổ đánh, hồi chiêu, cửa sổ nối, damage, sát thương choáng, thể lực, đường vũ khí, bán kính lưỡi, đẩy lùi) và `MeleeSet` (cây combo), cùng hằng số thể lực, đỡ, parry, poise.
2. `shared/src/meleePaths`: dữ liệu đường vũ khí.
3. `shared/src/melee.ts`: `stepMelee` thuần theo `seq`; có test chuỗi input.
4. `WeaponState` thêm `meleeMove`, `meleeStartMs`, `comboNode`, `chainEndMs`, `stamina`, `staminaRegenAtMs`, `guardSinceMs`, `staggerUntilMs`, `poise`; sửa copy/equal/snapshot.
5. `movement.ts`: thêm `Btn.Guard`; hệ số tốc độ theo trạng thái (đánh ×0,8, đỡ ×0,6, choáng ×0,3).
6. `stepWeaponCmd`: nhánh riêng cho vũ khí có bộ chiêu (`Btn.Fire` = trái, `Btn.Aim` = phải, `Btn.Guard` = đỡ). Claw zombie giữ nguyên.
7. Server: `resolveMeleeSweep` cạnh `resolveShot`.
8. Giao thức: `ShotFxMsg` thêm `moveId`, `startSeq`; thông báo kết quả đòn; snapshot chủ thêm thể lực, đỡ, choáng; thông điệp vũ khí thế giới.
9. Bot đọc `def.range` thay hằng 2,2.

## 6. Vũ khí cận chiến mới (đề xuất)

Mỗi vũ khí là một dòng trong `WEAPONS` (category `knife`, `melee: true`) cộng một bộ chiêu. Giá là đề xuất, cần cân với `economy.ts`.

| | Búa | Mã tấu | Thương | Gậy |
|---|---|---|---|---|
| Vai trò | Chậm, nặng, đẩy lùi | Nhanh vừa, chém chéo | Tầm xa, đâm | Rẻ, nhiều đòn nhẹ |
| Giá | 1.500 | 600 | 900 | 300 |
| Tầm | 2,4 m | 2,3 m | 3,2 m (mũi 3,6 m) | 2,6 m |
| Tốc độ chạy | ×0,95 | ×1,05 | ×1,0 | ×1,05 |
| Cầm | Hai tay | Một tay | Hai tay | Hai tay |

- **Búa:** L giáng từ trên xuống 70 (khởi động 450 ms); R quét ngang 45 đẩy lùi. Combo `L L` giáng kép 70 + 80; `R L` quét rồi giáng 45 + 85; `R R R` xoáy búa, vòng cuối 360° 60. Tuỳ chọn làm chậm nạn nhân 20% trong 0,8 s (cần trạng thái mới trên server).
- **Mã tấu:** L chém chéo xuống 45; R chém chéo ngược 45. Combo `L R L` chữ X 45 + 45 + 60; `L L R` chặt đầu (nhát cuối đầu ×2,5); `L R L R` bão chém 4 × 35, mỗi nhát nhanh hơn 10%.
- **Thương:** L đâm thẳng 50 (đầu mũi ≥ 2,4 m +20%); R quét ngang 40, góc 100°. Combo `L L L` ba đâm 50, 50, 70 (tầm 3,6 m); `L R` đâm rồi quét 50 + 40; `R L` hất rồi đâm 40 + 60. Khởi động dài, trượt bị phạt nặng.
- **Gậy:** L quật chéo 30 (300 ms); R đảo hai đầu 2 × 20. Combo `L L L L` mưa gậy 4 × 25, nhát cuối 50; `R L` quét gối (chân ×1,5, làm chậm 0,6 s) rồi quật đầu 30; `L R L` ba tầng đầu, thân, chân. Chặn đòn bằng R là cơ chế đỡ chung (mục 4.5).

## 7. Asset do người dùng cung cấp

`scripts/package.mjs` **dừng đóng gói** nếu file trong `client/public` không có dòng trong `assets/CREDITS.json` (`{ file, author, source, license, url }`). Dòng ghi "CHƯA XÁC MINH" chỉ cảnh báo (hiện 43/52 file như vậy, gồm `knife_1.glb`).

**Model vũ khí (mỗi vũ khí):**
- `.glb` (glTF 2.0), chưa nén; có `.blend` nguồn thì gửi kèm. Không cần rig hay animation.
- Đơn vị mét, kích thước thật: dao 0,25–0,30 m, mã tấu 0,6–0,7 m, búa cán 0,8–1,2 m, thương 1,8–2,2 m, gậy 1,5–1,8 m.
- Gốc (pivot) tại điểm tay phải nắm, trục Y lên, mũi/lưỡi/đầu hướng **-Z** khi cầm xuôi.
- Điểm đặt tên (empty hoặc mesh ẩn nhỏ): `grip_r` (bắt buộc), `grip_l` (vũ khí hai tay), `hit_base` và `hit_tip` (hai đầu đoạn gây sát thương; búa thêm `hit_head` ở tâm đầu búa). Bước nén xoá empty nên điểm này được đọc trước khi nén.
- Dưới 3.000 tam giác, một material, texture ≤ 1024×1024.
- Tên file `models/<key>.glb` với key `knife`, `hammer`, `machete`, `spear`, `staff`.

**Giấy phép (gửi kèm tác giả, link, loại license cho từng file):** tự làm, CC0, CC-BY (phải ghi tên tác giả và link trong CREDITS và menu Ghi công) đều dùng được. CC-BY-NC, CC-BY-ND, "dùng cá nhân", model rip từ game thì không dùng.

**Animation (chỉ nếu chọn đường B):** bộ xương Mixamo (`mixamorig:`, 65 xương), 30 fps, tại chỗ, tên clip theo danh sách ở 4.4. Mixamo cho tải miễn phí dùng trong game nhưng chưa đọc điều khoản hiện hành; vẫn cần dòng CREDITS cho từng clip.

**Âm thanh (nếu có):** vụt (nhẹ và nặng), trúng thịt, trúng tường, đỡ đòn, parry, vỡ thế thủ. Chưa có thì dùng âm thanh có sẵn làm placeholder.

## 8. Phase và công sức

| Phase | Nội dung | Công sức |
|---|---|---|
| P1 | Animation di chuyển cho dao (góc nhìn thứ nhất, chỉ client) | 1,5–2 ngày |
| P2 | Bộ máy chiêu trong `shared/`: `meleeConfig`, `stepMelee`, `WeaponState`, `Btn.Guard`, combo, thể lực, đỡ, parry, choáng, test | 4–5 ngày |
| P3 | Va chạm và mạng: `resolveMeleeSweep`, lag comp, dự đoán client, giao thức, overlay debug | 4–5 ngày |
| P4 | Dao trọn vẹn góc nhìn thứ nhất: keyframe 6 combo, cầm ngược, HUD thể lực/đỡ, âm thanh, hiệu ứng | 3–4 ngày |
| P5 | Góc nhìn thứ ba và animation toàn thân (đường A) | 5–7 ngày |
| P6 | 4 vũ khí mới (asset do người dùng cấp) | 6–10 ngày |
| P7 | Chế độ cận chiến (chọn vũ khí lúc hồi sinh), bot AI cận chiến | 4–6 ngày |
| P8 | Nhặt và vứt vũ khí | 3–4 ngày |
| P9 | Chế độ nhặt vũ khí (`weaponSpots`, spawn có seed, tuỳ chọn phòng, bot nhặt) | 3–4 ngày |
| P10 | Cân bằng và hoàn thiện | 4–5 ngày |
| | **Tổng** | **~37–52 ngày** |

Bốn mốc: M1 = P1–P4, M2 = P5, M3 = P6–P7, M4 = P8–P10. P8 cần ít nhất một vũ khí ngoài dao nên chỉ bắt đầu được sau vũ khí đầu tiên của P6. Thứ tự vũ khí gợi ý: mã tấu, gậy, búa, thương.

## 9. Rủi ro

- Trễ khi đỡ/parry qua mạng: bên thủ có lợi, người đánh có thể thấy trúng rồi bị báo đã đỡ. Cần thử ở ping 80–150 ms.
- Lệch dự đoán trạng thái combo, thể lực, đỡ giữa client và server. Test chuỗi input chạy cùng `seq` ở cả hai phía.
- Animation đường A trông cứng; chấp nhận cho bản đầu.
- Góc nhìn thứ ba nhìn được rộng hơn qua góc dù camera bị chặn bởi tường. Có thể tắt ở chế độ thi đấu.
- Spam và cân bằng thể lực, parry. Bot AI cận chiến khó cân. Người cầm búa/thương hơn hẳn người cầm dao ở chế độ nhặt vũ khí.
- Zombie mode: claw dùng cùng đường `stepWeaponCmd`, phải test không hỏng cào thường và cào mạnh.
- Phím đỡ `Shift` trái: kiểm tra không trùng chạy/đi bộ nếu sau này thêm.
