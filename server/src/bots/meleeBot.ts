// Bot thể thức Cận Chiến (plan 19 P7). Như bot thường: mỗi tick chỉ sinh InputCmd (phím + yaw/pitch), mọi luật đánh / đỡ / thể lực
// chạy qua stepMelee + quét va chạm của server như người thật.
//
//  - Xa: tìm đường tới đối thủ gần nhất (dùng lại ZombieBrain, không chui lỗ / không bật nhảy).
//  - Gần: giữ khoảng cách vừa tầm dao, đi vòng quanh, đánh theo chuỗi combo ngẫu nhiên của bộ chiêu.
//  - Đối thủ ra chiêu về phía mình: sau thời gian phản xạ thì đỡ (giữ Shift) hoặc canh parry (bấm Shift sát lúc trúng).
//  - Hết thể lực: lùi lại, chỉ đỡ, hồi đủ mới đánh tiếp.
import {
  Btn, KNIFE_SET, TICK_RATE, WEAPONS, defaultMovement, isStaggered, meleeSetOf, moveDurationMs, staminaAt,
  type InputCmd, type MeleeSet, type Vec3,
} from '@fps/shared'
import type { Player, Room } from '../room'
import { ZombieBrain } from '../zombies/brain'
import { rand, type BotMelee } from './params'

const DEG = Math.PI / 180
/** Khoảng cách ngang (m) */
export const MELEE_BOT = {
  engageM: 3.0,        // gần hơn: thôi tìm đường, vào thế đánh
  attackM: 1.9,        // trong tầm này mới ra chiêu
  keepM: 1.4,          // khoảng muốn giữ khi đi vòng
  tooCloseM: 0.9,      // sát quá thì lùi
  retargetMs: 800,
  pressAheadMs: 110,   // bấm chiêu kế khi chiêu hiện tại còn ngần này (bộ đệm input 150 ms)
  parryLeadMs: [40, 140] as [number, number],   // bấm đỡ trước lúc trúng bấy nhiêu ms để mở cửa sổ parry
}

const L = 1, R = 2
const KNIFE_RANGE = 2.2   // khoảng cách trong MELEE_BOT tính cho dao; vũ khí khác co giãn theo `range`

/** Mọi chuỗi phím đi được trên cây combo của bộ chiêu (L L R...), tính một lần mỗi bộ */
const combosCache = new Map<MeleeSet, number[][]>()
function combosOf(set: MeleeSet): number[][] {
  let out = combosCache.get(set)
  if (out) return out
  out = []
  const walk = (idx: number, keys: number[]): void => {
    out!.push(keys)
    const nx = set.moves[idx]!.next
    if (nx[0] >= 0) walk(nx[0], [...keys, L])
    if (nx[1] >= 0) walk(nx[1], [...keys, R])
  }
  walk(set.roots[0], [L]); walk(set.roots[1], [R])
  combosCache.set(set, out)
  return out
}

const _eye: Vec3 = [0, 0, 0]

export class MeleeBotBrain {
  private brain: ZombieBrain | null = null
  private targetId = -1
  private retargetAt = 0
  // combo
  private combo: readonly number[] | null = null
  private comboIdx = 0
  private nextComboAt = 0
  private keyHeld = 0          // phím vừa bấm tick trước (thả ra để tạo cạnh lên cho lần sau)
  private aimErr = 0
  // phòng thủ
  private watchedStart = -1    // meleeStartMs của chiêu đối thủ đã quyết định
  private pendingStart = -1    // chiêu đối thủ đang chờ hết thời gian phản xạ
  private pendingReact = 0
  private guardFrom = 0        // serverTime bắt đầu giữ đỡ
  private guardUntil = 0
  private retreating = false
  // đi vòng
  private strafeDir = 1
  private strafeUntil = 0

  constructor(private readonly params: () => BotMelee, private readonly rng: () => number) {}

  reset(): void {
    this.brain?.reset()
    this.targetId = -1; this.retargetAt = 0
    this.combo = null; this.comboIdx = 0; this.nextComboAt = 0; this.keyHeld = 0
    this.watchedStart = this.pendingStart = -1; this.guardFrom = this.guardUntil = 0; this.retreating = false
  }

  /** Ô đang chứa vũ khí cận chiến (thể thức Cận Chiến chỉ có dao) */
  static meleeSlot(p: Player): number {
    const slots = p.weapon.slots
    for (let i = 0; i < slots.length; i++) if (slots[i]! >= 0 && WEAPONS[slots[i]!]?.melee) return i
    return p.weapon.slot
  }

