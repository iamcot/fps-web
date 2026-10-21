# 18 – Đóng gói "nhấp đúp là chạy" cho Windows và Mac (Node Single Executable)

Mục tiêu: người nhận **không cần cài Node**, chỉ tải file zip, giải nén, **nhấp đúp một file** là:
1. Server game chạy (phục vụ cả trang game lẫn WebSocket trên **một cổng**).
2. Trình duyệt tự mở vào game.
3. Cửa sổ console hiện địa chỉ cho bạn bè trong mạng LAN vào cùng.

Kết quả phát hành: 3 file zip
- `FPSWeb-windows-x64.zip`
- `FPSWeb-macos-arm64.zip` (Mac chip M1/M2/M3/M4)
- `FPSWeb-macos-x64.zip` (Mac Intel)

Mỗi zip chứa:
```
FPSWeb/
  FPSWeb.exe        (Windows)  |  FPSWeb  (Mac)
  game/             trang game đã build (index.html, assets/, models/, sounds/, icons/, maps/)
  config.json       cổng, tự mở trình duyệt... (người nhận sửa được)
  HUONG-DAN.txt
  CREDITS.txt
```

Công nghệ: **Node Single Executable Applications (SEA)**, có sẵn trong Node, gói một file JS + chính Node thành một file chạy.

Thứ tự: K.1 → K.2 → K.3 → K.4 → K.5 → K.6 → K.7. Task ⚠️ nên dùng model mạnh.

---

## Task K.1 – Server chế độ standalone (một cổng cho tất cả) ⚠️

Tạo entry mới `server/src/standalone.ts` (giữ nguyên `main.ts` cho lúc dev):

- **HTTP server** (`node:http`, không thêm thư viện) phục vụ file tĩnh từ thư mục `game/`:
  - Thư mục gốc: `path.join(path.dirname(process.execPath), 'game')` khi chạy dạng SEA; khi chạy thử bằng `tsx` thì dùng `client/dist`. Phát hiện chế độ SEA bằng `require('node:sea').isSea()`.
  - MIME đúng cho: `.html .js .mjs .css .json .wasm (application/wasm) .glb (model/gltf-binary) .gltf .png .jpg .webp .svg .ogg (audio/ogg) .mp3 .ico .woff2`.
  - Cache: `/assets/` → `public, max-age=31536000, immutable`; `/models/ /sounds/ /icons/ /maps/` → `public, max-age=604800`; `index.html` → `no-cache`.
  - Đường dẫn không tồn tại và không có đuôi file → trả `index.html` (SPA).
  - **Chặn đi ngược thư mục**: chuẩn hoá đường dẫn, từ chối mọi đường dẫn nằm ngoài thư mục `game/` (`..`, đường dẫn tuyệt đối, ký tự lạ).
  - Hỗ trợ `Range` cho file lớn không bắt buộc; có `ETag` hoặc `Last-Modified` + trả `304` là đủ.
- **WebSocket** dùng chung HTTP server: `new WebSocketServer({ noServer: true })`, xử lý sự kiện `upgrade` khi `url` bắt đầu bằng `/ws`. Logic phòng/game dùng lại nguyên code hiện có.
- **Cổng**: đọc `config.json` (mặc định `8080`). Bị chiếm (`EADDRINUSE`) → thử lần lượt tới `+10`. Lắng nghe `0.0.0.0` (để máy khác trong LAN vào được).
- **In ra console** (tiếng Việt, rõ ràng):
  ```
  ==============================================
   FPS Web v1.3.0 đang chạy
   Bạn chơi:        http://localhost:8080
   Bạn bè cùng mạng: http://192.168.1.23:8080
                     http://10.35.112.150:8080
   Đóng cửa sổ này để tắt server.
  ==============================================
  ```
  Liệt kê mọi địa chỉ IPv4 không phải `internal`, bỏ `169.254.x.x`. Ghi kèm tên card mạng nếu có nhiều địa chỉ.
