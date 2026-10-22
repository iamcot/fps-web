import * as THREE from 'three'
import type { TeamId } from '@fps/shared'

// Tô màu trang phục theo đội trên model có xương. Texture gốc rất tối (trung bình sRGB ~30–65/255) nên nhân màu
// hay tăng intensity chỉ ra đen hoặc cháy. Ở đây đọc độ sáng (luma) của texel làm "chi tiết", dựng lại albedo
// = màu đội × đường cong luma đã nâng, giữ nếp vải/túi đạn; vùng da (ấm, sáng, bão hoà vừa) giữ nguyên.
// Màu ở không gian tuyến tính (đã qua Color.set).
export interface TeamTintDef {
  color: number      // màu vải ở độ sáng đầy
  lumRef: number     // luma tuyến tính của texel được coi là "sáng đầy" (≈ 2–3 lần trung bình texture)
  lift: number       // sàn sáng 0..1: vùng tối nhất của texture không xuống dưới mức này
  gamma: number      // < 1 nâng vùng tối
  strength: number   // pha giữa màu gốc (0) và màu đội (1)
}

const TINT: Record<string, Record<TeamId, TeamTintDef>> = {
  saber:   {
    A: { color: 0x5a90f0, lumRef: 0.07, lift: 0.30, gamma: 0.8, strength: 0.1 },   // Cớm: xanh dương
    B: { color: 0xffeccb, lumRef: 0.08, lift: 0.50, gamma: 0.8, strength: 0.2 },   // Cướp: trắng kem
  },
  classic: {
    A: { color: 0x5a90f0, lumRef: 0.03, lift: 0.30, gamma: 0.8, strength: 0.3 },
    B: { color: 0xffeccb, lumRef: 0.09, lift: 0.50, gamma: 0.8, strength: 0.5 },
  },
}

export function teamTintDef(skin: string, team: TeamId): TeamTintDef | null { return TINT[skin]?.[team] ?? null }

/** Luma sau khi nâng: 0..1, dùng cả ở shader (cùng công thức) lẫn test */
export function liftedLuma(luma: number, d: Pick<TeamTintDef, 'lumRef' | 'lift' | 'gamma'>): number {
  const n = Math.min(1, Math.max(0, luma / d.lumRef))
  return d.lift + (1 - d.lift) * Math.pow(n, d.gamma)
}

// ── Viền 2D (back-face normal offset) ────────────────────────────────────────
const OUTLINE_COLOR: Record<string, Record<TeamId, number>> = {
  saber:   { A: 0x4499ff, B: 0xFF0000 },
  classic: { A: 0x4499ff, B: 0xffaa44 },
}
export function outlineColorFor(skin: string, team: TeamId): number | null {
  return OUTLINE_COLOR[skin]?.[team] ?? null
}

/**
 * Tạo SkinnedMesh viền 2D cho `src`: back-face render, đẩy đỉnh ra theo normal.
 * Caller tự add vào cùng parent với src và gắn skeleton.
 */
export function makeOutlineMesh(
  src: THREE.SkinnedMesh,
  color: number,
  thickness = 0.013,
  opacity = 0.9,
): THREE.SkinnedMesh {
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.BackSide, transparent: true, opacity, depthWrite: false })
  const t = thickness.toFixed(4)
  mat.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <displacementmap_vertex>',
      `transformed += normalize(objectNormal) * ${t};\n#include <displacementmap_vertex>`,
    )
  }
  mat.customProgramCacheKey = () => `outline:${color}:${t}:${opacity}`
  const mesh = new THREE.SkinnedMesh(src.geometry, mat)
  mesh.skeleton = src.skeleton
  mesh.bindMatrix.copy(src.bindMatrix)
  mesh.bindMatrixInverse.copy(src.bindMatrixInverse)
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

export interface TeamTintHandle { strength: { value: number }; readonly base: number }

/** Vá MeshLambertMaterial: thay phần lấy mẫu texture. `strength` 0 = nguyên bản (zombie), `base` = mức của đội. */
export function applyTeamTint(mat: THREE.MeshLambertMaterial, d: TeamTintDef): TeamTintHandle {
  const handle: TeamTintHandle = { strength: { value: d.strength }, base: d.strength }
  const tint = new THREE.Color(d.color)
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTint = { value: tint }
    shader.uniforms.uStrength = handle.strength
    shader.uniforms.uRef = { value: d.lumRef }
    shader.uniforms.uLift = { value: d.lift }
    shader.uniforms.uGamma = { value: d.gamma }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform vec3 uTint; uniform float uStrength, uRef, uLift, uGamma;\nvoid main() {`)
      .replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 texel = texture2D( map, vMapUv );
        float tl = dot( texel.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        float tmx = max( texel.r, max( texel.g, texel.b ) );
        float tsat = ( tmx - min( texel.r, min( texel.g, texel.b ) ) ) / ( tmx + 1e-4 );
        float skin = step( texel.g, texel.r ) * step( texel.b, texel.g ) * smoothstep( 0.18, 0.28, tsat ) * smoothstep( 0.22, 0.34, tmx );
        float lv = uLift + ( 1.0 - uLift ) * pow( clamp( tl / uRef, 0.0, 1.0 ), uGamma );
        texel.rgb = mix( texel.rgb, mix( uTint * lv, texel.rgb, skin ), uStrength );
        diffuseColor *= texel;
      #endif`)
  }
  mat.customProgramCacheKey = () => `teamTint:${d.color}:${d.lumRef}:${d.lift}:${d.gamma}`
  return handle
}
