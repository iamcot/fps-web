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
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 1.2 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), mat)
  dome.frustumCulled = false
  dome.renderOrder = -1
  scene.add(dome)
  return { update(camPos: THREE.Vector3): void { dome.position.copy(camPos) } }
}
