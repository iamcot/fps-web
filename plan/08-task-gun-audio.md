# Task riêng – Bộ súng mới + âm thanh theo từng súng

Làm sau khi xong Phase 2 (task 2.4). Có thể làm trước hoặc sau Phase 3, không đụng tới netcode.

Bộ súng: **AK47**, **M16**, **Colt** (súng lục bán tự động), **Rulô** (revolver).

Thứ tự làm: A.1 → A.2 → A.3 → A.4 → A.5 (bảng chỉnh) → A.6 (nạp đạn) → A.7 (hết đạn) → A.8 (tiếng bắn trúng). A.6–A.8 dùng chung bộ âm tổng hợp ở A.4, nên phải xong A.4 trước.

---

## Task A.1 – Thay bộ súng trong `shared/src/weapons.ts`

Thay `WEAPONS` (Rifle/Pistol cũ) bằng 4 súng dưới. Thêm trường `slot`: 1 = súng chính, 2 = súng phụ. Phím 1–4 chọn súng theo thứ tự id (tạm thời, chưa có hệ thống chọn loadout).

```ts
export const WEAPONS: WeaponDef[] = [
  { id: 0, name: 'AK47', slot: 1, auto: true,
    damage: 30, headMult: 3.5, legMult: 0.75,
    fireIntervalMs: 100, magSize: 30, reloadMs: 2300, range: 200,
    spreadDeg: { stand: 0.5, move: 1.8, air: 4.5, crouch: 0.3 },
    recoilPitchDeg: 0.85, recoilYawDeg: 0.45, recoilRecoverDegPerSec: 7 },

  { id: 1, name: 'M16', slot: 1, auto: true,
    damage: 24, headMult: 4, legMult: 0.75,
    fireIntervalMs: 85, magSize: 30, reloadMs: 2000, range: 220,
    spreadDeg: { stand: 0.3, move: 1.4, air: 4, crouch: 0.2 },
    recoilPitchDeg: 0.5, recoilYawDeg: 0.2, recoilRecoverDegPerSec: 9 },

  { id: 2, name: 'Colt', slot: 2, auto: false,
    damage: 34, headMult: 3, legMult: 0.75,
    fireIntervalMs: 220, magSize: 7, reloadMs: 1500, range: 120,
    spreadDeg: { stand: 0.3, move: 1.0, air: 3, crouch: 0.2 },
    recoilPitchDeg: 1.4, recoilYawDeg: 0.25, recoilRecoverDegPerSec: 10 },

  { id: 3, name: 'Rulô', slot: 2, auto: false,
    damage: 55, headMult: 2, legMult: 0.8,
    fireIntervalMs: 450, magSize: 6, reloadMs: 2600, range: 140,
    spreadDeg: { stand: 0.2, move: 1.6, air: 4, crouch: 0.15 },
    recoilPitchDeg: 3.0, recoilYawDeg: 0.4, recoilRecoverDegPerSec: 8 },
];
```

Tính cách từng súng (để chỉnh thông số sau này không lệch hướng):
- **AK47:** mạnh, giật nặng, 4 phát thân là chết, headshot 1 phát. Thưởng người kiểm soát được độ giật.
- **M16:** bắn nhanh, giật nhẹ, chính xác, nhưng cần 5 phát thân. Dễ dùng.
- **Colt:** súng phụ chuẩn, bắn nhanh vừa, băng ít đạn.
- **Rulô:** chậm, 2 phát thân chết, headshot 1 phát, giật rất mạnh, nạp đạn lâu. Súng "chơi trội".

Nghiệm thu:
- [ ] `npm test` các test cũ của weaponLogic vẫn pass (sửa test nếu nó gắn với tên/thông số cũ, không sửa logic).
- [ ] Phím 1–4 đổi đúng súng, HUD hiện đúng tên và số đạn.

---

## Âm thanh: nguyên tắc

Một phát bắn = **nhiều lớp âm phát cùng lúc**, mỗi lớp có cao độ, âm lượng, độ trễ riêng, đi qua một **EQ riêng của từng súng**, rồi vào **compressor tổng**.

