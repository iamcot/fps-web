import * as THREE from 'three'
import { WEAPONS, WORLD_WEAPON, canPickUp, type Loadout, type OwnedWeapon, type Vec3, type WorldWeaponSpawnMsg } from '@fps/shared'
import { cloneGunModel } from './players'
import { WEAPON_LABEL } from '../weaponIcon'
import { t } from '../i18n'

// Vũ khí nằm dưới đất (plan 19 P8): model nằm nghiêng trên sàn, xoay chậm + nhấp nhô, vòng sáng dưới chân.
// Server quyết định nhặt / vứt; ở đây chỉ vẽ và gợi ý "G: nhặt <tên>" khi đứng trong tầm.
const LIE_Z = Math.PI / 2          // nằm nghiêng quanh trục dọc thân súng
const LIFT = 0.12                  // m: nâng khỏi sàn
const BOB = 0.04, BOB_HZ = 1.2
const FADE_START_MS = 5000         // sắp biến mất: nhấp nháy

interface Item {
  id: number
  weapon: number
  root: THREE.Group
  model: THREE.Object3D | null     // null = model chưa load xong, thử lại ở update
  persist: boolean
  age: number                      // giây từ lúc xuất hiện
  baseY: number
}

export function createWorldWeapons(scene: THREE.Scene) {
  const items = new Map<number, Item>()
  const ringGeo = new THREE.RingGeometry(0.28, 0.4, 28).rotateX(-Math.PI / 2)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  const hint = document.createElement('div')
  hint.style.cssText = 'position:fixed;left:50%;bottom:30%;transform:translateX(-50%);padding:4px 12px;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;font:15px monospace;text-shadow:0 0 4px #000;pointer-events:none;display:none;z-index:5'
  document.body.appendChild(hint)
  let hintText = ''
  const tmpLoadout: Loadout = { slots: [] }   // tái sử dụng: không cấp phát mỗi frame

  function attachModel(it: Item): void {
    const m = cloneGunModel(it.weapon)
    if (!m) return
    m.rotation.z = LIE_Z
    it.root.add(m)
    it.model = m
  }

  function dispose(it: Item): void {
    it.root.removeFromParent()   // geometry / material dùng chung với model gốc: không dispose
  }

  return {
    onSpawn(msg: WorldWeaponSpawnMsg): void {
      this.onRemove(msg.id)
      const root = new THREE.Group()
      root.position.set(msg.pos[0], msg.pos[1], msg.pos[2])
      root.rotation.y = msg.yaw
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.y = 0.02
      root.add(ring)
      const it: Item = { id: msg.id, weapon: msg.weapon, root, model: null, persist: !!msg.persist, age: 0, baseY: LIFT }
      attachModel(it)
      if (it.model) it.model.position.y = LIFT
      scene.add(root)
      items.set(msg.id, it)
    },
    onRemove(id: number): void {
      const it = items.get(id)
      if (!it) return
      dispose(it)
      items.delete(id)
    },
    clear(): void {
      for (const it of items.values()) dispose(it)
      items.clear()
      hint.style.display = 'none'
    },
    /** Mỗi frame. `viewer` = vị trí chân người chơi; `loadout` = súng đang mang (null = chưa biết); `canInteract` = còn sống và không gục */
    update(dt: number, viewer: Vec3, loadout: readonly (OwnedWeapon | null)[] | null, canInteract: boolean): void {
      if (loadout) tmpLoadout.slots = loadout as (OwnedWeapon | null)[]
      let nearest: Item | null = null
      let nearestD: number = WORLD_WEAPON.pickupRadius
      for (const it of items.values()) {
        it.age += dt
        if (!it.model) { attachModel(it); if (!it.model) continue }
        it.model.position.y = it.baseY + Math.sin(it.age * Math.PI * 2 * BOB_HZ) * BOB
        it.model.rotation.y += dt * 0.6
        it.root.visible = true
        if (!it.persist && it.age * 1000 > WORLD_WEAPON.despawnMs - FADE_START_MS) it.root.visible = Math.floor(it.age * 4) % 2 === 0   // sắp mất: nhấp nháy
        if (!canInteract || !loadout) continue
        const dx = it.root.position.x - viewer[0], dz = it.root.position.z - viewer[2]
        const d = Math.hypot(dx, dz)
        if (d < nearestD && Math.abs(it.root.position.y - viewer[1]) <= WORLD_WEAPON.pickupHeight && canPickUp(tmpLoadout, WEAPONS[it.weapon])) { nearestD = d; nearest = it }
      }
      const text = nearest ? t('G: pick up {name}', { name: WEAPON_LABEL[WEAPONS[(nearest as Item).weapon]!.key] ?? WEAPONS[(nearest as Item).weapon]!.name }) : ''
      if (text !== hintText) {
        hintText = text
        hint.textContent = text
        hint.style.display = text ? 'block' : 'none'
      }
    },
  }
}
