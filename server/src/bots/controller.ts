// Bot (plan 15, B.2–B.6). Bot là một Player bình thường: mỗi tick chỉ sinh InputCmd (phím + yaw/pitch) rồi đi qua
// đúng stepPlayer (stepMovement, stepWeaponCmd, resolveShot, spread, recoil) như người thật. Không đặt vị trí, không sửa máu, không bắn trúng trực tiếp.
//
//  think()  10Hz  : nhận thức, chọn hành vi (trung bình: máy trạng thái; khó: utility), tìm đường
//  drive()  mỗi tick: ngắm + bắn (lớp chiến đấu, độc lập với hành vi di chuyển) + phím di chuyển
import {
  Btn, DEFAULT_SLOT, DT, GRENADE, GRENADE_ID, GRENADE_SLOT, MatchPhase, TICK_RATE, WEAPONS, defaultMovement, phaseButtonMask, stepGrenade, throwInitial, weaponByKey,
  type AnyMsg, type BotDebugInfo, type BotDifficulty, type GrenadeState, type InputCmd, type PlayerState, type Transport, type Vec3,
} from '@fps/shared'
import type { Player, Room } from '../room'
import { handleBuy } from '../shop'
import { Aim, anglesTo, wrapAngle } from './aim'
import { EdgeKind, Zone, type Waypoint } from './nav'
import { Perception, bodyPoint, eyeOf, type Known } from './perception'
import { getBotParams, rand, randInt, type BotParams } from './params'
import { ZombieBrain } from '../zombies/brain'

export type BotState = 'Patrol' | 'Engage' | 'Search' | 'Reload' | 'Hunt' | 'TakeCover' | 'Peek' | 'Flank' | 'Push'

const DEG = Math.PI / 180
const THINK_MS = 100
const ARRIVE_M = 0.6
const STUCK_MS = 1500
const MELEE_RANGE = 2.2
const COVER_SEARCH_M = 12
const COVER_RAYS = 14
const NADE_COOLDOWN_MS = 20_000
const STICKY = 0.15
const BUY_GAP_MS = 230

const cfg = defaultMovement
const _tmpA: Vec3 = [0, 0, 0]
const _tmpB: Vec3 = [0, 0, 0]
const _ang: [number, number] = [0, 0]

export class BotController {
  readonly transport: Transport
  readonly aim: Aim
  state: BotState = 'Patrol'
  private room!: Room
  private me!: Player
  private perc!: Perception
  private seq = 0
  private readonly cmdA: InputCmd = { seq: 0, buttons: 0, yaw: 0, pitch: 0, weapon: DEFAULT_SLOT }
  private readonly cmdB: InputCmd = { seq: 0, buttons: 0, yaw: 0, pitch: 0, weapon: DEFAULT_SLOT }
  private flip = false
  private nextThinkAt = 0
  private wasAlive = false
  private lastPos: Vec3 = [0, 0, 0]
  private wantSlot = DEFAULT_SLOT
  private buyQueue: string[] = []
  private nextBuyAt = 0

  // mục tiêu / chiến đấu
  private targetId = -1
  private burstLeft = 0
  private pauseUntil = 0
  private nextTapAt = 0
  private lastShotSeq = 0
  private reloadPress = false
  private lookOverride: { yaw: number; pitch: number; until: number } | null = null
  private lastSuspLookAt = -1
  private scanAt = 0
  private scanYaw = 0

  // di chuyển
  private path: Waypoint[] | null = null
  private pathIdx = 0
  private goal: Vec3 | null = null
  private goalCost: ((n: number) => number) | undefined
  private wishX = 0
  private wishZ = 0
  private hasWish = false
  private speedCap = Infinity
  private wantCrouch = false
  private wantJump = false
  private progressPos: Vec3 = [0, 0, 0]
  private progressAt = 0
  private stuckCount = 0
  private strafeDir = 1
  private strafeUntil = 0
  private sidestepAt = 0
  private sidestepUntil = 0
  private crouchFight = false
  private slideUntil = 0
  private nextSlideAt = 0

  // hành vi
  private stateSince = 0
  private dwellUntil = 0
  private coverNode = -1
  private coverReadyAt = 0
  private peeks = 0
  private peekPhase: 'out' | 'fight' | 'back' = 'out'
  private peekUntil = 0
  private peekNode = -1
  private excludeCover = -1
  private coverFailUntil = 0
  private flankUntil = 0
  private flankCooldown = 0
  private exposure: Uint8Array | null = null
  private exposureFor: Vec3 = [1e9, 0, 1e9]
  private nade: { yaw: number; pitch: number; startedAt: number; releaseAt: number } | null = null
  private nextNadeAt = 0
  private hpLowEnter = false

  constructor(readonly difficulty: BotDifficulty, private readonly rng: () => number = Math.random) {
    this.aim = new Aim(rng)
    this.transport = {
      send: (msg: AnyMsg) => { if (this.perc) this.perc.onMessage(msg, this.room.serverNow, this.params) },
      onMessage: () => {},
      onClose: () => {},
    }
  }

  get params(): BotParams { return getBotParams(this.difficulty) }
  get hard(): boolean { return this.difficulty === 'hard' }