| Lớp | Vai trò | Nguồn |
|---|---|---|
| `mech` | tiếng "cạch" cơ khí, khoá nòng | file |
| `body` | tiếng nổ chính | file (3–4 biến thể) |
| `thump` | lực trầm "thụp" | **tổng hợp bằng code** (không cần file) |
| `tail` | tiếng vang sau phát bắn | file |
| `shell` | vỏ đạn rơi leng keng, trễ ~300ms | file dùng chung |

Tính cách âm thanh mong muốn:

| Súng | Cảm giác | Hướng chỉnh |
|---|---|---|
| AK47 | nặng, đục, "rền" | cao độ hơi thấp, tăng bass, thump mạnh, tail vừa |
| M16 | gọn, sắc, "chát" | cao độ hơi cao, tăng treble, thump nhẹ, tail ngắn |
| Colt | chắc, "bốp" | cao độ trung bình, mid đầy, thump vừa |
| Rulô | nổ to, "đoàng", vang dài | cao độ thấp, thump rất mạnh, tail dài nhất |

---

## Task A.2 – Cấu trúc file âm thanh

Người dùng chuẩn bị file theo quy ước sau (`.ogg`, kèm `.mp3` cùng tên nếu cần hỗ trợ Safari):

```
client/public/sounds/
  guns/
    ak47/   shot_01..04.ogg  mech_01.ogg  tail_01.ogg  reload_magout.ogg  reload_magin.ogg  reload_bolt.ogg  draw.ogg
    m16/    shot_01..04.ogg  mech_01.ogg  tail_01.ogg  reload_magout.ogg  reload_magin.ogg  reload_bolt.ogg  draw.ogg
    colt/   shot_01..03.ogg  mech_01.ogg  tail_01.ogg  reload_magout.ogg  reload_magin.ogg  reload_slide.ogg draw.ogg
    rulo/   shot_01..03.ogg  tail_01.ogg  cock.ogg     reload_open.ogg    reload_eject.ogg  reload_insert.ogg reload_close.ogg draw.ogg
    (mỗi súng có thể thêm dryfire.ogg riêng; không có thì dùng common/dryfire_rifle hoặc dryfire_pistol)
  common/
    dryfire_rifle.ogg  dryfire_pistol.ogg  lowammo.ogg
    shell_rifle_01..03.ogg  shell_pistol_01..03.ogg
    hit_body_01..03.ogg  hit_head_01..02.ogg  kill.ogg  kill_head.ogg  hurt_01..03.ogg
```

**Mọi âm trong danh sách đều có bản tổng hợp dự phòng bằng code** (A.6–A.8), nên thiếu file vẫn có tiếng. Có file thì dùng file, hoặc trộn cả hai (xem từng task).

Làm:
- Loader đọc danh sách file từ profile (task A.3), **file nào thiếu thì bỏ qua lớp đó và log cảnh báo một lần**, không crash. (Để người dùng có thể thử dần từng file.)
- Kiểm tra trình duyệt hỗ trợ ogg bằng `new Audio().canPlayType('audio/ogg; codecs="vorbis"')`; không hỗ trợ thì dùng `.mp3`.

Nghiệm thu:
- [ ] Xoá tạm một file `shot_02.ogg`: game vẫn chạy, console cảnh báo đúng một lần, súng dùng các biến thể còn lại.

---

## Task A.3 – Profile âm thanh từng súng

Tạo `client/src/audio/gunProfiles.ts` (chỉ client, không đặt trong `shared/`):

