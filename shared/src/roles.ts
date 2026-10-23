// Hệ số tốc độ chạy của người theo trạng thái (anh hùng, gục): server đặt Player.speedMult, client suy ra từ cờ NetFlag trong snapshot.
import { INFECTION } from './infection'
import { DEFENSE } from './defense'
import { defaultMovement, Btn } from './movement'
import { NetFlag } from './protocol'

export function downedSpeedMul(runSpeed = defaultMovement.runSpeed): number { return DEFENSE.down.crawlSpeed / runSpeed }
export function heroSpeedMul(): number { return INFECTION.hero.speedMult }

/** Hệ số tốc độ chạy của NGƯỜI theo cờ (zombie dùng cấu hình riêng nên không qua đây) */
export function flagSpeedMul(flags: number, runSpeed = defaultMovement.runSpeed): number {
  if (flags & NetFlag.Downed) return downedSpeedMul(runSpeed)
  if (flags & NetFlag.Hero) return heroSpeedMul()
  return 1
}

/** Nút bị cấm khi gục: không nhảy, không ngồi, không ném lựu đạn, không dùng chiêu */
export const DOWNED_BUTTON_MASK = ~(Btn.Jump | Btn.Crouch | Btn.QuickNade | Btn.Ability | Btn.Interact)
/** Ô súng ngắn: người gục chỉ bắn được súng ngắn */
export const DOWNED_WEAPON_SLOT = 1
