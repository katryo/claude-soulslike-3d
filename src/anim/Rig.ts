import * as THREE from 'three';
import { JOINTS, type Joint, type Pose } from './Pose';
import { getGrimeTexture } from '../world/Textures';

export type WeaponKind = 'sword' | 'greataxe' | 'club' | 'spear';

export interface RigStyle {
  scale: number;
  armor: number;
  cloth: number;
  trim: number;
  skin: number;
  helmet: 'knight' | 'hood' | 'horned' | 'bare';
  eyes?: number; // emissive eye color (enemies)
  weapon: WeaponKind;
  shield: boolean;
  cape: boolean;
  bulk?: number; // width multiplier for heavier builds
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: number, rough = 0.7, metal = 0.2, emissive = 0, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${emissive}|${emissiveIntensity}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      metalness: metal,
      emissive,
      emissiveIntensity,
      map: emissive ? null : getGrimeTexture(),
    });
    matCache.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

function limb(radius: number, length: number, m: THREE.Material, taper = 0.85): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radius * taper, radius, length, 8, 1);
  return mesh(g, m, 0, -length / 2, 0);
}

/** A procedurally modelled, procedurally animated humanoid. */
export class Rig {
  readonly root = new THREE.Group();
  readonly joints = {} as Record<Joint, THREE.Group>;
  readonly weapon = new THREE.Group();
  readonly weaponBase = new THREE.Object3D();
  readonly weaponTip = new THREE.Object3D();
  readonly shieldGroup = new THREE.Group();
  readonly capeSegs: THREE.Group[] = [];
  readonly hipsHeight: number;
  private materials: THREE.MeshStandardMaterial[] = [];
  private flash = 0;