  /** Ghi phím + hướng nhìn vào `cmd` (seq, weapon đã đặt). `now` = serverTime */
  drive(room: Room, me: Player, cmd: InputCmd, now: number, yaw: number): number {
    const pr = this.params()
    if (!this.brain && room.nav) this.brain = new ZombieBrain(room.nav, { hole: false, leap: false }, this.rng)
    const tgt = this.pickTarget(room, me, now)
    cmd.buttons = 0
    cmd.yaw = yaw; cmd.pitch = 0
    if (!tgt) return yaw

    const dx = tgt.state.pos[0] - me.state.pos[0], dz = tgt.state.pos[2] - me.state.pos[2]
    const hd = Math.hypot(dx, dz)
    const def = WEAPONS[me.weapon.current]!, set = meleeSetOf(def) ?? KNIFE_SET
    const k = Math.max(1, def.range / KNIFE_RANGE)   // vũ khí dài: đứng xa hơn
    const sameLevel = Math.abs(tgt.state.pos[1] - me.state.pos[1]) < 1.6

    // Xa (hoặc khác tầng): tìm đường
    if (hd > MELEE_BOT.engageM * k || !sameLevel) {
      if (this.brain) this.brain.step(cmd, me.state, tgt.state.pos, now, false)
      else { cmd.yaw = Math.atan2(-dx, -dz); cmd.buttons = Btn.Forward }
      this.keyHeld = 0
      return cmd.yaw
    }

    // Gần: quay mặt vào đối thủ (tốc độ quay có hạn + lệch nhỏ), nhìn vào ngực
    const want = Math.atan2(-dx, -dz) + this.aimErr
    const maxTurn = pr.turnDegPerSec * DEG / TICK_RATE
    let d = want - yaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    cmd.yaw = yaw + Math.max(-maxTurn, Math.min(maxTurn, d))
    eyeY(me, _eye)
    cmd.pitch = Math.atan2(tgt.state.pos[1] + 1.1 - _eye[1], Math.max(0.3, hd))

    const ws = me.weapon
    const myNow = cmd.seq * 1000 / TICK_RATE   // thang thời gian của chính bot (WeaponState tính theo seq)
    const stamina = staminaAt(ws, myNow)
    if (stamina < pr.retreatStamina) this.retreating = true
    else if (stamina >= pr.resumeStamina) this.retreating = false

    // Phòng thủ: đối thủ đang ra chiêu về phía mình
    this.watchIncoming(tgt, me, now, pr)
    const guarding = now >= this.guardFrom && now < this.guardUntil

    // Di chuyển: giữ khoảng cách, đi vòng; lùi khi hết thể lực
    let mv = 0
    if (this.retreating) mv |= Btn.Back
    else if (hd > MELEE_BOT.attackM * k) mv |= Btn.Forward
    else if (hd < MELEE_BOT.tooCloseM * k) mv |= Btn.Back
    else if (hd > MELEE_BOT.keepM * k + 0.3) mv |= Btn.Forward
    if (now >= this.strafeUntil) { this.strafeUntil = now + rand(this.rng, pr.strafeMs); this.strafeDir = this.rng() < 0.5 ? -1 : 1 }
    mv |= this.strafeDir > 0 ? Btn.Right : Btn.Left

    let act = 0
    if (guarding) { act = Btn.Guard; this.combo = null }
    else if (!this.retreating && !isStaggered(ws, myNow) && hd <= MELEE_BOT.attackM * k) act = this.attackKey(set, ws.meleeMove, ws.meleeStartMs, myNow, now, pr)
    if (act !== Btn.Guard) this.keyHeld = act
    cmd.buttons = mv | act
    return cmd.yaw
  }

  /** Mục tiêu: đối thủ còn sống gần nhất (theo đường chim bay, tầng khác tính nặng hơn) */
  private pickTarget(room: Room, me: Player, now: number): Player | null {
    let cur = room.players.get(this.targetId)
    if (now >= this.retargetAt || !cur || !cur.alive || cur.team === me.team) {
      this.retargetAt = now + MELEE_BOT.retargetMs
      let best: Player | null = null, bestD = Infinity
      for (const o of room.players.values()) {
        if (o === me || !o.alive || o.team === me.team) continue
        const dd = Math.hypot(o.state.pos[0] - me.state.pos[0], o.state.pos[2] - me.state.pos[2]) + Math.abs(o.state.pos[1] - me.state.pos[1]) * 3
        if (dd < bestD) { bestD = dd; best = o }
      }
      if (best && best.id !== this.targetId) { this.targetId = best.id; this.combo = null }
      cur = best ?? undefined
    }
    return cur ?? null
  }

