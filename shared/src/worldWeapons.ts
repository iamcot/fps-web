// Nhặt / vứt vũ khí (plan 19 P8): luật thuần, dùng chung server + client (gợi ý "G: nhặt").
// Ô 1 (CATEGORY_SLOT.knife = 0) luôn có dao gốc 'knife'; nhặt vũ khí cận chiến thì thay vào ô 1, vứt thì về dao.
// Dao gốc không vứt được. Lựu đạn và vuốt zombie không nhặt / vứt.
import { CATEGORY_SLOT, WEAPONS, type WeaponDef } from './weapons'
import type { Loadout, OwnedWeapon } from './economy'

export const WORLD_WEAPON = {
  pickupRadius: 1.8,      // m, ngang
  pickupHeight: 1.6,      // m, chênh cao tối đa giữa chân người và vật
  dropForward: 1.5,       // m phía trước người vứt
  dropWallGap: 0.3,       // m: gặp tường thì dừng cách tường chừng này
  dropLockMs: 1500,       // người vừa vứt không nhặt lại trong khoảng này
  despawnMs: 60000,       // vũ khí rơi biến mất sau 1 phút (trừ vũ khí của map)
  interactLockMs: 300,    // khựng sau khi nhặt / vứt (không bắn được ngay)
  maxItems: 64,           // trần số vật dưới đất của một phòng
} as const

const BASE_KNIFE = 'knife'

/** Vũ khí này có thể nằm dưới đất không (súng, vũ khí cận chiến; trừ dao gốc, lựu đạn, vuốt) */
export function isWorldWeapon(def: WeaponDef | undefined): def is WeaponDef {
  return !!def && !def.consumable && def.category !== 'grenade' && def.category !== 'claw' && def.key !== BASE_KNIFE
}

/** Ô loadout nhận vũ khí này, hoặc -1 nếu không nhặt được loại này */
export function pickupSlot(def: WeaponDef | undefined): number {
  return isWorldWeapon(def) ? CATEGORY_SLOT[def.category] : -1
}

/** Nhặt được không: ô đích trống (ô 1: đang giữ dao gốc) */
export function canPickUp(loadout: Loadout, def: WeaponDef | undefined): boolean {
  const slot = pickupSlot(def)
  if (slot < 0) return false
  const cur = loadout.slots[slot]
  return slot === CATEGORY_SLOT.knife ? !cur || cur.key === BASE_KNIFE : !cur
}

/** Loadout sau khi nhặt. Vũ khí nhặt không có giá bán lại (paid 0) để không đi buôn súng nhặt */
export function applyPickUp(loadout: Loadout, def: WeaponDef): Loadout {
  const slots = loadout.slots.slice()
  slots[pickupSlot(def)] = { key: def.key, paid: 0 }
  return { slots }
}

/** Ô đang cầm vứt được không (ô 1: chỉ khi không phải dao gốc) */
export function canDrop(loadout: Loadout, slot: number): boolean {
  const w: OwnedWeapon | null | undefined = loadout.slots[slot]
  if (!w) return false
  const def = WEAPONS.find(x => x.key === w.key)
  return isWorldWeapon(def) && CATEGORY_SLOT[def.category] === slot
}

/** Vứt ô `slot`: trả loadout mới (ô 1 về dao gốc, ô khác để trống) và vũ khí bị vứt; null nếu không vứt được */
export function applyDrop(loadout: Loadout, slot: number): { loadout: Loadout; weapon: WeaponDef } | null {
  if (!canDrop(loadout, slot)) return null
  const weapon = WEAPONS.find(x => x.key === loadout.slots[slot]!.key)!
  const slots = loadout.slots.slice()
  slots[slot] = slot === CATEGORY_SLOT.knife ? { key: BASE_KNIFE, paid: 0 } : null
  return { loadout: { slots }, weapon }
}
