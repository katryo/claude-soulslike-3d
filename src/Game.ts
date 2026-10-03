import * as THREE from 'three';
import { Input } from './core/Input';
import { audio } from './core/Audio';
import { CameraRig } from './core/CameraRig';
import { World, type BonfireSpot } from './world/World';
import { Effects } from './fx/Effects';
import { PostFX } from './fx/PostFX';
import { HUD, type MenuItem } from './ui/HUD';
import { Player } from './entities/Player';
import { Enemy, BRUTE, HOLLOW, SPEARMAN, type EnemyDef } from './entities/Enemy';
import { Boss } from './entities/Boss';
import { advanceAnimClock, type Actor } from './entities/Actor';
import type { GameContext } from './entities/Context';
import { clamp, yawTo, angleDiff } from './core/math';
import { defaultSave, loadSave, writeSave, clearSave, type SaveData } from './systems/Save';
import { canLevel, level, levelCost, maxHp, maxStamina, damageMultiplier, type PlayerStats } from './systems/Stats';

type Mode = 'title' | 'play' | 'menu' | 'dead' | 'fogwalk' | 'respawn';

const ENEMY_DEFS: Record<string, EnemyDef> = { hollow: HOLLOW, spearman: SPEARMAN, brute: BRUTE };
const LOCK_RANGE = 22;

interface Interactable {
  prompt: string;
  range: number;
  pos: THREE.Vector3;
  act: () => void;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly hud: HUD;
  readonly world: World;
  readonly fx: Effects;
  readonly post: PostFX;
  readonly camRig: CameraRig;
  readonly player: Player;
  readonly enemies: Enemy[] = [];
  readonly boss: Boss;
  readonly actors: Actor[] = [];
  save: SaveData;
  mode: Mode = 'title';
  private ctx: GameContext;
  private hitstopTimer = 0;
  private time = 0;
  private last = performance.now();
  private deathTimer = 0;
  private respawnTimer = 0;
  private fogwalkTimer = 0;
  private bossFight = false;
  private victoryTimer = -1;
  private area = '';
  private lastHp = new Map<Actor, number>();
  private bloodstain: { pos: THREE.Vector3; souls: number } | null = null;
  private fireTimer = 0;
  private menuMoveLatch = 0;
  private titleAngle = 0;
  private lastSafe = new THREE.Vector3();
  private fpsAccum = 0;
  private fpsFrames = 0;
  fps = 60;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.input = new Input(this.renderer.domElement);
    this.hud = new HUD(container);
    this.world = new World(this.scene);
    this.fx = new Effects(this.scene);
    this.fx.setViewportHeight(window.innerHeight);
    this.post = new PostFX(this.renderer, this.scene, this.camera, window.innerWidth, window.innerHeight);
    this.camRig = new CameraRig(this.camera);

    this.save = loadSave() ?? defaultSave();
    this.input.sensitivity = this.save.settings.sensitivity;
    this.input.invertY = this.save.settings.invertY;
    audio.masterVolume = this.save.settings.volume;

    this.player = new Player(this.input);
    this.addActor(this.player);
    for (const [i, s] of this.world.spawns.entries()) {
      const e = new Enemy(ENEMY_DEFS[s.kind], s.x, s.z, s.yaw, `${s.kind}${i}`);
      this.enemies.push(e);
      this.addActor(e);
    }
    const bs = this.world.bossSpawn;
    this.boss = new Boss(bs.x, bs.z, bs.yaw);
    this.boss.onPhaseChange = () => {
      this.hud.showDialog('<i>The Warden\'s blood ignites.</i>', 3);
    };
    this.enemies.push(this.boss);
    this.addActor(this.boss);

    this.ctx = {
      fx: this.fx,
      collision: this.world.collision,
      actors: this.actors,
      player: this.player,
      time: 0,
      shake: (a) => this.camRig.shake(a),
      hitstop: (s) => (this.hitstopTimer = Math.max(this.hitstopTimer, s)),
      onActorKilled: (v, k) => this.onKilled(v, k),
    };

