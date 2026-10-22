import {
  MAX_PELLETS, MAX_REWIND_MS, MsgType, WEAPONS, TICK_RATE, ZOMBIE, CLAW_HEAVY_ID, computeShotDirs, computeSpreadDeg, damageFalloff, hitboxesFor, rayAabb, movementFor, knockbackImpulse, applyKnockback,
  type HitBox, type HitConfirmMsg, type ShotFxMsg, type InputCmd, type MovementConfig, type PlayerState, type WeaponDef,
} from '@fps/shared'
import type { Player, Room } from './room'
import type { PastPlayer } from './lagComp'

const dirs: [number, number, number][] = Array.from({ length: MAX_PELLETS }, () => [0, 0, 0] as [number, number, number])
const hitTotals = new Map<number, { damage: number; headshot: boolean }>()
const eye: [number, number, number] = [0, 0, 0]
const past: PastPlayer = { pos: [0, 0, 0], crouching: false, alive: true }
// hitboxesFor chỉ đọc pos/crouching
const pastState = { pos: past.pos, crouching: false } as unknown as PlayerState
const kbImp: [number, number, number] = [0, 0, 0]

// Thời điểm cần tua về: fireRenderTime kẹp trong [serverNow − MAX_REWIND_MS, serverNow];
// không có fireRenderTime thì không tua.
export function rewindTime(fireRenderTime: number | undefined, serverNow: number): number {
  if (fireRenderTime === undefined) return serverNow
  return Math.min(serverNow, Math.max(serverNow - MAX_REWIND_MS, fireRenderTime))
}

/**
 * Áp một lần trúng lên `target` (sát thương đã nhân hệ số vùng / falloff, chưa nhân takenMult): trừ máu, đẩy lùi, gửi Hurt + HitConfirm.
 * `origin` = mắt người bắn (cho Hurt). `outcome` = kết quả cận chiến (MELEE_OUTCOME), bỏ qua với súng.
 */
export function applyHit(shooter: Player, room: Room, target: Player, damage: number, headshot: boolean, def: WeaponDef, origin: readonly number[], outcome?: number): void {
  const s = shooter.state
  // Bất tử tính theo giờ hiện tại của server (không tua). Chỉ trừ máu người còn sống và chưa bị chốt chết.
  const invuln = room.serverNow < target.invulnUntil
  // Zombie không đánh người đang gục (để đồng đội kịp chạy tới cứu; gục chỉ chết do hết giờ chảy máu)
  const applied = invuln || !target.alive || target.hp <= 0 || (target.downed && shooter.npc) ? 0 : Math.round(damage * target.takenMult)
  if (applied > 0) {
    target.hp -= applied
    target.lastHurtAt = room.serverNow
    room.mode.onDamage?.(room, shooter, target, applied)
    if (target.zstats && !def.melee) {   // zombie trúng đạn bị đẩy lùi (shotgun đẩy rất mạnh), kèm hiện tượng văng khỏi gờ khi đang trên không
      const dx = target.state.pos[0] - s.pos[0], dz = target.state.pos[2] - s.pos[2]
      const dl = Math.hypot(dx, dz) || 1
      knockbackImpulse(kbImp, def.key, applied, target.zstats.knockbackResist, dx / dl, dz / dl, !target.state.grounded)
      applyKnockback(target.state.vel, kbImp)
    }
    if (target.hp <= 0) { target.killerId = shooter.id; target.killWeapon = def.id; target.killHeadshot = headshot }
    target.transport.send({ t: MsgType.Hurt, origin: [origin[0]!, origin[1]!, origin[2]!], damage: applied, ...(outcome ? { outcome } : {}) })
    if (shooter.zstats?.shoveSpeed && def.melee && !target.zstats) {   // brute: cào trúng đẩy người lùi (khỏi gờ tường!)
      const dx = target.state.pos[0] - s.pos[0], dz = target.state.pos[2] - s.pos[2], dl = Math.hypot(dx, dz) || 1
      target.state.vel[0] += dx / dl * shooter.zstats.shoveSpeed; target.state.vel[2] += dz / dl * shooter.zstats.shoveSpeed
    }
  }
  else if (outcome) target.transport.send({ t: MsgType.Hurt, origin: [origin[0]!, origin[1]!, origin[2]!], damage: 0, outcome })   // đòn bị đỡ / parry hết sát thương: vẫn báo cho người đỡ
  const hc: HitConfirmMsg = { t: MsgType.HitConfirm, damage: applied, headshot, targetId: target.id }
  if (outcome) hc.outcome = outcome
  shooter.transport.send(hc)
}

// Chấm một phát bắn của `shooter` (vừa chạy cmd, state đã là sau cmd). Đối thủ được tua về cmd.fireRenderTime (lag compensation); tường và người bắn thì không.
// Gốc tia = mắt người bắn; hướng = yaw/pitch + recoil + spread (seed playerId, shotSeq) như client;
// tường: castRay trong world riêng của người bắn; người khác: ray vs AABB.
export function resolveShot(shooter: Player, room: Room, cmd: InputCmd, baseCfg: MovementConfig, defOverride?: WeaponDef): void {
  const ws = shooter.weapon
  const def = defOverride ?? WEAPONS[ws.current]!
  const s = shooter.state
  const cfg = movementFor(baseCfg, shooter.zstats, shooter.speedMult)
  // Vuốt zombie: sát thương theo loại zombie; cào mạnh nhân đôi
  const baseDamage = shooter.zstats && def.category === 'claw'
    ? shooter.zstats.clawDamage * (def.id === CLAW_HEAVY_ID ? ZOMBIE.heavyDamageMult : 1)
    : def.damage * shooter.damageMult

  const pellets = computeShotDirs(dirs, shooter.recoil, def, shooter.id, ws.shotSeq - 1, cmd.yaw, cmd.pitch, computeSpreadDeg(s, ws, def, cfg, cmd.seq * 1000 / TICK_RATE, true))
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
      for (const box of hitboxesFor(state, movementFor(baseCfg, other.zstats, other.speedMult), other.zstats?.scale ?? 1)) {
        if (k === 0) debugBoxes?.push(box)
        const d = rayAabb(eye, dir, box, bestDist)
        if (d !== null && d < bestDist) { bestDist = d; hitId = other.id; hitPart = box.part }
      }
    }
    dists.push(bestDist)

    if (hitId >= 0) {
      const hm = room.players.get(hitId)?.zstats?.headMult ?? def.headMult   // zombie Thủ Thành: đầu ×2 (boss ×3) bất kể súng
      const mult = hitPart === 'head' ? hm : hitPart === 'legs' ? def.legMult : 1
      const dmg = Math.round(baseDamage * mult * damageFalloff(def, bestDist))
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

  for (const [hitId, tot] of hitTotals) applyHit(shooter, room, room.players.get(hitId)!, tot.damage, tot.headshot, def, eye)

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
