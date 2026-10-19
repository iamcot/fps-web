import type { MapBox, MapFile, MapRamp, MapSpawn, MapZone, LoadedMap } from './types'

function mirrorBox(b: MapBox): MapBox {
  return { ...b, pos: [-b.pos[0], b.pos[1], b.pos[2]] }
}

function mirrorRamp(r: MapRamp): MapRamp {
  return {
    ...r,
    from: [-r.from[0], r.from[1], r.from[2]],
    to: [-r.to[0], r.to[1], r.to[2]],
  }
}

function mirrorSpawn(s: MapSpawn): MapSpawn {
  return { pos: [-s.pos[0], s.pos[1], s.pos[2]], yaw: -s.yaw }
}

function mirrorZone(z: MapZone): MapZone {
  return { min: [-z.max[0], z.min[1], z.min[2]], max: [-z.min[0], z.max[1], z.max[2]] }
}

function boxCrossesX0(b: MapBox): boolean {
  const minX = b.pos[0] - b.size[0] / 2
  const maxX = b.pos[0] + b.size[0] / 2
  return minX < 0 && maxX > 0
}

export function loadMap(file: MapFile): LoadedMap {
  if (!file.mirrorX) {
    return {
      name: file.name,
      boxes: file.boxes,
      ramps: file.ramps,
      spawns: { A: file.spawnsA, B: [] },
      buyZones: file.buyZoneA ? { A: file.buyZoneA } : {},
    }
  }

  for (const box of file.boxes) {
    if (!box.noMirror && boxCrossesX0(box)) {
      throw new Error(
        `Box "${box.texture}" at x=${box.pos[0]} (size ${box.size[0]}) crosses x=0 without noMirror`,
      )
    }
  }

  const boxes: MapBox[] = []
  for (const box of file.boxes) {
    boxes.push(box)
    if (!box.noMirror) boxes.push(mirrorBox(box))
  }

  const ramps: MapRamp[] = []
  for (const ramp of file.ramps) {
    ramps.push(ramp)
    if (!ramp.noMirror) ramps.push(mirrorRamp(ramp))
  }

  const spawnsB: MapSpawn[] = file.spawnsA.map(mirrorSpawn)

  return {
    name: file.name,
    boxes,
    ramps,
    spawns: { A: file.spawnsA, B: spawnsB },
    buyZones: file.buyZoneA ? { A: file.buyZoneA, B: mirrorZone(file.buyZoneA) } : {},
  }
}
