import * as THREE from 'three';
import { ParticlePool } from './Particles';

const TRAIL_SAMPLES = 14;

/** Ribbon that follows a weapon's base→tip segment while swinging. */
export class WeaponTrail {
  readonly mesh: THREE.Mesh;
  private positions: Float32Array;
  private alphas: Float32Array;
  private samples: { b: THREE.Vector3; t: THREE.Vector3; age: number }[] = [];
  active = false;
  private tmpB = new THREE.Vector3();
  private tmpT = new THREE.Vector3();

  constructor(private base: THREE.Object3D, private tip: THREE.Object3D, color: number) {
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(TRAIL_SAMPLES * 2 * 3);
    this.alphas = new Float32Array(TRAIL_SAMPLES * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * (0.6 + vA), vA * 0.55); }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
  }

  setColor(c: number): void {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uColor.value.set(c);
  }

  update(dt: number): void {
    for (const s of this.samples) s.age += dt;
    if (this.active) {
      this.base.getWorldPosition(this.tmpB);
      this.tip.getWorldPosition(this.tmpT);
      this.samples.unshift({ b: this.tmpB.clone(), t: this.tmpT.clone(), age: 0 });
    }
    const maxAge = 0.16;
    while (this.samples.length > TRAIL_SAMPLES || (this.samples.length && this.samples[this.samples.length - 1].age > maxAge)) {
      this.samples.pop();
    }
    const n = this.samples.length;
    for (let i = 0; i < TRAIL_SAMPLES; i++) {
      const s = this.samples[Math.min(i, n - 1)];
      const i6 = i * 6;
      if (!s) {
        this.alphas[i * 2] = this.alphas[i * 2 + 1] = 0;
        continue;
      }
      this.positions[i6] = s.b.x;
      this.positions[i6 + 1] = s.b.y;
      this.positions[i6 + 2] = s.b.z;
      this.positions[i6 + 3] = s.t.x;
      this.positions[i6 + 4] = s.t.y;
      this.positions[i6 + 5] = s.t.z;
      const a = i < n ? Math.max(0, 1 - s.age / maxAge) * (1 - i / TRAIL_SAMPLES) : 0;
      this.alphas[i * 2] = a * 0.1;
      this.alphas[i * 2 + 1] = a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
    this.mesh.visible = n > 1;
  }
}

interface Ring {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  radius: number;
}

interface FlashLight {
  light: THREE.PointLight;
  age: number;
  life: number;
  intensity: number;
}

export class Effects {
  readonly glow = new ParticlePool(5000, THREE.AdditiveBlending);
  readonly dust = new ParticlePool(1500, THREE.NormalBlending);
  private rings: Ring[] = [];
  private flashes: FlashLight[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48, 1);
  private ash: THREE.Points;
  private ashVel: Float32Array;
  readonly trails: WeaponTrail[] = [];
  private flashPool: THREE.PointLight[] = [];

