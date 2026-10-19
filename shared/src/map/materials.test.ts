import { describe, it, expect } from 'vitest'
import { resolveBoxLook, FLOOR_COLOR, TEXTURE_CLASSES } from './materials'
import type { MapBox } from './types'

const box = (texture: string, extra: Partial<MapBox> = {}): MapBox => ({ pos: [1, 2, 3], size: [1, 1, 1], texture, ...extra })

describe('resolveBoxLook', () => {
  it('class: chọn ảnh trong class; variant chọn đúng ảnh; color đi theo', () => {
    expect(TEXTURE_CLASSES.concrete!.files).toContain(resolveBoxLook(box('concrete')).file)
    expect(resolveBoxLook(box('concrete', { variant: 2 })).file).toBe('concrete_2')
    expect(resolveBoxLook(box('brick', { color: '#ff0000' }))).toMatchObject({ file: 'brick_1', color: '#ff0000', crate: false })
  })
  it('bản đối xứng (x đổi dấu) chọn cùng ảnh', () => {
    for (let x = 1; x < 30; x++) {
      expect(resolveBoxLook(box('concrete', { pos: [-x, 1, 4] })).file).toBe(resolveBoxLook(box('concrete', { pos: [x, 1, 4] })).file)
    }
  })
  it('loại cũ: wall = concrete, floor = xanh rêu (ghi đè được bằng color), crate = model', () => {
    expect(resolveBoxLook(box('wall')).file).toMatch(/^concrete_/)
    expect(resolveBoxLook(box('floor'))).toMatchObject({ file: null, color: FLOOR_COLOR })
    expect(resolveBoxLook(box('floor', { color: '#000000' })).color).toBe('#000000')
    expect(resolveBoxLook(box('crate')).crate).toBe(true)
  })
  it('tên file trực tiếp và tên lạ', () => {
    expect(resolveBoxLook(box('concrete_2')).file).toBe('concrete_2')
    expect(resolveBoxLook(box('khong-co'))).toMatchObject({ file: null, crate: false })
  })
})
