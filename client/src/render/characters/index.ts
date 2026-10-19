import { CHARACTER_SETS, DEFAULT_CHARACTER_SET, type CharacterSetId } from '@fps/shared'
import { blocky } from './blocky'
import { robot } from './robot'
import type { CharacterSet } from './types'

// Đăng ký bộ nhân vật. Thêm bộ mới: thêm id vào CHARACTER_SETS (shared) + module + một dòng ở đây.
const REGISTRY: Record<CharacterSetId, CharacterSet> = { blocky, robot }

export function getCharacterSet(id: string): CharacterSet {
  return REGISTRY[id as CharacterSetId] ?? REGISTRY[DEFAULT_CHARACTER_SET]
}

export const characterSetList: CharacterSet[] = CHARACTER_SETS.map(id => REGISTRY[id])
export type { CharacterRig, CharacterSet } from './types'
export { disposeRig } from './kit'
