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
- [x] 3.2 Room + join/leave — server/room.ts (Room, RoomManager: tạo phòng khi join, id tăng dần theo phòng, spawn A/B xen kẽ, xoá phòng trống >60s) + 5 test; protocol thêm Join/Welcome/PlayerJoined/PlayerLeft; Transport.onMessage giờ cộng dồn nhiều listener; client/net/lobby.ts (form tên+phòng, nhớ localStorage, nút Chơi offline, feed "X vào/đã rời" góc phải). Smoke test 3 trình duyệt OK
- [x] 3.3 Đồng bộ đồng hồ — client/net/clock.ts (ClockSync: 8 mẫu, chọn RTT nhỏ nhất; offset tăng nhảy ngay, giảm hạ ≤1ms/frame nên serverNow không lùi) + 5 test; ping.ts đẩy mẫu vào clock; F3 hiện serverNow/offset. Mục "so với serverTime snapshot" chờ 3.4 (chưa có snapshot)
- [x] 3.4 Server sim + snapshot + "client câm" — shared/protocol: Inputs/Snapshot/NetPlayer/NetFlag, isValidCmd, stateToNet/netToState (+test); server: simulation.ts (hàng đợi, ≤2 cmd/tick, bỏ seq trùng/cũ, idle bỏ Jump/Fire/Reload, snapshot 20Hz ack riêng), tickLoop.ts (accumulator, 60.0 tick/s đo thực), mỗi người 1 Rapier world; lastProcessedSeq khởi tạo -1 (client seq từ 0); client: net/snapshots.ts, render/players.ts (capsule), loop.ts setNetHooks (không tự mô phỏng khi online), F3 hiện serverNow−snapshot.serverTime. 15 test server. Bổ sung: CollisionWorld.dispose() (shared/physics/world), Room.leave giải phóng world; server khởi tạo Rapier xong mới listen (createWorld đồng thời lúc nguội làm crash "recursive use of an object"). Không vẽ capsule của chính mình (camera lệch >bán kính vài frame khi có jitter → lộ capsule); F5 ghost ở 3.7 sẽ hiện vị trí server. Heartbeat ws ping 5s (server/heartbeat.ts): kết nối không trả Pong bị ngắt trong ≤10s → hết người chơi ma khi reload qua proxy/tunnel; client đóng socket ở pagehide; log server có giờ
- [x] 3.5 Interpolation người khác — net/interpolation.ts (Interpolator: buffer ~1s, lerp pos/pitch, lerpAngle yaw, cờ của a, giữ snapshot cuối khi thiếu b, cờ stale >250ms; interp.currentRenderTime) + 10 test. Đo thật (bot Node, 8.5m/s): lat≤50 mượt, jit=30 mượt; lat≥80/chiều bị giữ-rồi-nhảy vì INTERP_DELAY 100ms < latency+50ms → đã sửa: delay thích nghi = INTERP_DELAY_MS + trễ 1 chiều (ClockSync.oneWayMs = RTT trung bình/2, InterpDelay đổi ≤1ms/frame). Đo lại: lat=80/jit=30 frame đứng yên 39%→4%, lat=150/jit=60 74%→4%. LƯU Ý phase 4: server rewind = trễ gửi + delay ≈ 2×oneWay+100 → >MAX_REWIND_MS=250 khi lat≥75/chiều; xem lại khi làm 4.3
- [x] 3.6 Prediction + reconciliation — net/prediction.ts (pending {cmd,stateAfter}, onSnapshot: bỏ cmd ≤ack, so sai số, đặt state server rồi replay, visualOffset ×0.85/frame, ≥1m teleport) + 7 test; loop.ts NetHooks (current/step/visualOffset). Đo thật (bot Node + Rapier thật + server thật, nhảy/ngồi/trượt/đổi hướng): lat=100/jit=20 62s → 1235 reconcile, 100% sai số 0. GỐC LỆCH ban đầu: server chạy bước 'idle' ngay khi hàng đợi trống thoáng qua (jitter) → server tiến thêm bước client chưa dự đoán (lat=100/jit=20: chỉ 26% sai số 0, p95 0.26m). Sửa: chờ INPUT_STARVE_GRACE_TICKS=6 (shared/constants) trước khi chạy idle — LỆCH plan 3.4 mục 2, cần người dùng biết
- [x] 3.7 Ghost + kiểm thử ping cao — render/ghosts.ts (F5: wireframe tại snapshot mới nhất của mọi người, mình màu vàng); F3 thêm pending, sai số reconcile (lần cuối + max 5s), snapshot/s (cùng RTT, offset, interp delay có từ trước). Kiểm: browser ?lat=100 nhấn D → vị trí đổi sau 41ms; ghost của mình trễ 1.59m khi chạy

## Phase 4 – Bắn online
- [x] 4.1 Bắn qua InputCmd, server kiểm soát đạn/fire rate — shared: stepWeaponCmd(ws, cmd) (đổi súng theo cmd.weapon + stepWeapon, nowMs = seq*1000/TICK_RATE), copyWeaponState/weaponStatesEqual, SnapshotMsg.wpn (WeaponState của người nhận), isValidCmd kiểm weapon trong dải + fireRenderTime hữu hạn, SEQ_AHEAD_SLACK_MS=1000; server: Player.weapon/shotsFired, bỏ cmd có seq chạy nhanh hơn thời gian thực >1s (thay cho 'đếm >66 cmd/giây'); client: cmd.weapon + Fire/Reload tắt khi chưa khoá chuột (loop.ts), fireRenderTime = interp.currentRenderTime khi Fire, net/weaponSync.ts reconcile súng (đặt state server, replay cmd chưa ack) + F3 'súng: lệch server n/m'. Chưa có: server chưa chấm trúng (4.2). Đo: bot giữ Fire AK 6s ở lat 0 / 100±20 / 150±40: ammo client = server, 0 lệch/180 lần. Plan nói Pistol 4 phát/giây nhưng COLT là bán tự động 160ms: AK47 = 10 phát/s đúng fireIntervalMs, COLT cần nhả cò giữa các phát
- [x] 4.2 Server hitscan (chưa lag comp) — server/shooting.ts resolveShot: gốc tia = mắt (eyeStand/eyeCrouch theo state sau cmd), hướng = computeShot (recoil per-player + shotSpread dùng chung client/server, seed id+shotSeq), tường = castRay world riêng, người khác = hitboxesFor+rayAabb (mọi người trừ mình; đội ở phase 5, chết ở 4.4), HitConfirm riêng người bắn, ShotFx cả phòng trừ người bắn (thêm trường weapon để chọn tiếng súng); shared: shotSpread, MsgType.HitConfirm=106/ShotFx=109; client: hitmarker + tiếng 'tách' chỉ khi nhận HitConfirm, render/tracers.ts vệt đạn + playShotOther, seed spread = id thật. Chưa trừ máu (4.4). Bot thật (Rapier + server thật): 4 HitConfirm (1 headshot 126, 3 thân 36) và ShotFx dist = khoảng cách tường khi bị chắn
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
