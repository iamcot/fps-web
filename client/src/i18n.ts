import { CATEGORY_LABEL, MODE_LABEL, MODE_DESC, TEAMS, type GameMode, type TeamId, type WeaponCategory } from '@fps/shared'

// Đa ngôn ngữ: chuỗi tiếng Anh là khoá (cũng là bản mặc định), `VI` dịch sang tiếng Việt. Thiếu bản dịch thì hiện tiếng Anh.
// Tham số dạng {name}. Đổi ngôn ngữ = lưu rồi tải lại trang (các hằng số cấp module nên cố định theo lúc nạp).
export type Lang = 'en' | 'vi'
export const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'vi', label: 'Tiếng Việt' }]
const LANG_KEY = 'fps.lang'

function loadLang(): Lang {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'vi') return v } catch { /* bỏ qua */ }
  return 'en'
}
let lang: Lang = loadLang()
try { document.documentElement.lang = lang } catch { /* không có DOM (test) */ }
export function getLang(): Lang { return lang }
/** Lưu ngôn ngữ; gọi location.reload() sau đó để mọi chuỗi cấp module nạp lại */
export function saveLang(l: Lang): void { lang = l; try { localStorage.setItem(LANG_KEY, l) } catch { /* bỏ qua */ } }

const VI: Record<string, string> = {
  // Lobby / name page
  'Your name': 'Tên của bạn', 'Enter your name': 'Nhập tên của bạn', 'Enter your name first': 'Nhập tên trước đã',
  'Enter': 'Vào', 'Play offline': 'Chơi offline', 'NETWORK': 'MẠNG', 'LOCAL': 'MÁY NÀY',
  'Connect to the server, then pick or create a room to play with other people.': 'Kết nối server, rồi chọn hoặc tạo phòng để chơi với người khác.',
  'Play on this device against bots. No server needed.': 'Chơi trên máy này với bot. Không cần server.',
  'Connecting…': 'Đang kết nối…', 'Could not connect to the server': 'Không kết nối được server', 'Starting offline game…': 'Đang khởi động offline…',
  'Credits': 'Ghi công', 'Close': 'Đóng', 'Change name': 'Đổi tên', 'Rooms — {name}': 'Phòng đang chơi — {name}',
  'No rooms yet. Create one below.': 'Chưa có phòng nào. Hãy tạo phòng mới ở bên dưới.', 'Create room': 'Tạo phòng', 'Create': 'Tạo', 'Cancel': 'Hủy',
  'Room name': 'Tên phòng', 'Enter a room name': 'Nhập tên phòng', 'Joining room…': 'Đang vào phòng…', 'Join': 'Vào phòng', 'Full': 'Đầy',
  'Team: auto': 'Phe: tự động', 'Team: {team}': 'Phe: {team}', 'Characters: {name}': 'Nhân vật: {name}', 'Map: {name}': 'Map: {name}', 'Max {n} players': 'Tối đa {n} người',
  '{n} players': '{n} người chơi', 'Reset': 'Mặc định', 'Player': 'Người chơi',
  'Rounds to win': 'Số ván thắng', 'Seconds per round': 'Giây mỗi ván', 'Kill limit': 'Giới hạn mạng', 'Minutes per match': 'Phút mỗi trận', 'Rounds': 'Số ván', 'Waves': 'Số đợt', 'Seconds between waves': 'Giây nghỉ giữa đợt',
  'Lighting': 'Ánh sáng', 'Night': 'Ban đêm', 'Day': 'Ban ngày', 'Difficulty': 'Độ khó', 'Easy': 'Dễ', 'Normal': 'Thường', 'Hard': 'Khó',
  'Game version mismatch, reload the page (Ctrl+F5)': 'Phiên bản game không khớp, tải lại trang (Ctrl+F5)', 'Room is full': 'Phòng đã đầy', 'Room name already taken': 'Tên phòng đã có người dùng',
  'Room no longer exists': 'Phòng không còn nữa', 'Invalid name or room name': 'Tên hoặc tên phòng không hợp lệ', 'Could not join': 'Không vào được',
  'Joined room "{room}" as #{id}': 'Vào phòng "{room}" với id {id}', '{name} (#{id}) joined': '{name} (#{id}) vào', '{name} left': '{name} đã rời',
  'Server closed the connection': 'Server đóng kết nối', 'Lost connection to server': 'Mất kết nối server', 'Lost connection to server — reload the page': 'Mất kết nối server — tải lại trang',
  'Offline worker failed to start': 'Worker offline không khởi động được', 'Offline worker error': 'Worker offline lỗi',
  // Modes, teams, weapons, zombies
  'Elimination': 'Sinh Tử', 'Team Deathmatch': 'Hỗn Chiến', 'Infection': 'Lây Nhiễm', 'Defense': 'Thủ Thành', 'Melee': 'Cận Chiến',
  'One life per round. First to win 10 rounds.': 'Mỗi ván một mạng. Thắng 10 ván trước.',
  'Continuous respawns. First to 50 kills, or when time runs out.': 'Hồi sinh liên tục. Bắn tới 50 mạng hoặc hết giờ.',
  'The mother zombie infects the room. Survive until time runs out to win.': 'Zombie mẹ lây nhiễm cả phòng. Trụ tới hết giờ để thắng.',
  'Hold the base against 10 zombie waves. The last wave has a boss.': 'Cả đội giữ thành chống 10 đợt zombie, đợt cuối có boss.',
  'Knives only. Team fight with combos, blocks and parries. Continuous respawns.': 'Chỉ dùng dao. Đánh theo đội bằng combo, đỡ và parry. Hồi sinh liên tục.',
  'Cops': 'Cớm', 'Robbers': 'Cướp',
  'Claw': 'Vuốt', 'Knife': 'Dao', 'Hammer': 'Búa', 'Machete': 'Mã tấu', 'Spear': 'Thương', 'Staff': 'Gậy', 'Pistol': 'Súng ngắn', 'Mid-range': 'Súng vừa', 'Long gun': 'Súng dài', 'Grenade': 'Lựu đạn', 'Revolver': 'Rulô',
  'Walker': 'Zombie thường', 'Runner': 'Zombie chạy', 'Crawler': 'Zombie bò', 'Leaper': 'Zombie nhảy', 'Brute': 'Zombie trâu', 'Screamer': 'Zombie gào', 'Zombie Boss': 'Đại Ca Zombie', 'Mother zombie': 'Zombie mẹ',
  'Cops & Robbers': 'Cớm & Cướp', 'Desert Storm': 'Bão Cát Sa Mạc', 'Robot (blocky)': 'Robot (khối hộp)',
  // Room status (từ server)
  'Waiting': 'Đang chờ', 'Ended': 'Kết thúc', 'Get ready': 'Chuẩn bị', '{t} left · {a}–{b}': 'Còn {t} · {a}–{b}', 'Round {r}/{m} · {a}–{b}': 'Ván {r}/{m} · {a}–{b}',
  'Wave {w}/{m} · {n} players': 'Đợt {w}/{m} · {n} người', 'Round {r}/{m} · {h} humans – {z} zombies': 'Ván {r}/{m} · {h} người – {z} zombie',
  // HUD
  'Scoreboard (TAB)': 'Xem thành tích (TAB)', 'Switch team (~)': 'Đổi phe (~)', 'Confirm (Enter)': 'Đồng ý (Enter)', 'Cancel (Esc)': 'Hủy (Esc)', 'Back to lobby': 'Về phòng chờ', 'Copy link': 'Sao chép link',
  'Click to play': 'Click để chơi', '+ Easy bot ([)': '+ Bot ngu ([)', '+ Hard bot (])': '+ Bot khôn (])', 'Clear bots (\\)': 'Xóa bot (\\)', 'No bots': 'Chưa có bot', 'Bot: ': 'Bot: ',
  'Killed by {name}': 'Bị {name} hạ', 'You died': 'Bạn đã chết', 'Respawn in {s}s': 'Hồi sinh sau {s}s', 'BOUNTY! Killed {name} (streak {n})': 'TRUY NÃ! Hạ {name} (chuỗi {n})',
  'No teammates left to watch': 'Không còn đồng đội để xem', 'Watching: {name}   ♥ {hp}   (Click / Space: next player)': 'Đang xem: {name}   ♥ {hp}   (Click / Space: đổi người)',
  'SHOP': 'CỬA HÀNG', 'You can carry one gun per slot. Buying into a taken slot sells your current gun ({pct}%).\nMax {n} grenades, not refundable.': 'Mỗi dòng súng chỉ mang được 1 loại. Mua trùng dòng sẽ tự bán súng đang có ({pct}%).\nLựu đạn tối đa {n} quả, không bán lại.',
  'In use': 'Đang dùng', 'Full ({c}/{m})': 'Đã đủ ({c}/{m})', 'sell {old} +${refund} · {verb} ${amt}': 'bán {old} +${refund} · {verb} ${amt}', 'pay': 'trả', 'get': 'nhận', '{old} is a starter weapon, no refund': '{old} cấp sẵn, không bán lại',
  'Back to the lobby? You will leave this match.': 'Về phòng chờ? Bạn sẽ rời trận này.', 'Switch to {team}? Bots switch sides too.': 'Đổi sang phe {team}? Bot cũng đổi phe theo.', 'Switch to {team}?': 'Đổi sang phe {team}?',
  'Switched to {team}': 'Đã sang phe {team}', 'Cannot switch: the other team is larger': 'Không đổi được: phe kia đã đông hơn', 'You were moved to {team} to balance the teams': 'Bạn được chuyển sang phe {team} để cân bằng',
  'Room link copied': 'Đã sao chép link phòng', 'Quick switch': 'Đổi súng nhanh', 'Reload': 'Thay đạn', 'Flashlight': 'Bật tắt đèn', 'Revive teammate': 'Cứu đồng đội', 'G: pick up {name}': 'G: nhặt {name}', 'Pick up / drop weapon': 'Nhặt / vứt vũ khí',
  'Offline · {map} · {mode}': 'Offline · {map} · {mode}',
  '{team} WIN': '{team} THẮNG', 'DRAW': 'HOÀ', '{team} WIN ROUND {r}': '{team} THẮNG VÁN {r}', 'ROUND DRAW': 'VÁN HOÀ', '{team} WIN THE MATCH': '{team} THẮNG TRẬN',
  'Team eliminated': 'Tiêu diệt toàn bộ', 'Time up · more players alive': 'Hết giờ · còn nhiều người hơn', 'Time up · more health left': 'Hết giờ · còn nhiều máu hơn', 'Both teams wiped out': 'Hai bên cùng hạ gục',
  'Zombies infected everyone': 'Zombie đã lây nhiễm tất cả', 'Time up · humans survived': 'Hết giờ · còn người sống sót',
  'Waiting for more players…': 'Chờ thêm người chơi…', 'Sides swapped': 'Đã đổi bên', 'ROUND {r}': 'VÁN {r}', 'Buy weapons: B': 'Mua súng: B', 'Break': 'Nghỉ', 'HALF TIME · SWITCH SIDES': 'HẾT HIỆP 1 · ĐỔI BÊN',
  'New match in {t}': 'Trận mới sau {t}', 'Match over': 'Hết trận', 'Round {r} / {m}': 'Ván {r} / {m}', 'No limit': 'Không giới hạn', 'Target: {n} kills': 'Mục tiêu: {n} mạng',
  'Name': 'Tên', 'Points': 'Điểm', 'Infected': 'Lây', 'Zombie kills': 'Hạ ZB', 'Role': 'Vai', 'Damage': 'Sát thương', 'Revives': 'Cứu',
  'Leap': 'Nhảy', 'Sniff': 'Đánh hơi', '👃 A zombie sniffed you!': '👃 Bạn bị zombie đánh hơi!', 'Waiting for players (need 3)…': 'Chờ thêm người (cần 3)…',
  'Zombies arrive in {t}': 'Zombie xuất hiện sau {t}', 'Buy weapons anywhere · B': 'Mua súng ở bất cứ đâu · B', 'HUMANS WIN': 'NGƯỜI THẮNG', 'ZOMBIES WIN': 'ZOMBIE THẮNG', 'MATCH OVER': 'KẾT THÚC TRẬN',
  'Most points: {name}': 'Nhiều điểm nhất: {name}', 'Waiting for players…': 'Chờ người chơi…', 'Get ready · {s}': 'Chuẩn bị · {s}', 'Zombies in {s}': 'Zombie tới sau {s}', 'Buy weapons in the buy zone · B': 'Mua súng ở khu mua · B',
  'WAVE {w} / {m}  ·  {n} zombies left': 'ĐỢT {w} / {m}  ·  Còn {n} zombie', 'Next wave in {s}': 'Đợt tiếp theo sau {s}', 'VICTORY!': 'THẮNG!', 'WAVE {w} CLEARED · +${b}': 'HẾT ĐỢT {w} · +${b}',
  'THE MOTHER ZOMBIE HAS APPEARED': 'ZOMBIE MẸ ĐÃ XUẤT HIỆN', 'You are the mother zombie! Infect everyone': 'Bạn là zombie mẹ! Lây nhiễm tất cả', 'YOU WERE INFECTED!': 'BẠN ĐÃ BỊ LÂY NHIỄM!', '{name} WAS INFECTED': '{name} ĐÃ BỊ LÂY NHIỄM',
  'YOU ARE THE LAST ONE STANDING – HERO!': 'BẠN LÀ NGƯỜI CUỐI CÙNG – ANH HÙNG!', '{name} IS THE LAST ONE STANDING – HERO!': '{name} LÀ NGƯỜI CUỐI CÙNG – ANH HÙNG!',
  'DEFENSE SUCCEEDED!': 'THỦ THÀNH THÀNH CÔNG!', 'LOST AT WAVE {w}': 'THUA Ở ĐỢT {w}', 'ZOMBIE BOSS': 'ĐẠI CA ZOMBIE', 'Hold E to revive {name}': 'Giữ E để cứu {name}',
  'YOU ARE DOWN · waiting for a teammate ({s}s)': 'BẠN ĐÃ GỤC · chờ đồng đội cứu ({s}s)',
}