```ts
export interface LayerDef {
  files: string[];        // chọn ngẫu nhiên, không lặp lại file vừa phát nếu có ≥ 2
  gainDb: number;
  pitch: number;          // playbackRate gốc
  pitchRand: number;      // ± ngẫu nhiên
  gainRandDb: number;     // ± ngẫu nhiên
  delayMs: number;
}

export interface ThumpDef {   // lớp bass tổng hợp
  gainDb: number;
  startHz: number;        // tần số đầu
  endHz: number;          // tần số cuối
  durationMs: number;
}

export interface GunSoundProfile {
  folder: string;
  layers: { body: LayerDef; mech?: LayerDef; tail?: LayerDef };
  thump: ThumpDef;
  eq: { lowShelfHz: number; lowShelfDb: number; highShelfHz: number; highShelfDb: number };
  shell: 'rifle' | 'pistol' | null;    // rulô không văng vỏ khi bắn
  shellDelayMs: number;
  reload: ReloadSoundDef;                 // xem A.6
  dryfire: { file?: string; kind: 'rifle' | 'pistol' };  // xem A.7
  draw: string;
  maxVoices: number;
}
```

Giá trị khởi điểm (chỉnh tai sau ở task A.5):

```ts
export const GUN_SOUNDS: Record<number, GunSoundProfile> = {
  0: { // AK47
    folder: 'ak47',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03','shot_04'], gainDb: 0,  pitch: 0.96, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                                gainDb: -8, pitch: 1.0,  pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                                gainDb: -6, pitch: 0.97, pitchRand: 0.03, gainRandDb: 1,   delayMs: 20 },
    },
    thump: { gainDb: -3, startHz: 110, endHz: 45, durationMs: 140 },
    eq: { lowShelfHz: 150, lowShelfDb: 4, highShelfHz: 5000, highShelfDb: -2 },
    shell: 'rifle', shellDelayMs: 320,
    reload: { kind: 'mag', steps: [
      { file: 'reload_magout', at: 0.15, synth: 'magout' },
      { file: 'reload_magin',  at: 0.55, synth: 'magin' },
      { file: 'reload_bolt',   at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 8,
  },
  1: { // M16
    folder: 'm16',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03','shot_04'], gainDb: 0,  pitch: 1.05, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                                gainDb: -6, pitch: 1.1,  pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                                gainDb: -9, pitch: 1.0,  pitchRand: 0.03, gainRandDb: 1,   delayMs: 15 },
    },
    thump: { gainDb: -8, startHz: 130, endHz: 60, durationMs: 90 },
    eq: { lowShelfHz: 150, lowShelfDb: 0, highShelfHz: 4000, highShelfDb: 3 },
    shell: 'rifle', shellDelayMs: 300,
    reload: { kind: 'mag', steps: [
      { file: 'reload_magout', at: 0.15, synth: 'magout' },
      { file: 'reload_magin',  at: 0.55, synth: 'magin' },
      { file: 'reload_bolt',   at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'rifle' },
    draw: 'draw', maxVoices: 8,
  },
  2: { // Colt
    folder: 'colt',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03'], gainDb: -1, pitch: 1.0, pitchRand: 0.04, gainRandDb: 1.5, delayMs: 0 },
      mech: { files: ['mech_01'],                     gainDb: -7, pitch: 1.0, pitchRand: 0.05, gainRandDb: 1,   delayMs: 0 },
      tail: { files: ['tail_01'],                     gainDb: -7, pitch: 1.0, pitchRand: 0.03, gainRandDb: 1,   delayMs: 20 },
    },
    thump: { gainDb: -5, startHz: 120, endHz: 55, durationMs: 110 },
    eq: { lowShelfHz: 200, lowShelfDb: 2, highShelfHz: 5000, highShelfDb: 0 },
    shell: 'pistol', shellDelayMs: 280,
    reload: { kind: 'mag', steps: [
      { file: 'reload_magout', at: 0.2,  synth: 'magout' },
      { file: 'reload_magin',  at: 0.6,  synth: 'magin' },
      { file: 'reload_slide',  at: 0.85, synth: 'bolt', emptyOnly: true },
    ] },
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 4,
  },
  3: { // Rulô
    folder: 'rulo',
    layers: {
      body: { files: ['shot_01','shot_02','shot_03'], gainDb: 1,  pitch: 0.92, pitchRand: 0.03, gainRandDb: 1, delayMs: 0 },
      tail: { files: ['tail_01'],                     gainDb: -3, pitch: 0.95, pitchRand: 0.03, gainRandDb: 1, delayMs: 25 },
    },
    thump: { gainDb: 0, startHz: 95, endHz: 38, durationMs: 200 },
    eq: { lowShelfHz: 140, lowShelfDb: 5, highShelfHz: 5000, highShelfDb: -1 },
    shell: null, shellDelayMs: 0,
    reload: { kind: 'perRound',
      open:   { file: 'reload_open',   at: 0.08, synth: 'magout' },
      eject:  { file: 'reload_eject',  at: 0.22, synth: 'shells' },
      insert: { file: 'reload_insert', from: 0.35, to: 0.8, synth: 'insert' },  // lặp theo số viên đã bắn
      close:  { file: 'reload_close',  at: 0.88, synth: 'magin' },
    },
    dryfire: { kind: 'pistol' },
    draw: 'draw', maxVoices: 4,
  },
};
```

