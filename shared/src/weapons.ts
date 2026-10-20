import { GRENADE, makeThrowState, type ThrowState } from './grenade'

export type WeaponCategory = 'knife' | 'pistol' | 'mid' | 'long' | 'grenade'
/** Ô vũ khí (phím 1–5) của từng dòng. Ô 5 = lựu đạn (hàng tiêu hao, không tính vào 4 dòng súng) */
export const CATEGORY_SLOT: Record<WeaponCategory, 0 | 1 | 2 | 3 | 4> = { knife: 0, pistol: 1, mid: 2, long: 3, grenade: 4 }
export const CATEGORY_LABEL: Record<WeaponCategory, string> = {
  knife: 'Dao', pistol: 'Súng ngắn', mid: 'Súng vừa', long: 'Súng dài', grenade: 'Lựu đạn',
}
export const SLOT_COUNT = 5
/** Ô lựu đạn */
export const GRENADE_SLOT = CATEGORY_SLOT.grenade
/** Ô mặc định khi hồi sinh / vào trận: súng dài (ô 4 của 0–4 là lựu đạn, không bao giờ là mặc định) */
export const DEFAULT_SLOT = 3

export interface WeaponDef {
  id: number
  key: string             // tên file icon/model: 'knife' | 'colt' | 'rulo' | 'shotgun' | 'smg' | 'ak47' | 'm16' | 'sniper'
  name: string
  category: WeaponCategory
  price: number           // USD; dao = 0
  buyable: boolean        // dao = false
  moveSpeedMul: number    // hệ số tốc độ chạy khi cầm súng này
  melee?: boolean         // dao: không đạn, không reload, tầm ngắn
  auto: boolean
  damage: number
  headMult: number
  legMult: number
  fireIntervalMs: number
  magSize: number
  reloadMs: number
  range: number
  spreadDeg: { stand: number; move: number; air: number; crouch: number }
  recoilPitchDeg: number
  recoilYawDeg: number
  recoilRecoverDegPerSec: number
  ads?: AdsDef            // có = giữ chuột phải để ngắm
  recoilRecoverDelayMs?: number   // hồi recoil sau phát bắn bấy nhiêu ms (mặc định: sau fireIntervalMs). Súng chậm như sniper cần hồi sớm
  pellets?: number                // số tia mỗi phát (mặc định 1). Mỗi tia có spread riêng, seed theo shotSeq + chỉ số tia
  falloff?: DamageFalloff         // sát thương giảm theo khoảng cách (mặc định: không giảm)
  consumable?: boolean    // lựu đạn: hàng tiêu hao (mua thêm tới maxCarry, không bán lại, không đạn/bắn)
  aimSpreadDeg?: number   // spread khi ngắm + đứng yên/ngồi trên mặt đất (thay các mức stand/crouch)
}

// Sát thương nhân hệ số 1 tới fullM, giảm tuyến tính còn minMult tại endM, giữ nguyên minMult sau đó
export interface DamageFalloff {
  fullM: number
  endM: number
  minMult: number
}

// Chế độ ngắm. fovs[0] = mức đầu, nếu có thêm thì lăn chuột để đổi (sâu dần). scope = che đen ngoài vòng tròn và ẩn súng
export interface AdsDef {
  fovs: number[]
  scope: boolean
}

export interface WeaponState {
  current: number         // id súng đang cầm (WEAPONS[current])
  slots: number[]         // id súng ở 5 ô (theo CATEGORY_SLOT; ô 4 = lựu đạn), -1 = trống. Server giữ, snapshot gửi cho chính người đó
  slot: number            // ô đang cầm
  wantSlot: number        // cmd.weapon của cmd gần nhất: chỉ đổi súng khi cmd.weapon ĐỔI (cmd cũ còn bay trên đường không kéo ngược lại ô vừa mua)
  ammo: number[]          // theo id súng; ammo[GRENADE_ID] = số lựu đạn đang mang
  nade: ThrowState        // trạng thái rút chốt/ném lựu đạn
  throwSeq: number        // số quả đã ném (gắn vào GrenadeSpawn để client nhận ra quả dự đoán của mình)
  quickHeld: boolean      // phím G đang giữ (nhận cạnh lên)
  prevSlot: number        // ô cầm trước khi chuyển sang lựu đạn (G / phím 5), để tự đổi về
  switchBackAtMs: number  // > 0: tới thời điểm này (thang seq) tự đổi về prevSlot nếu vẫn đang cầm lựu đạn
  reloadEndMs: number
  nextFireMs: number
  shotSeq: number
  triggerHeld: boolean
}