  /** Thấy đối thủ bắt đầu một chiêu và đang nhìn về phía mình: sau phản xạ quyết định đỡ / canh parry / mặc kệ */
  private watchIncoming(tgt: Player, me: Player, now: number, pr: BotMelee): void {
    const ows = tgt.weapon
    if (ows.meleeMove < 0) return
    const set = meleeSetOf(WEAPONS[ows.current]!) ?? KNIFE_SET
    const m = set.moves[ows.meleeMove]
    if (!m || ows.meleeStartMs === this.watchedStart) return
    const oNow = tgt.lastProcessedSeq * 1000 / TICK_RATE
    const elapsed = oNow - ows.meleeStartMs
    if (this.pendingStart !== ows.meleeStartMs) { this.pendingStart = ows.meleeStartMs; this.pendingReact = rand(this.rng, pr.reactionMs) }
    if (elapsed < this.pendingReact) return   // chưa kịp phản xạ
    this.watchedStart = ows.meleeStartMs
    // đối thủ có quay về phía mình không (chỉ né những đòn nhắm vào mình)
    const fx = -Math.sin(tgt.state.yaw), fz = -Math.cos(tgt.state.yaw)
    const dx = me.state.pos[0] - tgt.state.pos[0], dz = me.state.pos[2] - tgt.state.pos[2]
    const len = Math.hypot(dx, dz) || 1
    if ((dx * fx + dz * fz) / len < Math.cos(70 * DEG)) return
    const firstHit = now + (m.windupMs - elapsed)
    const lastHitEnd = firstHit + (m.hitCount - 1) * m.hitIntervalMs + m.strikeMs
    const roll = this.rng()
    if (roll < pr.parryChance) {
      const lead = rand(this.rng, MELEE_BOT.parryLeadMs)
      this.guardFrom = Math.max(now, firstHit - lead)
      this.guardUntil = lastHitEnd + 60
    } else if (roll < pr.parryChance + pr.guardChance) {
      this.guardFrom = now
      this.guardUntil = lastHitEnd + 120
    }
  }

  /** Phím đánh tick này theo chuỗi combo đang chạy (cạnh lên: bấm 1 tick rồi thả) */
  private attackKey(set: MeleeSet, moveIdx: number, startMs: number, myNow: number, now: number, pr: BotMelee): number {
    if (this.keyHeld !== 0) return 0   // thả phím một tick để lần bấm sau là cạnh lên
    if (!this.combo) {
      if (now < this.nextComboAt) return 0
      const combos = combosOf(set)
      this.combo = combos[Math.floor(this.rng() * combos.length)]!
      this.comboIdx = 0
      this.aimErr = (this.rng() * 2 - 1) * pr.aimErrorDeg * DEG
    }
    if (this.comboIdx >= this.combo.length) {
      if (moveIdx < 0) {
        this.combo = null; this.nextComboAt = now + rand(this.rng, pr.comboPauseMs)
        if (this.rng() < pr.guardChance) { this.guardFrom = now; this.guardUntil = this.nextComboAt }   // nghỉ giữa hai chuỗi: giơ dao thủ sẵn
      }
      return 0
    }
    // chiêu đang chạy: chỉ bấm tiếp khi sắp hết (lọt bộ đệm input) để nối combo
    if (moveIdx >= 0) {
      const m = set.moves[moveIdx]
      if (!m || myNow - startMs < moveDurationMs(m) - MELEE_BOT.pressAheadMs) return 0
    }
    const key = this.combo[this.comboIdx++]!
    return key === L ? Btn.Fire : Btn.Aim
  }

  /** Đang giữ đỡ (debug) */
  get guarding(): boolean { return this.guardUntil > 0 }
  get target(): number { return this.targetId }
}

function eyeY(p: Player, out: Vec3): Vec3 {
  out[0] = p.state.pos[0]; out[1] = p.state.pos[1] + (p.state.crouching ? defaultMovement.eyeCrouch : defaultMovement.eyeStand); out[2] = p.state.pos[2]
  return out
}
