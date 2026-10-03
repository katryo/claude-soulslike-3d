import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld, type BoxCollider } from './Collision';
import {
  getBarkTexture,
  getFlagstoneTexture,
  getGroundTexture,
  getStoneBump,
  getStoneTexture,
} from './Textures';
import { createSky } from './Sky';
import { fbm, rng } from '../core/math';
import { mat } from '../anim/Rig';

export interface BonfireSpot {
  id: string;
  name: string;
  pos: THREE.Vector3;
  /** Where the player stands / respawns. */
  spawn: THREE.Vector3;
  spawnYaw: number;
  light: THREE.PointLight;
  flame: THREE.Object3D;
  lit: boolean;
}

export interface MessageSpot {
  pos: THREE.Vector3;
  text: string;
}

export interface ItemSpot {
  id: string;
  pos: THREE.Vector3;
  name: string;
  desc: string;
  effect: 'flask' | 'souls' | 'vigor';
  amount: number;
  mesh: THREE.Object3D;
}

export interface EnemySpawn {
  kind: 'hollow' | 'spearman' | 'brute';
  x: number;
  z: number;
  yaw: number;
  dormant?: boolean;
}

interface Torch {
  pos: THREE.Vector3;
  light: THREE.PointLight | null;
  base: number;
  seed: number;
}

/** Batches static geometry per material to keep draw calls low. */
class StaticBatcher {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    // Normalise attribute sets so geometries can be merged.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    }
    let list = this.groups.get(material);
    if (!list) this.groups.set(material, (list = []));
    list.push(g);
  }
  build(scene: THREE.Scene, castShadow = true): void {
    for (const [m, list] of this.groups) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      list.forEach((g) => g.dispose());
    }
    this.groups.clear();
  }
}

/** Box geometry with UVs scaled to world size so textures tile uniformly. */
function worldBox(w: number, h: number, d: number, texScale = 0.25): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let su: number, sv: number;
    if (nx > 0.5) {
      su = d;
      sv = h;
    } else if (ny > 0.5) {
      su = w;
      sv = d;
    } else {
      su = w;
      sv = h;
    }
    uv.setXY(i, uv.getX(i) * su * texScale, uv.getY(i) * sv * texScale);
  }
  return g;
}

export class World {
  readonly scene: THREE.Scene;
  readonly collision = new CollisionWorld();
  readonly bonfires: BonfireSpot[] = [];
  readonly messages: MessageSpot[] = [];
  readonly items: ItemSpot[] = [];
  readonly spawns: EnemySpawn[] = [];
  readonly bossSpawn = { x: 0, z: -104, yaw: 0 };
  readonly arenaCenter = new THREE.Vector3(0, 0, -100);
  readonly arenaRadius = 21;
  fogGate!: { mesh: THREE.Mesh; collider: BoxCollider; pos: THREE.Vector3; open: boolean };
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.Mesh;
  private torches: Torch[] = [];
  private time = 0;
  private batch = new StaticBatcher();
  private stoneMat: THREE.MeshStandardMaterial;
  private darkStoneMat: THREE.MeshStandardMaterial;
  private floorMat: THREE.MeshStandardMaterial;
  private woodMat: THREE.MeshStandardMaterial;
  private rand = rng(1337);
  private m4 = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    scene.background = new THREE.Color(0x0d0d10);
    scene.fog = new THREE.FogExp2(0x17161a, 0.019);

    this.stoneMat = new THREE.MeshStandardMaterial({
      map: getStoneTexture(),
      bumpMap: getStoneBump(),
      bumpScale: 2.5,
      roughness: 0.92,
      metalness: 0.0,
      color: 0xb0aaa2,
    });
    this.darkStoneMat = new THREE.MeshStandardMaterial({
      map: getStoneTexture(),
      bumpMap: getStoneBump(),
      bumpScale: 2,
      roughness: 0.95,
      color: 0x6e6862,
    });
    this.floorMat = new THREE.MeshStandardMaterial({ map: getFlagstoneTexture(), roughness: 0.9, color: 0xa09890 });
    this.woodMat = new THREE.MeshStandardMaterial({ map: getBarkTexture(), roughness: 1, color: 0x8a7a6a });

    this.sky = createSky();
    scene.add(this.sky);

