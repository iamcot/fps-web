import * as THREE from 'three'
import { defaultMovement, NetFlag, TEAMS, type TeamId } from '@fps/shared'

// Tối thiểu để vẽ; NetPlayer và InterpPlayer đều thoả
interface RenderPlayer { id: number; pos: [number, number, number]; yaw: number; flags: number }

export interface TeamInfo {
  teamOf(id: number): TeamId | undefined
  nameOf(id: number): string | undefined
  myTeam(): TeamId | undefined
}

// Nhãn tên đồng đội: sprite canvas tạo một lần cho mỗi người
function makeNameSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 64
  const g = c.getContext('2d')!
  g.font = 'bold 34px monospace'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 128, 32)
  g.fillStyle = color; g.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(c)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sp.scale.set(1.6, 0.4, 1)
  sp.renderOrder = 10
  return sp
}

// Người chơi = capsule màu; pos là vị trí chân. Cao đứng/ngồi lấy từ MovementConfig.
export function createPlayersRenderer(scene: THREE.Scene, info?: TeamInfo) {
  const { radius, standHeight, crouchHeight } = defaultMovement
  const geo = new THREE.CapsuleGeometry(radius, standHeight - 2 * radius, 4, 12)
  const meshes = new Map<number, THREE.Mesh>()
  const lastSeen = new Map<number, number>()   // id → số frame cuối được thấy (tránh cấp phát Set mỗi frame)
  let frame = 0

  const labels = new Map<number, THREE.Sprite>()
  const FALLBACK = 0x888888

  function ensure(id: number): THREE.Mesh {
    let m = meshes.get(id)
    if (!m) {
      m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: FALLBACK, transparent: true }))
      m.castShadow = true
      scene.add(m)
      meshes.set(id, m)
    }
    return m
  }

  // Màu theo đội (đổi khi TeamAssigned đến); tên chỉ cho đồng đội, kẻ địch không có nhãn
  function dress(m: THREE.Mesh, id: number, h: number): void {
    const team = info?.teamOf(id)
    const mat = m.material as THREE.MeshLambertMaterial
    const want = team ? TEAMS[team].color : FALLBACK
    if (mat.color.getHex() !== want) mat.color.setHex(want)
    let label = labels.get(id)
    const mate = team !== undefined && team === info?.myTeam()
    if (mate && !label) {
      const name = info?.nameOf(id)
      if (name) {
        label = makeNameSprite(name, TEAMS[team!].uiColor)
        scene.add(label)
        labels.set(id, label)
      }
    }
    if (label) {
      label.visible = mate && m.visible
      label.position.set(m.position.x, m.position.y + h / 2 + 0.4, m.position.z)
    }
  }

  function place(m: THREE.Mesh, p: RenderPlayer) {
    const h = (p.flags & NetFlag.Crouching) ? crouchHeight : standHeight
    m.scale.y = h / standHeight
    m.position.set(p.pos[0], p.pos[1] + h / 2, p.pos[2])
    m.rotation.y = p.yaw
    m.visible = !(p.flags & NetFlag.Dead)   // người chết không vẽ
    dress(m, p.id, h)
    // Bất tử: nhấp nháy mờ
    ;(m.material as THREE.MeshLambertMaterial).opacity = (p.flags & NetFlag.Invuln) ? 0.55 + 0.3 * Math.sin(performance.now() / 70) : 1
  }

  return {
    // Vẽ đúng danh sách người chơi trong snapshot; ai không còn trong danh sách thì xoá.
    // Không vẽ chính mình: camera nằm trong capsule, lệch quá bán kính vài frame (jitter) là lộ ra.
    update(players: RenderPlayer[], selfId = -1) {
      frame++
      for (const p of players) {
        if (p.id === selfId) continue
        const m = ensure(p.id)
        lastSeen.set(p.id, frame)
        place(m, p)
      }
      for (const [id, m] of meshes) {
        if (lastSeen.get(id) === frame) continue
        scene.remove(m)
        const lb = labels.get(id)
        if (lb) { scene.remove(lb); lb.material.map?.dispose(); lb.material.dispose(); labels.delete(id) }
        ;(m.material as THREE.Material).dispose()
        meshes.delete(id)
        lastSeen.delete(id)
      }
    },
    clear() { this.update([]) },
  }
}
