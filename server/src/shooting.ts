import {
  MAX_PELLETS, MAX_REWIND_MS, MsgType, WEAPONS, computeShotDirs, damageFalloff, hitboxesFor, rayAabb, shotSpread,
  type HitBox, type ShotFxMsg, type InputCmd, type MovementConfig, type PlayerState,
} from '@fps/shared'
import type { Player, Room } from './room'
import type { PastPlayer } from './lagComp'

const dirs: [number, number, number][] = Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])
const hitTotals = new Map<number, { damage: number; headshot: boolean }>()
const eye: [number, number, number] = [0, 0, 0]
const past: PastPlayer = { pos: [0, 0, 0], crouching: false, alive: true }
// hitboxesFor chỉ đọc pos/crouching
const pastState = { pos: past.pos, crouching: false } as unknown as PlayerState

// Thời điểm cần tua về: fireRenderTime kẹp trong [serverNow − MAX_REWIND_MS, serverNow];
// không có fireRenderTime thì không tua.
export function rewindTime(fireRenderTime: number | undefined, serverNow: number): number {
  if (fireRenderTime === undefined) return serverNow
  return Math.min(serverNow, Math.max(serverNow - MAX_REWIND_MS, fireRenderTime))
}

// Chấm một phát bắn của `shooter` (vừa chạy cmd, state đã là sau cmd). Đối thủ được tua về cmd.fireRenderTime (lag compensation); tường và người bắn thì không.
// Gốc tia = mắt người bắn; hướng = yaw/pitch + recoil + spread (seed playerId, shotSeq) như client;
// tường: castRay trong world riêng của người bắn; người khác: ray vs AABB.
export function resolveShot(shooter: Player, room: Room, cmd: InputCmd, cfg: MovementConfig): void {
  const ws = shooter.weapon
  const def = WEAPONS[ws.current]!
  const s = shooter.state

  const pellets = computeShotDirs(dirs, shooter.recoil, def, shooter.id, ws.shotSeq - 1, cmd.yaw, cmd.pitch, shotSpread(def, s, cmd.buttons))
  eye[0] = s.pos[0]; eye[1] = s.pos[1] + (s.crouching ? cfg.eyeCrouch : cfg.eyeStand); eye[2] = s.pos[2]

  const t = rewindTime(cmd.fireRenderTime, room.serverNow)
  if (cmd.fireRenderTime !== undefined && cmd.fireRenderTime < t) shooter.rewindClamped++   // yêu cầu tua quá giới hạn
  const rewound = t < room.serverNow && room.history.locate(t)
  const debugBoxes: HitBox[] | null = shooter.debugShots ? [] : null

  // Cộng dồn sát thương mọi tia theo từng nạn nhân (một Hurt + một HitConfirm mỗi người mỗi phát)
  hitTotals.clear()
  const dists: number[] = []
  for (let k = 0; k < pellets; k++) {
    const dir = dirs[k]!
    const wallHit = shooter.world?.castRay(eye, dir, def.range) ?? null
    let bestDist = wallHit ? wallHit.dist : def.range
    let hitId = -1
    let hitPart: 'head' | 'body' | 'legs' = 'body'

    for (const other of room.players.values()) {
      if (other === shooter) continue
      if (other.team === shooter.team && !room.rules.friendlyFire) continue   // đồng đội: đạn xuyên qua
      let state: PlayerState = other.state
      let alive = other.alive
      if (rewound && room.history.get(other.id, past)) {
        pastState.crouching = past.crouching
        state = pastState
        alive = past.alive
      }
      if (!alive) continue
      for (const box of hitboxesFor(state, cfg)) {
        if (k === 0) debugBoxes?.push(box)
        const d = rayAabb(eye, dir, box, bestDist)
        if (d !== null && d < bestDist) { bestDist = d; hitId = other.id; hitPart = box.part }
      }
    }
    dists.push(bestDist)

    if (hitId >= 0) {
      const mult = hitPart === 'head' ? def.headMult : hitPart === 'legs' ? def.legMult : 1
      const dmg = Math.round(def.damage * mult * damageFalloff(def, bestDist))
      const tot = hitTotals.get(hitId)
      if (tot) { tot.damage += dmg; tot.headshot ||= hitPart === 'head' }
      else hitTotals.set(hitId, { damage: dmg, headshot: hitPart === 'head' })
    }
  }
  if (debugBoxes) {
    shooter.transport.send({
      t: MsgType.DebugShot,
      origin: [eye[0], eye[1], eye[2]], dir: [dirs[0]![0], dirs[0]![1], dirs[0]![2]], boxes: debugBoxes,
    })
  }

  for (const [hitId, tot] of hitTotals) {
    const target = room.players.get(hitId)!
    const damage = tot.damage
    const headshot = tot.headshot
    // Bất tử tính theo giờ hiện tại của server (không tua). Chỉ trừ máu người còn sống và chưa bị chốt chết.
    const invuln = room.serverNow < target.invulnUntil
    const applied = invuln || !target.alive || target.hp <= 0 ? 0 : damage
    if (applied > 0) {
      target.hp -= applied
      if (target.hp <= 0) { target.killerId = shooter.id; target.killWeapon = def.id; target.killHeadshot = headshot }
      target.transport.send({ t: MsgType.Hurt, origin: [eye[0], eye[1], eye[2]], damage: applied })
    }
    shooter.transport.send({ t: MsgType.HitConfirm, damage: applied, headshot, targetId: hitId })
  }

  const fx: ShotFxMsg = {
    t: MsgType.ShotFx, shooterId: shooter.id, weapon: def.id,
    origin: [eye[0], eye[1], eye[2]],
    dir: [dirs[0]![0], dirs[0]![1], dirs[0]![2]],
    dist: dists[0]!,
  }
  if (pellets > 1) {
    fx.extra = []
    for (let k = 1; k < pellets; k++) fx.extra.push({ dir: [dirs[k]![0], dirs[k]![1], dirs[k]![2]], dist: dists[k]! })
  }
  for (const other of room.players.values()) if (other !== shooter) other.transport.send(fx)
}