- **Tự mở trình duyệt** (`config.openBrowser`, mặc định `true`): Windows `cmd /c start "" <url>`, Mac `open <url>`. Lỗi thì bỏ qua, không crash.
- **Tham số dòng lệnh** (ghi đè config): `--port 9000`, `--no-open`.
- **Lỗi nghiêm trọng** (không mở được cổng nào, thiếu thư mục `game/`): in thông báo tiếng Việt dễ hiểu, rồi **chờ người dùng nhấn Enter mới thoát**, để cửa sổ console không biến mất trước khi kịp đọc.
- `Ctrl+C` / đóng cửa sổ: đóng mọi kết nối, thoát sạch.
- `config.json` mặc định:
  ```json
  { "port": 8080, "openBrowser": true, "maxRooms": 20 }
  ```

Nghiệm thu:
- [ ] `npm run build -w client` rồi `tsx server/src/standalone.ts`: mở `http://localhost:8080` chơi được, kể cả offline/bot, mua đồ, lựu đạn.
- [ ] Máy khác trong LAN vào `http://<IP>:8080` chơi chung được.
- [ ] Chạy 2 bản cùng lúc: bản thứ hai tự dùng cổng 8081 và in đúng cổng.
- [ ] `curl http://localhost:8080/../../etc/passwd` và các biến thể mã hoá (`%2e%2e`) đều bị từ chối.
- [ ] `curl -I` file `.glb` trả đúng `Content-Type` và `Cache-Control`.

---

## Task K.2 – Gom server thành một file JS (esbuild)

- Thêm `esbuild` (devDependency, ghi version cứng).
- Script `scripts/bundle-server.mjs`:
  ```
  entry:    server/src/standalone.ts
  bundle:   true
  platform: node
  format:   cjs              // SEA cần một file CommonJS
  target:   node24           // khớp version Node dùng để đóng gói
  outfile:  build/server.cjs
  external: ['bufferutil', 'utf-8-validate']   // gói tuỳ chọn của ws, ws tự bỏ qua nếu thiếu
  define:   { 'process.env.APP_VERSION': JSON.stringify(version trong package.json) }
  ```
- Không còn `require` nào tới gói ngoài trong `build/server.cjs` (trừ 2 gói external ở trên): trong SEA, `require` chỉ nạp được module có sẵn của Node.
- Rapier bản `-compat` (WASM nhúng sẵn dạng base64) chạy được trong file gộp; kiểm tra lại.

Nghiệm thu:
- [ ] `node build/server.cjs` (không có `node_modules` bên cạnh: copy file sang thư mục trống để thử) chạy được game y như K.1.

---

## Task K.3 – Đóng gói SEA cho nền tảng hiện tại ⚠️

Script `scripts/package.mjs` (chạy bằng `npm run package`), làm cho **nền tảng đang chạy script**:

1. `npm run build -w client` → `client/dist`.
2. `node scripts/bundle-server.mjs` → `build/server.cjs`.
3. Ghi `build/sea-config.json`:
   ```json
   {
     "main": "build/server.cjs",
     "output": "build/sea-prep.blob",
     "disableExperimentalSEAWarning": true,
     "useSnapshot": false,
     "useCodeCache": false
   }
   ```
4. `node --experimental-sea-config build/sea-config.json` → tạo blob.
5. Copy chính file `node` đang chạy (`process.execPath`) thành `release/FPSWeb/FPSWeb` (Mac) hoặc `FPSWeb.exe` (Windows).
6. **Mac**: `codesign --remove-signature release/FPSWeb/FPSWeb`.
7. Tiêm blob bằng `postject` (devDependency):
   - Windows: `npx postject FPSWeb.exe NODE_SEA_BLOB build/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`
   - Mac: như trên, thêm `--macho-segment-name NODE_SEA`
