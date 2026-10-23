// Va chạm cận chiến (plan 19, P3): cung quét của từng nhát đánh chấm với hitbox đã tua về quá khứ (lag compensation),
// rồi đưa qua đỡ / parry / choáng (shared/melee.ts) và trừ máu. Mỗi nạn nhân chỉ trúng một lần mỗi nhát.
import {
  MAX_REWIND_MS, MELEE, MELEE_OUTCOME, MsgType, TICK_RATE, WEAPONS, bladeSegAt, hitboxesFor, inGuardArc, makeBladeSeg, makeMeleeHitResult, meleeSetOf, movementFor,
  rayAabb, resolveMeleeHit, shootDir,
  type HitBox, type InputCmd, type MeleeMove, type MeleeOutcome, type MeleeSet, type MovementConfig, type PlayerState, type ShotFxMsg,
} from '@fps/shared'
import type { Player, Room } from './room'
import type { PastPlayer } from './lagComp'
import { applyHit } from './shooting'

const TICK_MS = 1000 / TICK_RATE
const SAMPLES_PER_TICK = 5

/** Cửa sổ quét đang chạy của một nhát đánh */
export interface MeleeSweep {
  moveIdx: number
  hitIdx: number
  t0: number            // giờ (thang seq của người đánh) nhát đánh bắt đầu
  prevU: number         // u đã chấm tới đâu (-1 = chưa chấm mẫu nào)
  renderOff: number | null   // fireRenderTime − giờ seq lúc bắt đầu chiêu: giờ nhìn thấy của người đánh = giờ seq + renderOff
  hitIds: number[]      // đã trúng trong nhát này
}

export function makeMeleeSweep(): MeleeSweep { return { moveIdx: -1, hitIdx: 0, t0: 0, prevU: -1, renderOff: null, hitIds: [] } }

const seg = makeBladeSeg()
const eye: [number, number, number] = [0, 0, 0]
const dir: [number, number, number] = [0, 0, 0]
const toHit: [number, number, number] = [0, 0, 0]
const past: PastPlayer = { pos: [0, 0, 0], crouching: false, alive: true }
const pastState = { pos: past.pos, crouching: false } as unknown as PlayerState
const res = makeMeleeHitResult()
const OUTCOME_CODE: Record<MeleeOutcome, number> = MELEE_OUTCOME

/** Giờ tua cho đòn cận chiến: kẹp trong [serverNow − maxRewindMs, serverNow]; không có mốc thì không tua */
function meleeRewindTime(sw: MeleeSweep, nowMs: number, serverNow: number): number {
  if (sw.renderOff === null) return serverNow
  return Math.min(serverNow, Math.max(serverNow - Math.min(MELEE.maxRewindMs, MAX_REWIND_MS), nowMs + sw.renderOff))
}

/**
 * Gọi mỗi cmd của người chơi sau stepWeaponCmd khi cầm vũ khí cận chiến có bộ chiêu (hoặc còn cửa sổ quét đang chạy).
 * 'meleeStart': báo cho người khác vẽ động tác. 'fired': mở cửa sổ quét của nhát đó. Mỗi tick chấm các mẫu từ lần trước tới giờ.
 */
export function stepMeleeSweep(p: Player, room: Room, cmd: InputCmd, ev: string, baseCfg: MovementConfig): void {
  const ws = p.weapon
  const def = WEAPONS[ws.current]!
  const set: MeleeSet | undefined = def.melee ? meleeSetOf(def) : undefined
  const nowMs = cmd.seq * 1000 / TICK_RATE

  if (cmd.fireRenderTime !== undefined) { p.meleeRender.off = cmd.fireRenderTime - nowMs; p.meleeRender.atMs = nowMs }

  if (!set || !p.alive) { p.sweep = null; return }
  const cfg = movementFor(baseCfg, p.zstats, p.speedMult)
  const s = p.state
  eye[0] = s.pos[0]; eye[1] = s.pos[1] + (s.crouching ? cfg.eyeCrouch : cfg.eyeStand); eye[2] = s.pos[2]

  if (ev === 'meleeStart') {
    p.invulnUntil = 0   // đánh hợp lệ đầu tiên thì hết bất tử
    const d = shootDir(cmd.yaw, cmd.pitch)
    const fx: ShotFxMsg = { t: MsgType.ShotFx, shooterId: p.id, weapon: def.id, origin: [eye[0], eye[1], eye[2]], dir: d, dist: 0, moveId: ws.meleeMove, startSeq: cmd.seq }
    for (const o of room.players.values()) if (o !== p) o.transport.send(fx)
    // Mốc tua của cả chiêu: cmd gần nhất có fireRenderTime (bấm trước lúc ra chiêu tối đa một bộ đệm input)
    const m = p.meleeRender
    p.meleeRenderOff = m.atMs >= 0 && nowMs - m.atMs <= MELEE.inputBufferMs + 50 ? m.off : null
  }
  if (ev === 'fired') {
    const mv = set.moves[ws.meleeMove]!
    const hitIdx = ws.meleeHits - 1
    const sw = p.sweep ?? (p.sweep = makeMeleeSweep())
    sw.moveIdx = ws.meleeMove; sw.hitIdx = hitIdx
    sw.t0 = ws.meleeStartMs + mv.windupMs + hitIdx * mv.hitIntervalMs
    sw.prevU = -1; sw.renderOff = p.meleeRenderOff; sw.hitIds.length = 0
    p.shotsFired++
  }

  const sw = p.sweep
  if (!sw) return
  // Nhát bị huỷ (choáng, parry, đổi vũ khí) hoặc đã sang nhát khác thì thôi
  if (ws.meleeMove !== sw.moveIdx || ws.meleeHits !== sw.hitIdx + 1) { p.sweep = null; return }
  const mv = set.moves[sw.moveIdx]!
  const u = Math.min(1, (nowMs - sw.t0) / mv.strikeMs)

  const rewindT = meleeRewindTime(sw, nowMs, room.serverNow)
  if (rewindT < room.serverNow && cmd.fireRenderTime !== undefined && cmd.fireRenderTime < rewindT) p.rewindClamped++
  const rewound = rewindT < room.serverNow && room.history.locate(rewindT)
  const dbg: number[] | null = p.debugShots ? [] : null

  // Mẫu: từ u đã chấm lần trước (lần đầu: từ 0) tới u hiện tại, cỡ bước ~ TICK_MS / SAMPLES_PER_TICK
  const from = sw.prevU < 0 ? 0 : sw.prevU
  const n = sw.prevU < 0 ? Math.max(1, Math.ceil((u - from) * mv.strikeMs / (TICK_MS / SAMPLES_PER_TICK))) : Math.ceil((u - from) * mv.strikeMs / (TICK_MS / SAMPLES_PER_TICK))
  for (let i = sw.prevU < 0 ? 0 : 1; i <= n; i++) {
    const uu = n === 0 ? u : from + (u - from) * (i / n)
    bladeSegAt(seg, mv.arc, uu, eye, cmd.yaw, cmd.pitch)
    if (dbg) dbg.push(seg.base[0], seg.base[1], seg.base[2], seg.tip[0], seg.tip[1], seg.tip[2])
    sweepSample(p, room, cmd, mv, sw, rewound, baseCfg, nowMs)
  }
  sw.prevU = u

  if (dbg) {
    const d = shootDir(cmd.yaw, cmd.pitch)
    p.transport.send({ t: MsgType.DebugShot, origin: [eye[0], eye[1], eye[2]], dir: d, boxes: debugBoxes(room, p, rewound, baseCfg), blade: dbg })
  }
  if (u >= 1) p.sweep = null
}

