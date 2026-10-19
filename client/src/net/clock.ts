const SAMPLES = 8
const MAX_SLEW_MS_PER_FRAME = 1

interface Sample { rtt: number; offset: number }

// Đồng hồ server ước lượng từ Ping/Pong. now được inject để test.
export class ClockSync {
  private samples: Sample[] = []
  private target = 0      // offset tốt nhất (mẫu RTT nhỏ nhất)
  private applied = 0     // offset đang dùng; chỉ được giảm dần để serverNow không chạy lùi
  private hasSample = false

  constructor(private now: () => number = () => performance.now()) {}

  // Nhận Pong: rtt = now − clientTime; offset = serverTime + rtt/2 − now
  addSample(clientTime: number, serverTime: number): void {
    const now = this.now()
    const rtt = now - clientTime
    this.samples.push({ rtt, offset: serverTime + rtt / 2 - now })
    if (this.samples.length > SAMPLES) this.samples.shift()
    let best = this.samples[0]!
    for (const s of this.samples) if (s.rtt < best.rtt) best = s
    this.target = best.offset
    if (!this.hasSample) { this.applied = this.target; this.hasSample = true }
  }

  // Gọi một lần mỗi frame. Offset tăng thì nhảy ngay (thời gian đi tới);
  // offset giảm thì hạ dần tối đa 1ms/frame để serverNow không bao giờ lùi.
  tick(): void {
    if (this.target >= this.applied) this.applied = this.target
    else this.applied -= Math.min(MAX_SLEW_MS_PER_FRAME, this.applied - this.target)
  }

  serverNow(): number { return this.now() + this.applied }
  get offset(): number { return this.applied }
  get synced(): boolean { return this.hasSample }
}

export const clock = new ClockSync()
