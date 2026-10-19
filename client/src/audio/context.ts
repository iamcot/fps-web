// AudioContext + đồ thị master (A.4):
//   gunGroup ─┐
//   (reload, hit, ui, âm người khác) ─► master Gain ─► Compressor ─► destination
// gunGroup (tiếng súng của mình) nằm riêng để ducking khi phát tiếng hạ gục.
// Context chỉ được tạo trong sự kiện người dùng đầu tiên → không cảnh báo autoplay.

export interface AudioSettings {
  volume: number
  lowAmmoWarning: boolean
  heartbeat: boolean
}

const LS_KEY = 'fps_audio'
export const settings: AudioSettings = { volume: 1, lowAmmoWarning: true, heartbeat: true }
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'))
} catch { /* localStorage hỏng/không có: dùng mặc định */ }

export function saveSettings(): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)) } catch { /* bỏ qua */ }
  if (graph) graph.master.gain.value = settings.volume
}

export interface AudioGraph {
  ctx: AudioContext
  master: GainNode
  comp: DynamicsCompressorNode
  analyser: AnalyserNode
  gunGroup: GainNode
}

let graph: AudioGraph | null = null
const readyCbs: ((g: AudioGraph) => void)[] = []

export const getGraph = (): AudioGraph | null => graph

/** Gọi cb khi context đã sẵn sàng (ngay lập tức nếu đã có). */
export function onAudioReady(cb: (g: AudioGraph) => void): void {
  if (graph) cb(graph)
  else readyCbs.push(cb)
}

/** Đăng ký tạo context ở click/phím đầu tiên (user gesture). */
export function initAudioContext(): void {
  const start = () => {
    if (!graph) {
      const ctx = new AudioContext()
      const master = ctx.createGain()
      master.gain.value = settings.volume
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.knee.value = 6
      comp.ratio.value = 4
      comp.attack.value = 0.003
      comp.release.value = 0.15
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      const gunGroup = ctx.createGain()
      gunGroup.connect(master)
      master.connect(comp)
      comp.connect(ctx.destination)
      comp.connect(analyser)
      graph = { ctx, master, comp, analyser, gunGroup }
      for (const cb of readyCbs.splice(0)) cb(graph)
    }
    if (graph.ctx.state === 'suspended') void graph.ctx.resume()
    document.removeEventListener('click', start)
    document.removeEventListener('keydown', start)
  }
  document.addEventListener('click', start)
  document.addEventListener('keydown', start)
}

// ── Listener (camera) ─────────────────────────────────────────────────────────
export const listenerPos: [number, number, number] = [0, 0, 0]

/** Gọi mỗi frame: không cấp phát. yaw/pitch theo quy ước dự án (yaw 0 nhìn -Z). */
export function updateListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
  listenerPos[0] = x; listenerPos[1] = y; listenerPos[2] = z
  if (!graph) return
  const l = graph.ctx.listener
  const cp = Math.cos(pitch)
  const fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp
  if (l.positionX) {
    const t = graph.ctx.currentTime
    l.positionX.setValueAtTime(x, t); l.positionY.setValueAtTime(y, t); l.positionZ.setValueAtTime(z, t)
    l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t)
    l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t)
  } else {
    l.setPosition(x, y, z)
    l.setOrientation(fx, fy, fz, 0, 1, 0)
  }
}