  constructor(readonly style: RigStyle) {
    const s = style;
    const bulk = s.bulk ?? 1;
    const armor = mat(s.armor, 0.45, 0.75);
    const cloth = mat(s.cloth, 0.95, 0.0);
    const trim = mat(s.trim, 0.35, 0.9);
    const skin = mat(s.skin, 0.8, 0.0);
    const dark = mat(0x0a0a0c, 0.9, 0.1);

    for (const j of JOINTS) {
      const g = new THREE.Group();
      g.name = j;
      this.joints[j] = g;
    }
    const J = this.joints;
    this.hipsHeight = 1.0;
    J.hips.position.set(0, this.hipsHeight, 0);
    this.root.add(J.hips);

    // Pelvis + belt + tabard
    J.hips.add(mesh(new THREE.BoxGeometry(0.34 * bulk, 0.16, 0.2), cloth, 0, 0, 0));
    J.hips.add(mesh(new THREE.BoxGeometry(0.36 * bulk, 0.05, 0.22), trim, 0, 0.06, 0));
    const tabard = mesh(new THREE.BoxGeometry(0.22 * bulk, 0.42, 0.02), cloth, 0, -0.22, 0.11);
    J.hips.add(tabard);
    const tabardB = mesh(new THREE.BoxGeometry(0.26 * bulk, 0.44, 0.02), cloth, 0, -0.22, -0.11);
    J.hips.add(tabardB);

    // Spine / chest
    J.spine.position.set(0, 0.08, 0);
    J.hips.add(J.spine);
    J.spine.add(mesh(new THREE.BoxGeometry(0.3 * bulk, 0.16, 0.18), cloth, 0, 0.08, 0));
    J.chest.position.set(0, 0.16, 0);
    J.spine.add(J.chest);
    const torsoGeo = new THREE.CylinderGeometry(0.21 * bulk, 0.16 * bulk, 0.36, 8, 1);
    torsoGeo.scale(1, 1, 0.68);
    J.chest.add(mesh(torsoGeo, armor, 0, 0.17, 0));
    // Breastplate ridge
    J.chest.add(mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), trim, 0, 0.17, 0.12));
    // Gorget
    J.chest.add(mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.08, 8), armor, 0, 0.37, 0));

    J.neck.position.set(0, 0.38, 0);
    J.chest.add(J.neck);
    J.neck.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6), skin, 0, 0.05, 0));
    J.head.position.set(0, 0.1, 0);
    J.neck.add(J.head);
    this.buildHead(J.head, s, armor, cloth, trim, skin, dark);

    // Arms
    for (const side of [-1, 1] as const) {
      const sh = side < 0 ? J.lShoulder : J.rShoulder;
      const el = side < 0 ? J.lElbow : J.rElbow;
      const wr = side < 0 ? J.lWrist : J.rWrist;
      // side -1 = left = +X in local space (character faces +Z, so its left is +X)
      const x = -side * 0.25 * bulk;
      sh.position.set(x, 0.3, 0);
      J.chest.add(sh);
      // Pauldron
      const pauldron = mesh(new THREE.SphereGeometry(0.11 * bulk, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), armor, -side * 0.02, 0.02, 0);
      pauldron.scale.set(1.1, 0.9, 1.05);
      sh.add(pauldron);
      sh.add(limb(0.07 * bulk, 0.3, cloth));
      el.position.set(0, -0.3, 0);
      sh.add(el);
      el.add(mesh(new THREE.SphereGeometry(0.055 * bulk, 8, 6), armor));
      el.add(limb(0.066 * bulk, 0.26, armor, 0.75));
      el.add(mesh(new THREE.CylinderGeometry(0.075 * bulk, 0.07 * bulk, 0.12, 8), armor, 0, -0.2, 0));
      wr.position.set(0, -0.27, 0);
      el.add(wr);
      wr.add(mesh(new THREE.BoxGeometry(0.075, 0.09, 0.085), dark, 0, -0.03, 0));
    }

    // Legs
    for (const side of [-1, 1] as const) {
      const hip = side < 0 ? J.lHip : J.rHip;
      const knee = side < 0 ? J.lKnee : J.rKnee;
      hip.position.set(-side * 0.1 * bulk, -0.05, 0);
      J.hips.add(hip);
      hip.add(limb(0.1 * bulk, 0.45, cloth, 0.78));
      hip.add(mesh(new THREE.BoxGeometry(0.17 * bulk, 0.26, 0.17), armor, 0, -0.17, 0.02));
      knee.position.set(0, -0.45, 0);
      hip.add(knee);
      knee.add(mesh(new THREE.SphereGeometry(0.065, 8, 6), armor, 0, 0, 0.02));
      knee.add(limb(0.08 * bulk, 0.45, armor, 0.72));
      knee.add(mesh(new THREE.CylinderGeometry(0.085 * bulk, 0.075 * bulk, 0.16, 8), dark, 0, -0.34, 0));
      knee.add(mesh(new THREE.BoxGeometry(0.12 * bulk, 0.08, 0.25), dark, 0, -0.42, 0.05));
    }

    this.buildWeapon(s, trim, dark);
    if (s.shield) this.buildShield(armor, trim, cloth);
    if (s.cape) this.buildCape(cloth);

    this.root.scale.setScalar(s.scale);
    this.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !this.materials.includes(m)) this.materials.push(m);
    });
    // Per-rig material clones so hit-flash doesn't leak onto other actors.
    const clones = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    this.root.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      const src = me.material as THREE.MeshStandardMaterial;
      if (src.emissiveIntensity > 0 && src.emissive.getHex() !== 0) return; // keep glowing parts shared
      let c = clones.get(src);
      if (!c) {
        c = src.clone();
        clones.set(src, c);
      }
      me.material = c;
    });
    this.materials = [...clones.values()];
  }

  private buildHead(head: THREE.Group, s: RigStyle, armor: THREE.Material, cloth: THREE.Material, trim: THREE.Material, skin: THREE.Material, dark: THREE.Material): void {
    switch (s.helmet) {
      case 'knight': {
        const helm = mesh(new THREE.CylinderGeometry(0.115, 0.12, 0.24, 10), armor, 0, 0.11, 0);
        head.add(helm);
        head.add(mesh(new THREE.SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), armor, 0, 0.23, 0));
        head.add(mesh(new THREE.BoxGeometry(0.18, 0.025, 0.02), dark, 0, 0.14, 0.115));
        head.add(mesh(new THREE.BoxGeometry(0.02, 0.12, 0.02), dark, 0, 0.07, 0.118));
        // Crest
        head.add(mesh(new THREE.BoxGeometry(0.02, 0.06, 0.22), trim, 0, 0.33, 0));
        break;
      }
      case 'hood': {
        head.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), skin, 0, 0.1, 0.01));
        const hood = mesh(new THREE.ConeGeometry(0.15, 0.36, 10, 1, true), cloth, 0, 0.16, -0.02);
        hood.rotation.x = -0.25;
        head.add(hood);
        head.add(mesh(new THREE.SphereGeometry(0.135, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), cloth, 0, 0.1, -0.02));
        break;
      }
      case 'horned': {
        head.add(mesh(new THREE.SphereGeometry(0.135, 10, 8), armor, 0, 0.12, 0));
        head.add(mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), dark, 0, 0.12, 0.11));
        for (const sx of [-1, 1]) {
          const horn = mesh(new THREE.ConeGeometry(0.04, 0.32, 8), trim, sx * 0.13, 0.25, 0);
          horn.rotation.z = -sx * 0.7;
          head.add(horn);
          const tip = mesh(new THREE.ConeGeometry(0.025, 0.18, 8), trim, sx * 0.25, 0.4, 0);
          tip.rotation.z = -sx * 0.1;
          head.add(tip);
        }
        break;
      }
      case 'bare': {
        head.add(mesh(new THREE.SphereGeometry(0.11, 10, 8), skin, 0, 0.1, 0));
        break;
      }
    }
    if (s.eyes) {
      const eye = mat(s.eyes, 1, 0, s.eyes, 6);
      for (const sx of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.016, 6, 4), eye, sx * 0.04, 0.13, 0.115));
    }
  }

  private buildWeapon(s: RigStyle, trim: THREE.Material, dark: THREE.Material): void {
    const steel = mat(0xb8bcc4, 0.25, 0.95);
    const wood = mat(0x3a2a1c, 0.9, 0);
    const w = this.weapon;
    // Grip point sits in the hand, weapon extends along local +Z.
    w.position.set(0, -0.05, 0.0);
    this.joints.rWrist.add(w);
    let len = 1;
    switch (s.weapon) {
      case 'sword': {
        w.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6).rotateX(Math.PI / 2), dark, 0, 0, -0.02));
        w.add(mesh(new THREE.SphereGeometry(0.03, 6, 6), trim, 0, 0, -0.13));
        w.add(mesh(new THREE.BoxGeometry(0.24, 0.035, 0.04), trim, 0, 0, 0.09));
        const blade = new THREE.BoxGeometry(0.055, 0.012, 0.9);
        blade.translate(0, 0, 0.56);
        w.add(mesh(blade, steel));
        const tip = new THREE.ConeGeometry(0.039, 0.1, 4).rotateX(Math.PI / 2).scale(1, 0.3, 1);
        tip.translate(0, 0, 1.06);
        w.add(mesh(tip, steel));
        len = 1.1;
        break;
      }
      case 'greataxe': {
        w.add(mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.9, 8).rotateX(Math.PI / 2), wood, 0, 0, 0.6));
        const head = new THREE.Shape();
        head.moveTo(0, 0);
        head.lineTo(0.5, -0.25);
        head.quadraticCurveTo(0.65, 0.15, 0.5, 0.55);
        head.lineTo(0, 0.3);
        head.lineTo(0, 0);
        const g = new THREE.ExtrudeGeometry(head, { depth: 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 1 });
        g.translate(0, -0.15, -0.02);
        // Lay the blade so it extends sideways (+X) from the haft near its end.
        g.rotateX(Math.PI / 2);
        g.rotateY(0);
        const ax = mesh(g, mat(0x3b3532, 0.35, 0.9));
        ax.position.set(0.02, 0, 1.3);
        w.add(ax);
        w.add(mesh(new THREE.ConeGeometry(0.05, 0.25, 6).rotateX(Math.PI / 2), trim, 0, 0, 1.65));
        len = 1.6;
        break;
      }
      case 'club': {
        w.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6).rotateX(Math.PI / 2), wood, 0, 0, 0.0));
        const c = new THREE.CylinderGeometry(0.11, 0.05, 0.9, 7).rotateX(-Math.PI / 2);
        c.translate(0, 0, 0.55);
        w.add(mesh(c, wood));
        for (let i = 0; i < 6; i++) {
          const spike = mesh(new THREE.ConeGeometry(0.025, 0.1, 4), dark);
          const a = (i / 6) * Math.PI * 2;
          spike.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.8);
          spike.rotation.z = a - Math.PI / 2;
          w.add(spike);
        }
        len = 1.0;
        break;
      }
      case 'spear': {
        w.add(mesh(new THREE.CylinderGeometry(0.02, 0.022, 2.0, 6).rotateX(Math.PI / 2), wood, 0, 0, 0.5));
        const tip = new THREE.ConeGeometry(0.05, 0.3, 4).rotateX(Math.PI / 2);
        tip.translate(0, 0, 1.6);
        w.add(mesh(tip, steel));
        len = 1.75;
        break;
      }
    }
    this.weaponBase.position.set(0, 0, len * 0.25);
    this.weaponTip.position.set(0, 0, len);
    w.add(this.weaponBase, this.weaponTip);
  }

  private buildShield(armor: THREE.Material, trim: THREE.Material, cloth: THREE.Material): void {
    const g = this.shieldGroup;
    g.position.set(0.06, -0.14, 0.02);
    this.joints.lElbow.add(g);
    const body = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 20, 1);
    body.rotateZ(Math.PI / 2);
    body.scale(1, 1.25, 1);
    g.add(mesh(body, armor, 0.03, 0, 0));
    const face = new THREE.CylinderGeometry(0.25, 0.25, 0.02, 20, 1);
    face.rotateZ(Math.PI / 2);
    face.scale(1, 1.25, 1);
    g.add(mesh(face, cloth, 0.06, 0, 0));
    g.add(mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2), trim, 0.07, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.05, 0.5), trim, 0.07, 0, 0));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.62, 0.05), trim, 0.07, 0, 0));
  }

  private buildCape(cloth: THREE.Material): void {
    let parent: THREE.Object3D = this.joints.chest;
    const segLen = 0.3;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.32 : -segLen, i === 0 ? -0.14 : 0);
      const w = 0.42 + i * 0.05;
      seg.add(mesh(new THREE.BoxGeometry(w, segLen, 0.015), cloth, 0, -segLen / 2, 0));
      parent.add(seg);
      this.capeSegs.push(seg);
      parent = seg;
    }
  }

  applyPose(p: Pose): void {
    for (const j of JOINTS) {
      const r = p[j];
      const g = this.joints[j];
      if (r) g.rotation.set(r[0], r[1], r[2]);
      else g.rotation.set(0, 0, 0);
    }
    const root = p.root;
    this.joints.hips.position.set(root ? root[0] : 0, this.hipsHeight + (root ? root[1] : 0), root ? root[2] : 0);
  }

  /** Secondary motion for the cape, driven by forward speed and vertical motion. */
  updateCape(speed: number, time: number): void {
    for (let i = 0; i < this.capeSegs.length; i++) {
      const flutter = Math.sin(time * 9 + i * 1.3) * 0.05 * Math.min(1, speed / 4);
      const base = i === 0 ? 0.12 : 0.05;
      this.capeSegs[i].rotation.x = base + Math.min(speed * 0.09, 0.55) / (i + 1) + flutter;
    }
  }

  hitFlash(): void {
    this.flash = 1;
  }

  update(dt: number): void {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      const v = this.flash * this.flash;
      for (const m of this.materials) {
        m.emissive.setRGB(v * 0.9, v * 0.25, v * 0.1);
      }
    }
  }

  /** Fade all materials (used for dissolving corpses). */
  setOpacity(a: number): void {
    for (const m of this.materials) {
      m.transparent = a < 1;
      m.opacity = a;
      m.depthWrite = a > 0.5;
    }
    this.root.traverse((o) => {
      o.castShadow = a > 0.5;
    });
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }
}