Thêm cho Rulô: phát `cock.ogg` ở **giữa hai phát bắn** (khoảng 60% `fireIntervalMs` sau mỗi phát) cho cảm giác lên cò.

---

## Task A.4 – Đồ thị âm thanh (Web Audio)

```
mỗi lớp: AudioBufferSource ─► Gain(lớp) ─┐
thump (Oscillator)  ─► Gain(envelope) ───┼─► [bus súng] LowShelf ─► HighShelf ─► ┬─► (súng mình) ─────────────► Master
                                         │                                       └─► (người khác) Lowpass ─► Panner ─► Master
Master: Gain ─► DynamicsCompressor ─► destination
```

Làm (`client/src/audio/gunAudio.ts`):

1. **Master** (tạo một lần): `DynamicsCompressorNode` với `threshold −18dB`, `knee 6`, `ratio 4`, `attack 0.003`, `release 0.15`. Gain tổng theo setting âm lượng.
2. **Bus súng**: mỗi súng một chuỗi `BiquadFilter lowshelf` → `highshelf` tạo **một lần** theo `eq` của profile, dùng chung cho mọi phát của súng đó (của mình). Người khác: mỗi lần bắn tạo chuỗi riêng có thêm `lowpass` + `PannerNode`.
3. **Phát một lớp**: chọn file ngẫu nhiên (tránh lặp file vừa dùng), `playbackRate = pitch + rand(±pitchRand)`, gain = `dbToGain(gainDb + rand(±gainRandDb))`, `start(ctx.currentTime + delayMs/1000)`.
4. **Thump tổng hợp**:
   ```ts
   function playThump(ctx: AudioContext, dest: AudioNode, t: ThumpDef, when: number) {
     const osc = ctx.createOscillator();
     const g = ctx.createGain();
     osc.type = 'sine';
     osc.frequency.setValueAtTime(t.startHz, when);
     osc.frequency.exponentialRampToValueAtTime(t.endHz, when + t.durationMs / 1000);
     const peak = dbToGain(t.gainDb);
     g.gain.setValueAtTime(0.0001, when);
     g.gain.exponentialRampToValueAtTime(peak, when + 0.004);
     g.gain.exponentialRampToValueAtTime(0.0001, when + t.durationMs / 1000);
     osc.connect(g).connect(dest);
     osc.start(when);
     osc.stop(when + t.durationMs / 1000 + 0.02);
   }
   ```
5. **Giới hạn số tiếng**: mỗi súng giữ danh sách source đang phát; vượt `maxVoices` thì dừng source cũ nhất (fade 10ms, không cắt cụt).
6. **Vỏ đạn**: sau `shellDelayMs`, phát file `shell_rifle_*`/`shell_pistol_*` ngẫu nhiên, gain −14dB, chỉ cho súng của mình và người khác trong 15m.
7. **Reload**: làm ở task A.6.
8. **Hết đạn**: làm ở task A.7.
9. **Súng người khác (từ ShotFx, phase 4)**:
   - `PannerNode`: `panningModel 'equalpower'`, `distanceModel 'inverse'`, `refDistance 4`, `rolloffFactor 1.2`, vị trí = `origin` của phát bắn. Listener cập nhật theo camera mỗi frame.
   - `lowpass` cutoff theo khoảng cách `d`: `cutoff = 18000 * Math.pow(0.5, d / 15)`, kẹp tối thiểu 1500Hz (càng xa càng đục).
   - Không phát lớp `mech` cho người khác (tiếng cơ khí chỉ nghe được ở gần tay).
   - `tail` của người khác to hơn 3dB so với của mình (ở xa nghe vang nhiều hơn tiếng nổ).

