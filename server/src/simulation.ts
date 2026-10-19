import {
  Btn, DT, INPUT_STARVE_GRACE_TICKS, MAX_INPUTS_PER_TICK, MAX_INPUT_QUEUE, MsgType, SNAPSHOT_EVERY_TICKS,
  isValidCmd, stateToNet, stepMovement,
  type MovementConfig, type NetPlayer,
} from '@fps/shared'
import type { Player, Room } from './room'

// Khi không có input mới, giữ hướng di chuyển nhưng không lặp hành động một lần
const HELD_MASK = ~(Btn.Jump | Btn.Fire | Btn.Reload)
const MAX_CMDS_PER_MSG = 16

// Cmd từ client không đáng tin: sai thì bỏ; hàng đợi quá dài thì bỏ cmd cũ nhất
export function enqueueCmds(p: Player, cmds: unknown): void {
  if (!Array.isArray(cmds)) return
  for (let i = 0; i < cmds.length && i < MAX_CMDS_PER_MSG; i++) {
    const c = cmds[i]
    if (!isValidCmd(c)) continue
    p.inputQueue.push(c)
    if (p.inputQueue.length > MAX_INPUT_QUEUE) p.inputQueue.shift()
  }
}

export function stepPlayer(p: Player, cfg: MovementConfig): void {
  if (!p.world) return
  let ran = 0
  while (ran < MAX_INPUTS_PER_TICK && p.inputQueue.length > 0) {
    const cmd = p.inputQueue.shift()!
    if (cmd.seq <= p.lastProcessedSeq) continue   // trùng hoặc cũ
    p.state = stepMovement(p.state, cmd, p.world, cfg, DT)
    p.lastProcessedSeq = cmd.seq
    p.lastCmd = cmd
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
  idle.buttons = last ? last.buttons & HELD_MASK : 0
  idle.yaw = last ? last.yaw : p.state.yaw
  idle.pitch = last ? last.pitch : p.state.pitch
  p.state = stepMovement(p.state, idle, p.world, cfg, DT)
}

export function stepRoom(room: Room, cfg: MovementConfig): void {
  for (const p of room.players.values()) stepPlayer(p, cfg)
}

// Snapshot chứa mọi người; chỉ `ack` khác nhau giữa các client
export function sendSnapshots(room: Room, tick: number, serverTime: number): void {
  if (tick % SNAPSHOT_EVERY_TICKS !== 0 || room.players.size === 0) return
  const players: NetPlayer[] = []
  for (const p of room.players.values()) players.push(stateToNet(p.id, p.state))
  for (const p of room.players.values()) {
    p.transport.send({ t: MsgType.Snapshot, tick, serverTime, ack: p.lastProcessedSeq, players })
  }
}
