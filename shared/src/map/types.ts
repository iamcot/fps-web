import type { Vec3 } from '../math'

export type { Vec3 }

export interface MapBox {
  pos: Vec3
  size: Vec3
  texture: string     // class / loại / tên ảnh — xem materials.ts
  variant?: number    // chọn ảnh thứ n (từ 1) trong class
  color?: string      // '#rrggbb' nhân vào ảnh (hoặc sơn phẳng)
  noMirror?: boolean
  invisible?: boolean // chỉ va chạm, không vẽ (tường chắn trời)
}

export interface MapRamp {
  from: Vec3
  to: Vec3
  width: number
  texture?: string    // như MapBox (class / tên ảnh); bỏ trống = ô kẻ xanh xám
  variant?: number
  color?: string
  noMirror?: boolean
}

export interface MapSpawn {
  pos: Vec3
  yaw: number
}

export interface MapZone {
  min: Vec3
  max: Vec3
}

export interface MapFile {
  name: string
  mirrorX: boolean
  boxes: MapBox[]
  ramps: MapRamp[]
  spawnsA: MapSpawn[]
  buyZoneA?: MapZone   // khu mua của căn cứ phía x âm; loadMap mirror ra B
}

export interface LoadedMap {
  name: string
  boxes: MapBox[]
  ramps: MapRamp[]
  spawns: { A: MapSpawn[]; B: MapSpawn[] }
  buyZones: { A?: MapZone; B?: MapZone }
}
