import {
  Btn, DT, MatchPhase, NetFlag, INPUT_STARVE_GRACE_TICKS, MAX_INPUTS_PER_TICK, MAX_INPUT_QUEUE, MsgType, SEQ_AHEAD_SLACK_MS, SNAPSHOT_EVERY_TICKS, TICK_RATE,
  WEAPONS, isValidCmd, phaseButtonMask, moveSpeedMul, recoverRecoil, stateToNet, stepMovement, stepWeaponCmd,
  type MovementConfig, type NetPlayer,
} from '@fps/shared'
import type { Player, Room } from './room'
import { resolveShot } from './shooting'
import { spawnThrown, stepGrenades } from './grenades'
import { updateMatch } from './match'

// Khi không có input mới, giữ hướng di chuyển nhưng không lặp hành động một lần
const HELD_MASK = ~(Btn.Jump | Btn.Fire | Btn.Reload)
const MAX_CMDS_PER_MSG = 16

// Cmd từ client không đáng tin: sai thì bỏ; hàng đợi quá dài thì bỏ cmd cũ nhất.
// seq quyết định thời gian của súng (fire rate/reload) nên không được chạy nhanh hơn thời gian thực:
// cmd có seq vượt quá SEQ_AHEAD_SLACK_MS so với mốc của cmd đầu tiên thì bỏ (seq nhảy cóc, gửi dồn).
export function enqueueCmds(p: Player, cmds: unknown, nowMs: number = performance.now()): void {
  if (!Array.isArray(cmds)) return
  for (let i = 0; i < cmds.length && i < MAX_CMDS_PER_MSG; i++) {
    const c = cmds[i]
    if (!isValidCmd(c)) continue
    const offset = nowMs - c.seq * 1000 / TICK_RATE
    if (p.seqOffset === null) p.seqOffset = offset
    else if (offset < p.seqOffset - SEQ_AHEAD_SLACK_MS) continue
    p.inputQueue.push(c)
    if (p.inputQueue.length > MAX_INPUT_QUEUE) p.inputQueue.shift()
  }
}

export function stepPlayer(p: Player, cfg: MovementConfig, room: Room | null = null): void {
  if (!p.world) return
  let ran = 0
  while (ran < MAX_INPUTS_PER_TICK && p.inputQueue.length > 0) {
    const cmd = p.inputQueue.shift()!
    if (cmd.seq <= p.lastProcessedSeq) continue   // trùng hoặc cũ
    // Nút bị cấm (chết / đếm ngược / hết trận): bỏ nút, vẫn bước để rơi xuống đất, xoay và ack tiếp.
    // Client áp cùng phaseButtonMask nên dự đoán khớp.
    const mask = phaseButtonMask(room?.phase ?? MatchPhase.Playing, p.alive)
    let eff = cmd
    if ((cmd.buttons & ~mask) !== 0) {
      eff = p.deadCmd
      eff.seq = cmd.seq; eff.yaw = cmd.yaw; eff.pitch = cmd.pitch; eff.weapon = cmd.weapon
      eff.buttons = cmd.buttons & mask; eff.fireRenderTime = cmd.fireRenderTime
    }
    // Tốc độ theo súng đang cầm TRƯỚC cmd này (đổi súng ở cuối tick); client dự đoán và replay cùng thứ tự
    p.state = stepMovement(p.state, eff, p.world, cfg, DT, moveSpeedMul(p.weapon, eff.buttons))
    p.lastProcessedSeq = cmd.seq
    p.lastCmd = cmd
    // Chạy cả khi chết (nút đã bị mask nên không bắn được): wantSlot/hoàn tất nạp khớp với dự đoán của client
    const ev = stepWeaponCmd(p.weapon, eff)
    if (ev === 'fired' && p.alive) {
      p.shotsFired++
      p.invulnUntil = 0   // bắn phát hợp lệ đầu tiên thì hết bất tử
      if (room) resolveShot(p, room, eff, cfg)
    } else if (room && p.alive && (ev === 'pull' || ev === 'cancel' || ev === 'threw')) {
      // Lựu đạn: động tác cho người khác vẽ; ném thật thì tạo quả (state đã là sau cmd này)
      const mode = p.weapon.nade.mode
      if (ev === 'threw') { p.invulnUntil = 0; spawnThrown(room, p, mode, cfg) }
      const anim = { t: MsgType.GrenadeAnim, playerId: p.id, phase: ev === 'pull' ? 'pulling' : ev === 'threw' ? 'throw' : 'cancel', mode } as const
      for (const o of room.players.values()) o.transport.send(anim)
    }
    recoverRecoil(p.recoil, WEAPONS[p.weapon.current]!, p.weapon, cmd.seq * 1000 / TICK_RATE, DT)
    ran++
  }
  if (ran > 0) { p.starvedTicks = 0; return }

  // Hàng đợi trống. Cmd đến trễ vài ms do jitter là chuyện thường: nếu chạy ngay một bước 'idle'
  // thì server tiến thêm một bước mà client chưa hề dự đoán → reconcile lệch liên tục. Nên chờ tối
  // đa INPUT_STARVE_GRACE_TICKS tick (cmd tới sau sẽ được bù, tối đa MAX_INPUTS_PER_TICK mỗi tick).
  // Người chưa gửi cmd nào (lastCmd null) hoặc im quá lâu thì mới chạy idle.
  p.starvedTicks++
  if (p.lastCmd && p.starvedTicks <= INPUT_STARVE_GRACE_TICKS) return

  // Chạy tiếp lastCmd đã bỏ Jump/Fire/Reload, không tăng lastProcessedSeq
  const idle = p.idleCmd
  const last = p.lastCmd
  idle.buttons = last ? last.buttons & HELD_MASK & phaseButtonMask(room?.phase ?? MatchPhase.Playing, p.alive) : 0
  idle.yaw = last ? last.yaw : p.state.yaw
  idle.pitch = last ? last.pitch : p.state.pitch
  p.state = stepMovement(p.state, idle, p.world, cfg, DT, moveSpeedMul(p.weapon, idle.buttons))
}

// serverTime = thời điểm của tick này; lịch sử hitbox ghi theo mốc này sau khi mọi người đã bước
export function stepRoom(room: Room, cfg: MovementConfig, serverTime = room.serverNow, tick?: number): void {
  room.serverNow = serverTime
  room.tick = tick ?? room.tick + 1
  for (const p of room.players.values()) stepPlayer(p, cfg, room)
  room.finalizeDeaths()
  stepGrenades(room)   // sau finalizeDeaths: lựu đạn rơi từ người vừa chết đã vào danh sách
  room.respawnDue()
  updateMatch(room)
  room.history.record(serverTime, room.players.values())
}

// Snapshot chứa mọi người; chỉ `ack` khác nhau giữa các client
export function sendSnapshots(room: Room, tick: number, serverTime: number): void {
  if (tick % SNAPSHOT_EVERY_TICKS !== 0 || room.players.size === 0) return
  const players: NetPlayer[] = []
  for (const p of room.players.values()) {
    const flags = (p.alive ? 0 : NetFlag.Dead) | (p.alive && serverTime < p.invulnUntil ? NetFlag.Invuln : 0)
    players.push(stateToNet(p.id, p.state, Math.max(0, p.hp), flags, p.team, p.weapon.current, p.killStreak))
  }
  for (const p of room.players.values()) {
    p.transport.send({ t: MsgType.Snapshot, tick, serverTime, ack: p.lastProcessedSeq, players, wpn: p.weapon, money: p.money, loadout: p.loadout.slots })
  }
}
