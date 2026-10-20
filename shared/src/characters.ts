// Bộ nhân vật (chỉ là danh mục id): mỗi phòng chọn một bộ lúc tạo, server báo cho mọi client qua Welcome.
// Phần vẽ nằm ở client/src/render/characters/ (mỗi bộ một module); thêm bộ mới = thêm id ở đây + một module bên đó.
export const CHARACTER_SETS = ['saberDesert', 'copRobber', 'robot'] as const
export type CharacterSetId = (typeof CHARACTER_SETS)[number]
export const DEFAULT_CHARACTER_SET: CharacterSetId = 'saberDesert'

export function isCharacterSet(v: unknown): v is CharacterSetId {
  return typeof v === 'string' && (CHARACTER_SETS as readonly string[]).includes(v)
}