    this.applySave();
    this.respawnAll(true);

    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('click', () => this.onCanvasClick());
    this.hud.title.addEventListener('click', () => this.onCanvasClick());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.mode === 'play' && !this.input.usingGamepad) this.openPause();
    });
    this.hud.setTitlePrompt(loadSave() ? 'Click to continue' : 'Click to begin');
  }

  private addActor(a: Actor): void {
    this.actors.push(a);
    this.scene.add(a.rig.root);
    this.fx.addTrail(a.trail);
  }

  // -------------------------------------------------------------------------
  // Save / progression
  // -------------------------------------------------------------------------

  private applySave(): void {
    const s = this.save;
    this.player.applyStats(s.stats);
    this.player.hp = this.player.maxHp;
    this.player.flasksMax = s.flasksMax;
    this.player.flasks = s.flasksMax;
    for (const b of this.world.bonfires) this.world.setBonfireLit(b, s.litBonfires.includes(b.id));
    for (const it of this.world.items) it.mesh.visible = !s.itemsTaken.includes(it.id);
    this.bloodstain = s.bloodstain ? { pos: new THREE.Vector3(s.bloodstain.x, 0, s.bloodstain.z), souls: s.bloodstain.souls } : null;
    this.world.setFogGate(s.bossDefeated, !s.bossDefeated);
    this.hud.setSouls(s.souls, true);
  }

  private persist(): void {
    this.save.bloodstain = this.bloodstain ? { x: this.bloodstain.pos.x, z: this.bloodstain.pos.z, souls: this.bloodstain.souls } : null;
    this.save.flasksMax = this.player.flasksMax;
    writeSave(this.save);
  }

  private get souls(): number {
    return this.save.souls;
  }

  private set souls(v: number) {
    this.save.souls = v;
    this.hud.setSouls(v);
  }

  private currentBonfire(): BonfireSpot {
    return this.world.bonfires.find((b) => b.id === this.save.lastBonfire) ?? this.world.bonfires[0];
  }

  /** Place the player at the last bonfire and reset every enemy. */
  private respawnAll(first = false): void {
    const b = this.currentBonfire();
    const fresh = first && !loadSave();
    const sx = fresh ? 0 : b.spawn.x;
    const sz = fresh ? 20.5 : b.spawn.z;
    const yaw = fresh ? Math.PI : b.spawnYaw;
    this.player.reset(sx, sz, yaw);
    this.player.flasks = this.player.flasksMax;
    this.player.target = null;
    this.lastSafe.set(sx, 0, sz);
    for (const e of this.enemies) {
      if (e === this.boss) continue;
      e.respawn();
    }
    if (this.save.bossDefeated) {
      this.boss.rig.setVisible(false);
      this.boss.state = 'dead';
    } else {
      this.boss.respawn();
    }
    this.bossFight = false;
    this.world.setFogGate(this.save.bossDefeated, !this.save.bossDefeated);
    this.hud.setBoss(null);
    this.hud.clearEnemyBars();
    this.lastHp.clear();
    this.camRig.snap(this.player, yaw);
    this.fx.clear();
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.fx.setViewportHeight(h);
  }

  private onCanvasClick(): void {
    audio.init();
    if (this.mode === 'title') {
      this.hud.hideTitle();
      this.mode = 'play';
      audio.startAmbience();
      this.input.requestPointerLock();
      this.renderer.domElement.focus();
      this.camRig.snap(this.player, this.player.yaw);
      this.area = '';
      if (!loadSave()) {
        this.hud.showDialog('Rest at the bonfire. Then go north, through the gate, and end the Warden who keeps the last flame.', 7);
        writeSave(this.save);
      }
      return;
    }
    if (this.mode === 'play') this.input.requestPointerLock();
  }

  private onKilled(victim: Actor, _killer: Actor | null): void {
    void _killer;
    if (victim === this.player) {
      this.mode = 'dead';
      this.deathTimer = 0;
      this.player.target = null;
      this.save.deaths++;
      this.bloodstain = this.souls > 0 ? { pos: this.player.pos.clone(), souls: this.souls } : null;
      this.souls = 0;
      audio.youDied();
      audio.stopMusic();
      this.persist();
      return;
    }
    const e = victim as Enemy;
    if (!e.awardedSouls) {
      e.awardedSouls = true;
      this.souls = this.souls + e.def.souls;
      this.fx.soulStream(e.pos.clone().setY(1), this.player.pos, e === this.boss ? 160 : 25);
      audio.enemyDeath();
      setTimeout(() => audio.souls(), 700);
    }
    if (this.player.target === victim) this.player.target = this.findTarget(0);
    if (victim === this.boss) {
      this.bossFight = false;
      this.save.bossDefeated = true;
      this.world.setFogGate(true, false);
      audio.stopMusic();
      this.hud.setBoss(null);
      this.victoryTimer = 0;
      this.persist();
      this.hitstopTimer = 0.6;
    }
  }

  // -------------------------------------------------------------------------
  // Lock-on
  // -------------------------------------------------------------------------

  private findTarget(dir: number): Actor | null {
    const p = this.player;
    const camFwd = new THREE.Vector3();
    this.camera.getWorldDirection(camFwd);
    const camYaw = Math.atan2(camFwd.x, camFwd.z);
    let best: Actor | null = null;
    let bestScore = Infinity;
    const cur = p.target;
    const curAng = cur ? angleDiff(camYaw, yawTo(cur.pos.x - p.pos.x, cur.pos.z - p.pos.z)) : 0;
    for (const e of this.enemies) {
      if (!e.alive || !e.rig.root.visible || e === cur) continue;
      if (e === this.boss && !this.boss.active) continue;
      const d = p.distanceTo(e);
      if (d > LOCK_RANGE) continue;
      const ang = angleDiff(camYaw, yawTo(e.pos.x - p.pos.x, e.pos.z - p.pos.z));
      if (dir === 0) {
        if (Math.abs(ang) > 1.2) continue;
        const score = Math.abs(ang) * 8 + d * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      } else {
        // Switching: nearest in the requested screen direction.
        const rel = -(ang - curAng) * dir; // camera-right is negative yaw delta
        if (rel <= 0.02) continue;
        const score = rel * 4 + d * 0.15;
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
    }
    return best;
  }

  private updateLockOn(): void {
    const p = this.player;
    if (this.input.wasPressed('lockon')) {
      if (p.target) p.target = null;
      else {
        p.target = this.findTarget(0);
        if (!p.target) this.camRig.yaw = p.yaw; // recentre camera
      }
    }
    if (p.target) {
      if (this.input.wasPressed('switchLeft')) p.target = this.findTarget(-1) ?? p.target;
      if (this.input.wasPressed('switchRight')) p.target = this.findTarget(1) ?? p.target;
      const t = p.target;
      if (!t.alive || p.distanceTo(t) > LOCK_RANGE + 4 || !t.rig.root.visible) p.target = null;
    }
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  private interactables(): Interactable[] {
    const list: Interactable[] = [];
    const p = this.player;
    if (this.bloodstain) {
      const bs = this.bloodstain;
      list.push({
        prompt: 'Retrieve souls',
        range: 1.8,
        pos: bs.pos,
        act: () => {
          this.souls = this.souls + bs.souls;
          this.fx.soulStream(bs.pos.clone().setY(0.5), p.pos, 40);
          audio.souls();
          this.bloodstain = null;
          this.persist();
        },
      });
    }
    for (const it of this.world.items) {
      if (!it.mesh.visible) continue;
      list.push({
        prompt: 'Pick up',
        range: 1.8,
        pos: it.pos,
        act: () => {
          it.mesh.visible = false;
          this.save.itemsTaken.push(it.id);
          if (it.effect === 'flask') {
            p.flasksMax += it.amount;
            p.flasks += it.amount;
          } else if (it.effect === 'souls') {
            this.souls = this.souls + it.amount;
          } else if (it.effect === 'vigor') {
            this.save.stats.vigor += it.amount;
            p.applyStats(this.save.stats);
          }
          audio.souls();
          this.hud.showDialog(`<div class="item-name">${it.name}</div><div>${it.desc}</div>`, 5);
          this.persist();
        },
      });
    }
    for (const b of this.world.bonfires) {
      list.push({
        prompt: b.lit ? 'Rest at bonfire' : 'Light bonfire',
        range: 2.3,
        pos: b.pos,
        act: () => this.useBonfire(b),
      });
    }
    for (const m of this.world.messages) {
      list.push({
        prompt: 'Read message',
        range: 1.4,
        pos: m.pos,
        act: () => this.hud.showDialog(`<i>${m.text}</i>`, 6),
      });
    }
    const fg = this.world.fogGate;
    if (!fg.open && !this.bossFight && p.pos.z > fg.pos.z) {
      list.push({ prompt: 'Traverse the white fog', range: 2.6, pos: fg.pos.clone().setX(p.pos.x), act: () => this.enterFog() });
    }
    return list;
  }

  private updateInteraction(): void {
    const p = this.player;
    if (p.state !== 'move') {
      this.hud.setPrompt(null);
      return;
    }
    let best: Interactable | null = null;
    let bd = Infinity;
    for (const it of this.interactables()) {
      const d = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
      if (d < it.range && d < bd) {
        bd = d;
        best = it;
      }
    }
    if (best) {
      const key = this.input.usingGamepad ? 'A' : 'E';
      this.hud.setPrompt(`<span class="key">${key}</span> ${best.prompt}`);
      if (this.input.consume('interact')) {
        best.act();
        audio.uiConfirm();
      }
    } else this.hud.setPrompt(null);
  }

  private enterFog(): void {
    this.mode = 'fogwalk';
    this.fogwalkTimer = 0;
    this.player.target = null;
    this.player.faceTowards(this.player.pos.x, this.world.fogGate.pos.z - 5);
    this.world.fogGate.collider.enabled = false;
  }

  private useBonfire(b: BonfireSpot): void {
    if (!b.lit) {
      this.world.setBonfireLit(b, true);
      this.save.litBonfires.push(b.id);
      this.hud.showBanner('BONFIRE LIT', 'gold', 3.5);
      audio.bonfireLit();
    }
    this.save.lastBonfire = b.id;
    // Rest
    this.player.faceTowards(b.pos.x, b.pos.z);
    this.player.rest();
    this.player.target = null;
    this.player.hp = this.player.maxHp;
    this.player.stamina = this.player.maxStamina;
    this.player.flasks = this.player.flasksMax;
    for (const e of this.enemies) if (e !== this.boss) e.respawn();
    this.hud.clearEnemyBars();
    this.persist();
    this.openBonfireMenu(b);
  }

  // -------------------------------------------------------------------------
  // Menus
  // -------------------------------------------------------------------------

  private enterMenu(): void {
    this.mode = 'menu';
    this.input.exitPointerLock();
  }

  private leaveMenu(): void {
    this.hud.closeMenu();
    this.mode = 'play';
    this.input.requestPointerLock();
  }

  private openBonfireMenu(b: BonfireSpot): void {
    this.enterMenu();
    const lit = this.world.bonfires.filter((x) => x.lit && x !== b);
    this.hud.openMenu(
      b.name,
      [
        { label: 'Level Up', action: () => this.openLevelMenu(b) },
        { label: 'Travel', disabled: lit.length === 0, detail: lit.length ? '' : 'No other bonfires', action: () => this.openTravelMenu(b) },
        { label: 'Leave', action: () => this.leaveBonfire() },
      ],
      () => this.leaveBonfire(),
      'The flame flickers. Your flasks are refilled. The hollows stir again.',
    );
  }

  private leaveBonfire(): void {
    this.leaveMenu();
    this.player.standUp();
  }

  private openTravelMenu(from: BonfireSpot): void {
    const items: MenuItem[] = this.world.bonfires
      .filter((x) => x.lit)
      .map((x) => ({
        label: x.name,
        detail: x === from ? 'Here' : '',
        disabled: x === from,
        action: () => {
          this.save.lastBonfire = x.id;
          this.persist();
          this.hud.closeMenu();
          this.mode = 'respawn';
          this.respawnTimer = 0;
          this.player.standUp();
        },
      }));
    items.push({ label: 'Back', action: () => this.openBonfireMenu(from) });
    this.hud.openMenu('Travel', items, () => this.openBonfireMenu(from));
  }

  private openLevelMenu(b: BonfireSpot): void {
    const s = this.save.stats;
    const lvl = level(s);
    const cost = levelCost(lvl);
    const row = (key: keyof PlayerStats, label: string, preview: string): MenuItem => ({
      label: `${label} <b>${s[key]}</b>`,
      detail: preview,
      disabled: !canLevel(s, key, this.souls),
      action: () => {
        this.souls = this.souls - cost;
        s[key]++;
        this.player.applyStats(s);
        this.player.hp = this.player.maxHp;
        this.player.stamina = this.player.maxStamina;
        audio.uiConfirm();
        this.persist();
        this.openLevelMenu(b);
      },
    });
    this.hud.openMenu(
      `Level ${lvl}`,
      [
        row('vigor', 'Vigor', `HP ${maxHp(s.vigor)} → ${maxHp(s.vigor + 1)}`),
        row('endurance', 'Endurance', `Stamina ${maxStamina(s.endurance)} → ${maxStamina(s.endurance + 1)}`),
        row('strength', 'Strength', `Attack ×${damageMultiplier(s.strength).toFixed(2)} → ×${damageMultiplier(s.strength + 1).toFixed(2)}`),
        { label: 'Back', action: () => this.openBonfireMenu(b) },
      ],
      () => this.openBonfireMenu(b),
      `Souls held: <b>${this.souls}</b> &nbsp;·&nbsp; Required: <b>${cost}</b>`,
    );
  }

  private openPause(): void {
    if (this.mode !== 'play') return;
    this.enterMenu();
    this.showPauseMenu();
  }

  private showPauseMenu(): void {
    const st = this.save.settings;
    const s = this.save.stats;
    this.hud.openMenu(
      'Paused',
      [
        { label: 'Resume', action: () => this.leaveMenu() },
        {
          label: 'Volume',
          detail: `${Math.round(st.volume * 100)}%`,
          action: () => {
            st.volume = st.volume >= 1 ? 0 : Math.round((st.volume + 0.1) * 10) / 10;
            audio.setVolume(st.volume);
            this.persist();
            this.showPauseMenu();
          },
        },
        {
          label: 'Camera sensitivity',
          detail: `${st.sensitivity.toFixed(1)}`,
          action: () => {
            st.sensitivity = st.sensitivity >= 2 ? 0.4 : Math.round((st.sensitivity + 0.2) * 10) / 10;
            this.input.sensitivity = st.sensitivity;
            this.persist();
            this.showPauseMenu();
          },
        },
        {
          label: 'Invert camera Y',
          detail: st.invertY ? 'On' : 'Off',
          action: () => {
            st.invertY = !st.invertY;
            this.input.invertY = st.invertY;
            this.persist();
            this.showPauseMenu();
          },
        },
        {
          label: 'Controls',
          action: () =>
            this.hud.showDialog(
              '<b>WASD</b> move · <b>Mouse</b> camera · <b>LMB</b> light · <b>Shift+LMB/C</b> heavy · <b>RMB</b> block · <b>F</b> parry · <b>Space</b> roll / hold to sprint · <b>Tab/Q/MMB</b> lock-on · <b>Wheel/Z/X</b> switch target · <b>R</b> flask · <b>E</b> interact',
              8,
            ),
        },
        {
          label: 'New game',
          detail: 'Erases progress',
          action: () => {
            clearSave();
            window.location.reload();
          },
        },
      ],
      () => this.leaveMenu(),
      `Level ${level(s)} · Vigor ${s.vigor} · Endurance ${s.endurance} · Strength ${s.strength} · Deaths ${this.save.deaths}`,
    );
  }

  private updateMenuInput(): void {
    const i = this.input;
    const y = i.moveY;
    let nav = 0;
    if (i.wasPressed('up')) nav = -1;
    if (i.wasPressed('down')) nav = 1;
    if (Math.abs(y) > 0.6 && this.menuMoveLatch === 0) {
      nav = y > 0 ? -1 : 1;
      this.menuMoveLatch = 1;
    } else if (Math.abs(y) < 0.3) this.menuMoveLatch = 0;
    if (nav) {
      this.hud.menuNav(nav);
      audio.uiMove();
    }
    if (i.wasPressed('interact') || i.wasPressed('confirm')) this.hud.menuConfirm();
    if (i.wasPressed('back') || i.wasPressed('pause')) this.hud.menuBack();
  }

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  /** Advance one frame. Exposed for automated testing. */
  frame(dt: number): void {
    this.time += dt;
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum > 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    this.input.update(dt);

    let sim = dt;
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      sim = dt * 0.04;
    }

    switch (this.mode) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'menu':
        this.updateMenuInput();
        this.simulate(sim, false);
        break;
      case 'play':
        if (this.input.wasPressed('pause')) {
          this.openPause();
          break;
        }
        this.updateLockOn();
        this.updateInteraction();
        this.simulate(sim, true);
        break;
      case 'dead':
        this.deathTimer += dt;
        if (this.deathTimer > 1.0 && this.deathTimer - dt <= 1.0) this.hud.showBanner('YOU DIED', 'death', 4.2);
        this.post.desaturate = clamp((this.deathTimer - 0.5) / 2, 0, 0.8);
        if (this.deathTimer > 5) this.hud.setFade(clamp((this.deathTimer - 5) / 1, 0, 1));
        this.simulate(sim, false);
        if (this.deathTimer > 6.2) {
          this.respawnAll();
          this.mode = 'respawn';
          this.respawnTimer = 0.5;
          this.post.desaturate = 0;
        }
        break;
      case 'respawn':
        this.respawnTimer += dt;
        if (this.respawnTimer < 0.5) {
          this.hud.setFade(this.respawnTimer / 0.5);
        } else if (this.respawnTimer < 0.55) {
          this.respawnAll();
        } else {
          this.hud.setFade(1 - clamp((this.respawnTimer - 0.6) / 0.8, 0, 1));
        }
        this.simulate(sim, false);
        if (this.respawnTimer > 1.4) {
          this.mode = 'play';
          this.hud.setFade(0);
          this.area = '';
        }
        break;
      case 'fogwalk': {
        this.fogwalkTimer += dt;
        const p = this.player;
        p.frozen = true;
        p.pos.z -= dt * 2.2;
        this.hud.setPrompt(null);
        this.simulate(sim, false);
        if (this.fogwalkTimer > 1.4) {
          p.frozen = false;
          this.world.fogGate.collider.enabled = true;
          this.mode = 'play';
          this.bossFight = true;
          this.boss.activate();
          audio.startBossMusic(false);
          this.hud.showDialog('<i>The Warden rises from the ashes.</i>', 3);
        }
        break;
      }
    }

    this.updateVictory(dt);
    this.render(dt);
    this.input.endFrame();
  }

  private updateTitle(dt: number): void {
    this.titleAngle += dt * 0.05;
    const c = new THREE.Vector3(0, 0, 10);
    this.camera.position.set(c.x + Math.sin(this.titleAngle) * 9, 3.2, c.z + Math.cos(this.titleAngle) * 9);
    this.camera.lookAt(0, 1.4, 6);
    // Keep the shadow camera and actors animated behind the title card.
    for (const a of this.actors) if (a.alive) a.update(0, this.ctx);
    this.world.update(dt, new THREE.Vector3(0, 0, 10));
    this.emitFires(dt);
    this.fx.update(dt, this.camera.position);
    advanceAnimClock(dt);
  }

  private simulate(dt: number, interactive: boolean): void {
    void interactive;
    advanceAnimClock(dt);
    this.ctx.time = this.time;
    const p = this.player;
    p.camYaw = this.camRig.yaw;
    p.frozen = this.mode !== 'play' && this.mode !== 'fogwalk' ? true : this.mode === 'fogwalk';

    for (const a of this.actors) {
      if (a !== p && a !== this.boss && a.pos.distanceTo(p.pos) > 55 && a.alive) continue;
      if (a === this.boss && this.save.bossDefeated && !a.alive && !a.rig.root.visible) continue;
      a.update(dt, this.ctx);
    }
    this.separate();

    // Keep the player within the level.
    if (this.world.distanceOutsidePlay(p.pos.x, p.pos.z) > 0.6) p.pos.copy(this.lastSafe);
    else this.lastSafe.copy(p.pos);
    if (this.mode === 'fogwalk') this.lastSafe.copy(p.pos);

    for (const e of this.enemies) e.updateCorpse(dt, this.ctx);

    // Track enemy damage for floating bars.
    for (const e of this.enemies) {
      const prev = this.lastHp.get(e) ?? e.hp;
      if (e.hp < prev && e !== this.boss) this.hud.enemyDamaged(e);
      this.lastHp.set(e, e.hp);
    }

    // Boss bar & arena
    if (this.bossFight) {
      this.hud.setBoss(this.boss.name, this.boss.hp, this.boss.maxHp);
    }

    // Areas
    const z = p.pos.z;
    const area = z > 2 ? 'Shrine of Embers' : z > -10 ? 'Ruined Gatehouse' : z > -58 ? 'Hollow Courtyard' : z > -80 ? 'Bridge of Cinders' : "Warden's Pyre";
    if (area !== this.area && this.mode === 'play') {
      this.hud.showArea(area);
      this.area = area;
    }

    // Bonfire crackle volume
    let near = 0;
    for (const b of this.world.bonfires) if (b.lit) near = Math.max(near, 1 - b.pos.distanceTo(p.pos) / 10);
    audio.setFireProximity(clamp(near, 0, 1));

    this.world.update(dt, p.pos);
    this.emitFires(dt);

    // Bloodstain glow
    if (this.bloodstain && Math.random() < 0.6) {
      const bp = this.bloodstain.pos;
      this.fx.glow.spawn({
        x: bp.x + (Math.random() - 0.5) * 0.4, y: 0.1, z: bp.z + (Math.random() - 0.5) * 0.4,
        vy: 0.6 + Math.random() * 0.6, life: 0.8, size: 0.35, sizeEnd: 0.05,
        r: 0.3, g: 1, b: 0.55,
      });
    }
    // Item sparkles
    for (const it of this.world.items) {
      if (it.mesh.visible && Math.random() < 0.15) this.fx.spark(it.mesh.position.clone().setY(0.4));
    }

    this.fx.update(dt, this.camera.position);

    const lowHp = p.hp / p.maxHp;
    this.post.hurt = lowHp < 0.3 ? (0.3 - lowHp) * 2 * (0.7 + 0.3 * Math.sin(this.time * 5)) : 0;
  }

  private emitFires(dt: number): void {
    this.fireTimer += dt;
    if (this.fireTimer < 1 / 60) return;
    this.fireTimer = 0;
    const cam = this.camera.position;
    for (const f of this.world.fireSources) {
      if (f.pos.distanceTo(cam) > 45) continue;
      this.fx.fireEmber(f.pos, f.big ? 0.5 : 0.12, f.big ? 1.4 : 0.9);
      if (f.big) this.fx.fireEmber(f.pos, 0.5, 1.4);
      if (Math.random() < 0.05) this.fx.spark(f.pos.clone().setY(f.pos.y + 0.3));
    }
    for (const b of this.world.bonfires) {
      if (!b.lit || b.pos.distanceTo(cam) > 50) continue;
      for (let i = 0; i < 2; i++) this.fx.fireEmber(b.pos.clone().setY(0.25), 0.55, 1.8);
      if (Math.random() < 0.3) this.fx.spark(b.pos.clone().setY(0.6));
    }
  }

  /** Soft push-apart between live actors. */
  private separate(): void {
    const list = this.actors.filter((a) => a.alive && a.rig.root.visible);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d >= min || d < 1e-5) continue;
        if (a.state === 'roll' || b.state === 'roll') continue; // roll through enemies
        const push = (min - d) / d;
        const wa = b.scale / (a.scale + b.scale), wb = 1 - wa;
        a.pos.x -= dx * push * wa;
        a.pos.z -= dz * push * wa;
        b.pos.x += dx * push * wb;
        b.pos.z += dz * push * wb;
      }
    }
  }

  private updateVictory(dt: number): void {
    if (this.victoryTimer < 0) return;
    this.victoryTimer += dt;
    if (this.victoryTimer > 1.2 && this.victoryTimer - dt <= 1.2) {
      this.hud.showBanner('WARDEN VANQUISHED', 'victory', 5);
      audio.victory();
    }
    if (this.victoryTimer > 7 && this.victoryTimer - dt <= 7) {
      this.hud.showDialog(
        `<div class="item-name">Ember of the Warden</div><div>The last flame is yours. Thank you for playing <b>Ashen Hollow</b>.<br/>Deaths: ${this.save.deaths} · Level ${level(this.save.stats)}</div>`,
        10,
      );
      this.victoryTimer = -1;
    }
  }

  private render(dt: number): void {
    if (this.mode !== 'title') {
      const scripted = this.player.state === 'rest' ? { yaw: this.player.yaw + 0.9, pitch: 0.15, dist: 3.6 } : undefined;
      const look = this.mode === 'play' && this.player.alive ? this.input : null;
      this.camRig.update(dt, this.player, this.player.target, look, this.world.collision, scripted);
    }
    this.hud.update(dt);
    if (this.mode !== 'title') this.updateHudWorld(dt);
    this.post.render(this.time);
  }

  private updateHudWorld(dt: number): void {
    const p = this.player;
    this.hud.setVitals(p.hp, p.maxHp, p.stamina, p.maxStamina);
    this.hud.setFlasks(p.flasks);
    const w = window.innerWidth, h = window.innerHeight;
    const proj = this.hud.projector(this.camera, w, h);
    if (p.target) {
      const t = p.target;
      this.hud.setReticle(proj(new THREE.Vector3(t.pos.x, 1.15 * t.scale, t.pos.z)));
    } else this.hud.setReticle(null);
    for (const e of this.enemies) {
      if (e === this.boss) continue;
      const head = new THREE.Vector3(e.pos.x, 2.15 * e.scale, e.pos.z);
      const s = e.alive && e.rig.root.visible ? proj(head) : null;
      this.hud.updateEnemyBar(e, s, e.hp / e.maxHp, dt, p.target === e);
    }
  }
}
