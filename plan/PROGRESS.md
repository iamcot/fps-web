# Tiến độ

Đánh dấu `[x]` khi task xong và đã qua tiêu chí nghiệm thu. Ghi chú ngắn nếu có quyết định quan trọng.

## Phase 0 – Khung dự án
- [x] 0.1 Monorepo + scripts — npm workspaces (shared/server/client), tsx watch + vite dev, typecheck + vitest pass
- [x] 0.2 Hằng số, quy ước, protocol rỗng — constants.ts, math.ts (Vec3, forward/right, lerp, lerpAngle, mulberry32, hashSeed), protocol.ts (msgpack encode/decode, MsgType)
- [x] 0.3 Map format + loader + mirror — map/types.ts (MapBox, MapRamp, MapSpawn, MapFile, LoadedMap), map/loadMap.ts (mirror X, validate cross x=0)
- [x] 0.4 Map "Hai thành" + render tĩnh — hai-thanh.json (tường thành + lỗ bắn, ramp, tháp, khu giữa), physics/world.ts (Rapier static colliders + ramp rotation), client fly camera WASD, F4 debug wireframe, spawn arrows

## Phase 1 – Di chuyển offline
- [x] 1.1 Pointer lock + nhìn chuột — input.ts (overlay, sens localStorage, ±89° clamp, skip spike đầu); movement.ts types (Btn, InputCmd, PlayerState, MovementConfig)
- [x] 1.2 Fixed timestep loop — loop.ts (acc clamp 0.25s, buildCmd, lerpState interpolation); eye height lerp ~0.1s
- [x] 1.3 stepMovement: đi, ma sát, trọng lực, nhảy — CollisionWorld (capsule kinematic, controller 50°, snap 0.3m, collision groups map/player); Quake accelerate; applyFriction; crouching+canStand; hitCeiling; slideTimer/slideCooldown đã decrement (logic task 1.5)
- [x] 1.4 Không trung, bunny hop
- [x] 1.5 Ngồi + trượt — trượt khi bấm Crouch (cạnh lên) lúc grounded, tốc độ ≥ slideMinSpeed, hết cooldown: +slideBoost theo hướng vận tốc; trong lúc trượt dùng slideFriction và bỏ accelerate; nhả Crouch/nhảy thì huỷ trượt; 2 test mới. Lỗi nhả Ctrl không đứng dậy: canStand bị sàn cắt capsule (đã sửa)
- [x] 1.6 Test determinism + debug overlay — movement.test.ts (2 world song song 600 tick bit-identical; chạy thẳng 2s → 8.4–8.6 m/s); F3 overlay (FPS, tốc độ, grounded, slideTimer, pos, yaw/pitch); F6 panel (sliders + Copy JSON)

## Phase 2 – Súng offline
- [x] 2.1 Viewmodel + render pass riêng — weapons.ts (WeaponDef, WEAPONS Rifle/Pistol, WeaponState); viewmodel.ts (viewScene FOV60 near0.01, gun placeholder box, switch anim 0.3s xuống/lên, phím 1/2); renderer.autoClear=false + clearDepth() giữa 2 pass
- [x] 2.2 Hitscan + bia — hitbox.ts (HitBox AABB, hitboxesFor, rayAabb, shootDir + 8 test); castRay trong CollisionWorld (castRayAndGetNormal Rapier); 5 bia dummy 3 phần đầu/thân/chân; fireHitscan wall-occlusion; hitmarker X trắng/đỏ 150ms; bullet hole decal tối đa 50
- [x] 2.3 Logic súng — weaponLogic.ts (tryFire, stepWeapon, spreadFor, computeShot seed hashSeed(playerId,shotSeq), RecoilState riêng, recoverRecoil) + 9 test; loop.ts có onTick(state, cmd, simMs); thông số 4 súng chỉnh theo súng thật; thêm SWITCH_MS, MOVE_SPREAD_SPEED vào weapons.ts
- [x] 2.4 Hiệu ứng + âm thanh + HUD — viewmodel: giật/lắc số 8/reload/flash tại node 'muzzle'; audio.ts tổng hợp âm bằng code (chưa có file âm thanh), context tạo ở click đầu; HUD tâm ngắm giãn theo spread, máu, đạn

