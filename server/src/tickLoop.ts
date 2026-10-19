import { TICK_RATE } from '@fps/shared'

const TICK_MS = 1000 / TICK_RATE
const MAX_CATCHUP_TICKS = 10

// Số tick cần chạy tính theo thời gian thực đã trôi (accumulator), không tin nhịp setInterval.
// Tick k xảy ra ở thời điểm start + k*TICK_MS; serverTime của snapshot lấy từ đây nên đều đặn.
export class TickLoop {
  private start: number
  private _tick = 0
  skipped = 0   // tick bị bỏ vì server tụt quá xa

  constructor(private now: () => number, private onTick: (tick: number, serverTime: number) => void) {
    this.start = now()
  }

  get tick(): number { return this._tick }

  timeOf(tick: number): number { return this.start + tick * TICK_MS }

  pump(): void {
    const target = Math.floor((this.now() - this.start) / TICK_MS)
    if (target - this._tick > MAX_CATCHUP_TICKS) {
      this.skipped += target - this._tick - MAX_CATCHUP_TICKS
      this._tick = target - MAX_CATCHUP_TICKS
    }
    while (this._tick < target) {
      this._tick++
      this.onTick(this._tick, this.timeOf(this._tick))
    }
  }
}