10. **Bộ âm tổng hợp** `client/src/audio/synth.ts`, dùng cho thump và các âm dự phòng ở A.6–A.8:
    - Tạo **một lần** một `AudioBuffer` tiếng ồn trắng dài 1 giây; mọi âm "noise burst" dùng lại buffer này (đặt `offset` ngẫu nhiên khi `start`).
    - Hàm chung:
      ```ts
      tone(dest, { type, freq, freqEnd?, gainDb, attackMs, decayMs, when })
      noise(dest, { filter: 'bandpass' | 'highpass' | 'lowpass', freq, q, gainDb, attackMs, decayMs, when })
      ```
    - Mọi envelope dùng `exponentialRampToValueAtTime` từ/đến 0.0001.

Nghiệm thu:
- [ ] Nhắm mắt nghe, phân biệt được 4 súng.
- [ ] Xả AK47 hết băng: không rè, không vỡ tiếng, không bị cắt tiếng giữa chừng.
- [ ] Mở 8 bot/tab cùng xả súng: không méo tiếng (compressor hoạt động), FPS không tụt.
- [ ] Tiếng súng người khác ở xa 50m nghe đục và nhỏ, ở gần 3m nghe rõ; quay đầu nghe được hướng trái/phải.
- [ ] Đổi súng giữa lúc reload: tiếng reload dừng ngay.
- [ ] Rulô có tiếng lên cò giữa 2 phát.

Pitfall:
- `exponentialRampToValueAtTime` **không chấp nhận giá trị 0**, dùng 0.0001.
- Không tạo mới `BiquadFilter` cho mỗi phát của chính mình (dùng bus chung), chỉ tạo mới cho súng người khác vì mỗi phát có vị trí khác nhau.
- `AudioBufferSourceNode` dùng xong một lần là bỏ, nhớ `disconnect()` trong `onended` để không rò bộ nhớ.
- Thời điểm phát dùng `ctx.currentTime`, không dùng `setTimeout` cho các lớp trong cùng một phát (lệch nhịp nghe ra ngay). `setTimeout` chỉ được dùng để lên lịch vỏ đạn và reload.

---

## Task A.5 – Bảng chỉnh tiếng (F8)

Làm:
- Phím F8 mở panel: chọn súng, slider cho mọi trường trong profile (gain, pitch, rand từng lớp; thump; EQ; tail delay).
- Nút **"Bắn thử"** (phát 1 phát) và **"Xả 1 giây"** (phát theo `fireIntervalMs` trong 1 giây) để nghe ngay khi chỉnh, không cần vào game bắn.
- Nút **"Copy JSON"** xuất profile hiện tại để dán vào `gunProfiles.ts`.
- Thanh đo mức âm (peak meter) ở đầu ra master: dùng `AnalyserNode`, hiện đỏ nếu vượt −1dBFS.

Nghiệm thu:
- [ ] Kéo slider thump của AK47 lên, bấm "Bắn thử": nghe khác ngay.
- [ ] Copy JSON dán vào code, reload trang: âm thanh giữ đúng như lúc chỉnh.


## Task A.6 – Tiếng nạp đạn

### A.6.1 Nạp đạn nhanh vs nạp đạn rỗng (đổi logic trong `shared/`)

Thêm vào `WeaponDef`: `reloadEmptyMs` (nạp khi đã bắn hết, phải kéo khoá nòng nên lâu hơn). `reloadMs` hiện tại thành nạp nhanh (còn đạn trong băng).

