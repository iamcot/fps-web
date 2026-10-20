import * as THREE from 'three'

// Bầu trời dựng bằng code (không cần ảnh): vòm cầu tô gradient chân trời → thiên đỉnh + quầng mặt trời.
// Màu chân trời cũng là màu sương mù để vật ở xa tan vào bầu trời, không lộ đường chân trời cứng.
export const SKY_HORIZON = 0xbcd2e4
const SKY_ZENITH = 0x3f78b8
const SKY_RADIUS = 200   // phải nhỏ hơn camera.far

export function createSky(scene: THREE.Scene, sunDir: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(SKY_HORIZON) },
      zenith: { value: new THREE.Color(SKY_ZENITH) },
      sunDir: { value: sunDir.clone().normalize() },
      night: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform float night; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18) * (1.0 - night);
        if (night > 0.5) {   // đêm: gradient tối + vài ngôi sao (ô lưới 3D ngẫu nhiên) + quầng trăng mờ
          c = mix(vec3(0.02, 0.03, 0.06), vec3(0.0, 0.005, 0.02), pow(h, 0.5));
          vec3 q = normalize(vDir) * 280.0;
          vec3 g = floor(q);
          float star = step(0.994, hash(g)) * smoothstep(0.05, 0.4, h) * (1.0 - smoothstep(0.07, 0.16, length(fract(q) - 0.5)));   // chấm nhỏ giữa ô lưới
          c += vec3(0.8, 0.85, 1.0) * star;
          c += vec3(0.35, 0.42, 0.6) * (pow(s, 900.0) * 1.0 + pow(s, 14.0) * 0.06);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), mat)
  dome.frustumCulled = false
  dome.renderOrder = -1
  scene.add(dome)
  return {
    update(camPos: THREE.Vector3): void { dome.position.copy(camPos) },
    setNight(on: boolean): void { mat.uniforms.night!.value = on ? 1 : 0 },
  }
}