8. **Mac**: ký ad-hoc `codesign --sign - release/FPSWeb/FPSWeb` (bắt buộc trên Mac chip M, không có chữ ký là hệ điều hành không cho chạy).
9. Copy `client/dist` → `release/FPSWeb/game/`, ghi `config.json` mặc định, `HUONG-DAN.txt` (K.5), `CREDITS.txt` (K.6).
10. Nén thành `release/FPSWeb-<os>-<arch>.zip`:
    - Mac: dùng `ditto -c -k --keepParent` hoặc `zip -r -y` để **giữ quyền chạy** của file `FPSWeb`.
    - Windows: `Compress-Archive` hoặc thư viện nén trong Node.

Lưu ý quan trọng:
- **Phiên bản Node** dùng để đóng gói phải giống nhau ở bước 4 và bước 5 (cùng một file `node`). Ghi phiên bản Node cố định trong `.nvmrc` và trong workflow K.4.
- Đối chiếu các bước với **tài liệu "Single executable applications" của đúng phiên bản Node đang dùng**; nếu tài liệu có cách mới gọn hơn (ví dụ tạo file chạy trực tiếp không cần `postject`), được dùng cách đó nhưng phải ghi chú vào báo cáo.
- Windows: file `node.exe` gốc có chữ ký số của Node; tiêm blob làm chữ ký đó không còn hợp lệ. Không sao, chỉ khiến SmartScreen cảnh báo (người nhận bấm "Run anyway", xem K.5).

Nghiệm thu:
- [ ] Trên Mac: `npm run package` tạo `release/FPSWeb-macos-arm64.zip`. Giải nén ở thư mục khác, nhấp đúp `FPSWeb`: Terminal mở, server chạy, trình duyệt tự mở game.
- [ ] Thử trên một máy **chưa cài Node** (hoặc gỡ Node khỏi PATH để giả lập): vẫn chạy.

---

## Task K.4 – Build cả 3 bản bằng GitHub Actions

`.github/workflows/release.yml`:
- Kích hoạt: đẩy tag `v*` (ví dụ `v1.3.0`) hoặc bấm chạy tay (`workflow_dispatch`).
- Ma trận 3 job:

  | Bản | Runner |
  |---|---|
  | windows-x64 | `windows-latest` |
  | macos-arm64 | `macos-latest` (máy chip M) |
  | macos-x64 | runner **Intel** còn được GitHub hỗ trợ tại thời điểm làm (kiểm tra trang "GitHub-hosted runners", label Intel mới nhất). Nếu không còn runner Intel: build trên runner chip M nhưng **tải file `node` bản darwin-x64** cùng phiên bản từ nodejs.org để làm bước 5 (blob không dùng snapshot/code cache nên dùng chung được), rồi thử chạy trên một máy Mac Intel thật trước khi phát hành. |

- Mỗi job: `actions/setup-node` với **đúng phiên bản trong `.nvmrc`** → `npm ci` → `npm run package` → upload file zip làm artifact.
- Job cuối (khi chạy theo tag): tạo **GitHub Release**, đính kèm 3 file zip, nội dung release lấy từ `CHANGELOG.md` (mục của phiên bản đó).
- Repo có thể để private; Release trên repo private chỉ người có quyền xem tải được → gửi file zip trực tiếp cho người nhận.

Nghiệm thu:
- [ ] Đẩy tag thử `v0.0.1-test`: sau khi chạy xong có đủ 3 file zip trong Release/artifact.
- [ ] Tải bản Windows về một máy Windows chưa cài Node: chạy được.

Pitfall:
- Asset lớn (model, âm thanh) làm repo nặng: nếu tổng > 1GB cân nhắc Git LFS; nhớ bật LFS trong bước checkout (`lfs: true`).
- Đừng commit thư mục `release/` và `build/` (thêm vào `.gitignore`).

---

## Task K.5 – Hướng dẫn cho người nhận (`HUONG-DAN.txt`)

Nội dung (viết đúng như dưới, thay `{version}` lúc đóng gói):