/** Dịch `key` (tiếng Anh) sang ngôn ngữ hiện tại; `{x}` được thay bằng params.x */
export const tr = t
export function t(key: string, params?: Record<string, string | number>): string {
  let s = lang === 'vi' ? VI[key] ?? key : key
  if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]))
  return s
}

export const teamName = (id: TeamId): string => t(TEAMS[id].name)
export const modeLabel = (m: GameMode): string => t(MODE_LABEL[m])
export const modeDesc = (m: GameMode): string => t(MODE_DESC[m])
export const categoryLabel = (c: WeaponCategory): string => t(CATEGORY_LABEL[c])

// Trạng thái phòng do server gửi bằng tiếng Anh ("Round 2/5 · 3–1"): khớp với các khuôn có tham số rồi dịch
const STATUS_PATTERNS: { re: RegExp; key: string; names: string[] }[] = Object.keys(VI).filter(k => k.includes('{') && /^(Round|Wave|\{t\} left)/.test(k))
  .sort((a, b) => b.length - a.length).map(key => {
  const names: string[] = []
  const src = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_, n) => { names.push(n); return '(.+?)' })
  return { re: new RegExp(`^${src}$`), key, names }
})
export function statusText(raw: string): string {
  if (lang === 'en') return raw
  for (const p of STATUS_PATTERNS) {
    const m = p.re.exec(raw)
    if (m) return t(p.key, Object.fromEntries(p.names.map((n, i) => [n, m[i + 1]!])))
  }
  return t(raw)
}