    // Lighting
    const hemi = new THREE.HemisphereLight(0x8a94a8, 0x302418, 0.95);
    scene.add(hemi);
    const amb = new THREE.AmbientLight(0x3a3036, 0.35);
    scene.add(amb);
    this.sun = new THREE.DirectionalLight(0xc8d0e8, 1.35);
    this.sun.position.set(-30, 50, 25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -28;
    sc.right = 28;
    sc.top = 28;
    sc.bottom = -28;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    // Warm rim light from the eclipse.
    const rim = new THREE.DirectionalLight(0xff8a50, 0.55);
    rim.position.set(0, 12, -100);
    scene.add(rim);

    this.buildGround();
    this.buildShrine();
    this.buildGatehouse();
    this.buildCourtyard();
    this.buildBridge();
    this.buildArena();
    this.buildBackdrop();
    this.batch.build(scene);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private addStatic(geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, s = 1): void {
    this.m4.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(s, s, s),
    );
    this.batch.add(geo, material, this.m4);
  }

  /** Wall from (x1,z1) to (x2,z2) with collider and crenellations. */
  private wall(x1: number, z1: number, x2: number, z2: number, height = 6, thick = 1.2, opts: { crenel?: boolean; ruined?: boolean; dark?: boolean } = {}): void {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz) - Math.PI / 2; // local X runs along the wall
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const m = opts.dark ? this.darkStoneMat : this.stoneMat;
    if (opts.ruined) {
      // Uneven broken top built from segments.
      const segs = Math.max(1, Math.round(len / 2));
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const h = height * (0.45 + 0.55 * this.rand());
        const sx = x1 + dx * (t0 + t1) / 2, sz = z1 + dz * (t0 + t1) / 2;
        this.addStatic(worldBox(len / segs + 0.02, h, thick), m, sx, h / 2, sz, angle);
      }
    } else {
      this.addStatic(worldBox(len, height, thick), m, cx, height / 2, cz, angle);
      // Plinth
      this.addStatic(worldBox(len, 0.5, thick + 0.4), this.darkStoneMat, cx, 0.25, cz, angle);
      if (opts.crenel !== false) {
        const n = Math.floor(len / 1.6);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          if (this.rand() < 0.15) continue; // missing merlons
          this.addStatic(worldBox(0.8, 0.8, thick + 0.1), m, x1 + dx * t, height + 0.4, z1 + dz * t, angle);
        }
      }
    }
    this.collision.add({ kind: 'box', x: cx, z: cz, hx: len / 2, hz: thick / 2 + 0.05, angle, height, enabled: true });
  }

  private pillar(x: number, z: number, h = 5, r = 0.55, broken = false): void {
    const hh = broken ? h * (0.3 + this.rand() * 0.5) : h;
    const g = new THREE.CylinderGeometry(r * 0.9, r, hh, 12, 1);
    this.addStatic(g, this.stoneMat, x, hh / 2, z);
    this.addStatic(worldBox(r * 2.6, 0.5, r * 2.6), this.darkStoneMat, x, 0.25, z);
    if (!broken) {
      this.addStatic(worldBox(r * 2.5, 0.45, r * 2.5), this.darkStoneMat, x, hh + 0.22, z);
    } else {
      // Fallen drum next to it
      const a = this.rand() * Math.PI * 2;
      const dg = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 1.2, 12);
      this.addStatic(dg, this.stoneMat, x + Math.cos(a) * 1.8, r * 0.9, z + Math.sin(a) * 1.8, a, 0, Math.PI / 2);
      this.collision.add({ kind: 'circle', x: x + Math.cos(a) * 1.8, z: z + Math.sin(a) * 1.8, r: 0.8, height: 1, enabled: true });
    }
    this.collision.add({ kind: 'circle', x, z, r: r + 0.05, height: hh, enabled: true });
  }

  private arch(x: number, z: number, width: number, height: number, angle = 0): void {
    const t = 1.4;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (const s of [-1, 1]) {
      const px = x + cos * (s * (width / 2 + 0.6)), pz = z - sin * (s * (width / 2 + 0.6));
      this.addStatic(worldBox(1.2, height, t), this.stoneMat, px, height / 2, pz, angle);
      this.collision.add({ kind: 'box', x: px, z: pz, hx: 0.6, hz: t / 2, angle, height, enabled: true });
    }
    // Lintel and a pointed gable
    this.addStatic(worldBox(width + 2.4, 1.2, t), this.stoneMat, x, height + 0.6, z, angle);
    this.addStatic(new THREE.BoxGeometry(width + 2.4, 0.3, t + 0.2), this.darkStoneMat, x, height + 1.35, z, angle);
  }

  private gravestone(x: number, z: number): void {
    const r = this.rand;
    const tilt = (r() - 0.5) * 0.4;
    const ry = (r() - 0.5) * 0.6;
    if (r() < 0.5) {
      this.addStatic(worldBox(0.7, 1.1, 0.2, 0.6), this.darkStoneMat, x, 0.5, z, ry, tilt * 0.3, tilt);
      this.addStatic(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), this.darkStoneMat, x, 1.05, z, ry + Math.PI / 2, 0, tilt);
    } else {
      // Cross
      this.addStatic(worldBox(0.18, 1.4, 0.18, 0.6), this.darkStoneMat, x, 0.65, z, ry, tilt * 0.3, tilt);
      this.addStatic(worldBox(0.7, 0.16, 0.16, 0.6), this.darkStoneMat, x, 1.0, z, ry, tilt * 0.3, tilt);
    }
    this.collision.add({ kind: 'circle', x, z, r: 0.35, height: 1, enabled: true });
  }

  private deadTree(x: number, z: number, s = 1): void {
    const r = this.rand;
    const trunkH = 5 * s;
    this.addStatic(new THREE.CylinderGeometry(0.18 * s, 0.4 * s, trunkH, 7), this.woodMat, x, trunkH / 2, z, r() * 3, (r() - 0.5) * 0.15, (r() - 0.5) * 0.15);
    for (let i = 0; i < 6; i++) {
      const len = (1.4 + r() * 2.2) * s;
      const g = new THREE.CylinderGeometry(0.03 * s, 0.12 * s, len, 5);
      g.translate(0, len / 2, 0);
      const ry = r() * Math.PI * 2;
      const rz = 0.5 + r() * 0.7;
      this.addStatic(g, this.woodMat, x, trunkH * (0.45 + r() * 0.5), z, ry, 0, rz);
    }
    this.collision.add({ kind: 'circle', x, z, r: 0.45 * s, height: trunkH, enabled: true });
  }

  private rock(x: number, z: number, s: number): void {
    const g = new THREE.DodecahedronGeometry(s, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = 0.75 + fbm(pos.getX(i) * 2 + x, pos.getZ(i) * 2 + z) * 0.5;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    this.addStatic(g, this.darkStoneMat, x, s * 0.25, z, this.rand() * 6);
    if (s > 0.6) this.collision.add({ kind: 'circle', x, z, r: s * 0.8, height: s, enabled: true });
  }

  private torch(x: number, z: number, y = 2.6, withLight = true): void {
    this.addStatic(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 6), this.woodMat, x, y - 0.3, z);
    this.addStatic(new THREE.CylinderGeometry(0.14, 0.08, 0.2, 8), mat(0x222222, 0.5, 0.8), x, y, z);
    let light: THREE.PointLight | null = null;
    if (withLight) {
      light = new THREE.PointLight(0xff8a3a, 14, 14, 1.8);
      light.position.set(x, y + 0.4, z);
      this.scene.add(light);
    }
    this.torches.push({ pos: new THREE.Vector3(x, y + 0.15, z), light, base: 14, seed: this.rand() * 100 });
  }

  private brazier(x: number, z: number, withLight = true): void {
    this.addStatic(new THREE.CylinderGeometry(0.15, 0.25, 1.1, 8), mat(0x1c1a18, 0.6, 0.7), x, 0.55, z);
    this.addStatic(new THREE.CylinderGeometry(0.6, 0.3, 0.45, 10, 1, true), mat(0x1c1a18, 0.6, 0.7), x, 1.3, z);
    this.addStatic(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 10), mat(0x2a0f05, 0.9, 0, 0xff4a10, 1.5), x, 1.35, z);
    let light: THREE.PointLight | null = null;
    if (withLight) {
      light = new THREE.PointLight(0xff7a2a, 22, 18, 1.8);
      light.position.set(x, 2.2, z);
      this.scene.add(light);
    }
    this.torches.push({ pos: new THREE.Vector3(x, 1.5, z), light, base: 22, seed: this.rand() * 100 });
    this.collision.add({ kind: 'circle', x, z, r: 0.55, height: 1.5, enabled: true });
  }

  private floorPatch(x: number, z: number, w: number, d: number, round = false): void {
    let g: THREE.BufferGeometry;
    if (round) {
      g = new THREE.CircleGeometry(w, 48);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 0.4, uv.getY(i) * w * 0.4);
    } else {
      g = new THREE.PlaneGeometry(w, d);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 0.2, uv.getY(i) * d * 0.2);
    }
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, this.floorMat);
    mesh.position.set(x, 0.015, z);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private bonfire(id: string, name: string, x: number, z: number, spawnYaw: number, lit: boolean): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    // Ash mound and charred logs/bones
    const ash = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.35, 12), mat(0x2a2522, 1, 0));
    ash.position.y = 0.17;
    ash.receiveShadow = true;
    g.add(ash);
    for (let i = 0; i < 7; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 5), mat(0x1a1210, 1, 0));
      const a = (i / 7) * Math.PI * 2;
      log.position.set(Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3);
      log.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      log.castShadow = true;
      g.add(log);
    }
    for (let i = 0; i < 5; i++) {
      const sk = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), mat(0xb8b0a0, 0.8, 0));
      const a = this.rand() * Math.PI * 2;
      sk.position.set(Math.cos(a) * 0.7, 0.08, Math.sin(a) * 0.7);
      g.add(sk);
    }
    // Coiled sword planted in the ashes
    const sword = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.1, 0.015), mat(0x3a3330, 0.4, 0.9, 0x401000, 0.6));
    blade.position.y = 0.35;
    sword.add(blade);
    for (let i = 0; i < 7; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 8), mat(0x3a3330, 0.4, 0.9));
      coil.position.y = 0.0 + i * 0.12;
      coil.rotation.x = Math.PI / 2 + Math.sin(i) * 0.4;
      sword.add(coil);
    }
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.05), mat(0x2a2522, 0.5, 0.8));
    guard.position.y = 0.92;
    sword.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), mat(0x1a1210, 0.9, 0));
    grip.position.y = 1.05;
    sword.add(grip);
    sword.rotation.z = 0.12;
    sword.position.y = 0.1;
    sword.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    g.add(sword);
    // Glowing embers core
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.position.y = 0.3;
    flame.scale.set(1, 0.6, 1);
    g.add(flame);
    flame.visible = lit;
    this.scene.add(g);

    const light = new THREE.PointLight(0xff8833, lit ? 30 : 0, 22, 1.6);
    light.position.set(x, 1.3, z);
    light.castShadow = false;
    this.scene.add(light);
    const sx = x + Math.sin(spawnYaw + Math.PI) * 1.8, sz = z + Math.cos(spawnYaw + Math.PI) * 1.8;
    this.bonfires.push({ id, name, pos: new THREE.Vector3(x, 0, z), spawn: new THREE.Vector3(sx, 0, sz), spawnYaw, light, flame, lit });
    this.collision.add({ kind: 'circle', x, z, r: 0.6, height: 0.8, enabled: true });
  }

  setBonfireLit(b: BonfireSpot, lit: boolean): void {
    b.lit = lit;
    b.flame.visible = lit;
    b.light.intensity = lit ? 30 : 0;
  }

  private message(x: number, z: number, text: string): void {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = 'rgba(255,150,60,0.95)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(255,120,40,1)';
    ctx.shadowBlur = 8;
    const r = rng(Math.floor(x * 31 + z * 17));
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      const cx = 20 + r() * 88, cy = 30 + r() * 68;
      ctx.moveTo(cx, cy);
      for (let k = 0; k < 3; k++) ctx.lineTo(cx + (r() - 0.5) * 40, cy + (r() - 0.5) * 30);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(64, 64, 58, 40, 0, 0, Math.PI * 2);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = this.rand() * Math.PI;
    m.position.set(x, 0.03, z);
    this.scene.add(m);
    this.messages.push({ pos: new THREE.Vector3(x, 0, z), text });
  }

  private item(id: string, x: number, z: number, name: string, desc: string, effect: ItemSpot['effect'], amount: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0.4, z);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
    g.add(orb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(0.9);
    g.add(halo);
    // Corpse slumped against nothing in particular
    const corpse = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 4, 8), mat(0x3a332c, 1, 0));
    corpse.rotation.z = Math.PI / 2.3;
    corpse.position.set(0.5, -0.2, 0.2);
    corpse.castShadow = true;
    g.add(corpse);
    this.scene.add(g);
    this.items.push({ id, pos: new THREE.Vector3(x, 0, z), name, desc, effect, amount, mesh: g });
  }

  // -------------------------------------------------------------------------
  // Areas
  // -------------------------------------------------------------------------

  private buildGround(): void {
    const size = 420;
    const g = new THREE.PlaneGeometry(size, size, 160, 160);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // Flat where the playable space is; rugged hills further out.
      const dPlay = this.distanceOutsidePlay(x, z);
      const hills = Math.max(0, dPlay - 6) * 0.35 * (0.6 + fbm(x * 0.03, z * 0.03, 4));
      const bumps = fbm(x * 0.15, z * 0.15, 3) * 0.5;
      // Perfectly flat (slightly sunken) inside the playable area, blending into rough ground outside.
      pos.setY(i, -0.03 + hills + bumps * Math.min(1, dPlay / 4));
      uv.setXY(i, uv.getX(i) * size * 0.12, uv.getY(i) * size * 0.12);
    }
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ map: getGroundTexture(), roughness: 1, color: 0x8a8070 });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Scattered rocks outside the walls
    for (let i = 0; i < 70; i++) {
      const x = (this.rand() - 0.5) * 160, z = 30 - this.rand() * 170;
      if (this.distanceOutsidePlay(x, z) < 3) continue;
      this.rock(x, z, 0.6 + this.rand() * 2.2);
    }
  }

  /** Rough distance from the outer edge of the playable space (0 inside). */
  distanceOutsidePlay(x: number, z: number): number {
    const box = (x0: number, x1: number, z0: number, z1: number) => {
      const dx = Math.max(x0 - x, 0, x - x1);
      const dz = Math.max(z0 - z, 0, z - z1);
      return Math.hypot(dx, dz);
    };
    const arena = Math.max(0, Math.hypot(x - this.arenaCenter.x, z - this.arenaCenter.z) - (this.arenaRadius + 2));
    return Math.min(box(-14, 14, 0, 28), box(-5, 5, -12, 2), box(-26, 26, -60, -8), box(-6, 6, -82, -58), arena);
  }

  private buildShrine(): void {
    // Start area: x∈[-12,12], z∈[2,26]
    this.floorPatch(0, 14, 7, 7, true);
    this.wall(-12, 26, 12, 26, 5, 1.2, { ruined: true });
    this.wall(-12, 2, -12, 26, 5, 1.2, { ruined: true });
    this.wall(12, 2, 12, 26, 5, 1.2, { ruined: true });
    this.wall(-12, 2, -3.5, 2, 6);
    this.wall(3.5, 2, 12, 2, 6);
    this.bonfire('shrine', 'Shrine of Embers', 0, 14, Math.PI, true);
    this.pillar(-7, 9, 4.5, 0.5, true);
    this.pillar(7, 9, 4.5, 0.5);
    this.pillar(-7, 19, 4.5, 0.5);
    this.pillar(7, 19, 4.5, 0.5, true);
    for (let i = 0; i < 8; i++) this.gravestone(-10 + (i % 4) * 1.5 + this.rand() * 0.4, 22 + Math.floor(i / 4) * 1.8);
    this.deadTree(8.5, 22.5, 1.1);
    // Fallen statue
    this.addStatic(worldBox(1.2, 0.9, 3.2), this.stoneMat, 9, 0.45, 13, 0.4);
    this.addStatic(new THREE.SphereGeometry(0.5, 10, 8), this.stoneMat, 9.6, 0.5, 11.2);
    this.collision.add({ kind: 'box', x: 9, z: 13, hx: 0.6, hz: 1.6, angle: 0.4, height: 1, enabled: true });
    this.torch(-3.2, 2.9);
    this.torch(3.2, 2.9, 2.6, false);
    this.message(0, 7, 'Hold the shield (RMB) when foes strike. Time F to parry, then strike to riposte.');
    this.message(-4, 17, 'Rest at a bonfire to heal, restore flasks and spend souls. But the dead will rise again.');
  }

  private buildGatehouse(): void {
    // Corridor x∈[-3.5,3.5], z∈[-10,2]
    this.floorPatch(0, -4, 7, 12);
    this.wall(-3.5, 2, -3.5, -10, 7, 1.2, { crenel: true });
    this.wall(3.5, 2, 3.5, -10, 7, 1.2, { crenel: true });
    this.arch(0, 2, 6.2, 5.5);
    this.arch(0, -10, 6.2, 5.5);
    // Roof beams
    for (let z = -8; z <= 0; z += 2.5) this.addStatic(worldBox(7, 0.4, 0.4), this.woodMat, 0, 6.2, z);
    this.torch(-2.8, -4);
    this.message(2, -2, 'Approach from behind... and strike (backstab).');
    this.spawns.push({ kind: 'hollow', x: 0, z: -7.5, yaw: Math.PI });
  }

  private buildCourtyard(): void {
    // x∈[-24,24], z∈[-58,-10]
    const N = -58, S = -10, W = -24, E = 24;
    this.wall(W, S, -3.5, S, 7);
    this.wall(3.5, S, E, S, 7);
    this.wall(W, N, -4, N, 7);
    this.wall(4, N, E, N, 7);
    this.wall(W, S, W, N, 7);
    this.wall(E, S, E, -44, 7);
    this.wall(E, -50, E, N, 7);
    // Bonfire alcove on the east side
    this.wall(E, -44, E + 6, -44, 6);
    this.wall(E, -50, E + 6, -50, 6);
    this.wall(E + 6, -44, E + 6, -50, 6);
    this.bonfire('courtyard', 'Hollow Courtyard', E + 3, -47, -Math.PI / 2, false);
    // Towers at corners
    for (const [x, z] of [[W, S], [E, S], [W, N], [E, N]] as const) {
      const g = new THREE.CylinderGeometry(2.4, 2.6, 12, 12);
      this.addStatic(g, this.stoneMat, x, 6, z);
      this.addStatic(new THREE.ConeGeometry(3, 4, 12), this.darkStoneMat, x, 14, z);
      this.collision.add({ kind: 'circle', x, z, r: 2.6, height: 12, enabled: true });
    }
    // Paths and central fountain
    this.floorPatch(0, -34, 8, 48);
    this.floorPatch(0, -32, 6.5, 6.5, true);
    const basin = new THREE.CylinderGeometry(3, 3.2, 0.8, 24, 1, true);
    this.addStatic(basin, this.stoneMat, 0, 0.4, -32);
    this.addStatic(new THREE.TorusGeometry(3.05, 0.2, 6, 24).rotateX(Math.PI / 2), this.darkStoneMat, 0, 0.8, -32);
    this.addStatic(new THREE.CylinderGeometry(0.5, 0.7, 2.4, 10), this.stoneMat, 0, 1.2, -32);
    this.addStatic(new THREE.CylinderGeometry(1.4, 0.5, 0.4, 14), this.stoneMat, 0, 2.5, -32);
    // Headless angel statue
    this.addStatic(new THREE.CylinderGeometry(0.3, 0.45, 1.6, 8), this.stoneMat, 0, 3.5, -32);
    for (const s of [-1, 1]) {
      const wing = worldBox(1.6, 1.4, 0.12);
      this.addStatic(wing, this.stoneMat, s * 0.9, 3.9, -32.2, 0, 0, s * 0.4);
    }
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.95, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0e10, roughness: 0.05, metalness: 0.6 }));
    water.position.set(0, 0.55, -32);
    this.scene.add(water);
    this.collision.add({ kind: 'circle', x: 0, z: -32, r: 3.25, height: 1, enabled: true });

    // Colonnade
    for (const z of [-18, -26, -38, -46]) {
      this.pillar(-12, z, 6, 0.55, this.rand() < 0.35);
      this.pillar(12, z, 6, 0.55, this.rand() < 0.35);
    }
    // Ruined inner walls for cover
    this.wall(-20, -24, -15, -28, 3, 0.9, { ruined: true });
    this.wall(15, -36, 20, -33, 3, 0.9, { ruined: true });
    this.wall(-19, -44, -15, -50, 3, 0.9, { ruined: true });
    // Graveyard in the west
    for (let i = 0; i < 14; i++) this.gravestone(-21 + (i % 5) * 1.6 + this.rand() * 0.3, -14 - Math.floor(i / 5) * 2.2);
    this.deadTree(-18, -40, 1.3);
    this.deadTree(18, -16, 1.0);
    this.deadTree(7, -54, 0.9);
    for (let i = 0; i < 10; i++) this.rock(-22 + this.rand() * 44, -12 - this.rand() * 44, 0.3 + this.rand() * 0.4);
    // Carts and crates
    this.addStatic(worldBox(1, 1, 1), this.woodMat, 16, 0.5, -52, 0.3);
    this.addStatic(worldBox(0.8, 0.8, 0.8), this.woodMat, 17.2, 0.4, -52.6, 0.9);
    this.addStatic(worldBox(0.8, 0.8, 0.8), this.woodMat, 16.4, 1.4, -52.2, 0.5);
    this.collision.add({ kind: 'circle', x: 16.6, z: -52.3, r: 1.2, height: 1.8, enabled: true });

    this.torch(-3, -11, 2.8);
    this.torch(23, -47, 2.6);
    this.brazier(-6, -55);
    this.brazier(6, -55, false);
    this.torch(-23, -30, 2.8, false);

    this.message(0, -13, 'Many hollows ahead. Patience is a virtue.');
    this.message(19, -40, 'Bonfire ahead.');
    this.message(-3, -56, 'Beyond the bridge: the Warden. Watch for delayed blows.');

    this.spawns.push(
      { kind: 'hollow', x: -8, z: -19, yaw: 0.3 },
      { kind: 'hollow', x: 9, z: -23, yaw: -0.5, dormant: true },
      { kind: 'spearman', x: -14, z: -34, yaw: 0.8 },
      { kind: 'hollow', x: 12, z: -41, yaw: 0 },
      { kind: 'hollow', x: -7, z: -48, yaw: 0.4, dormant: true },
      { kind: 'hollow', x: -21, z: -46, yaw: 1.4, dormant: true },
      { kind: 'spearman', x: 18, z: -28, yaw: -1.2 },
      { kind: 'brute', x: 0, z: -51, yaw: 0 },
    );
    this.item('shard1', -21, -21, 'Ember Shard', 'A shard of a dying flame. Flask uses increased by one.', 'flask', 1);
    this.item('souls1', 20, -55, 'Soul of a Fallen Knight', 'Grants 600 souls.', 'souls', 600);
    this.item('heart1', -20.5, -55, 'Warden\'s Ember Heart', 'Hardens flesh. Vigor permanently +2.', 'vigor', 2);
  }

  private buildBridge(): void {
    // Causeway x∈[-4,4], z∈[-80,-58]
    this.floorPatch(0, -69, 8, 22);
    this.wall(-4.5, -58, -4.5, -80, 1.6, 0.6, { crenel: false, dark: true });
    this.wall(4.5, -58, 4.5, -80, 1.6, 0.6, { crenel: false, dark: true });
    for (let z = -60; z >= -78; z -= 4.5) {
      this.pillar(-4.5, z, 2.4, 0.35);
      this.pillar(4.5, z, 2.4, 0.35);
    }
    this.torch(-4.5, -62, 3.0);
    this.torch(4.5, -71, 3.0);
    this.arch(0, -58, 7, 6);
    this.arch(0, -80, 7, 7.5);

    // Fog gate at the arena entrance
    const fogMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uOpacity; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),u.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.1; a*=0.5;} return s; }
        void main(){
          vec2 p = vUv * vec2(3.0, 4.0);
          float f = fbm(p + vec2(uTime*0.15, uTime*0.35)) * fbm(p*1.7 - vec2(uTime*0.1, uTime*0.2));
          float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(1.0, 0.85, vUv.y);
          float a = (0.12 + f * 0.9) * edge * uOpacity;
          gl_FragColor = vec4(vec3(0.75, 0.78, 0.85) * a, a);
        }`,
    });
    const fog = new THREE.Mesh(new THREE.PlaneGeometry(7, 7.5), fogMat);
    fog.position.set(0, 3.75, -80);
    this.scene.add(fog);
    const col = this.collision.add({ kind: 'box', x: 0, z: -80, hx: 3.6, hz: 0.3, angle: 0, height: 7, enabled: true, tag: 'fog' });
    this.fogGate = { mesh: fog, collider: col, pos: new THREE.Vector3(0, 0, -80), open: false };
  }

  private buildArena(): void {
    const c = this.arenaCenter, R = this.arenaRadius;
    this.floorPatch(c.x, c.z, R + 1, R + 1, true);
    // Ring wall with an entrance gap at the south (+Z)
    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      // Gap: angle where direction ≈ +Z
      const dirz = Math.cos(mid);
      if (dirz > 0.985) continue;
      const rr = R + 0.8;
      this.wall(c.x + Math.sin(a0) * rr, c.z + Math.cos(a0) * rr, c.x + Math.sin(a1) * rr, c.z + Math.cos(a1) * rr, 9, 1.6, { crenel: true });
    }
    // Inner ring of broken columns
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
      if (Math.cos(a) > 0.9) continue;
      this.pillar(c.x + Math.sin(a) * (R - 3), c.z + Math.cos(a) * (R - 3), 7, 0.7, i % 3 === 0);
    }
    // Braziers
    for (const a of [Math.PI * 0.75, Math.PI * 1.25, Math.PI * 0.3, Math.PI * 1.7]) {
      this.brazier(c.x + Math.sin(a) * (R - 6), c.z + Math.cos(a) * (R - 6), true);
    }
    // Giant throne / statue backdrop at the north end
    const tz = c.z - R - 4;
    this.addStatic(worldBox(8, 14, 3), this.darkStoneMat, 0, 7, tz);
    this.addStatic(new THREE.ConeGeometry(4.5, 8, 4), this.darkStoneMat, 0, 18, tz, Math.PI / 4);
    // Ash strewn arena markings
    const ring = new THREE.Mesh(new THREE.RingGeometry(6, 6.3, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5a2a12, transparent: true, opacity: 0.5 }));
    ring.position.set(c.x, 0.03, c.z);
    this.scene.add(ring);
  }

  private buildBackdrop(): void {
    // Distant castle silhouette to the north, past the arena.
    const castle = (x: number, z: number, w: number, h: number) => {
      this.addStatic(worldBox(w, h, w, 0.08), this.darkStoneMat, x, h / 2, z);
      this.addStatic(new THREE.ConeGeometry(w * 0.75, h * 0.35, 4), this.darkStoneMat, x, h + h * 0.17, z, Math.PI / 4);
    };
    castle(-30, -170, 10, 40);
    castle(-12, -185, 14, 62);
    castle(10, -175, 9, 48);
    castle(32, -160, 12, 30);
    castle(0, -200, 20, 80);
    this.addStatic(worldBox(80, 18, 8, 0.08), this.darkStoneMat, 0, 9, -168);
    // Outer hills ring of dead trees
    for (let i = 0; i < 40; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 50 + this.rand() * 40;
      const x = Math.sin(a) * r, z = -45 + Math.cos(a) * r;
      if (this.distanceOutsidePlay(x, z) < 8) continue;
      this.deadTree(x, z, 1 + this.rand() * 1.2);
    }
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.time += dt;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    this.sky.position.copy(focus);
    (this.fogGate.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    // Shadow camera follows the player
    this.sun.position.set(focus.x - 30, 50, focus.z + 25);
    this.sun.target.position.copy(focus);
    for (const t of this.torches) {
      const f = Math.sin(this.time * 13 + t.seed) * 0.08 + Math.sin(this.time * 7.3 + t.seed * 2) * 0.1 + Math.sin(this.time * 23 + t.seed) * 0.05;
      if (t.light) t.light.intensity = t.base * (1 + f);
    }
    for (const b of this.bonfires) {
      if (!b.lit) continue;
      const f = Math.sin(this.time * 11 + b.pos.x) * 0.1 + Math.sin(this.time * 5.7) * 0.12 + Math.sin(this.time * 31) * 0.04;
      b.light.intensity = 30 * (1 + f);
      b.flame.scale.set(1 + f * 0.5, 0.6 + f, 1 + f * 0.5);
    }
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.mesh.children[1].scale.setScalar(0.8 + Math.sin(this.time * 3 + it.pos.x) * 0.15);
    }
  }

  /** Points that emit fire particles every frame (torches, braziers). */
  get fireSources(): { pos: THREE.Vector3; big: boolean }[] {
    return this.torches.map((t) => ({ pos: t.pos, big: t.base > 15 }));
  }

  setFogGate(open: boolean, visible: boolean): void {
    this.fogGate.open = open;
    this.fogGate.collider.enabled = !open;
    this.fogGate.mesh.visible = visible;
  }

  isInsideArena(p: THREE.Vector3): boolean {
    return Math.hypot(p.x - this.arenaCenter.x, p.z - this.arenaCenter.z) < this.arenaRadius && p.z < this.fogGate.pos.z - 0.5;
  }
}