| Súng | reloadMs (còn đạn) | reloadEmptyMs (hết đạn) |
|---|---|---|
| AK47 | 2000 | 2600 |
| M16 | 1800 | 2300 |
| Colt | 1300 | 1700 |
| Rulô | 2600 | 2600 (nạp theo viên, xem dưới) |

- `WeaponState` thêm `reloadEmpty: boolean` (ghi lại lúc bắt đầu nạp là loại nào).
- Đây là logic **shared**, client và server dùng chung. Cập nhật test của `weaponLogic`: nạp khi còn 5 viên mất `reloadMs`, nạp khi 0 viên mất `reloadEmptyMs`.

### A.6.2 Âm thanh

```ts
type ReloadSynth = 'magout' | 'magin' | 'bolt' | 'shells' | 'insert';
interface ReloadStep { file: string; at: number; synth: ReloadSynth; emptyOnly?: boolean }
type ReloadSoundDef =
  | { kind: 'mag'; steps: ReloadStep[] }
  | { kind: 'perRound';
      open: ReloadStep; eject: ReloadStep; close: ReloadStep;
      insert: { file: string; from: number; to: number; synth: ReloadSynth } };
```

- `at` là tỉ lệ 0..1 của **thời gian nạp thực tế** (`reloadMs` hoặc `reloadEmptyMs` tuỳ loại).
- Bước có `emptyOnly: true` (kéo khoá nòng) chỉ phát khi nạp rỗng.
- **Rulô** (`perRound`): số viên cần nạp `n = magSize − ammo`. Phát `insert` đúng `n` lần, rải đều trong khoảng `from..to`. Mỗi lần lệch cao độ ±4% để không giống tiếng máy. Bắn 1 viên rồi nạp → nghe 1 tiếng nhét đạn; bắn hết 6 → nghe 6 tiếng.
- Lên lịch bằng `setTimeout` lúc bắt đầu nạp, giữ danh sách id; reload bị huỷ (đổi súng, chết) → `clearTimeout` hết và dừng mọi source reload đang phát (fade 20ms).
- Âm reload của **chính mình**: −4dB, không qua EQ của súng (đi thẳng vào master). Của **người khác**: chỉ phát nếu trong 12m, qua panner, −10dB (để nghe được "thằng kia đang nạp đạn" khi đứng gần).

Âm tổng hợp dự phòng (khi thiếu file):

| synth | Cách tạo |
|---|---|
| `magout` | noise bandpass 1800Hz q=3, decay 40ms, −10dB + tone sine 320→220Hz decay 60ms, −14dB |
| `magin` | hai cú "cạch": noise bandpass 2500Hz q=4 decay 25ms −8dB tại t và t+45ms; thêm tone sine 180Hz decay 70ms −12dB tại t+45ms |
| `bolt` | noise bandpass quét 1200→3500Hz trong 90ms (kéo) −12dB, rồi noise bandpass 3000Hz q=5 decay 30ms −6dB tại t+120ms (thả) |
| `shells` | 6 cú tone sine ngẫu nhiên 3500–5200Hz, decay 80ms, −18dB, rải ngẫu nhiên trong 250ms (vỏ đạn rơi) |
| `insert` | noise bandpass 2800Hz q=6 decay 20ms −10dB + tone sine 1400Hz decay 35ms −16dB |

Nghiệm thu:
- [ ] AK47 bắn 10 viên rồi R: nghe tháo băng, lắp băng, **không** có kéo khoá nòng; HUD đầy đạn đúng lúc 2,0s.
- [ ] AK47 bắn hết băng: tự nạp, có kéo khoá nòng, mất 2,6s.
- [ ] Rulô bắn 2 viên rồi R: nghe đúng 2 tiếng nhét đạn. Bắn hết 6: nghe 6 tiếng.
- [ ] Đang nạp thì đổi súng: im ngay, không còn tiếng sót.
- [ ] Xoá hết file reload: vẫn nghe tiếng tổng hợp, phân biệt được các bước.