// Thời gian khoá bắn sau khi đổi súng (khớp animation hạ/đưa súng 2×0.15s ở viewmodel)
export const SWITCH_MS = 300
// Tốc độ ngang (m/s) trên mức này thì dùng spread 'move'
export const MOVE_SPREAD_SPEED = 1

// Thông số theo súng thật (sát thương trên thang máu 100):
// - AK47: 7.62x39, ~600 phát/phút, 30 viên, giật mạnh, tản đạn lớn khi di chuyển.
// - M16: 5.56x45, ~750 phát/phút, 30 viên, chính xác và giật nhẹ hơn AK, tầm xa hơn.
// - COLT (M1911 .45): bán tự động, 7 viên, giật rõ.
// - ROULEAU (súng lục ổ xoay): bán tự động, 6 viên, sát thương lớn, nạp đạn lâu.
export const WEAPONS: WeaponDef[] = [
  {
    id: 0, key: 'ak47', name: 'AK47', category: 'long', price: 2700, buyable: true, moveSpeedMul: 0.92, auto: true, damage: 36, headMult: 3.5, legMult: 0.75,
    fireIntervalMs: 100, magSize: 30, reloadMs: 2500, range: 180,
    spreadDeg: { stand: 0.5, move: 2.5, air: 6, crouch: 0.3 },
    recoilPitchDeg: 0.9, recoilYawDeg: 0.45, recoilRecoverDegPerSec: 8,
    ads: { fovs: [65], scope: false }, aimSpreadDeg: 0.15,   // súng trường: ngắm qua đầu ruồi, zoom nhẹ, không che màn hình; ngắm đứng yên thì chụm
  },
  {
    id: 1, key: 'm16', name: 'M16', category: 'long', price: 3100, buyable: true, moveSpeedMul: 0.93, auto: true, damage: 30, headMult: 4, legMult: 0.75,
    fireIntervalMs: 80, magSize: 30, reloadMs: 2200, range: 220,
    spreadDeg: { stand: 0.45, move: 2.3, air: 5, crouch: 0.25 },
    recoilPitchDeg: 0.55, recoilYawDeg: 0.25, recoilRecoverDegPerSec: 10,
    ads: { fovs: [65], scope: false }, aimSpreadDeg: 0.14,
  },
  {
    id: 2, key: 'colt', name: 'COLT', category: 'pistol', price: 300, buyable: true, moveSpeedMul: 1.0, auto: false, damage: 32, headMult: 3, legMult: 0.75,
    fireIntervalMs: 160, magSize: 7, reloadMs: 1600, range: 90,
    spreadDeg: { stand: 0.4, move: 1.5, air: 4, crouch: 0.25 },
    recoilPitchDeg: 1.5, recoilYawDeg: 0.3, recoilRecoverDegPerSec: 12,
  },
  {
    id: 3, key: 'rulo', name: 'ROULEAU', category: 'pistol', price: 700, buyable: true, moveSpeedMul: 1.0, auto: false, damage: 55, headMult: 3, legMult: 0.75,
    fireIntervalMs: 400, magSize: 6, reloadMs: 3000, range: 110,
    spreadDeg: { stand: 0.3, move: 1.8, air: 5, crouch: 0.2 },
    recoilPitchDeg: 2.5, recoilYawDeg: 0.4, recoilRecoverDegPerSec: 10,
  },
  {
    // Sniper: 1 phát/1,2s, 90 sát thương (đầu ×2 = 180), tản đạn rất lớn khi không ngắm; scope 2 mức zoom
    id: 4, key: 'sniper', name: 'SNIPER', category: 'long', price: 4750, buyable: true, moveSpeedMul: 0.85, auto: false, damage: 90, headMult: 2, legMult: 0.75,
    fireIntervalMs: 1200, magSize: 5, reloadMs: 3200, range: 400,
    spreadDeg: { stand: 5, move: 9, air: 14, crouch: 4 },
    recoilPitchDeg: 3, recoilYawDeg: 0.5, recoilRecoverDegPerSec: 15, recoilRecoverDelayMs: 120,
    ads: { fovs: [30], scope: true }, aimSpreadDeg: 0.02,
  },
  {
    // Shotgun: 8 tia/phát, mỗi tia 16 sát thương (gần: 8 tia thân = 128, đủ hạ 1 phát), giảm dần theo khoảng cách
    id: 5, key: 'shotgun', name: 'SHOTGUN', category: 'mid', price: 1100, buyable: true, moveSpeedMul: 0.95, auto: false, damage: 16, headMult: 2, legMult: 0.75,
    fireIntervalMs: 900, magSize: 6, reloadMs: 3000, range: 60,
    spreadDeg: { stand: 4, move: 5, air: 7, crouch: 3.5 },
    recoilPitchDeg: 4, recoilYawDeg: 0.6, recoilRecoverDegPerSec: 12, recoilRecoverDelayMs: 120,
    pellets: 8, falloff: { fullM: 6, endM: 30, minMult: 0.2 },
  },
  {
    // Dao: chém hitscan 2,2m từ mắt, không spread/recoil, không đạn. 2 nhát hạ (55 × 2 ≥ 100 vào thân)
    id: 6, key: 'knife', name: 'DAO', category: 'knife', price: 0, buyable: false, moveSpeedMul: 1.1, melee: true,
    auto: true, damage: 55, headMult: 2, legMult: 1,
    fireIntervalMs: 450, magSize: 0, reloadMs: 0, range: 2.2,
    spreadDeg: { stand: 0, move: 0, air: 0, crouch: 0 },
    recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0,
  },
  {
    // SMG: nhanh, đạn yếu, tầm trung
    id: 7, key: 'smg', name: 'SMG', category: 'mid', price: 1250, buyable: true, moveSpeedMul: 1.0,
    auto: true, damage: 20, headMult: 3, legMult: 0.75,
    fireIntervalMs: 70, magSize: 30, reloadMs: 1800, range: 100,
    spreadDeg: { stand: 0.7, move: 1.2, air: 3.5, crouch: 0.5 },
    recoilPitchDeg: 0.4, recoilYawDeg: 0.35, recoilRecoverDegPerSec: 10,
    falloff: { fullM: 15, endM: 40, minMult: 0.6 },
  },
  {
    // Lựu đạn M67: không dùng các trường bắn (xem grenade.ts / grenadePhysics.ts)
    id: 8, key: GRENADE.key, name: 'M67', category: 'grenade', price: GRENADE.price, buyable: true, moveSpeedMul: 1.0, consumable: true,
    auto: false, damage: 0, headMult: 1, legMult: 1,
    fireIntervalMs: 0, magSize: 0, reloadMs: 0, range: 0,
    spreadDeg: { stand: 0, move: 0, air: 0, crouch: 0 },
    recoilPitchDeg: 0, recoilYawDeg: 0, recoilRecoverDegPerSec: 0,
  },
]

