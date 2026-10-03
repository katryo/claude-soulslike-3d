import * as THREE from 'three';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export interface MenuItem {
  label: string;
  detail?: string;
  disabled?: boolean;
  action: () => void;
}

interface EnemyBar {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  lag: HTMLDivElement;
  lagValue: number;
  timer: number;
}

/** DOM-based heads-up display, banners, prompts and menus. */
export class HUD {
  readonly root: HTMLDivElement;
  private hpBar: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpLag: HTMLDivElement;
  private stBar: HTMLDivElement;
  private stFill: HTMLDivElement;
  private flaskCount: HTMLDivElement;
  private flaskIcon: HTMLDivElement;
  private soulsEl: HTMLDivElement;
  private soulsGain: HTMLDivElement;
  private bossWrap: HTMLDivElement;
  private bossName: HTMLDivElement;
  private bossFill: HTMLDivElement;
  private bossLag: HTMLDivElement;
  private reticle: HTMLDivElement;
  private prompt: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerText: HTMLDivElement;
  private areaName: HTMLDivElement;
  private dialog: HTMLDivElement;
  private menu: HTMLDivElement;
  private vignette: HTMLDivElement;
  private fade: HTMLDivElement;
  private hint: HTMLDivElement;
  private enemyBars = new Map<object, EnemyBar>();
  private shownSouls = 0;
  private targetSouls = 0;
  private gainTimer = 0;
  private hpLagValue = 1;
  private bossLagValue = 1;
  private bannerTimer = 0;
  private areaTimer = 0;
  private dialogTimer = 0;
  private hurt = 0;
  private menuItems: MenuItem[] = [];
  private menuIndex = 0;
  private menuOnBack: (() => void) | null = null;
  title: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.vignette = el('div', 'hurt-vignette', this.root);

    const bars = el('div', 'bars', this.root);
    this.hpBar = el('div', 'bar hp', bars);
    this.hpLag = el('div', 'lag', this.hpBar);
    this.hpFill = el('div', 'fill', this.hpBar);
    this.stBar = el('div', 'bar st', bars);
    this.stFill = el('div', 'fill', this.stBar);

    const flask = el('div', 'flask', this.root);
    this.flaskIcon = el('div', 'flask-icon', flask);
    this.flaskCount = el('div', 'flask-count', flask);

    const souls = el('div', 'souls', this.root);
    this.soulsGain = el('div', 'souls-gain', souls);
    this.soulsEl = el('div', 'souls-value', souls);

    this.bossWrap = el('div', 'boss', this.root);
    this.bossName = el('div', 'boss-name', this.bossWrap);
    const bb = el('div', 'boss-bar', this.bossWrap);
    this.bossLag = el('div', 'lag', bb);
    this.bossFill = el('div', 'fill', bb);