---

## Task A.7 – Tiếng "cạch" hết đạn + cảnh báo sắp hết

### Hết đạn (dry fire)

- Phát khi **bấm cò** lúc băng rỗng (cạnh lên của chuột trái), một lần mỗi lần bấm. Giữ chuột không phát lặp.
- Ngay sau đó tự động nạp đạn (logic sẵn có ở task 2.3) — nghĩa là người chơi nghe "cạch" rồi tới tiếng tháo băng, đúng như ngoài đời.
- Nếu không còn tự nạp (ví dụ sau này có chế độ hết đạn dự trữ) thì mỗi lần bấm đều "cạch".
- File: `guns/<súng>/dryfire.ogg` nếu có, không thì `common/dryfire_rifle|pistol.ogg`, không có nữa thì tổng hợp:
  - Rifle: noise highpass 2500Hz decay 15ms −6dB + tone square 1100Hz decay 25ms −18dB (cạch khô, kim loại nặng).
  - Pistol: noise highpass 3500Hz decay 10ms −6dB + tone square 1700Hz decay 18ms −18dB (tách nhỏ, gọn hơn).
- Chỉ phát cho chính mình, không gửi lên mạng.

### Cảnh báo sắp hết đạn

- Khi bắn mà số đạn còn lại ≤ 25% băng: phát thêm một tiếng "tink" nhỏ **cùng lúc** với phát bắn, cao độ tăng dần khi đạn càng ít:
  `pitchFactor = 1 + 0.6 * (1 − ammoLeft / (magSize * 0.25))`
- File `common/lowammo.ogg`, không có thì tổng hợp: tone sine 2600Hz × `pitchFactor`, decay 60ms, −20dB.
- Viên cuối cùng: tiếng "tink" to hơn 4dB (báo sắp nghe "cạch").
- Rulô (6 viên): bật cảnh báo từ viên thứ 5.
- Có setting bật/tắt (mặc định bật).

Nghiệm thu:
- [ ] Giữ chuột xả AK47 tới hết: 8 viên cuối nghe "tink" cao dần, viên cuối rõ hơn, rồi "cạch", rồi tiếng nạp đạn.
- [ ] Bấm chuột liên tục khi đang nạp đạn: không phát "cạch" (đang nạp không phải băng rỗng).
- [ ] Rifle và pistol "cạch" nghe khác nhau.

---

## Task A.8 – Tiếng bắn trúng (hitmarker), hạ gục, bị trúng

Mục tiêu: trúng đạn phải nghe **giòn, rõ, có độ "ngọt"**, headshot nghe khác hẳn, hạ gục có tiếng "chốt" riêng. Tất cả phát từ `HitConfirm`/`Kill` của server (task 4.5), không đoán trước.

### Cấu tạo âm (tổng hợp, dùng làm mặc định)

| Sự kiện | Lớp | Thông số |
|---|---|---|
| **Trúng thân** | "tách" giòn | noise bandpass 3200Hz q=2, attack 1ms, decay 30ms, −6dB |
|  | thân âm | tone triangle 1250Hz, decay 70ms, −12dB |
|  | độ dày | tone sine 220→120Hz, decay 60ms, −14dB |
| **Trúng đầu** | như trúng thân, cộng thêm: | |
|  | "ting" kim loại | 3 tone sine 2100Hz, 2100×2,76Hz, 2100×5,4Hz (tỉ lệ chuông), gain −10/−16/−22dB, decay 380/250/150ms |
|  | "tách" sắc hơn | noise bandpass tăng lên 4500Hz |
| **Hạ gục** | "thụp" chốt | tone sine 160→55Hz, decay 180ms, −6dB |
|  | 2 nốt đi lên | tone triangle 880Hz decay 120ms −12dB tại t; 1320Hz decay 220ms −12dB tại t+70ms |
| **Hạ gục bằng headshot** | hạ gục + "ting" của trúng đầu, nốt thứ hai đổi thành 1760Hz | |

