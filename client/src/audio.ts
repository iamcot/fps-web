// Âm thanh Web Audio. Chưa có file âm thanh trong assets nên mọi buffer được tổng hợp
// bằng code lúc khởi tạo (AudioBuffer), phát bằng AudioBufferSourceNode mới mỗi lần.
// AudioContext chỉ được tạo/resume trong sự kiện người dùng đầu tiên (click khoá chuột)
// → trước đó mọi lệnh play() là no-op, không có cảnh báo autoplay trong console.

export type SoundName =
  | 'fire0' | 'fire1' | 'fire2' | 'fire3'
  | 'dry' | 'reload' | 'reloadDone' | 'step' | 'hit' | 'headshot'

let ctx: AudioContext | null = null
const buffers = new Map<SoundName, AudioBuffer>()

function makeBuffer(c: AudioContext, seconds: number, fn: (t: number, i: number) => number): AudioBuffer {
  const rate = c.sampleRate
  const buf  = c.createBuffer(1, Math.ceil(seconds * rate), rate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = fn(i / rate, i)
  return buf
}

const noise = () => Math.random() * 2 - 1

// Tiếng súng: nổ (noise lọc thấp dần) + bụp trầm; mỗi súng một tham số
function gunshot(c: AudioContext, len: number, boomHz: number, crack: number, decay: number): AudioBuffer {
  let lp = 0
  return makeBuffer(c, len, (t) => {
    const env  = Math.exp(-t * decay)
    lp += (noise() - lp) * (0.15 + 0.6 * Math.exp(-t * 40))   // mở rộng band lúc đầu → "crack"
    const boom = Math.sin(2 * Math.PI * boomHz * t * (1 - 0.5 * t / len)) * Math.exp(-t * decay * 0.6)
    return (lp * crack * env + boom * 0.8) * 0.9
  })
}

function click(c: AudioContext, freq: number, len: number, level: number): AudioBuffer {
  return makeBuffer(c, len, (t) => (noise() * 0.5 + Math.sin(2 * Math.PI * freq * t)) * Math.exp(-t * 90) * level)
}

function buildBuffers(c: AudioContext): void {
  buffers.set('fire0', gunshot(c, 0.35, 95,  1.3, 14))   // AK47: trầm, gắt
  buffers.set('fire1', gunshot(c, 0.28, 130, 1.0, 18))   // M16: gọn, cao hơn
  buffers.set('fire2', gunshot(c, 0.30, 110, 1.1, 16))   // COLT
  buffers.set('fire3', gunshot(c, 0.55, 70,  1.4, 9))    // ROULEAU: nặng, vang
  buffers.set('dry', click(c, 1800, 0.08, 0.7))
  buffers.set('reload', makeBuffer(c, 0.5, (t) => {      // tháo băng: hai tiếng cạch
    const a = Math.exp(-(t % 0.25) * 70) * (t < 0.5 ? 1 : 0)
    return (noise() * 0.6 + Math.sin(2 * Math.PI * 900 * t)) * a * 0.5
  }))
  buffers.set('reloadDone', click(c, 700, 0.12, 0.9))    // lên đạn
  buffers.set('step', makeBuffer(c, 0.12, (t) => {
    return noise() * Math.exp(-t * 45) * (0.35 + 0.65 * Math.exp(-t * 200)) * 0.5
  }))
  buffers.set('hit', makeBuffer(c, 0.07, (t) => Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-t * 60) * 0.5))
  buffers.set('headshot', makeBuffer(c, 0.18, (t) => {
    const e = Math.exp(-t * 28)
    return (Math.sin(2 * Math.PI * 2200 * t) + 0.5 * Math.sin(2 * Math.PI * 3300 * t)) * e * 0.4
  }))
}

/** Đăng ký tạo AudioContext ở cú click/phím đầu tiên (gesture của người dùng). */
export function initAudio(): void {
  const start = () => {
    if (!ctx) {
      ctx = new AudioContext()
      buildBuffers(ctx)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    document.removeEventListener('click', start)
    document.removeEventListener('keydown', start)
  }
  document.addEventListener('click', start)
  document.addEventListener('keydown', start)
}

export function play(name: SoundName, volume = 1, rate = 1): void {
  if (!ctx || ctx.state !== 'running') return
  const buf = buffers.get(name)
  if (!buf) return
  const src  = ctx.createBufferSource()
  const gain = ctx.createGain()
  src.buffer = buf
  src.playbackRate.value = rate
  gain.gain.value = volume
  src.connect(gain).connect(ctx.destination)
  src.start()
}