function debugBoxes(room: Room, shooter: Player, rewound: boolean, baseCfg: MovementConfig): HitBox[] {
  const out: HitBox[] = []
  for (const other of room.players.values()) {
    if (other === shooter) continue
    let state: PlayerState = other.state
    if (rewound && room.history.get(other.id, past)) { pastState.crouching = past.crouching; state = pastState }
    for (const b of hitboxesFor(state, movementFor(baseCfg, other.zstats, other.speedMult), other.zstats?.scale ?? 1)) out.push(b)
  }
  return out
}

/** Chấm đoạn `seg` (đã tính) với mọi đối thủ chưa trúng trong nhát này */
function sweepSample(p: Player, room: Room, cmd: InputCmd, mv: MeleeMove, sw: MeleeSweep, rewound: boolean, baseCfg: MovementConfig, nowMs: number): void {
  const bx = seg.base[0], by = seg.base[1], bz = seg.base[2]
  const dx = seg.tip[0] - bx, dy = seg.tip[1] - by, dz = seg.tip[2] - bz
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) return
  dir[0] = dx / len; dir[1] = dy / len; dir[2] = dz / len
  const def = WEAPONS[p.weapon.current]!

  for (const other of room.players.values()) {
    if (other === p || sw.hitIds.includes(other.id)) continue
    if (other.team === p.team && !room.rules.friendlyFire) continue   // đồng đội: lưỡi xuyên qua
    let state: PlayerState = other.state
    let alive = other.alive
    if (rewound && room.history.get(other.id, past)) { pastState.crouching = past.crouching; state = pastState; alive = past.alive }
    if (!alive) continue

    let bestD = Infinity, bestPart: HitBox['part'] = 'body'
    for (const box of hitboxesFor(state, movementFor(baseCfg, other.zstats, other.speedMult), other.zstats?.scale ?? 1)) {
      const r = MELEE.bladeRadius
      box.min[0] -= r; box.min[1] -= r; box.min[2] -= r; box.max[0] += r; box.max[1] += r; box.max[2] += r
      const d = rayAabb(seg.base, dir, box, len)
      if (d !== null && d < bestD) { bestD = d; bestPart = box.part }
    }
    if (bestD === Infinity) continue

    // Tường chắn giữa mắt và điểm chạm
    toHit[0] = bx + dir[0] * bestD - eye[0]; toHit[1] = by + dir[1] * bestD - eye[1]; toHit[2] = bz + dir[2] * bestD - eye[2]
    const th = Math.hypot(toHit[0], toHit[1], toHit[2])
    if (th > 0.05) {
      toHit[0] /= th; toHit[1] /= th; toHit[2] /= th
      const wall = p.world?.castRay(eye, toHit, th)
      if (wall && wall.dist < th - 0.05) continue
    }

    sw.hitIds.push(other.id)
    const front = inGuardArc(other.state.yaw, p.state.pos[0] - other.state.pos[0], p.state.pos[2] - other.state.pos[2])
    const vDef = WEAPONS[other.weapon.current]
    const victimMelee = !!vDef?.melee && !!meleeSetOf(vDef)
    resolveMeleeHit(res, other.weapon, p.weapon, mv, front, victimMelee, other.lastProcessedSeq * 1000 / TICK_RATE, nowMs)

    const headshot = bestPart === 'head'
    const zone = headshot ? other.zstats?.headMult ?? MELEE.headMult : bestPart === 'legs' ? def.legMult : 1
    const dmg = res.outcome === 'parried' ? 0 : Math.round(res.damage * zone * p.damageMult)
    applyHit(p, room, other, dmg, headshot, def, eye, OUTCOME_CODE[res.outcome])
  }
}
