import * as THREE from 'three';
import { Rig, type RigStyle } from '../anim/Rig';
import { sampleClip, type Keyframe, type Pose } from '../anim/Pose';
import * as A from '../anim/Animations';
import { BOSS_ATTACKS, BRUTE_ATTACKS, HOLLOW_ATTACKS, PLAYER_ATTACKS } from '../combat/Attacks';
import { HOLLOW, BRUTE } from '../entities/Enemy';
import { WARDEN } from '../entities/Boss';

/**
 * Developer pose viewer: `?viewer=<clip>&style=<player|hollow|brute|boss>&yaw=<deg>&n=<count>`.
 * Renders a row of rigs sampling a clip across time so animations can be inspected.
 */
export function runViewer(container: HTMLElement): void {
  const q = new URLSearchParams(location.search);
  const clipName = q.get('viewer') ?? 'GUARD';
  const styleName = q.get('style') ?? 'player';
  const yaw = ((parseFloat(q.get('yaw') ?? '30') || 0) * Math.PI) / 180;
  const count = parseInt(q.get('n') ?? '6', 10);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x404850);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 2);
  dl.position.set(3, 6, 5);
  scene.add(dl);
  scene.add(new THREE.GridHelper(40, 40, 0x222222, 0x333333));

  const styles: Record<string, RigStyle> = {
    player: { scale: 1, armor: 0x7d8189, cloth: 0x4a1814, trim: 0xa8834a, skin: 0xc49a7c, helmet: 'knight', weapon: 'sword', shield: true, cape: true },
    hollow: HOLLOW.style,
    brute: BRUTE.style,
    boss: WARDEN.style,
  };
  const style = styles[styleName];
  const all = { ...PLAYER_ATTACKS, ...HOLLOW_ATTACKS, ...BRUTE_ATTACKS, ...BOSS_ATTACKS } as Record<string, { clip: Keyframe[] }>;
  const clips: Record<string, Keyframe[]> = {
    ROLL: A.ROLL_CLIP,
    BACKSTEP: A.BACKSTEP_CLIP,
    STAGGER: A.STAGGER_CLIP,
    PARRIED: A.PARRIED_CLIP,
    DEATH: A.DEATH_CLIP,
    HEAL: A.HEAL_CLIP,
    PARRY: A.PARRY_CLIP,
  };
  const statics: Record<string, Pose> = { GUARD: A.GUARD, BLOCK: A.BLOCK, BRUTE_GUARD: A.BRUTE_GUARD, REST: A.REST_POSE };
  const loco = /^(WALK|RUN|SPRINT|STRAFE)/.test(clipName);
  const clip: Keyframe[] | null = loco ? null : clips[clipName] ?? all[clipName]?.clip ?? null;
  const dur = clip ? clip[clip.length - 1].t : 1;
  const n = statics[clipName] ? 1 : count;
  const spacing = 2.2 * style.scale;
  for (let i = 0; i < n; i++) {
    const rig = new Rig(style);
    const t = n === 1 ? 0 : (i / (n - 1)) * dur;
    let pose: Pose;
    if (statics[clipName]) pose = statics[clipName];
    else if (clip) pose = sampleClip(clip, t);
    else {
      const strafe = clipName.startsWith('STRAFE');
      pose = A.locomotion(A.GUARD, {
        phase: (i / n) * Math.PI * 2,
        forward: strafe ? 0 : 1,
        side: strafe ? 1 : 0,
        speed: clipName.startsWith('WALK') ? 0.5 : 1,
        sprint: clipName.startsWith('SPRINT') ? 1 : 0,
      });
    }
    rig.applyPose(pose);
    rig.root.position.set((i - (n - 1) / 2) * spacing, 0, 0);
    rig.root.rotation.y = yaw;
    scene.add(rig.root);
    const label = document.createElement('div');
    label.textContent = `${clipName} t=${t.toFixed(2)}`;
    Object.assign(label.style, { position: 'fixed', color: '#fff', font: '12px monospace', left: `${((i + 0.5) / n) * 100}%`, top: '8px', transform: 'translateX(-50%)' });
    document.body.appendChild(label);
  }
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
  const w = n * spacing;
  camera.position.set(0, 1.3 * style.scale, Math.max(4.5 * style.scale, w * 0.62));
  camera.lookAt(0, 1.0 * style.scale, 0);
  renderer.render(scene, camera);
  (window as unknown as { viewerReady: boolean }).viewerReady = true;
}
