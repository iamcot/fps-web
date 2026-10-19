import { describe, it, expect } from 'vitest'
import { hurtEdgeWeights } from './hudNet'

const w = (dx: number, dz: number, yaw: number) => {
  const o: [number, number, number, number] = [0, 0, 0, 0]
  hurtEdgeWeights(dx, dz, yaw, o)
  return o
}

describe('hurtEdgeWeights', () => {
  it('yaw 0 nhìn −Z: bắn từ phía trước (−Z) → cạnh trên', () => {
    const o = w(0, -10, 0)
    expect(o[0]).toBeCloseTo(1); expect(o[1]).toBeCloseTo(0); expect(o[2]).toBe(0); expect(o[3]).toBe(0)
  })
  it('từ phía sau (+Z) → cạnh dưới', () => {
    expect(w(0, 10, 0)[2]).toBeCloseTo(1)
  })
  it('từ bên phải (+X khi yaw 0) → cạnh phải; bên trái → cạnh trái', () => {
    expect(w(10, 0, 0)[1]).toBeCloseTo(1)
    expect(w(-10, 0, 0)[3]).toBeCloseTo(1)
  })
  it('xoay yaw: quay trái 90° (yaw π/2) nhìn −X; kẻ địch ở −X → cạnh trên', () => {
    expect(w(-10, 0, Math.PI / 2)[0]).toBeCloseTo(1)
  })
  it('chéo 45° chia đều hai cạnh', () => {
    const o = w(10, -10, 0)
    expect(o[0]).toBeCloseTo(Math.SQRT1_2); expect(o[1]).toBeCloseTo(Math.SQRT1_2)
  })
})
