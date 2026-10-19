import {
  MsgType, WEAPONS, computeShot, hitboxesFor, rayAabb, shotSpread,
  type InputCmd, type MovementConfig,
} from '@fps/shared'
import type { Player, Room } from './room'

const dir: [number, number, number] = [0, 0, 0]
const eye: [number, number, number] = [0, 0, 0]

// Chấm một phát bắn của `shooter` (vừa chạy cmd, state đã là sau cmd). Chưa tua thời gian (4.3).
// Gốc tia = mắt người bắn; hướng = yaw/pitch + recoil + spread (seed playerId, shotSeq) như client;
// tường: castRay trong world riêng của người bắn; người khác: ray vs AABB.
export function resolveShot(shooter: Player, room: Room, cmd: InputCmd, cfg: MovementConfig): void {
  const ws = shooter.weapon
  const def = WEAPONS[ws.current]!
  const s = shooter.state

  computeShot(dir, shooter.recoil, def, shooter.id, ws.shotSeq - 1, cmd.yaw, cmd.pitch, shotSpread(def, s, cmd.buttons))
  eye[0] = s.pos[0]; eye[1] = s.pos[1] + (s.crouching ? cfg.eyeCrouch : cfg.eyeStand); eye[2] = s.pos[2]

  const wallHit = shooter.world?.castRay(eye, dir, def.range) ?? null
  let bestDist = wallHit ? wallHit.dist : def.range
  let hitId = -1
  let hitPart: 'head' | 'body' | 'legs' = 'body'

  for (const other of room.players.values()) {
    if (other === shooter) continue
    for (const box of hitboxesFor(other.state, cfg)) {
      const d = rayAabb(eye, dir, box, bestDist)
      if (d !== null && d < bestDist) { bestDist = d; hitId = other.id; hitPart = box.part }
    }
  }

  if (hitId >= 0) {
    const mult = hitPart === 'head' ? def.headMult : hitPart === 'legs' ? def.legMult : 1
    shooter.transport.send({
      t: MsgType.HitConfirm, damage: Math.round(def.damage * mult), headshot: hitPart === 'head', targetId: hitId,
    })
    // Trừ máu ở 4.4
  }

  const fx = {
    t: MsgType.ShotFx, shooterId: shooter.id, weapon: def.id,
    origin: [eye[0], eye[1], eye[2]] as [number, number, number],
    dir: [dir[0], dir[1], dir[2]] as [number, number, number],
    dist: bestDist,
  }
  for (const other of room.players.values()) if (other !== shooter) other.transport.send(fx)
}
