import type { TeamId } from '../teams'
import type { LoadedMap } from './types'

/**
 * Chân người chơi có đang trong khu mua của đội mình không. Đội A ở căn cứ A trừ khi đã đổi bên (sideSwapped).
 * `pos` = vị trí chân. Map không khai báo khu mua → false.
 */
export function inBuyZone(map: Pick<LoadedMap, 'buyZones'>, team: TeamId, sideSwapped: boolean, pos: readonly number[]): boolean {
  const side = (team === 'A') !== sideSwapped ? 'A' : 'B'
  const z = map.buyZones[side]
  if (!z) return false
  return pos[0]! >= z.min[0] && pos[0]! <= z.max[0] &&
         pos[1]! >= z.min[1] && pos[1]! <= z.max[1] &&
         pos[2]! >= z.min[2] && pos[2]! <= z.max[2]
}