  constructor(private scene: THREE.Scene) {
    scene.add(this.glow.points, this.dust.points);
    this.ringGeo.rotateX(-Math.PI / 2);

    // Ambient falling ash around the camera.
    const N = 900;
    const pos = new Float32Array(N * 3);
    this.ashVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
      this.ashVel[i] = 0.3 + Math.random() * 0.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xb8aea0, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false });
    this.ash = new THREE.Points(g, m);
    this.ash.frustumCulled = false;
    scene.add(this.ash);

    // Pre-create a few point lights for impact flashes to avoid shader recompiles.
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 8, 2);
      l.visible = true;
      scene.add(l);
      this.flashPool.push(l);
    }
  }

  setViewportHeight(h: number): void {
    this.glow.setViewportHeight(h);
    this.dust.setViewportHeight(h);
  }

  addTrail(t: WeaponTrail): void {
    this.trails.push(t);
    this.scene.add(t.mesh);
  }

  removeTrail(t: WeaponTrail): void {
    const i = this.trails.indexOf(t);
    if (i >= 0) this.trails.splice(i, 1);
    this.scene.remove(t.mesh);
  }

  sparks(p: THREE.Vector3, dir: THREE.Vector3, count = 16, color: [number, number, number] = [1, 0.7, 0.3]): void {
    for (let i = 0; i < count; i++) {
      const s = 3 + Math.random() * 6;
      this.glow.spawn({
        x: p.x, y: p.y, z: p.z,
        vx: dir.x * s + (Math.random() - 0.5) * 5,
        vy: dir.y * s + Math.random() * 4,
        vz: dir.z * s + (Math.random() - 0.5) * 5,
        life: 0.25 + Math.random() * 0.35,
        size: 0.12 + Math.random() * 0.1,
        sizeEnd: 0.02,
        r: color[0], g: color[1], b: color[2],
        gravity: 12,
        drag: 2,
      });
    }
    this.flash(p, 0xffb060, 6, 0.12);
  }

  blood(p: THREE.Vector3, dir: THREE.Vector3, count = 18): void {
    for (let i = 0; i < count; i++) {
      const s = 1.5 + Math.random() * 4;
      this.dust.spawn({
        x: p.x, y: p.y, z: p.z,
        vx: dir.x * s + (Math.random() - 0.5) * 2.5,
        vy: 1 + Math.random() * 3,
        vz: dir.z * s + (Math.random() - 0.5) * 2.5,
        life: 0.5 + Math.random() * 0.4,
        size: 0.1 + Math.random() * 0.12,
        sizeEnd: 0.05,
        r: 0.35, g: 0.02, b: 0.02,
        alpha: 0.95,
        gravity: 9.8,
        drag: 1,
      });
    }
  }

  dustPuff(p: THREE.Vector3, count = 10, spread = 1, color: [number, number, number] = [0.45, 0.42, 0.38]): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.5 + Math.random() * 1.5) * spread;
      this.dust.spawn({
        x: p.x + Math.cos(a) * 0.2, y: p.y + 0.1, z: p.z + Math.sin(a) * 0.2,
        vx: Math.cos(a) * s, vy: 0.3 + Math.random() * 0.8, vz: Math.sin(a) * s,
        life: 0.7 + Math.random() * 0.7,
        size: 0.35 * spread, sizeEnd: 1.1 * spread,
        r: color[0], g: color[1], b: color[2],
        alpha: 0.35,
        drag: 2.5,
      });
    }
  }

  shockwave(p: THREE.Vector3, radius: number, color = 0xffa060, life = 0.45): void {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeo, m);
    mesh.position.set(p.x, 0.06, p.z);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, radius });
    this.dustPuff(p, 24, radius * 0.5);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = radius * (2 + Math.random() * 2);
      this.glow.spawn({
        x: p.x, y: 0.2, z: p.z,
        vx: Math.cos(a) * s, vy: 2 + Math.random() * 4, vz: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.3,
        size: 0.15, sizeEnd: 0.02,
        r: 1, g: 0.6, b: 0.25, gravity: 10, drag: 3,
      });
    }
    this.flash(p.clone().setY(1), color, 12, 0.3);
  }

  fireNova(p: THREE.Vector3, radius: number): void {
    this.shockwave(p, radius, 0xff6a20, 0.7);
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = radius * (1.5 + Math.random() * 2.5);
      this.glow.spawn({
        x: p.x, y: 0.4 + Math.random() * 1.5, z: p.z,
        vx: Math.cos(a) * s, vy: Math.random() * 3, vz: Math.sin(a) * s,
        life: 0.5 + Math.random() * 0.5,
        size: 0.6 + Math.random() * 0.6, sizeEnd: 0.1,
        r: 1, g: 0.35 + Math.random() * 0.3, b: 0.08, drag: 2.2,
      });
    }
    this.flash(p.clone().setY(1.5), 0xff7030, 40, 0.6);
  }

  /** Charging glow while the boss gathers fire. */
  fireGather(p: THREE.Vector3, radius: number): void {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.8 + Math.random() * 0.4);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      this.glow.spawn({
        x, y: 0.2 + Math.random() * 2, z,
        vx: (p.x - x) * 1.8, vy: 0.5, vz: (p.z - z) * 1.8,
        life: 0.5, size: 0.3, sizeEnd: 0.05,
        r: 1, g: 0.45, b: 0.1,
      });
    }
  }

  fireEmber(p: THREE.Vector3, spread = 0.3, rise = 1.5): void {
    this.glow.spawn({
      x: p.x + (Math.random() - 0.5) * spread, y: p.y, z: p.z + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 0.4, vy: rise * (0.6 + Math.random() * 0.8), vz: (Math.random() - 0.5) * 0.4,
      life: 0.5 + Math.random() * 0.6,
      size: 0.35 + Math.random() * 0.3, sizeEnd: 0.05,
      r: 1, g: 0.42 + Math.random() * 0.25, b: 0.1,
      alpha: 0.9,
    });
  }

  spark(p: THREE.Vector3): void {
    this.glow.spawn({
      x: p.x + (Math.random() - 0.5) * 0.2, y: p.y, z: p.z + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 0.8, vy: 1.5 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 0.8,
      life: 1.2 + Math.random() * 1.2,
      size: 0.06, sizeEnd: 0.02,
      r: 1, g: 0.6, b: 0.2,
    });
  }

  /** Wisps that fly into the player when souls are gained. */
  soulStream(from: THREE.Vector3, to: THREE.Vector3, count = 30): void {
    for (let i = 0; i < count; i++) {
      this.glow.spawn({
        x: from.x + (Math.random() - 0.5) * 0.6, y: from.y + Math.random() * 1.2, z: from.z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4,
        life: 1.6 + Math.random() * 0.6,
        size: 0.25, sizeEnd: 0.08,
        r: 0.75, g: 0.85, b: 1,
        drag: 1.5,
        home: to,
      });
    }
  }

  /** Dissolving corpse ash. */
  dissolve(p: THREE.Vector3, scale = 1): void {
    for (let i = 0; i < 6; i++) {
      this.glow.spawn({
        x: p.x + (Math.random() - 0.5) * 0.8 * scale, y: p.y + Math.random() * 0.6 * scale, z: p.z + (Math.random() - 0.5) * 0.8 * scale,
        vx: (Math.random() - 0.5) * 0.3, vy: 0.6 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.3,
        life: 1 + Math.random(),
        size: 0.12 * scale, sizeEnd: 0.02,
        r: 0.9, g: 0.8, b: 0.6, alpha: 0.7,
      });
    }
  }

  healBurst(p: THREE.Vector3): void {
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.4;
      this.glow.spawn({
        x: p.x + Math.cos(a) * r, y: p.y + Math.random() * 0.4, z: p.z + Math.sin(a) * r,
        vx: 0, vy: 1 + Math.random() * 1.5, vz: 0,
        life: 0.8 + Math.random() * 0.6, size: 0.18, sizeEnd: 0.02,
        r: 1, g: 0.75, b: 0.35,
      });
    }
    this.flash(p.clone().setY(p.y + 1), 0xffb050, 5, 0.8);
  }

  flash(p: THREE.Vector3, color: number, intensity: number, life: number): void {
    const l = this.flashPool.find((x) => !this.flashes.some((f) => f.light === x)) ?? this.flashes.shift()?.light;
    if (!l) return;
    l.color.set(color);
    l.position.copy(p);
    this.flashes.push({ light: l, age: 0, life, intensity });
  }

  update(dt: number, camPos: THREE.Vector3): void {
    this.glow.update(dt);
    this.dust.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const k = r.age / r.life;
      r.mesh.scale.setScalar(0.1 + (r.radius - 0.1) * (1 - Math.pow(1 - k, 3)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const k = 1 - f.age / f.life;
      f.light.intensity = Math.max(0, k * k * f.intensity);
      if (f.age >= f.life) {
        f.light.intensity = 0;
        this.flashes.splice(i, 1);
      }
    }
    for (const t of this.trails) t.update(dt);

    // Ash drifts down and wraps around the camera.
    const pos = this.ash.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const n = a.length / 3;
    const time = performance.now() * 0.001;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      a[i3] += Math.sin(time * 0.5 + i) * 0.15 * dt + 0.2 * dt;
      a[i3 + 1] -= this.ashVel[i] * dt;
      a[i3 + 2] += Math.cos(time * 0.4 + i * 1.3) * 0.15 * dt;
      const dx = a[i3] - camPos.x, dz = a[i3 + 2] - camPos.z;
      if (dx > 20) a[i3] -= 40; else if (dx < -20) a[i3] += 40;
      if (dz > 20) a[i3 + 2] -= 40; else if (dz < -20) a[i3 + 2] += 40;
      if (a[i3 + 1] < 0) a[i3 + 1] += 18;
    }
    pos.needsUpdate = true;
  }

  clear(): void {
    this.glow.clear();
    this.dust.clear();
  }
}
