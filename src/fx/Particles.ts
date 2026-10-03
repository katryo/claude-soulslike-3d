import * as THREE from 'three';
import { getGlowTexture } from '../world/Textures';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  if (gl_FragColor.a < 0.003) discard;
}`;

export interface ParticleSpawn {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  r: number; g: number; b: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  /** If set, particle homes toward this target (used for souls). */
  home?: THREE.Vector3;
}

/** Fixed-capacity CPU particle pool rendered as a single Points draw call. */
export class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private size1: Float32Array;
  private alpha0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private homes: (THREE.Vector3 | undefined)[];
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;

  constructor(readonly capacity: number, blending: THREE.Blending) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.homes = new Array(capacity);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: getGlowTexture() }, uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setViewportHeight(h: number): void {
    this.material.uniforms.uScale.value = h * 0.5;
  }

  spawn(p: ParticleSpawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx ?? 0;
    this.vel[i3 + 1] = p.vy ?? 0;
    this.vel[i3 + 2] = p.vz ?? 0;
    this.col[i3] = p.r;
    this.col[i3 + 1] = p.g;
    this.col[i3 + 2] = p.b;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.size0[i] = p.size;
    this.size1[i] = p.sizeEnd ?? p.size;
    this.alpha0[i] = p.alpha ?? 1;
    this.grav[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 0;
    this.homes[i] = p.home;
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const home = this.homes[i];
      if (home) {
        const dx = home.x - this.pos[i3], dy = home.y + 1 - this.pos[i3 + 1], dz = home.z - this.pos[i3 + 2];
        const d = Math.hypot(dx, dy, dz) || 1;
        const acc = 30;
        this.vel[i3] += (dx / d) * acc * dt;
        this.vel[i3 + 1] += (dy / d) * acc * dt;
        this.vel[i3 + 2] += (dz / d) * acc * dt;
        if (d < 0.5) this.life[i] = Math.min(this.life[i], 0.05);
      }
      const drag = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag - this.grav[i] * dt;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.grav[i] > 0) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.3;
        this.vel[i3] *= 0.6;
        this.vel[i3 + 2] *= 0.6;
      }
      this.size[i] = this.size1[i] + (this.size0[i] - this.size1[i]) * k;
      // Fade in quickly, fade out with life.
      const fadeIn = Math.min(1, (1 - k) * 12);
      this.alpha[i] = this.alpha0[i] * Math.min(fadeIn, k * 1.6);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}