Nếu có file (`hit_body_*`, `hit_head_*`, `kill`, `kill_head`): profile có tuỳ chọn `mode: 'file' | 'synth' | 'both'` cho từng sự kiện. Mặc định `'both'` khi có file: phát file + lớp "độ dày" tổng hợp (file trên mạng thường mỏng, thiếu bass — đó là lý do nghe "tịt tịt").

### Làm cho "ngọt"

- **Combo cao độ:** trúng liên tiếp trong vòng 400ms thì mỗi lần cao độ tăng 3% (tối đa +15%), quá 400ms không trúng thì về lại. Xả AK trúng liên tục nghe "tách tách tách" leo dần, rất sướng tai.
- **Không chồng tiếng:** nhiều HitConfirm đến trong cùng 30ms (bắn trúng nhiều người, hoặc gói mạng dồn) → chỉ phát 1 lần, lấy sự kiện "nặng" nhất (kill > head > body).
- **Ngẫu nhiên nhẹ:** cao độ ±2%, gain ±1dB mỗi lần.
- **Đi thẳng vào master**, không qua EQ súng, không qua panner (là âm giao diện, luôn nghe rõ ở giữa).
- **Ducking:** lúc phát tiếng hạ gục, hạ âm lượng tiếng súng của chính mình −4dB trong 150ms rồi trả lại (dùng một `GainNode` riêng cho nhóm tiếng súng), để tiếng "chốt" nổi bật.
- Hitmarker hình và tiếng phải cùng một khung hình.

### Bị trúng (phía nạn nhân)

- Nạn nhân nghe tiếng "phập" trầm: noise lowpass 900Hz decay 80ms −8dB + tone sine 140→70Hz decay 120ms −10dB, phát từ hướng đạn đến (panner đặt cách người chơi 1m theo hướng người bắn).
- File `hurt_*` nếu có thì thay lớp noise.
- Máu dưới 30: thêm tiếng tim đập nhỏ lặp (tone sine 55Hz, 2 nhịp mỗi 0,9s, −20dB) đến khi hồi sinh. Có setting tắt.

### Bảng chỉnh F8 (bổ sung vào A.5)

- Tab "Hit": slider cho từng lớp của trúng thân, trúng đầu, hạ gục; nút "Thử trúng thân", "Thử trúng đầu", "Thử combo 6 phát", "Thử hạ gục", "Thử hạ gục headshot"; chọn `mode` file/synth/both.

Nghiệm thu:
- [ ] Nhắm mắt nghe phân biệt được: trúng thân, trúng đầu, hạ gục, hạ gục headshot.
- [ ] Xả AK trúng liên tục vào bia: tiếng leo cao dần, dừng 0,5s rồi bắn lại thì về cao độ gốc.
- [ ] Bắn 1 viên trúng 2 người đứng thẳng hàng (nếu đạn xuyên) hoặc trúng dồn: chỉ nghe 1 tiếng.
- [ ] Không có file nào: vẫn nghe giòn, có bass, không "tịt tịt".
- [ ] Nạn nhân nghe tiếng bị trúng từ đúng hướng người bắn.

---

## Ghi chú cho người dùng

- Chưa có file nào cũng chạy được: thump là âm tổng hợp, nên chỉ cần mỗi file `shot_01` là đã nghe có lực.
- Ưu tiên tìm file theo thứ tự: `shot` (quan trọng nhất) → `tail` → `reload` → `mech` → `shell`. Tiếng trúng, hết đạn, cảnh báo sắp hết thì bản tổng hợp đã khá ổn, có file đẹp mới thay.
- Từ khoá tìm trên freesound/OpenGameArt: `rifle magazine reload`, `pistol slide`, `revolver cylinder`, `bullet insert`, `gun dry fire click`, `hitmarker`, `bullet impact flesh`, `metal ping`.
- Chỉnh tai bằng F8 khi đeo tai nghe **và** khi nghe loa laptop, vì bass nghe tai nghe thấy đã nhưng loa laptop có thể mất hết.
