import { describe, it, expect } from 'vitest'
import { lanAddresses } from './lan'

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }) as never

describe('lanAddresses', () => {
  it('lấy IPv4 LAN, bỏ loopback, link-local, IPv6 và card ảo', () => {
    const r = lanAddresses({
      lo: [v4('127.0.0.1', true)],
      docker0: [v4('172.17.0.1')],
      eth1: [v4('169.254.3.4')],
      eth0: [v4('192.168.1.23'), { address: 'fe80::1', family: 'IPv6', internal: false } as never],
    })
    expect(r).toEqual([{ iface: 'eth0', address: '192.168.1.23' }])
  })

  it('mạng riêng đứng trước IP công cộng', () => {
    const r = lanAddresses({ ppp0: [v4('8.8.4.4')], wlan0: [v4('10.0.0.5')] })
    expect(r.map(a => a.address)).toEqual(['10.0.0.5', '8.8.4.4'])
  })

  it('không có mạng: mảng rỗng', () => {
    expect(lanAddresses({})).toEqual([])
  })
})