    this.reticle = el('div', 'reticle', this.root);
    this.prompt = el('div', 'prompt', this.root);
    this.banner = el('div', 'banner', this.root);
    this.bannerText = el('div', 'banner-text', this.banner);
    this.areaName = el('div', 'area-name', this.root);
    this.dialog = el('div', 'dialog', this.root);
    this.menu = el('div', 'menu', this.root);
    this.fade = el('div', 'fade', this.root);
    this.hint = el('div', 'hint', this.root, 'Click to control the camera');
    this.title = el('div', 'title-screen', parent);
    this.title.innerHTML = `
      <div class="title-inner">
        <div class="title-sub">A Tale of Ash and Embers</div>
        <h1>ASHEN HOLLOW</h1>
        <div class="title-press">Click to begin</div>
        <div class="title-controls">
          <div><b>WASD</b> Move</div><div><b>Mouse</b> Camera</div>
          <div><b>LMB</b> Light attack</div><div><b>Shift+LMB / C</b> Heavy attack</div>
          <div><b>RMB</b> Block</div><div><b>F</b> Parry</div>
          <div><b>Space</b> Roll (hold: sprint)</div><div><b>Tab / Q / MMB</b> Lock on</div>
          <div><b>R</b> Drink flask</div><div><b>E</b> Interact</div>
          <div><b>Wheel / Z X</b> Switch target</div><div><b>Esc</b> Menu</div>
        </div>
        <div class="title-pad">Gamepad supported</div>
      </div>`;
    this.setBoss(null);
    this.root.style.visibility = 'hidden';
  }

  hideTitle(): void {
    this.title.classList.add('hidden');
    this.root.style.visibility = 'visible';
  }

  setTitlePrompt(text: string): void {
    const p = this.title.querySelector('.title-press');
    if (p) p.textContent = text;
  }

  setVitals(hp: number, maxHp: number, st: number, maxSt: number): void {
    const hpW = 180 + maxHp * 0.9;
    const stW = 140 + maxSt * 1.6;
    this.hpBar.style.width = `${hpW}px`;
    this.stBar.style.width = `${stW}px`;
    const f = Math.max(0, hp / maxHp);
    if (f < this.hpLagValue - 0.001) {
      if (f < parseFloat(this.hpFill.dataset.f ?? '1') - 0.001) this.hurt = 1;
    }
    this.hpFill.dataset.f = String(f);
    this.hpFill.style.transform = `scaleX(${f})`;
    if (f > this.hpLagValue) this.hpLagValue = f;
    this.stFill.style.transform = `scaleX(${Math.max(0, st / maxSt)})`;
    this.hpBar.classList.toggle('low', f < 0.25);
  }

  setFlasks(n: number): void {
    this.flaskCount.textContent = String(n);
    this.flaskIcon.classList.toggle('empty', n === 0);
  }

  setSouls(n: number, instant = false): void {
    if (n > this.targetSouls && !instant) {
      this.soulsGain.textContent = `+${n - this.targetSouls}`;
      this.gainTimer = 2.2;
    }
    this.targetSouls = n;
    if (instant) this.shownSouls = n;
  }

  setBoss(name: string | null, hp = 1, max = 1): void {
    this.bossWrap.style.display = name ? 'block' : 'none';
    if (!name) {
      this.bossLagValue = 1;
      return;
    }
    this.bossName.textContent = name;
    const f = Math.max(0, hp / max);
    this.bossFill.style.transform = `scaleX(${f})`;
    if (f > this.bossLagValue) this.bossLagValue = f;
  }

  setReticle(screen: { x: number; y: number } | null): void {
    if (!screen) {
      this.reticle.style.display = 'none';
      return;
    }
    this.reticle.style.display = 'block';
    this.reticle.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
  }

  setPrompt(text: string | null): void {
    if (!text) {
      this.prompt.style.opacity = '0';
      return;
    }
    this.prompt.innerHTML = text;
    this.prompt.style.opacity = '1';
  }

  showBanner(text: string, style: 'death' | 'gold' | 'victory', duration = 4): void {
    this.bannerText.textContent = text;
    this.banner.className = `banner show ${style}`;
    this.bannerTimer = duration;
  }

  showArea(name: string): void {
    this.areaName.textContent = name;
    this.areaName.classList.add('show');
    this.areaTimer = 3.5;
  }

  showDialog(html: string, duration = 5): void {
    this.dialog.innerHTML = html;
    this.dialog.classList.add('show');
    this.dialogTimer = duration;
  }

  hideDialog(): void {
    this.dialog.classList.remove('show');
    this.dialogTimer = 0;
  }

  setHint(show: boolean): void {
    this.hint.style.opacity = show ? '1' : '0';
  }

  setFade(v: number): void {
    this.fade.style.opacity = String(v);
  }

  flashHurt(): void {
    this.hurt = 1;
  }

  // ---- Enemy health bars -------------------------------------------------

  enemyDamaged(key: object): void {
    let b = this.enemyBars.get(key);
    if (!b) {
      const root = el('div', 'ebar', this.root);
      const lag = el('div', 'lag', root);
      const fill = el('div', 'fill', root);
      b = { root, fill, lag, lagValue: 1, timer: 0 };
      this.enemyBars.set(key, b);
    }
    b.timer = 4;
  }

  updateEnemyBar(key: object, screen: { x: number; y: number } | null, frac: number, dt: number, force = false): void {
    const b = this.enemyBars.get(key);
    if (!b) return;
    if (force) b.timer = Math.max(b.timer, 0.1);
    b.timer -= dt;
    if (!screen || b.timer <= 0 || frac <= 0) {
      b.root.style.display = 'none';
      if (frac <= 0) b.timer = 0;
      return;
    }
    b.root.style.display = 'block';
    b.root.style.transform = `translate(${screen.x - 40}px, ${screen.y}px)`;
    b.fill.style.transform = `scaleX(${frac})`;
    if (frac > b.lagValue) b.lagValue = frac;
    b.lagValue = Math.max(frac, b.lagValue - dt * 0.5);
    b.lag.style.transform = `scaleX(${b.lagValue})`;
  }

  clearEnemyBars(): void {
    for (const b of this.enemyBars.values()) b.root.remove();
    this.enemyBars.clear();
  }

  // ---- Menu ---------------------------------------------------------------

  openMenu(title: string, items: MenuItem[], onBack: (() => void) | null, footer = ''): void {
    this.menuItems = items;
    this.menuIndex = Math.max(0, items.findIndex((i) => !i.disabled));
    this.menuOnBack = onBack;
    this.menu.innerHTML = '';
    el('div', 'menu-title', this.menu, title);
    const list = el('div', 'menu-list', this.menu);
    items.forEach((it, i) => {
      const row = el('div', `menu-item${it.disabled ? ' disabled' : ''}`, list);
      el('span', 'label', row, it.label);
      if (it.detail) el('span', 'detail', row, it.detail);
      row.addEventListener('mouseenter', () => {
        if (!it.disabled) {
          this.menuIndex = i;
          this.refreshMenu();
        }
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!it.disabled) it.action();
      });
    });
    if (footer) el('div', 'menu-footer', this.menu, footer);
    this.menu.classList.add('show');
    this.refreshMenu();
  }

  get menuOpen(): boolean {
    return this.menu.classList.contains('show');
  }

  closeMenu(): void {
    this.menu.classList.remove('show');
    this.menuItems = [];
  }

  private refreshMenu(): void {
    const rows = this.menu.querySelectorAll('.menu-item');
    rows.forEach((r, i) => r.classList.toggle('sel', i === this.menuIndex));
  }

  menuNav(dir: number): void {
    if (!this.menuItems.length) return;
    let i = this.menuIndex;
    for (let k = 0; k < this.menuItems.length; k++) {
      i = (i + dir + this.menuItems.length) % this.menuItems.length;
      if (!this.menuItems[i].disabled) break;
    }
    this.menuIndex = i;
    this.refreshMenu();
  }

  menuConfirm(): void {
    const it = this.menuItems[this.menuIndex];
    if (it && !it.disabled) it.action();
  }

  menuBack(): void {
    this.menuOnBack?.();
  }

  update(dt: number): void {
    // Souls counter roll-up
    if (this.shownSouls !== this.targetSouls) {
      const d = this.targetSouls - this.shownSouls;
      const step = Math.max(1, Math.abs(d) * dt * 4);
      this.shownSouls = Math.abs(d) <= step ? this.targetSouls : this.shownSouls + Math.sign(d) * step;
    }
    this.soulsEl.textContent = String(Math.round(this.shownSouls));
    this.gainTimer -= dt;
    this.soulsGain.style.opacity = this.gainTimer > 0 ? String(Math.min(1, this.gainTimer)) : '0';

    const hpF = parseFloat(this.hpFill.dataset.f ?? '1');
    this.hpLagValue = Math.max(hpF, this.hpLagValue - dt * 0.35);
    this.hpLag.style.transform = `scaleX(${this.hpLagValue})`;
    const bossF = parseFloat((this.bossFill.style.transform.match(/scaleX\(([^)]+)\)/) ?? [0, '1'])[1] as string);
    this.bossLagValue = Math.max(bossF, this.bossLagValue - dt * 0.25);
    this.bossLag.style.transform = `scaleX(${this.bossLagValue})`;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.areaTimer > 0) {
      this.areaTimer -= dt;
      if (this.areaTimer <= 0) this.areaName.classList.remove('show');
    }
    if (this.dialogTimer > 0) {
      this.dialogTimer -= dt;
      if (this.dialogTimer <= 0) this.dialog.classList.remove('show');
    }
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    this.vignette.style.opacity = String(this.hurt * 0.8);
  }

  projector(camera: THREE.Camera, w: number, h: number): (p: THREE.Vector3) => { x: number; y: number } | null {
    const v = new THREE.Vector3();
    return (p) => {
      v.copy(p).project(camera);
      if (v.z > 1 || v.z < -1) return null;
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    };
  }
}