```
FPS WEB {version} – HƯỚNG DẪN TỰ CHẠY SERVER

1) Giải nén file zip ra một thư mục (ví dụ Desktop). Đừng chạy trực tiếp trong file zip.

2) WINDOWS
   - Nhấp đúp FPSWeb.exe.
   - Nếu hiện màn hình "Windows protected your PC": bấm "More info" → "Run anyway".
   - Nếu Tường lửa hỏi quyền: tick "Private networks" → bấm "Allow access".
     (Không cho phép thì bạn bè trong mạng sẽ không vào được.)

3) MAC
   - Nhấp đúp file FPSWeb.
   - Nếu báo không thể mở vì không xác minh được nhà phát triển:
     mở System Settings → Privacy & Security → kéo xuống, bấm "Open Anyway" cạnh dòng FPSWeb,
     rồi nhấp đúp FPSWeb lần nữa và chọn "Open".
   - Nếu Mac hỏi cho phép nhận kết nối mạng: chọn "Allow".

4) Cửa sổ đen (Terminal/Console) hiện ra và trình duyệt tự mở game.
   - Bạn bè cùng mạng wifi/LAN: mở trình duyệt, gõ địa chỉ "Bạn bè cùng mạng" hiện trong cửa sổ đen.
   - Nên dùng Chrome, Edge hoặc Firefox bản mới.

5) Tắt server: đóng cửa sổ đen.

6) Đổi cổng: mở config.json bằng Notepad/TextEdit, sửa "port", lưu lại, chạy lại.

Gặp lỗi: chụp màn hình cửa sổ đen gửi cho người đã gửi game cho bạn.
```

- Kèm thêm 2 ảnh chụp minh hoạ (SmartScreen, Privacy & Security) trong thư mục `docs/` nếu có; không có thì chỉ cần file text.

---

## Task K.6 – Ghi công tác giả (`CREDITS.txt`) và kiểm tra license

- Tạo `assets/CREDITS.json` liệt kê **mọi** asset bên thứ ba: `{ file, author, source, license, url }`.
- Script đóng gói sinh `CREDITS.txt` từ file này, và **dừng đóng gói** nếu có asset trong `client/public` mà không có trong `CREDITS.json` (tránh quên ghi nguồn).
- Trong game: menu chính có mục **"Ghi công"** hiển thị cùng nội dung.
- **Người dùng tự kiểm tra** (Claude Code không tự quyết): license của từng model/âm thanh có cho **phân phối lại** không. Đặc biệt các model nhân vật lấy từ thư viện cộng đồng. File CC-BY phải ghi tên tác giả; file chỉ cho dùng cá nhân thì **không được** đưa vào bản phát hành.

Nghiệm thu:
- [ ] Thêm thử một file âm thanh mới không khai báo: `npm run package` báo lỗi, chỉ rõ tên file.

---

## Task K.7 – Phiên bản và thông tin trong game

- Phiên bản lấy từ `package.json` gốc, hiện ở góc dưới menu chính và trong console server.
- Client và server khác phiên bản (người dùng mở nhầm tab cũ): server từ chối kết nối, client báo "Phiên bản game không khớp, tải lại trang (Ctrl+F5)".
- `CHANGELOG.md`: mỗi lần phát hành thêm một mục ngắn bằng tiếng Việt.

---

## Ghi chú cho người dùng

- Dung lượng mỗi bản khoảng 40–60MB khi nén (riêng Node đã chiếm phần lớn), cộng dung lượng asset của game.
- Một số phần mềm diệt virus đôi khi báo nhầm file chạy tự đóng gói chưa ký số. Nếu người nhận gặp, họ có thể thêm vào danh sách tin cậy; muốn hết hẳn cảnh báo thì phải mua chứng chỉ ký số (Windows) và tài khoản Apple Developer (Mac) để ký/notarize — làm sau nếu thật sự cần.
- Muốn có bản Linux: thêm một job `ubuntu-latest` vào K.4, các bước giống Windows (không cần ký).
