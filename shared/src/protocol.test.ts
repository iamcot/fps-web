import { describe, it, expect } from 'vitest'
import { encode, decode, MsgType } from './protocol'

describe('encode / decode', () => {
  it('round-trip PingMsg', () => {
    const msg = { t: MsgType.Ping, clientTime: 1234.5 } as const
    expect(decode(encode(msg))).toEqual(msg)
  })

  it('round-trip PongMsg', () => {
    const msg = { t: MsgType.Pong, clientTime: 1234.5, serverTime: 99999.25 } as const
    expect(decode(encode(msg))).toEqual(msg)
  })

  it('encode trả về Uint8Array', () => {
    const buf = encode({ t: MsgType.Ping, clientTime: 0 })
    expect(buf).toBeInstanceOf(Uint8Array)
  })

  it('decode object có thêm field', () => {
    // Kiểm tra msgpack giữ nguyên giá trị số nguyên và string
    const msg = { t: MsgType.Ping, seq: 42, name: 'player1' } as unknown as Parameters<typeof encode>[0]
    const result = decode(encode(msg)) as unknown as Record<string, unknown>
    expect(result['t']).toBe(MsgType.Ping)
    expect(result['seq']).toBe(42)
    expect(result['name']).toBe('player1')
  })
})

import { isValidCmd, stateToNet, netToState } from './protocol'
import { Btn, type PlayerState } from './movement'

describe('isValidCmd', () => {
  const ok = { seq: 3, buttons: Btn.Forward | Btn.Jump, yaw: 1.2, pitch: 0.5, weapon: 0 }
  it('cmd đúng', () => expect(isValidCmd(ok)).toBe(true))
  it('pitch quá ±1.56', () => {
    expect(isValidCmd({ ...ok, pitch: 1.57 })).toBe(false)
    expect(isValidCmd({ ...ok, pitch: -1.57 })).toBe(false)
  })
  it('yaw không hữu hạn', () => {
    expect(isValidCmd({ ...ok, yaw: NaN })).toBe(false)
    expect(isValidCmd({ ...ok, yaw: Infinity })).toBe(false)
  })
  it('bit nút lạ', () => expect(isValidCmd({ ...ok, buttons: 1 << 14 })).toBe(false))
  it('thiếu trường / sai kiểu', () => {
    expect(isValidCmd(null)).toBe(false)
    expect(isValidCmd({ ...ok, seq: 1.5 })).toBe(false)
    expect(isValidCmd({ ...ok, yaw: '1' })).toBe(false)
  })
})

describe('NetPlayer', () => {
  it('state → net → state giữ đủ mọi trường', () => {
    const s: PlayerState = {
      pos: [1, 2, 3], vel: [4, 5, 6], yaw: 0.7, pitch: -0.2,
      grounded: true, crouching: true, slideTimer: 0.3, slideCooldown: 0.9, adsT: 0,
    }
    const n = stateToNet(7, s)
    expect(n.id).toBe(7)
    const back = decode(encode({ t: MsgType.Snapshot, tick: 1, serverTime: 2, ack: 0, players: [n] }))
    if (back.t !== MsgType.Snapshot) throw new Error('sai loại')
    expect(netToState(back.players[0]!)).toEqual(s)
    expect(netToState(n)).toEqual(s)
  })
})
