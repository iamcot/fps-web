import { copyWeaponState, makeWeaponState, stepWeaponCmd, weaponStatesEqual, type InputCmd, type WeaponState } from '@fps/shared'

export const weaponSyncStats = { checks: 0, mismatches: 0 }

const tmp = makeWeaponState()

// Reconcile súng giống reconcile vị trí: đặt WeaponState = của server (sau cmd `ack`), chạy lại các cmd
// chưa ack rồi ghi đè `ws` nếu khác. Chỉ trạng thái (đạn, reload, fire rate); hiệu ứng không phát lại.
// `pending` đã bỏ cmd ≤ ack.
export function reconcileWeapon(ws: WeaponState, server: WeaponState, pending: readonly { cmd: InputCmd }[]): boolean {
  copyWeaponState(tmp, server)
  for (const p of pending) stepWeaponCmd(tmp, p.cmd)
  weaponSyncStats.checks++
  if (weaponStatesEqual(tmp, ws)) return false
  weaponSyncStats.mismatches++
  copyWeaponState(ws, tmp)
  return true
}
