import { HITBOX_HISTORY_MS, TICK_RATE } from '@fps/shared'

const MAX_SLOTS = 32   // người chơi tối đa lưu trong mỗi mục lịch sử
const CAPACITY = Math.ceil(HITBOX_HISTORY_MS * TICK_RATE / 1000) + 2

interface Entry {
  time: number
  count: number
  ids: Int32Array
  pos: Float64Array        // 3 số mỗi người
  crouching: Uint8Array
  alive: Uint8Array
}

export interface PastPlayer {
  pos: [number, number, number]
  crouching: boolean
  alive: boolean
}

// Lịch sử vị trí để tua đối thủ về quá khứ (lag compensation). Ring buffer cấp phát sẵn;
// mỗi mục lưu theo serverTime của tick (không phải thời điểm gửi snapshot).
export class LagHistory {
  private entries: Entry[] = []
  private head = -1        // mục mới nhất
  private size = 0
  // Kết quả của locate()
  private a: Entry | null = null
  private b: Entry | null = null
  private alpha = 0

  constructor() {
    for (let i = 0; i < CAPACITY; i++) {
      this.entries.push({
        time: 0, count: 0, ids: new Int32Array(MAX_SLOTS), pos: new Float64Array(MAX_SLOTS * 3),
        crouching: new Uint8Array(MAX_SLOTS), alive: new Uint8Array(MAX_SLOTS),
      })
    }
  }

  get newestTime(): number { return this.size > 0 ? this.entries[this.head]!.time : -Infinity }
  get oldestTime(): number { return this.size > 0 ? this.entries[(this.head - this.size + 1 + CAPACITY) % CAPACITY]!.time : Infinity }

  // Gọi một lần mỗi tick, sau khi mô phỏng
  record(time: number, players: Iterable<{ id: number; state: { pos: readonly number[]; crouching: boolean }; alive: boolean }>): void {
    this.head = (this.head + 1) % CAPACITY
    if (this.size < CAPACITY) this.size++
    const e = this.entries[this.head]!
    e.time = time
    let n = 0
    for (const p of players) {
      if (n >= MAX_SLOTS) break
      e.ids[n] = p.id
      e.pos[n * 3] = p.state.pos[0]!; e.pos[n * 3 + 1] = p.state.pos[1]!; e.pos[n * 3 + 2] = p.state.pos[2]!
      e.crouching[n] = p.state.crouching ? 1 : 0
      e.alive[n] = p.alive ? 1 : 0
      n++
    }
    e.count = n
  }

  // Tìm hai mục kẹp thời điểm t. Trả false nếu chưa có lịch sử.
  // t sớm hơn mục cũ nhất thì dùng mục cũ nhất; muộn hơn mục mới nhất thì dùng mục mới nhất.
  locate(t: number): boolean {
    if (this.size === 0) return false
    const newest = this.entries[this.head]!
    if (t >= newest.time) { this.a = this.b = newest; this.alpha = 0; return true }
    for (let k = 0; k < this.size - 1; k++) {
      const hi = this.entries[(this.head - k + CAPACITY) % CAPACITY]!
      const lo = this.entries[(this.head - k - 1 + CAPACITY) % CAPACITY]!
      if (lo.time <= t) {
        this.a = lo; this.b = hi
        this.alpha = hi.time > lo.time ? (t - lo.time) / (hi.time - lo.time) : 0
        return true
      }
    }
    const oldest = this.entries[(this.head - this.size + 1 + CAPACITY) % CAPACITY]!
    this.a = this.b = oldest; this.alpha = 0
    return true
  }

  // Vị trí `id` tại thời điểm đã locate(). Nội suy tuyến tính pos như client; crouching/alive theo mục trước.
  // Không có người đó trong lịch sử (mới vào) → false.
  get(id: number, out: PastPlayer): boolean {
    const a = this.a, b = this.b
    if (!a || !b) return false
    const ia = indexOf(a, id)
    if (ia < 0) return false
    const ib = a === b ? ia : indexOf(b, id)
    const k = ib < 0 ? 0 : this.alpha
    const jb = ib < 0 ? ia : ib
    for (let i = 0; i < 3; i++) out.pos[i] = a.pos[ia * 3 + i]! + (b.pos[jb * 3 + i]! - a.pos[ia * 3 + i]!) * k
    out.crouching = a.crouching[ia] === 1
    out.alive = a.alive[ia] === 1
    return true
  }
}

function indexOf(e: Entry, id: number): number {
  for (let i = 0; i < e.count; i++) if (e.ids[i] === id) return i
  return -1
}
