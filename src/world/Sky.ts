import * as THREE from 'three';

/** Gradient sky dome with a hazy eclipsed sun, stars and drifting cloud bands. */
export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.0, 0.12, -1).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(vec3(i, 0.0)), b = hash(vec3(i + vec2(1, 0), 0.0));
        float c = hash(vec3(i + vec2(0, 1), 0.0)), d = hash(vec3(i + vec2(1, 1), 0.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.035, 0.04, 0.06);
        vec3 mid = vec3(0.10, 0.09, 0.10);
        vec3 horizon = vec3(0.42, 0.22, 0.12);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.18, 0.7, h));
        col = mix(col, vec3(0.06, 0.05, 0.05), smoothstep(0.0, -0.2, h));
        // Eclipsed sun: dark disc with a burning corona.
        float sd = dot(d, normalize(uSunDir));
        float corona = smoothstep(0.985, 0.9985, sd) * (1.0 - smoothstep(0.9988, 0.9992, sd));
        float disc = smoothstep(0.9988, 0.9991, sd);
        float halo = pow(max(sd, 0.0), 40.0) * 0.6 + pow(max(sd, 0.0), 6.0) * 0.18;
        col += vec3(1.0, 0.55, 0.25) * (halo + corona * 3.0);
        col = mix(col, vec3(0.01, 0.005, 0.005), disc);
        // Clouds
        vec2 uv = d.xz / max(0.08, d.y + 0.15);
        float c = fbm(uv * 1.3 + vec2(uTime * 0.004, uTime * 0.002));
        float cloud = smoothstep(0.45, 0.85, c) * smoothstep(-0.02, 0.25, h);
        vec3 cloudCol = mix(vec3(0.05, 0.045, 0.05), vec3(0.5, 0.25, 0.12), pow(max(sd, 0.0), 3.0) * 0.8 + smoothstep(0.25, 0.0, h) * 0.3);
        col = mix(col, cloudCol, cloud * 0.8);
        // Stars
        vec3 sp = floor(d * 400.0);
        float star = step(0.9975, hash(sp)) * smoothstep(0.25, 0.6, h) * (1.0 - cloud);
        col += vec3(star) * (0.5 + 0.5 * sin(uTime * 2.0 + hash(sp) * 50.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