## Task riêng – Âm thanh súng (plan/08-task-gun-audio.md)
- [ ] A.1 Thay bộ súng — BỎ QUA theo yêu cầu (đặc tính súng giữ nguyên)
- [x] A.2 Cấu trúc file + loader — audio/loader.ts: ogg/mp3 theo canPlayType, file thiếu → bỏ qua, gom 1 cảnh báo console; chưa có file nào trong client/public/sounds nên đang chạy hoàn toàn bằng âm tổng hợp
- [x] A.3 Profile từng súng — audio/gunProfiles.ts (theo id súng hiện có; thêm LayerDef.synthDecayMs, GunSoundProfile.cockFile)
- [x] A.4 Đồ thị Web Audio — audio/context.ts (master+compressor, gunGroup), synth.ts, gunAudio.ts (bus EQ, voice limit, thump, vỏ đạn, súng người khác qua panner/lowpass/listener, lên cò rulô)
- [x] A.5 Bảng F8 — audio/tuning.ts (slider, Bắn thử, Xả 1 giây, Copy JSON, peak meter)
- [~] A.6 Nạp đạn — phần âm thanh xong (mag + perRound, huỷ khi đổi súng). BỎ QUA A.6.1 (reloadEmptyMs/reloadEmpty trong shared = đặc tính súng): "nạp rỗng" suy ra từ ammo==0 lúc bắt đầu nạp, thời lượng dùng reloadMs hiện có
- [x] A.7 Hết đạn + cảnh báo sắp hết (setting bật/tắt ở F8 > Chung)
- [x] Âm bước chân/tiếp đất — audio/footsteps.ts, config FOOTSTEPS + tab F8 "Footsteps"; âm vỏ đạn tổng hợp theo SHELL_SYNTH (gunProfiles.ts)
- [x] Reload mag dùng file nạp trọn (assets/source/sounds/gunreload1pres → client/public/sounds/common/reload_mag.ogg/.mp3) cho AK47/M16/Colt; dryfire synth làm lại (trong, rõ hơn); tail rulô bớt bass
- [x] Dryfire: file dryfire.wav phát nhanh 2 lần (common/dryfire_rifle|pistol); reload_bolt phát sau tiếng thay băng, cách một khoảng nghỉ, lúc súng đưa lên (AK47/M16/Colt)
- [x] A.8 Trúng/hạ gục/bị trúng — audio/hitAudio.ts (combo, gộp 30ms, ducking, tim đập; tab Hit ở F8). Offline mới nối hit thân/đầu; kill/hurt/heartbeat là API chờ phase 4

## Phase 3 – Multiplayer di chuyển
- [x] 3.1 Transport + netsim — shared/transport.ts (interface Transport + withNetsim: hàng đợi FIFO giữ thứ tự), server/transport.ts + client/net/transport.ts (WebSocket+msgpack), net/ping.ts (Ping 1s, RTT + đếm Pong sai thứ tự trên F3); protocol.ts đổi MsgType theo plan (Ping/Pong); server trả Pong. Netsim: ?lat=&jit= (mỗi chiều). Test e2e: lat=80 → RTT 161ms; jit=30 → 0 gói đảo
- [ ] 3.2 Room + join/leave
- [ ] 3.3 Đồng bộ đồng hồ
- [ ] 3.4 Server sim + snapshot + "client câm"
- [ ] 3.5 Interpolation người khác
- [ ] 3.6 Prediction + reconciliation
- [ ] 3.7 Ghost + kiểm thử ping cao

## Phase 4 – Bắn online
- [ ] 4.1 Bắn qua InputCmd, server kiểm soát đạn/fire rate
- [ ] 4.2 Server hitscan (chưa lag comp)
- [ ] 4.3 Lịch sử hitbox + lag compensation
- [ ] 4.4 Máu, chết, hồi sinh, bất tử
- [ ] 4.5 Hitmarker, killfeed, debug tia bắn

## Phase 5 – Team Deathmatch
- [ ] 5.1 Đội + chia đội
- [ ] 5.2 State machine trận đấu
- [ ] 5.3 Bảng điểm + HUD điểm đội
- [ ] 5.4 Đổi bên + người vào giữa trận

## Phase 6 – Làm đẹp
- [ ] (làm sau, task chọn lẻ)
