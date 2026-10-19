import type { CharacterRig } from './types'

// Animation thủ tục (6.2): không cần file animation. Chạy theo vị trí đã nội suy giữa các frame (⇒ vận tốc nội suy),
// không theo input. Chỉ chạm vào khung xương chuẩn nên dùng được cho mọi bộ nhân vật. Không cấp phát.
export interface AnimState {
  phase: number     // pha bước (rad), tăng theo quãng đường đi
  speed: number     // tốc độ ngang đã làm mượt (m/s)
  lastX: number
  lastZ: number
  hasLast: boolean
  air: number       // 0..1, độ chuyển sang tư thế nhảy / trượt / ngồi (làm mượt)
  slide: number
  crouch: number
}

export function makeAnimState(): AnimState {
  return { phase: 0, speed: 0, lastX: 0, lastZ: 0, hasLast: false, air: 0, slide: 0, crouch: 0 }
}

export interface AnimInput {
  x: number; z: number      // vị trí chân (đã nội suy)
  dt: number                // giây từ frame trước
  grounded: boolean
  crouching: boolean
  sliding: boolean
  pitch: number
  crouchDrop: number        // m hạ hông khi ngồi hết mức (chỉ chân co lại, thân/đầu giữ nguyên tỉ lệ)
}

const RUN_SPEED = 8.5          // tốc độ chạy: biên độ tối đa
const TELEPORT_M = 3           // nhảy xa hơn mức này trong một frame = hồi sinh/teleport, không tính là chạy
const POSE_EASE = 15           // 1/giây: tốc độ chuyển tư thế nhảy/trượt/ngồi
const HEAD_PITCH = 0.7         // phần pitch do đầu/súng đảm nhận; phần còn lại (1−0.7) do nghiêng thân
const SLIDE_LEAN = 0.55        // ngả người ra sau khi trượt (rad, +X = đổ ra sau)
const CROUCH_LEAN = -0.2       // cúi người về trước khi ngồi
const AIR_LEG_L = 0.7          // nhảy: co chân (một chân co nhiều hơn)
const AIR_LEG_R = 0.3

const HIP_Y = 0.8              // chiều cao hông khi đứng (khớp kit.ts)

const approach = (cur: number, target: number, k: number) => cur + (target - cur) * k

export function updateAnim(rig: CharacterRig, st: AnimState, inp: AnimInput): void {
  const { dt } = inp
  let moved = 0
  if (st.hasLast && dt > 0) {
    moved = Math.hypot(inp.x - st.lastX, inp.z - st.lastZ)
    if (moved > TELEPORT_M) moved = 0
  }
  st.lastX = inp.x; st.lastZ = inp.z; st.hasLast = true
  const target = dt > 0 ? moved / dt : 0
  st.speed = approach(st.speed, target, Math.min(1, dt * 12))
  const running = inp.grounded && !inp.sliding
  if (running) st.phase += moved * rig.anim.strideRadPerM
  const amp = running ? Math.min(1, st.speed / RUN_SPEED) : 0
  const k = Math.min(1, dt * POSE_EASE)
  const sw = Math.sin(st.phase) * amp

  // Chuyển tư thế (nhảy/trượt/ngồi) được làm mượt bằng trọng số; đung đưa khi chạy thì không làm mượt
  // (tần số bước vượt xa tốc độ làm mượt, làm mượt sẽ nuốt mất biên độ)
  st.air = approach(st.air, !inp.grounded && !inp.sliding ? 1 : 0, k)
  st.slide = approach(st.slide, inp.sliding ? 1 : 0, k)
  st.crouch = approach(st.crouch, inp.crouching ? 1 : 0, k)

  // Chân + tay trái đung đưa chéo nhau; tay phải giữ súng
  let legL = sw * rig.anim.legSwing
  let legR = -sw * rig.anim.legSwing
  let armL = rig.armRestL - sw * rig.anim.armSwing
  legL += (AIR_LEG_L - legL) * st.air; legR += (AIR_LEG_R - legR) * st.air; armL += (rig.armRestL + 0.3 - armL) * st.air
  legL += (1.0 - legL) * st.slide; legR += (1.0 - legR) * st.slide; armL += (rig.armRestL + 0.3 - armL) * st.slide
  const lean = CROUCH_LEAN * st.crouch + SLIDE_LEAN * st.slide

  rig.legL.rotation.x = legL
  rig.legR.rotation.x = legR
  rig.armL.rotation.x = armL
  rig.upper.rotation.x = lean + inp.pitch * (1 - HEAD_PITCH)
  // Đầu và tay phải (kéo theo súng) cùng nhìn/chĩa theo pitch (+pitch = ngước lên = xoay +X quanh pivot)
  rig.headPivot.rotation.x = inp.pitch * HEAD_PITCH
  rig.armR.rotation.x = rig.armRestR + inp.pitch * HEAD_PITCH
  // Nhún nhẹ khi chạy (hai lần mỗi chu kỳ bước)
  // Ngồi: hạ hông, chân co ngắn lại (scale riêng chân), thân và đầu giữ nguyên
  const hip = HIP_Y - inp.crouchDrop * st.crouch
  rig.legL.position.y = hip; rig.legR.position.y = hip
  rig.legL.scale.y = rig.legR.scale.y = hip / HIP_Y
  rig.upper.position.y = hip + Math.abs(sw) * rig.anim.bobAmp
}
