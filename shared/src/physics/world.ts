import RAPIER from '@dimforge/rapier3d-compat'
import type { LoadedMap } from '../map/types'

// Collision groups: encoding = (membership << 16) | filter
// An interaction is allowed if (memberA & filterB) != 0 && (memberB & filterA) != 0
const MAP_FILTER    = (0x0001 << 16) | 0xFFFF  // member=1, collides with all
const PLAYER_FILTER = (0x0002 << 16) | 0x0001  // member=2, collides with map only

// Controller có thể để chân lún ~1e-4 dưới mặt sàn; không nâng shape lên thì canStand
// luôn false (sàn cắt capsule) và người chơi kẹt ở trạng thái ngồi khi nhả Ctrl.
const CANSTAND_EPS = 0.02

export interface CollisionWorld {
  moveCharacter(
    pos: [number, number, number],
    delta: [number, number, number],
    crouching: boolean,
  ): { pos: [number, number, number]; grounded: boolean; hitCeiling: boolean }
  canStand(pos: [number, number, number]): boolean
  castRay(
    origin: [number, number, number],
    dir: [number, number, number],
    maxDist: number,
  ): { dist: number; normal: [number, number, number] } | null
  debugRender(): { vertices: Float32Array; colors: Float32Array }
}

class PhysicsWorld implements CollisionWorld {
  private _w: RAPIER.World
  private _body: RAPIER.RigidBody
  private _col: RAPIER.Collider
  private _ctrl: RAPIER.KinematicCharacterController
  private _standHalf: number
  private _crouchHalf: number
  private _standOffset: number   // capsule center Y above foot for stand
  private _crouchOffset: number  // capsule center Y above foot for crouch
  private _radius: number
  private _standShape: RAPIER.Capsule
  private _crouching = false

  constructor(w: RAPIER.World, standH: number, crouchH: number, r: number) {
    this._w      = w
    this._radius = r
    this._standHalf  = (standH  - 2 * r) / 2
    this._crouchHalf = (crouchH - 2 * r) / 2
    this._standOffset  = r + this._standHalf
    this._crouchOffset = r + this._crouchHalf
    // Shape kiểm tra đứng: bỏ CANSTAND_EPS ở đáy để chạm sàn không bị tính là va chạm
    this._standShape   = new RAPIER.Capsule(this._standHalf - CANSTAND_EPS / 2, r)

    this._body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased())
    this._col  = w.createCollider(
      RAPIER.ColliderDesc.capsule(this._standHalf, r).setCollisionGroups(PLAYER_FILTER),
      this._body,
    )

    this._ctrl = w.createCharacterController(0.02)
    this._ctrl.setMaxSlopeClimbAngle(50 * Math.PI / 180)
    this._ctrl.enableSnapToGround(0.3)
    this._ctrl.disableAutostep()
  }

  moveCharacter(
    pos: [number, number, number],
    delta: [number, number, number],
    crouching: boolean,
  ): { pos: [number, number, number]; grounded: boolean; hitCeiling: boolean } {
    if (crouching !== this._crouching) {
      this._w.removeCollider(this._col, false)
      const half = crouching ? this._crouchHalf : this._standHalf
      this._col = this._w.createCollider(
        RAPIER.ColliderDesc.capsule(half, this._radius).setCollisionGroups(PLAYER_FILTER),
        this._body,
      )
      this._crouching = crouching
    }

    const off = crouching ? this._crouchOffset : this._standOffset
    this._body.setNextKinematicTranslation({ x: pos[0], y: pos[1] + off, z: pos[2] })
    this._w.step()  // apply kinematic translation + update query pipeline

    this._ctrl.computeColliderMovement(
      this._col,
      { x: delta[0], y: delta[1], z: delta[2] },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_FILTER,
    )

    const mv      = this._ctrl.computedMovement()
    const ground  = this._ctrl.computedGrounded()
    const ceiling = delta[1] > 0 && mv.y < delta[1] * 0.5

    return {
      pos: [pos[0] + mv.x, pos[1] + mv.y, pos[2] + mv.z],
      grounded: ground,
      hitCeiling: ceiling,
    }
  }

  canStand(pos: [number, number, number]): boolean {
    const cy  = pos[1] + this._standOffset + CANSTAND_EPS / 2
    const hit = this._w.intersectionWithShape(
      { x: pos[0], y: cy, z: pos[2] },
      { x: 0, y: 0, z: 0, w: 1 },
      this._standShape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_FILTER,
      this._col,
    )
    return hit === null
  }

  castRay(
    origin: [number, number, number],
    dir: [number, number, number],
    maxDist: number,
  ): { dist: number; normal: [number, number, number] } | null {
    const ray = new RAPIER.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: dir[0],    y: dir[1],    z: dir[2] },
    )
    const hit = this._w.castRayAndGetNormal(
      ray, maxDist, false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      PLAYER_FILTER,
      this._col,
    )
    if (!hit) return null
    return {
      dist:   hit.toi,
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
    }
  }

  debugRender(): { vertices: Float32Array; colors: Float32Array } {
    return this._w.debugRender()
  }
}

// Quaternion rotating local X-axis to align with unit direction (dx, dy, dz)
function dirToQuatX(dx: number, dy: number, dz: number) {
  const sinTheta = Math.sqrt(dy * dy + dz * dz)
  const cosTheta = dx
  if (sinTheta < 1e-9) {
    return cosTheta > 0
      ? { x: 0, y: 0, z: 0, w: 1 }
      : { x: 0, y: 1, z: 0, w: 0 }
  }
  const half = Math.atan2(sinTheta, cosTheta) / 2
  const f    = Math.sin(half) / sinTheta
  return { x: 0, y: -dz * f, z: dy * f, w: Math.cos(half) }
}

export async function createWorld(
  map: LoadedMap,
  standHeight = 1.8,
  crouchHeight = 1.2,
  radius = 0.4,
): Promise<CollisionWorld> {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 })

  for (const box of map.boxes) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(box.pos[0], box.pos[1], box.pos[2]),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.size[0] / 2, box.size[1] / 2, box.size[2] / 2)
        .setCollisionGroups(MAP_FILTER),
      body,
    )
  }

  for (const ramp of map.ramps) {
    const cx  = (ramp.from[0] + ramp.to[0]) / 2
    const cy  = (ramp.from[1] + ramp.to[1]) / 2
    const cz  = (ramp.from[2] + ramp.to[2]) / 2
    const dx  = ramp.to[0] - ramp.from[0]
    const dy  = ramp.to[1] - ramp.from[1]
    const dz  = ramp.to[2] - ramp.from[2]
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const q   = dirToQuatX(dx / len, dy / len, dz / len)
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(len / 2, 0.15, ramp.width / 2)
        .setRotation(q)
        .setCollisionGroups(MAP_FILTER),
      body,
    )
  }

  return new PhysicsWorld(world, standHeight, crouchHeight, radius)
}
