import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withNetsim, type Transport } from './transport'
import { MsgType, type AnyMsg } from './protocol'

function fakeInner() {
  const sent: AnyMsg[] = []
  let cb: (m: AnyMsg) => void = () => {}
  const t: Transport = {
    send: m => { sent.push(m) },
    onMessage: c => { cb = c },
    onClose: () => {},
  }
  return { t, sent, emit: (m: AnyMsg) => cb(m) }
}
const ping = (n: number): AnyMsg => ({ t: MsgType.Ping, clientTime: n })

describe('withNetsim', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('trễ mỗi chiều latencyMs', () => {
    const { t, sent, emit } = fakeInner()
    const ns = withNetsim(t, { latencyMs: 80, jitterMs: 0, now: () => Date.now() })
    const got: AnyMsg[] = []
    ns.onMessage(m => got.push(m))
    ns.send(ping(1))
    emit(ping(2))
    vi.advanceTimersByTime(79)
    expect(sent.length).toBe(0)
    expect(got.length).toBe(0)
    vi.advanceTimersByTime(1)
    expect(sent.length).toBe(1)
    expect(got.length).toBe(1)
  })

  it('jitter lớn vẫn giữ đúng thứ tự', () => {
    const { t, sent, emit } = fakeInner()
    // random xen kẽ 0 và 1 → trễ xen kẽ nhỏ/lớn nhất
    let i = 0
    const random = () => (i++ % 2 === 0 ? 1 : 0)
    const ns = withNetsim(t, { latencyMs: 50, jitterMs: 40, now: () => Date.now(), random })
    const got: number[] = []
    ns.onMessage(m => got.push((m as { clientTime: number }).clientTime))
    for (let n = 0; n < 50; n++) {
      ns.send(ping(n))
      emit(ping(n))
      vi.advanceTimersByTime(5)
    }
    vi.advanceTimersByTime(1000)
    const out = sent.map(m => (m as { clientTime: number }).clientTime)
    const seq = Array.from({ length: 50 }, (_, k) => k)
    expect(out).toEqual(seq)
    expect(got).toEqual(seq)
  })
})