export const WEAPON_BY_KEY: ReadonlyMap<string, WeaponDef> = new Map(WEAPONS.map(w => [w.key, w]))
/** id của lựu đạn trong WEAPONS */
export const GRENADE_ID = WEAPON_BY_KEY.get(GRENADE.key)!.id
export function weaponByKey(key: string): WeaponDef | undefined { return WEAPON_BY_KEY.get(key) }

/** Số tia tối đa mỗi phát (mảng hướng bắn cấp phát sẵn theo số này; seed dành 6 bit cho chỉ số tia) */
export const MAX_PELLETS = 16


/** Bộ mặc định lúc chưa biết đội (Cớm): Dao, Colt, —, M16, (không lựu đạn) */
export const FALLBACK_SLOTS: readonly number[] = [6, 2, -1, 1, -1]

export function makeWeaponState(slots: readonly number[] = FALLBACK_SLOTS): WeaponState {
  const slot = slots[DEFAULT_SLOT]! >= 0 ? DEFAULT_SLOT : Math.max(0, slots.findIndex(id => id >= 0))
  return {
    current:     slots[slot]!,
    slots:       [...slots],
    slot,
    wantSlot:    DEFAULT_SLOT,
    ammo:        WEAPONS.map(w => w.magSize),
    nade:        makeThrowState(),
    throwSeq:    0,
    quickHeld:   false,
    prevSlot:    DEFAULT_SLOT,
    switchBackAtMs: 0,
    reloadEndMs: 0,
    nextFireMs:  0,
    shotSeq:     0,
    triggerHeld: false,
  }
}