  attach(room: Room, me: Player): void {
    this.room = room; this.me = me
    this.perc = new Perception(me, room, this.rng, this.hard)
    this.aim.set(me.state.yaw, 0)
    this.lastPos = [me.state.pos[0], me.state.pos[1], me.state.pos[2]]
    this.nextThinkAt = room.serverNow + (me.id % 6) * (THINK_MS / 6)
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Mỗi tick, trước stepPlayer
  drive(room: Room, p: Player, nowMs: number): void {
    const cmd = (this.flip = !this.flip) ? this.cmdA : this.cmdB
    cmd.seq = this.seq++
    cmd.weapon = this.wantSlot
    cmd.buttons = 0
    if (!p.alive) {
      this.wasAlive = false
      cmd.yaw = this.aim.yaw; cmd.pitch = this.aim.pitch
      p.inputQueue.push(cmd)
      return
    }
    // hồi sinh (kể cả bị dịch chuyển khi đổi phe/đầu trận)
    const jumped = Math.hypot(p.state.pos[0] - this.lastPos[0], p.state.pos[2] - this.lastPos[2]) > 4
    if (!this.wasAlive || jumped) this.onRespawn(nowMs)
    this.wasAlive = true
    this.lastPos[0] = p.state.pos[0]; this.lastPos[1] = p.state.pos[1]; this.lastPos[2] = p.state.pos[2]

    if (p.role === 'zombie') { this.driveZombie(room, p, cmd, nowMs); return }   // Lây Nhiễm: bot làm zombie đi săn người (plan 16 I.5)
    if (nowMs >= this.nextThinkAt) { this.nextThinkAt = nowMs + THINK_MS; this.think(nowMs) }
    this.tickBuy(nowMs)

    let buttons = 0
    buttons |= this.combatTick(nowMs)
    buttons |= this.moveTick(nowMs)
    if (this.reloadPress) { buttons |= Btn.Reload; this.reloadPress = false }
    cmd.buttons = buttons & phaseButtonMask(room.phase, true)
    cmd.yaw = this.aim.yaw; cmd.pitch = this.aim.pitch
    p.inputQueue.push(cmd)
  }

  // ── Bot đóng vai zombie: tìm đường tới người gần nhất (cạnh Hole/Leap), cào khi tới gần, đánh hơi khi lâu không thấy người
  private zbrain: ZombieBrain | null = null
  private zTargetAt = 0
  private zTargetId = -1
  private zNextAttackAt = 0
  private zNextSniffAt = 0
  private zLastSeenAt = 0
  private readonly zTgt: Vec3 = [0, 0, 0]

  private driveZombie(room: Room, p: Player, cmd: InputCmd, now: number): void {
    if (!room.nav) { cmd.yaw = this.aim.yaw; p.inputQueue.push(cmd); return }
    if (!this.zbrain) this.zbrain = new ZombieBrain(room.nav, { hole: true, leap: true }, this.rng)
    if (now >= this.zTargetAt) {
      this.zTargetAt = now + 1000
      let best = -1, bestD = Infinity
      for (const o of room.players.values()) {
        if (o.role !== 'human' || !o.alive) continue
        const d = Math.hypot(o.state.pos[0] - p.state.pos[0], o.state.pos[2] - p.state.pos[2]) + Math.abs(o.state.pos[1] - p.state.pos[1]) * 2
        if (d < bestD) { bestD = d; best = o.id }
      }
      this.zTargetId = best
    }
    const tgt = room.players.get(this.zTargetId)
    if (!tgt || !tgt.alive || tgt.role !== 'human') { this.zTargetAt = 0; cmd.yaw = this.aim.yaw; p.inputQueue.push(cmd); return }
    this.zTgt[0] = tgt.state.pos[0]; this.zTgt[1] = tgt.state.pos[1]; this.zTgt[2] = tgt.state.pos[2]
    const r = this.zbrain.step(cmd, p.state, this.zTgt, now, (p.state.leapCd ?? 0) <= 0)
    if (r.attack && now >= this.zNextAttackAt) {
      const hd = Math.hypot(this.zTgt[0] - p.state.pos[0], this.zTgt[2] - p.state.pos[2])
      cmd.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(this.zTgt[1] + 1.1 - (p.state.pos[1] + 1.6), Math.max(0.2, hd))))
      cmd.buttons |= this.rng() < 0.3 ? Btn.Aim : Btn.Fire   // thỉnh thoảng cào mạnh
      this.zNextAttackAt = now + 600
    }
    // đánh hơi (Q) khi 10s không có người nào trong tầm nhìn gần
    if (Math.hypot(this.zTgt[0] - p.state.pos[0], this.zTgt[2] - p.state.pos[2]) < 12) this.zLastSeenAt = now
    if (now - this.zLastSeenAt > 10_000 && now >= this.zNextSniffAt) { cmd.buttons |= Btn.Sniff; this.zNextSniffAt = now + 15_000; this.zLastSeenAt = now }
    cmd.buttons &= phaseButtonMask(room.phase, true)
    this.aim.set(cmd.yaw, cmd.pitch)
    p.inputQueue.push(cmd)
  }

  private onRespawn(now: number): void {
    const me = this.me
    this.perc.reset()
    this.targetId = -1; this.aim.end()
    this.aim.set(me.state.yaw, 0)
    this.path = null; this.goal = null; this.pathIdx = 0
    this.burstLeft = 0; this.pauseUntil = 0
    this.lookOverride = null; this.nade = null
    this.lastShotSeq = me.weapon.shotSeq
    this.coverNode = -1; this.peeks = 0; this.excludeCover = -1
    this.progressPos[0] = me.state.pos[0]; this.progressPos[1] = me.state.pos[1]; this.progressPos[2] = me.state.pos[2]; this.progressAt = now; this.stuckCount = 0
    this.enter(this.hard ? 'Hunt' : 'Patrol', now)
    this.dwellUntil = 0
    this.planBuys()
    this.wantSlot = DEFAULT_SLOT
    this.hpLowEnter = false
  }

  // ── Mua đồ (B.2/B.8) ────────────────────────────────────────────────────────────────────
  private planBuys(): void {
    const b = this.params.buy
    const q: string[] = []
    const pick = (l: string[]) => l[Math.floor(this.rng() * l.length)]!
    if (b.pistol.length > 0) q.push(pick(b.pistol))
    const useMid = b.mid.length > 0 && (b.long.length === 0 || this.rng() < 0.5)
    if (useMid) q.push(pick(b.mid))
    else if (b.long.length > 0) q.push(pick(b.long))
    for (let i = 0; i < b.grenades; i++) q.push('m67')
    this.buyQueue = q
    this.nextBuyAt = this.room.serverNow + 200 + this.rng() * 400
  }

  private tickBuy(now: number): void {
    if (this.buyQueue.length === 0 || now < this.nextBuyAt) return
    const key = this.buyQueue.shift()!
    this.nextBuyAt = now + BUY_GAP_MS
    handleBuy(this.room, this.me, key)
    const def = weaponByKey(key)
    if (def && !def.consumable && this.me.weapon.slots[this.me.weapon.slot] === def.id) this.wantSlot = this.me.weapon.slot
  }

  // ── Nghĩ (10Hz) ─────────────────────────────────────────────────────────────────────────
  private think(now: number): void {
    const me = this.me, params = this.params
    this.perc.update(now, params, this.aim.yaw, this.aim.pitch)

    // chọn mục tiêu: gần nhất trong số đang thấy và đã qua phản xạ; đang bám ai còn thấy thì giữ
    let best: Known | null = null
    const cur = this.perc.known.get(this.targetId)
    if (cur && cur.visible && now >= cur.reactAtMs) best = cur
    else for (const k of this.perc.known.values()) if (k.visible && now >= k.reactAtMs && (!best || k.dist < best.dist)) best = k
    if (best && best.id !== this.targetId) { this.targetId = best.id; this.aim.begin(best.id, params); this.burstLeft = 0; this.pauseUntil = now + 0 }
    else if (!best && this.targetId >= 0) { this.targetId = -1; this.aim.end() }

    // vừa thấy địch nhưng còn đang "phản xạ": quay đầu nhìn thẳng vào nó (người thấy địch thì nhìn về phía đó, rồi mới ngắm/bắn)
    if (!best) {
      for (const k of this.perc.known.values()) {
        if (!k.visible || now >= k.reactAtMs) continue
        const o = this.room.players.get(k.id)
        if (!o) continue
        anglesTo(eyeOf(me, _tmpA), bodyPoint(o, false, _tmpB), _ang)
        this.lookOverride = { yaw: _ang[0], pitch: _ang[1], until: k.reactAtMs + 300 }
        break
      }
    }
    // nghi ngờ / bị bắn: quay đầu về hướng đó (khi chưa thấy ai)
    if (!best) {
      if (now - this.perc.hurtAtMs < 120) this.lookOverride = { yaw: this.perc.hurtYaw, pitch: 0, until: now + 1500 }
      else if (this.perc.suspicion && this.perc.suspicion.atMs !== this.lastSuspLookAt) {
        this.lastSuspLookAt = this.perc.suspicion.atMs
        anglesTo(eyeOf(me, _tmpA), this.perc.suspicion.pos, _ang)
        this.lookOverride = { yaw: _ang[0], pitch: 0, until: now + 1200 }
      }
    }

    // nạp đạn
    const ws = me.weapon, def = WEAPONS[ws.current]!
    if (!def.melee && ws.current !== GRENADE_ID && ws.reloadEndMs === 0) {
      const ammo = ws.ammo[def.id]!
      if (ammo <= 0 || (ammo < def.magSize * 0.4 && !best && this.state !== 'Engage')) this.reloadPress = true
    }

    this.checkStuck(now)
    if (this.hard) this.thinkHard(now); else this.thinkMedium(now)
    if (this.hard && params.skills.grenade) this.thinkGrenade(now)
  }

  // ── Trung bình (B.5) ────────────────────────────────────────────────────────────────────
  private thinkMedium(now: number): void {
    const me = this.me
    const target = this.perc.known.get(this.targetId)
    const reloading = me.weapon.reloadEndMs > 0
    if (reloading && !target?.visible) { if (this.state !== 'Reload') this.enter('Reload', now); return }
    if (this.state === 'Reload' && !reloading) this.enter('Patrol', now)
    if (target) {
      if (this.state !== 'Engage') {
        this.enter('Engage', now)
        this.crouchFight = this.rng() < this.params.crouchChance
        this.sidestepAt = now + rand(this.rng, [3000, 5000])
      }
      return
    }
    if (this.state === 'Engage') {
      const last = this.lastKnown()
      this.enter('Search', now)
      if (last) this.goTo(last.pos, false)
      return
    }
    if (this.state === 'Search') {
      const last = this.lastKnown()
      if (!last && !this.perc.suspicion) { this.enter('Patrol', now); return }
      if (!this.path && last && now - last.lastSeenMs <= this.params.memoryMs) this.scanAround(now)
      else if (!this.path) this.enter('Patrol', now)
      return
    }
    if (this.state === 'Patrol') {
      if (this.path) return
      if (this.dwellUntil === 0) { this.dwellUntil = now + rand(this.rng, [3000, 8000]) }
      if (now < this.dwellUntil) { this.scanAround(now); return }
      this.dwellUntil = 0
      const node = this.randomNode(true)
      if (node >= 0) this.goTo(this.room.nav!.pos(node, [0, 0, 0]), false)
    }
  }

  // ── Khó (B.6): chọn hành vi bằng điểm ưu tiên ──────────────────────────────────────────
  private thinkHard(now: number): void {
    const me = this.me, params = this.params, sk = params.skills
    const target = this.perc.known.get(this.targetId) ?? null
    const reloading = me.weapon.reloadEndMs > 0
    const threat = this.threatPos(now)
    const scores: Partial<Record<BotState, number>> = {}

    scores.Engage = target ? 0.6 : 0
    scores.Hunt = target ? 0 : 0.35 + (threat ? 0.2 : 0)

    const lost = this.perc.hitsTaken(now, 1000) >= 2 && now - this.perc.lastDealtMs > 1000
    const lowHp = me.hp < 50
    if (sk.cover && threat && now >= this.coverFailUntil) {
      let c = 0
      if (lowHp) c = 0.9
      if (reloading) c = Math.max(c, 0.85)
      if (lost) c = Math.max(c, 0.95)
      // đã núp xong và sẵn sàng (nạp xong, hết thời gian ẩn) thì thôi "đang cần núp": nhường cho Peek, không thì máu thấp giữ bot trốn mãi
      if ((this.state === 'TakeCover' || this.state === 'Peek') && sk.peek && this.coverNode >= 0 && this.peeks < 3 && this.peekReady(now)) c = 0
      scores.TakeCover = c
    }
    // đang núp xong → ló ra
    if (sk.peek && (this.state === 'TakeCover' || this.state === 'Peek') && this.coverNode >= 0 && threat && this.peeks < 3) {
      const ready = this.peekReady(now)
      if (ready || this.state === 'Peek') scores.Peek = 0.9
    }
    if (sk.flank && now >= this.flankCooldown) {
      for (const k of this.perc.known.values()) {
        if (now - k.stillSince >= 4000 && now - k.lastSeenMs < 3000 && k.dist > 12) { scores.Flank = 0.7; break }
      }
    }
    if (sk.push) {
      const hasMid = WEAPONS[me.weapon.current]!.category === 'mid'
      for (const k of this.perc.known.values()) {
        if (now - k.lastSeenMs > 3000) continue
        const o = this.room.players.get(k.id)
        if (!o || !o.alive) continue
        if ((o.weapon.reloadEndMs > 0 && k.dist < 20) || this.perc.dealtTo(k.id, now) >= 60 || (hasMid && k.dist < 35)) { scores.Push = 0.75; break }
      }
      if (reloading) scores.Push = 0
    }
    // dính: đang làm gì thì cộng điểm cho hành vi đó
    if (scores[this.state] !== undefined && scores[this.state]! > 0) scores[this.state]! += STICKY
    else if (this.state === 'TakeCover' || this.state === 'Peek') {
      // đang núp mà tạm hết điều kiện: giữ chỗ núp tới khi hết hạn
      if (this.coverNode >= 0 && now < this.coverReadyAt + 4000) scores[this.state] = Math.max(scores[this.state] ?? 0, 0.5)
    }

    let best: BotState = 'Hunt', bestScore = -1
    for (const s of Object.keys(scores) as BotState[]) if (scores[s]! > bestScore) { bestScore = scores[s]!; best = s }
    if (best !== this.state) this.enterHard(best, now, threat)
    this.stepHard(now, threat)
  }

  private enterHard(s: BotState, now: number, threat: Vec3 | null): void {
    this.enter(s, now)
    switch (s) {
      case 'Engage': this.path = null; this.crouchFight = this.rng() < this.params.crouchChance * 0.5; break
      case 'TakeCover': if (!this.chooseCover(now, threat)) { this.coverFailUntil = now + 2000; this.enter('Hunt', now) } break
      case 'Peek': this.peekPhase = 'out'; this.peekUntil = 0; this.pickPeek(now, threat); break
      case 'Flank': this.startFlank(now); break
      case 'Push': this.path = null; break
      case 'Hunt': this.path = null; break
    }
  }

  private stepHard(now: number, threat: Vec3 | null): void {
    const me = this.me
    switch (this.state) {
      case 'Hunt': {
        if (this.path && this.goal && now - this.stateSince < 2500) break   // đang đi: để yên, hết 2,5s mới cân nhắc lại
        let goal: Vec3 | null = this.lastKnown()?.pos ?? this.perc.suspicion?.pos ?? null
        if (!goal || Math.hypot(goal[0] - me.state.pos[0], goal[2] - me.state.pos[2]) < 3) {
          const node = this.randomNode(false)
          if (node >= 0) goal = this.room.nav!.pos(node, [0, 0, 0])
        }
        if (goal) {
          const nav = this.room.nav
          this.goTo(goal, true, nav ? i => (nav.cover[i] === 0 ? 0.8 : 0) : undefined)   // thích đường có nhiều chỗ núp
          this.stateSince = now
        }
        break
      }
      case 'Engage': break
      case 'TakeCover': {
        if (this.coverNode < 0) { this.enter('Hunt', now); break }
        if (!this.path) {
          const nav = this.room.nav!
          const near = Math.hypot(nav.x[this.coverNode]! - me.state.pos[0], nav.z[this.coverNode]! - me.state.pos[2]) < 1.2
          if (near) { if (this.coverReadyAt === 0) this.coverReadyAt = now + rand(this.rng, me.hp < 50 ? [2500, 3500] : [1200, 2000]) }
          else this.goTo(nav.pos(this.coverNode, _tmpA), true)
        }
        break
      }
      case 'Peek': this.stepPeek(now, threat); break
      case 'Flank': {
        if (!this.path || now > this.flankUntil) { this.flankCooldown = now + 6000; this.enter('Hunt', now) }
        break
      }
      case 'Push': {
        const k = this.nearestKnown(now)
        if (!k) { this.enter('Hunt', now); break }
        if (!this.path || now - this.stateSince > 1200) { this.goTo(k.pos, true); this.stateSince = now }
        // trượt vào tầm gần
        const hs = Math.hypot(me.state.vel[0], me.state.vel[2])
        if (k.dist < 12 && k.dist > 4 && hs >= cfg.slideMinSpeed && me.state.grounded && now >= this.nextSlideAt && me.state.slideCooldown <= 0) {
          this.slideUntil = now + 450; this.nextSlideAt = now + 3000
        }
        break
      }
    }
  }

  // ── Núp / ló (B.6) ─────────────────────────────────────────────────────────────────────
  private threatPos(now: number): Vec3 | null {
    const k = this.nearestKnown(now)
    if (k) return k.pos
    const s = this.perc.suspicion
    return s && now - s.atMs < this.params.memoryMs ? s.pos : null
  }

  private nearestKnown(now: number): Known | null {
    let best: Known | null = null
    for (const k of this.perc.known.values()) {
      if (now - k.lastSeenMs > this.params.memoryMs) continue
      if (!best || k.dist < best.dist) best = k
    }
    return best
  }

  private lastKnown(): Known | null {
    let best: Known | null = null
    for (const k of this.perc.known.values()) if (!best || k.lastSeenMs > best.lastSeenMs) best = k
    return best
  }

  private chooseCover(now: number, threat: Vec3 | null): boolean {
    const nav = this.room.nav, me = this.me, world = me.world
    if (!nav || !threat || !world) return false
    const cands = nav.nodesNear(me.state.pos[0], me.state.pos[1], me.state.pos[2], COVER_SEARCH_M, 2.5).filter(i => nav.cover[i] !== 0 && i !== this.excludeCover)
    cands.sort((a, b) => Math.hypot(nav.x[a]! - me.state.pos[0], nav.z[a]! - me.state.pos[2]) - Math.hypot(nav.x[b]! - me.state.pos[0], nav.z[b]! - me.state.pos[2]))
    const eye = _tmpA; eye[0] = threat[0]; eye[1] = threat[1] + cfg.eyeStand; eye[2] = threat[2]
    let tested = 0
    for (const c of cands) {
      if (tested >= COVER_RAYS) break
      tested++
      // địch không nhìn thấy ngực người ngồi ở node này
      const tx = nav.x[c]!, ty = nav.y[c]! + 0.8, tz = nav.z[c]!
      const dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2]
      const d = Math.hypot(dx, dy, dz)
      if (d < 3) continue
      _tmpB[0] = dx / d; _tmpB[1] = dy / d; _tmpB[2] = dz / d
      const hit = world.castRay(eye, _tmpB, d)
      if (hit && hit.dist < d - 0.3) {
        this.coverNode = c; this.coverReadyAt = 0; this.peeks = 0; this.path = null
        return true
      }
    }
    return false
  }

  private peekReady(now: number): boolean {
    const me = this.me, ws = me.weapon
    if (this.coverReadyAt === 0 || now < this.coverReadyAt) return false
    const def = WEAPONS[ws.current]!
    if (!def.melee && (ws.reloadEndMs > 0 || ws.ammo[def.id]! <= 0)) return false
    const nav = this.room.nav!
    return Math.hypot(nav.x[this.coverNode]! - me.state.pos[0], nav.z[this.coverNode]! - me.state.pos[2]) < 1.5
  }

  private pickPeek(now: number, threat: Vec3 | null): void {
    const nav = this.room.nav, me = this.me, world = me.world
    this.peekNode = -1
    if (!nav || !threat || !world || this.coverNode < 0) return
    const cx = nav.x[this.coverNode]!, cy = nav.y[this.coverNode]!, cz = nav.z[this.coverNode]!
    const cands = nav.nodesNear(cx, cy, cz, 2.2, 0.6)
    const eyeY = cfg.eyeStand
    let best = -1, bestD = Infinity
    for (const i of cands) {
      const d0 = Math.hypot(nav.x[i]! - cx, nav.z[i]! - cz)
      if (d0 < 0.8 || d0 > 2.2) continue
      _tmpA[0] = nav.x[i]!; _tmpA[1] = nav.y[i]! + eyeY; _tmpA[2] = nav.z[i]!
      const dx = threat[0] - _tmpA[0], dy = threat[1] + 1.1 - _tmpA[1], dz = threat[2] - _tmpA[2]
      const d = Math.hypot(dx, dy, dz)
      if (d < 1) continue
      _tmpB[0] = dx / d; _tmpB[1] = dy / d; _tmpB[2] = dz / d
      const hit = world.castRay(_tmpA, _tmpB, d)
      if (hit && hit.dist < d - 0.5) continue
      if (d0 < bestD) { bestD = d0; best = i }
    }
    this.peekNode = best
    void now
  }

  private stepPeek(now: number, threat: Vec3 | null): void {
    const nav = this.room.nav, me = this.me
    if (!nav || this.coverNode < 0) { this.enter('Hunt', now); return }
    const target = this.perc.known.get(this.targetId)
    if (this.peekPhase === 'out') {
      if (this.peekNode < 0) { this.peekPhase = 'fight'; this.peekUntil = now + 900; return }
      const arrived = Math.hypot(nav.x[this.peekNode]! - me.state.pos[0], nav.z[this.peekNode]! - me.state.pos[2]) < 0.9
      if (arrived) { this.peekPhase = 'fight'; this.peekUntil = now + rand(this.rng, [900, 1500]); this.path = null }
      else if (!this.path) this.goTo(nav.pos(this.peekNode, _tmpA), true)
    } else if (this.peekPhase === 'fight') {
      this.path = null
      if (now >= this.peekUntil || (!target && now > this.peekUntil - 400)) { this.peekPhase = 'back'; this.peeks++ }
    } else {
      const arrived = Math.hypot(nav.x[this.coverNode]! - me.state.pos[0], nav.z[this.coverNode]! - me.state.pos[2]) < 0.9
      if (arrived) {
        if (this.peeks >= 3) { this.excludeCover = this.coverNode; this.coverNode = -1; this.enter('Hunt', now) }   // đổi chỗ núp
        else { this.coverReadyAt = now + rand(this.rng, [700, 1400]); this.enter('TakeCover', now); this.path = null }
      } else if (!this.path) this.goTo(nav.pos(this.coverNode, _tmpA), true)
    }
    void threat
  }

  // ── Đánh vòng ───────────────────────────────────────────────────────────────────────────
  private startFlank(now: number): void {
    const nav = this.room.nav, me = this.me
    let tgt: Known | null = null
    for (const k of this.perc.known.values()) if (now - k.stillSince >= 4000 && (!tgt || k.dist > tgt.dist)) tgt = k
    if (!nav || !tgt) { this.enter('Hunt', now); return }
    const expo = this.computeExposure(tgt.pos)
    const near = nav.nodesNear(tgt.pos[0], tgt.pos[1], tgt.pos[2], 9, 6).filter(i => Math.hypot(nav.x[i]! - tgt!.pos[0], nav.z[i]! - tgt!.pos[2]) > 4.5)
    if (near.length === 0) { this.enter('Hunt', now); return }
    // đích: node gần địch, ưu tiên node địch không nhìn thấy
    near.sort((a, b) => (expo[a]! - expo[b]!) || (Math.hypot(nav.x[a]! - me.state.pos[0], nav.z[a]! - me.state.pos[2]) - Math.hypot(nav.x[b]! - me.state.pos[0], nav.z[b]! - me.state.pos[2])))
    const goal = near[0]!
    this.goTo(nav.pos(goal, _tmpA), true, i => (expo[i] ? 6 : 0))
    this.flankUntil = now + 12_000
    if (!this.path) { this.flankCooldown = now + 6000; this.enter('Hunt', now) }
  }

  /** 1 = node mà người đứng ở `from` nhìn thấy được (tia từ mắt tới ngực người đứng ở node không bị chặn, ≤ 45m) */
  private computeExposure(from: Vec3): Uint8Array {
    const nav = this.room.nav!, world = this.me.world!
    if (this.exposure && Math.hypot(from[0] - this.exposureFor[0], from[2] - this.exposureFor[2]) < 2) return this.exposure
    const ex = this.exposure && this.exposure.length === nav.count ? this.exposure : new Uint8Array(nav.count)
    ex.fill(0)
    const eye = _tmpA; eye[0] = from[0]; eye[1] = from[1] + cfg.eyeStand; eye[2] = from[2]
    for (let i = 0; i < nav.count; i++) {
      const dx = nav.x[i]! - eye[0], dy = nav.y[i]! + 1.1 - eye[1], dz = nav.z[i]! - eye[2]
      const d = Math.hypot(dx, dy, dz)
      if (d > 45) continue
      _tmpB[0] = dx / d; _tmpB[1] = dy / d; _tmpB[2] = dz / d
      const hit = world.castRay(eye, _tmpB, d)
      if (!hit || hit.dist >= d - 0.3) ex[i] = 1
    }
    this.exposure = ex; this.exposureFor = [from[0], from[1], from[2]]
    return ex
  }

  // ── Lựu đạn (tuỳ chọn, bot khó) ────────────────────────────────────────────────────────
  private thinkGrenade(now: number): void {
    const me = this.me, ws = me.weapon
    if (this.nade || now < this.nextNadeAt || (ws.ammo[GRENADE_ID] ?? 0) <= 0 || (ws.slots[GRENADE_SLOT] ?? -1) < 0 || ws.reloadEndMs > 0) return
    // địch vừa thấy trong 3s nhưng giờ khuất sau vật che
    let tgt: Known | null = null
    for (const k of this.perc.known.values()) if (!k.visible && now - k.lastSeenMs <= 3000 && now - k.lastSeenMs >= 400 && k.dist >= 7 && k.dist <= 32 && (!tgt || k.dist < tgt.dist)) tgt = k
    if (!tgt || !me.world) return
    const eye = eyeOf(me, _tmpA)
    anglesTo(eye, [tgt.pos[0], tgt.pos[1] + 1, tgt.pos[2]], _ang)
    const yaw = _ang[0]
    let bestPitch = 0, bestD = Infinity
    const gs: GrenadeState = { id: 0, ownerId: me.id, team: me.team, pos: [0, 0, 0], vel: [0, 0, 0], spawnTick: 0, resting: false }
    const st: PlayerState = { ...me.state, pos: [me.state.pos[0], me.state.pos[1], me.state.pos[2]], vel: [0, 0, 0], yaw, pitch: 0 }
    for (const pd of [-5, 5, 15, 25, 35]) {
      st.pitch = pd * DEG
      const t = throwInitial(st, 'strong', me.world, cfg)
      gs.pos[0] = t.pos[0]; gs.pos[1] = t.pos[1]; gs.pos[2] = t.pos[2]; gs.vel[0] = t.vel[0]; gs.vel[1] = t.vel[1]; gs.vel[2] = t.vel[2]; gs.resting = false
      const ticks = Math.round(GRENADE.fuseMs * TICK_RATE / 1000)
      for (let i = 0; i < ticks; i++) stepGrenade(gs, me.world, DT)
      const d = Math.hypot(gs.pos[0] - tgt.pos[0], gs.pos[2] - tgt.pos[2]) + Math.abs(gs.pos[1] - tgt.pos[1]) * 0.5
      if (d < bestD) { bestD = d; bestPitch = pd * DEG }
    }
    if (bestD > 4) { this.nextNadeAt = now + 3000; return }
    this.nade = { yaw, pitch: bestPitch, startedAt: now, releaseAt: 0 }
    this.nextNadeAt = now + NADE_COOLDOWN_MS
  }

  // ── Lớp chiến đấu: ngắm + bắn ──────────────────────────────────────────────────────────
  private combatTick(now: number): number {
    const me = this.me, params = this.params, aim = this.aim
    let buttons = 0
    const ws = me.weapon
    // đang ném lựu đạn: quay đúng góc, giữ G tới khi rút chốt xong rồi thả
    if (this.nade) return this.nadeTick(now)
    // vũ khí muốn cầm: nếu đang cầm lựu đạn do logic thì về súng chính
    const primary = this.primarySlot()
    if (this.wantSlot !== primary && ws.current === GRENADE_ID && ws.nade.phase === 'idle') this.wantSlot = primary
    if (ws.current !== GRENADE_ID && this.wantSlot === GRENADE_SLOT) this.wantSlot = primary

    const kt = this.perc.known.get(this.targetId)
    const target = kt && kt.visible ? this.room.players.get(this.targetId) : undefined
    const eye = eyeOf(me, _tmpA)
    const def = WEAPONS[ws.current]!

    if (target && target.alive && kt) {
      const usingHead = aim.headTarget && kt.headVisible || !kt.chestVisible
      const pt = bodyPoint(target, usingHead, _tmpB)
      aim.record(pt[0], pt[1], pt[2], now)
      const d = aim.delayed(now, params.trackingLagMs)
      anglesTo(eye, d, _ang)
      const dYaw = _ang[0], dPitch = _ang[1]
      aim.step(DT, now, dYaw, dPitch, me.recoil.yaw, me.recoil.pitch, params, true)

      const dist = Math.hypot(pt[0] - eye[0], pt[1] - eye[1], pt[2] - eye[2])
      const ammo = ws.ammo[def.id]!
      const reloading = ws.reloadEndMs > 0
      // ngắm qua ống ngắm / đầu ruồi khi xa hoặc sniper
      const hs = Math.hypot(me.state.vel[0], me.state.vel[2])
      const wantAds = !!def.ads && !reloading && (def.ads.scope || (dist > 20 && hs < 2))
      if (wantAds) buttons |= Btn.Aim
      const adsReady = !wantAds || me.state.adsT >= 0.85 || !def.ads!.scope && me.state.adsT >= 0.5
      const err = aim.angleTo(dYaw, dPitch)
      const thr = (def.melee ? 6 : params.fireThresholdDeg) * DEG
      const reacted = now >= kt.reactAtMs
      const inRange = def.melee ? dist < MELEE_RANGE : dist < def.range
      const canFire = reacted && !reloading && (def.melee || ammo > 0) && err < thr && adsReady && inRange && ws.current !== GRENADE_ID
      // Bắn
      const shots = ws.shotSeq - this.lastShotSeq
      this.lastShotSeq = ws.shotSeq
      if (canFire) buttons |= this.fireControl(now, def, dist, shots)
      else if (!def.auto) this.nextTapAt = Math.max(this.nextTapAt, now)
      void ammo
    } else {
      this.lastShotSeq = ws.shotSeq
      // không có mục tiêu: nhìn theo override / hướng đi / quét quanh
      this.idleLook(now, eye)
    }
    return buttons
  }

  private fireControl(now: number, def: (typeof WEAPONS)[number], dist: number, shotsSince: number): number {
    const params = this.params
    const farSingle = !this.hard && dist > 40 && def.auto && !def.melee
    if (def.auto && !farSingle) {
      if (def.melee) return Btn.Fire
      if (now < this.pauseUntil) return 0
      if (this.burstLeft <= 0) { this.burstLeft = randInt(this.rng, params.burst); this.aim.reroll(params) }
      this.burstLeft -= shotsSince
      if (this.burstLeft <= 0) { this.pauseUntil = now + rand(this.rng, params.burstPauseMs); return 0 }
      return Btn.Fire
    }
    // bán tự động: nhịp bấm chậm hơn tốc độ tối đa 20–60%
    if (now < this.nextTapAt) return 0
    this.nextTapAt = now + Math.max(def.fireIntervalMs, 120) * (1.2 + 0.4 * this.rng())
    this.aim.reroll(params)
    return Btn.Fire
  }

  private nadeTick(now: number): number {
    const n = this.nade!, me = this.me
    this.aim.step(DT, now, n.yaw, n.pitch, 0, 0, this.params, false)
    const err = this.aim.angleTo(n.yaw, n.pitch)
    if (n.releaseAt === 0) {
      if (err < 1.2 * DEG || now - n.startedAt > 1200) n.releaseAt = now + GRENADE.pinPullMs + 80   // bắt đầu rút chốt (giữ G) khi đã đúng góc
      else return 0
    }
    if (now < n.releaseAt) return Btn.QuickNade
    if (me.weapon.nade.phase === 'ready' || me.weapon.nade.phase === 'pulling') {
      if (now > n.releaseAt + 600) { this.nade = null }   // quá hạn: bỏ
      return 0   // thả G → ném
    }
    this.nade = null
    return 0
  }

  private idleLook(now: number, eye: Vec3): void {
    const aim = this.aim
    let yaw = aim.yaw, pitch = 0, speedMul = 0.7
    if (this.lookOverride && now < this.lookOverride.until) { yaw = this.lookOverride.yaw; pitch = this.lookOverride.pitch; speedMul = 1 }
    else if (this.hasWish && this.path) { yaw = Math.atan2(-this.wishX, -this.wishZ); speedMul = 0.8 }
    else if (now >= this.scanAt) { this.scanAt = now + rand(this.rng, [1200, 2400]); this.scanYaw = aim.yaw + (this.rng() * 2 - 1) * 70 * DEG; yaw = this.scanYaw }
    else yaw = this.scanYaw
    if (!(this.lookOverride && now < this.lookOverride.until) && !this.hasWish) yaw = this.scanYaw
    aim.step(DT, now, yaw, pitch, 0, 0, this.params, false, speedMul)
    void eye
  }

  private scanAround(now: number): void { if (now >= this.scanAt) { this.scanAt = now + rand(this.rng, [1200, 2400]); this.scanYaw = this.aim.yaw + (this.rng() * 2 - 1) * 90 * DEG } }

  private primarySlot(): number {
    const ws = this.me.weapon
    if (this.hard && (ws.slots[2] ?? -1) >= 0 && WEAPONS[ws.slots[2]!]?.category === 'mid' && ws.slot !== DEFAULT_SLOT && ws.slot === 2) return 2
    for (const s of [3, 2, 1, 0]) if ((ws.slots[s] ?? -1) >= 0) return s
    return 0
  }

  // ── Lớp di chuyển ──────────────────────────────────────────────────────────────────────
  private moveTick(now: number): number {
    const me = this.me, params = this.params
    this.hasWish = false; this.wantJump = false
    this.wantCrouch = false
    this.speedCap = Infinity
    const target = this.perc.known.get(this.targetId)
    const targetVisible = !!target && target.visible
    const reloading = me.weapon.reloadEndMs > 0
    const def = WEAPONS[me.weapon.current]!
    const walkCap = cfg.runSpeed * def.moveSpeedMul * params.moveSpeedMul

    switch (this.state) {
      case 'Patrol':
        if (this.follow(now)) this.speedCap = walkCap
        break
      case 'Search':
        if (this.follow(now)) this.speedCap = walkCap
        break
      case 'Reload':
        this.wantCrouch = this.crouchFight
        break
      case 'Engage':
        this.wantCrouch = this.crouchFight
        if (this.hard) this.strafe(now, def.spread.accurateSpeed)
        else this.sidestep(now)
        break
      case 'Hunt': case 'Flank':
        this.follow(now)
        break
      case 'Push':
        this.follow(now)
        if (now < this.slideUntil) this.wantCrouch = true
        break
      case 'TakeCover':
        if (!this.follow(now)) this.wantCrouch = targetVisible ? false : true
        break
      case 'Peek':
        this.follow(now)
        if (this.peekPhase === 'fight' && this.rng() < 0.002) this.wantCrouch = true
        break
    }
    if (targetVisible && this.hard && this.state !== 'Engage' && this.state !== 'Push' && !this.hasWish) this.strafe(now, def.spread.accurateSpeed)
    if (reloading && this.state === 'Engage' && !this.hard) this.hasWish = false

    // chiếu hướng muốn đi lên W/A/S/D theo yaw hiện tại
    let buttons = 0
    if (this.hasWish) {
      const hs = Math.hypot(me.state.vel[0], me.state.vel[2])
      if (hs < this.speedCap || !me.state.grounded) {
        const y = this.aim.yaw
        const fwd = -Math.sin(y) * this.wishX + -Math.cos(y) * this.wishZ
        const rgt = Math.cos(y) * this.wishX + -Math.sin(y) * this.wishZ
        if (fwd > 0.38) buttons |= Btn.Forward; else if (fwd < -0.38) buttons |= Btn.Back
        if (rgt > 0.38) buttons |= Btn.Right; else if (rgt < -0.38) buttons |= Btn.Left
      }
    }
    if (this.wantJump && me.state.grounded) buttons |= Btn.Jump
    if (this.wantCrouch) buttons |= Btn.Crouch
    return buttons
  }

  /** Đi theo đường; true nếu đang di chuyển */
  private follow(now: number): boolean {
    const me = this.me
    if (!this.path) return false
    while (this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx]!
      const dx = wp.x - me.state.pos[0], dz = wp.z - me.state.pos[2]
      const d = Math.hypot(dx, dz)
      const lastWp = this.pathIdx === this.path.length - 1
      if (d < (lastWp ? ARRIVE_M : ARRIVE_M + 0.2) && Math.abs(wp.y - me.state.pos[1]) < 1.4) { this.pathIdx++; continue }
      this.wishX = dx / d; this.wishZ = dz / d; this.hasWish = true
      if (wp.jump && d < 1.5 && me.state.grounded) this.wantJump = true
      if (this.stuckCount >= 2 && now - this.progressAt > STUCK_MS / 2) this.wantJump = true
      return true
    }
    this.path = null
    return false
  }

  private strafe(now: number, accurateSpeed: number): void {
    if (now >= this.strafeUntil) { this.strafeUntil = now + rand(this.rng, [300, 800]); this.strafeDir = this.rng() < 0.5 ? -1 : 1 }
    const y = this.aim.yaw
    this.wishX = Math.cos(y) * this.strafeDir; this.wishZ = -Math.sin(y) * this.strafeDir; this.hasWish = true
    this.speedCap = accurateSpeed * 0.95
    // thỉnh thoảng ngồi xuống giữa loạt bắn
    if (this.crouchFight && this.rng() < 0.01) this.wantCrouch = true
  }

  private sidestep(now: number): void {
    if (now >= this.sidestepAt) { this.sidestepAt = now + rand(this.rng, [3000, 5000]); this.sidestepUntil = now + rand(this.rng, [220, 420]); this.strafeDir = this.rng() < 0.5 ? -1 : 1 }
    if (now < this.sidestepUntil) {
      const y = this.aim.yaw
      this.wishX = Math.cos(y) * this.strafeDir; this.wishZ = -Math.sin(y) * this.strafeDir; this.hasWish = true
      this.speedCap = 3
    }
  }

  private goTo(pos: Vec3, _run: boolean, costFn?: (n: number) => number): void {
    const nav = this.room.nav, me = this.me
    this.goal = [pos[0], pos[1], pos[2]]; this.goalCost = costFn
    this.path = nav ? nav.findPath(me.state.pos, pos, costFn) : null
    this.pathIdx = 0
    this.progressAt = this.room.serverNow
    this.progressPos[0] = me.state.pos[0]; this.progressPos[1] = me.state.pos[1]; this.progressPos[2] = me.state.pos[2]
  }

  private checkStuck(now: number): void {
    const me = this.me
    if (!this.hasWish || !this.path) { this.progressAt = now; this.progressPos[0] = me.state.pos[0]; this.progressPos[1] = me.state.pos[1]; this.progressPos[2] = me.state.pos[2]; this.stuckCount = 0; return }
    const moved = Math.hypot(me.state.pos[0] - this.progressPos[0], me.state.pos[1] - this.progressPos[1], me.state.pos[2] - this.progressPos[2])
    if (moved >= 0.5) { this.progressAt = now; this.progressPos[0] = me.state.pos[0]; this.progressPos[1] = me.state.pos[1]; this.progressPos[2] = me.state.pos[2]; this.stuckCount = 0; return }
    if (now - this.progressAt < STUCK_MS) return
    this.stuckCount++
    this.progressAt = now
    if (this.goal) this.goTo(this.goal, true, this.goalCost)
    if (this.stuckCount >= 2) this.wantJump = true
    if (this.stuckCount >= 4) { this.path = null; this.stuckCount = 0 }   // bỏ đích này
  }

  private enter(s: BotState, now: number): void {
    if (s === this.state && this.stateSince !== 0) return
    this.state = s; this.stateSince = now
    if (s === 'Patrol' || s === 'Search' || s === 'Hunt' || s === 'Reload') { this.path = s === 'Reload' ? this.path : null }
    if (s === 'TakeCover') this.coverReadyAt = 0
  }

  private randomNode(ownHalf: boolean): number {
    const nav = this.room.nav
    if (!nav || nav.count === 0) return -1
    const sign = this.me.team === 'A' ? -1 : 1
    for (let i = 0; i < 40; i++) {
      const n = Math.floor(this.rng() * nav.count)
      if (nav.y[n]! > 1.5) continue
      const z = nav.zone[n]!
      if (z === Zone.WallA || z === Zone.WallB || z === Zone.TowerA || z === Zone.TowerB) continue
      const rel = nav.x[n]! * sign   // > 0 = nửa của mình
      if (ownHalf ? rel > -4 : rel < 8) {
        if (!ownHalf && Math.abs(nav.x[n]!) > 22) continue
        return n
      }
    }
    return -1
  }

  // ── Debug (F11) ────────────────────────────────────────────────────────────────────────
  debugInfo(): BotDebugInfo {
    const me = this.me
    const eye = eyeOf(me, [0, 0, 0])
    const cp = Math.cos(this.aim.pitch)
    const look: Vec3 = [eye[0] - Math.sin(this.aim.yaw) * cp * 12, eye[1] + Math.sin(this.aim.pitch) * 12, eye[2] - Math.cos(this.aim.yaw) * cp * 12]
    let want: Vec3 | null = null
    const k = this.perc.known.get(this.targetId)
    if (k && k.visible) {
      const o = this.room.players.get(k.id)
      if (o) want = bodyPoint(o, this.aim.headTarget, [0, 0, 0])
    }
    const path: Vec3[] = []
    if (this.path) for (let i = this.pathIdx; i < this.path.length; i++) path.push([this.path[i]!.x, this.path[i]!.y + 0.15, this.path[i]!.z])
    return { id: me.id, state: this.nade ? 'Grenade' : this.state, eye, look, want, path }
  }
}

export { EdgeKind, wrapAngle }
