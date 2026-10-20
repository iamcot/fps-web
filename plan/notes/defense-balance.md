# Thủ Thành – số liệu cân bằng (T.9)

Công cụ: `BALANCE=1 npx vitest run server/src/defenseBalance.test.ts` (bot KHÓ đóng vai người chơi giữ thành, độ khó `normal`, mô phỏng nhanh hơn thời gian thực).

| Lần | Cấu hình | Kết quả | Ghi chú |
|---|---|---|---|
| 1 | 1 bot khó | thua ở đợt 1 sau 27s | |
| 1 | 4 bot khó | thua ở đợt 2 sau 113s (đợt 1 xong sau 70s) | tiền cuối 1700–2300/người |

**Chưa kết luận được cân bằng.** Bot không phải đại diện cho người chơi: nó đứng giữa căn cứ và đấu súng như đấu người, không thủ ở gờ/tháp, không lùi bắn, không dùng lựu đạn theo đám đông. Mục tiêu của plan (1 người khá trụ tới đợt 7–8; 4 người qua 10 đợt nếu phối hợp) cần **chơi thử bằng người thật**, ghi lại đợt thua, thời gian mỗi đợt và tiền vào bảng này.

Núm chỉnh (không cần sửa code): `shared/src/zombieTypes.json` (hp, runSpeed, clawDamage, attackMs, reward), `shared/src/waves.json` (số lượng, nhịp sinh, hệ số độ khó/số người, `maxAlive`), `shared/src/defense.ts → DEFENSE` (thưởng hết đợt, thời gian gục/cứu, báo trước vuốt 250ms), `BOSS`.
