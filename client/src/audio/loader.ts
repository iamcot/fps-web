// Nạp file âm thanh vào AudioBuffer. File thiếu → bỏ qua (dùng âm tổng hợp dự phòng),
// gom thành MỘT cảnh báo console, không crash.

const buffers = new Map<string, AudioBuffer>()

/** Khoá dạng 'guns/ak47/shot_01' hoặc 'common/kill' (không đuôi file). */
export const gunKey = (folder: string, name: string): string => `guns/${folder}/${name}`
export const commonKey = (name: string): string => `common/${name}`

export const getBuffer = (key: string): AudioBuffer | undefined => buffers.get(key)
export const hasBuffer = (key: string): boolean => buffers.has(key)

function fileExt(): 'ogg' | 'mp3' {
  const ok = new Audio().canPlayType('audio/ogg; codecs="vorbis"')
  return ok ? 'ogg' : 'mp3'
}

/** Nạp song song; trả danh sách khoá bị thiếu. */
export async function preload(ctx: BaseAudioContext, keys: string[]): Promise<string[]> {
  const ext = fileExt()
  const missing: string[] = []
  await Promise.all([...new Set(keys)].map(async (key) => {
    try {
      const res = await fetch(`/sounds/${key}.${ext}`)
      if (!res.ok) throw new Error(String(res.status))
      const buf = await ctx.decodeAudioData(await res.arrayBuffer())   // HTML fallback của dev server sẽ lỗi ở đây
      buffers.set(key, buf)
    } catch {
      missing.push(key)
    }
  }))
  if (missing.length > 0) {
    missing.sort()
    console.warn(`[audio] thiếu ${missing.length}/${new Set(keys).size} file âm thanh (dùng âm tổng hợp thay thế):`, missing)
  }
  return missing
}
