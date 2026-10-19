import { rayAabb } from '@fps/shared'
import type { MovementConfig } from '@fps/shared'
import type { CollisionWorld } from '@fps/shared/physics/world'
import { targetHitboxes } from './targets'
import type { Target } from './targets'

export type HitResult =
  | { kind: 'target'; idx: number; part: 'head' | 'body' | 'legs'; dist: number }
  | { kind: 'wall'; dist: number; hitPos: [number, number, number]; normal: [number, number, number] }

export function fireHitscan(
  eyePos: [number, number, number],
  dir: [number, number, number],
  maxDist: number,
  world: CollisionWorld,
  cfg: MovementConfig,
  targets: Target[],
): HitResult | null {
  // Khoảng cách đến tường gần nhất
  const wallHit  = world.castRay(eyePos, dir, maxDist)
  const wallDist = wallHit ? wallHit.dist : maxDist

  // Kiểm tra hitbox bia (chỉ nếu gần hơn tường)
  let bestDist  = wallDist
  let bestTarget: { idx: number; part: 'head' | 'body' | 'legs' } | null = null

  for (let i = 0; i < targets.length; i++) {
    for (const box of targetHitboxes(targets[i]!, cfg)) {
      const d = rayAabb(eyePos, dir, box, bestDist)
      if (d !== null && d < bestDist) {
        bestDist   = d
        bestTarget = { idx: i, part: box.part }
      }
    }
  }

  if (bestTarget) {
    return { kind: 'target', idx: bestTarget.idx, part: bestTarget.part, dist: bestDist }
  }

  if (wallHit) {
    const hitPos: [number, number, number] = [
      eyePos[0] + dir[0] * wallHit.dist,
      eyePos[1] + dir[1] * wallHit.dist,
      eyePos[2] + dir[2] * wallHit.dist,
    ]
    return { kind: 'wall', dist: wallHit.dist, hitPos, normal: wallHit.normal }
  }

  return null
}
