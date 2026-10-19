import { INTERP_DELAY_MS, lerp, lerpAngle, type NetPlayer } from '@fps/shared'

const BUFFER_MS = 1000       // giữ ~1 giây snapshot mỗi người
const STALE_MS = 250         // quá mốc này không có snapshot mới thì coi là đứng yên (không ngoại suy)

interface Entry {
  serverTime: number
  pos: [number, number, number]
  yaw: number
  pitch: number
  flags: number
}

// Trạng thái đã nội suy, tái sử dụng mỗi frame (không cấp phát)
export interface InterpPlayer {
  id: number
  pos: [number, number, number]
  yaw: number
  pitch: number
  flags: number
  stale: boolean   // snapshot cuối đã cũ hơn STALE_MS so với renderTime
}

// Phase 4 dùng khi bắn: thời điểm server mà người chơi đang "nhìn thấy" ở frame này
export const interp = { currentRenderTime: 0, delayMs: INTERP_DELAY_MS }

const MAX_ONE_WAY_MS = 250
const DELAY_SLEW_MS_PER_FRAME = 1

// serverNow ước lượng giờ thật của server, còn snapshot đến muộn thêm trễ một chiều. Nếu chỉ lùi
// INTERP_DELAY_MS cố định thì ping cao sẽ không còn snapshot "b" để nội suy. Nên lùi thêm đúng
// bằng trễ một chiều. Đổi delay từ từ (≤1ms/frame) để người khác không bị trượt/nhảy.
export class InterpDelay {
  private _value = INTERP_DELAY_MS
  private started = false

  get value(): number { return this._value }

  // Gọi mỗi frame với trễ một chiều ước lượng (ms)
  update(oneWayMs: number): number {
    const target = INTERP_DELAY_MS + Math.min(Math.max(oneWayMs, 0), MAX_ONE_WAY_MS)
    if (!this.started) { this._value = target; this.started = oneWayMs > 0 }
    else if (target > this._value) this._value = Math.min(target, this._value + DELAY_SLEW_MS_PER_FRAME)
    else this._value = Math.max(target, this._value - DELAY_SLEW_MS_PER_FRAME)
    return this._value
  }
}

export class Interpolator {
  private buffers = new Map<number, Entry[]>()
  private out = new Map<number, InterpPlayer>()
  private list: InterpPlayer[] = []

  // Nhận snapshot: thêm vào buffer từng người (trừ selfId), xoá người không còn trong snapshot
  push(serverTime: number, players: NetPlayer[], selfId = -1): void {
    const seen = new Set<number>()
    for (const p of players) {
      if (p.id === selfId) continue
      seen.add(p.id)
      let buf = this.buffers.get(p.id)
      if (!buf) { buf = []; this.buffers.set(p.id, buf) }
      const last = buf[buf.length - 1]
      if (last && serverTime <= last.serverTime) continue
      buf.push({ serverTime, pos: [p.pos[0], p.pos[1], p.pos[2]], yaw: p.yaw, pitch: p.pitch, flags: p.flags })
      while (buf.length > 2 && buf[0]!.serverTime < serverTime - BUFFER_MS) buf.shift()
    }
    for (const id of this.buffers.keys()) {
      if (!seen.has(id)) { this.buffers.delete(id); this.out.delete(id) }
    }
  }

  // Gọi mỗi frame với serverNow() hiện tại; trả về danh sách dùng lại (hợp lệ tới lần gọi sau)
  sample(serverNow: number, delayMs = INTERP_DELAY_MS): InterpPlayer[] {
    const renderTime = serverNow - delayMs
    interp.currentRenderTime = renderTime
    interp.delayMs = delayMs
    this.list.length = 0
    for (const [id, buf] of this.buffers) {
      let o = this.out.get(id)
      if (!o) { o = { id, pos: [0, 0, 0], yaw: 0, pitch: 0, flags: 0, stale: false }; this.out.set(id, o) }
      this.fill(o, buf, renderTime)
      this.list.push(o)
    }
    return this.list
  }

  private fill(o: InterpPlayer, buf: Entry[], renderTime: number): void {
    const first = buf[0]!
    const last = buf[buf.length - 1]!
    if (renderTime >= last.serverTime) {
      // Snapshot đến muộn: giữ ở snapshot cuối, không ngoại suy
      this.copy(o, last)
      o.stale = renderTime - last.serverTime > STALE_MS
      return
    }
    o.stale = false
    if (renderTime <= first.serverTime) { this.copy(o, first); return }
    // a.serverTime ≤ renderTime < b.serverTime
    let i = buf.length - 2
    while (i > 0 && buf[i]!.serverTime > renderTime) i--
    const a = buf[i]!
    const b = buf[i + 1]!
    const t = (renderTime - a.serverTime) / (b.serverTime - a.serverTime)
    o.pos[0] = lerp(a.pos[0], b.pos[0], t)
    o.pos[1] = lerp(a.pos[1], b.pos[1], t)
    o.pos[2] = lerp(a.pos[2], b.pos[2], t)
    o.yaw = lerpAngle(a.yaw, b.yaw, t)
    o.pitch = lerp(a.pitch, b.pitch, t)
    o.flags = a.flags   // cờ ngồi/trượt: lấy của a
  }

  private copy(o: InterpPlayer, e: Entry): void {
    o.pos[0] = e.pos[0]; o.pos[1] = e.pos[1]; o.pos[2] = e.pos[2]
    o.yaw = e.yaw; o.pitch = e.pitch; o.flags = e.flags
  }
}
