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
