/**
 * Unified keyboard + mouse + gamepad input.
 *
 * Default bindings (keyboard / mouse):
 *   WASD move · Mouse look · LMB light attack · Shift+LMB or C heavy attack
 *   RMB (hold) block · F parry · Space tap = roll, hold = sprint
 *   Tab / MMB / Q lock-on · Wheel or Z/X switch target · R drink flask
 *   E interact · Esc pause
 *
 * Gamepad (standard mapping):
 *   LS move · RS look · R1 light · R2 heavy · L1 block · L2 parry
 *   B (East) tap roll / hold sprint · R3 lock-on · RS flick switch target
 *   X (West) flask · A (South) interact · Start pause
 */
export type Action =
  | 'light'
  | 'heavy'
  | 'roll'
  | 'parry'
  | 'lockon'
  | 'switchLeft'
  | 'switchRight'
  | 'heal'
  | 'interact'
  | 'pause'
  | 'confirm'
  | 'back'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'any';

const SPRINT_HOLD = 0.28;

export class Input {
  moveX = 0;
  moveY = 0; // +1 = forward
  lookX = 0;
  lookY = 0;
  block = false;
  sprint = false;
  usingGamepad = false;
  sensitivity = 1;
  invertY = false;

  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  private rmb = false;
  private rollKeyDown = -1;
  private padRollDown = -1;
  private padPrev: boolean[] = [];
  private padStickFlick = 0;
  private time = 0;
  pointerLocked = false;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.rmb = false;
      this.rollKeyDown = -1;
    });
    canvas.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.pointerLocked) return;
        this.press(e.deltaY > 0 ? 'switchRight' : 'switchLeft');
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestPointerLock(): void {
    if (!this.pointerLocked && this.canvas.requestPointerLock) {
      try {
        const r = this.canvas.requestPointerLock() as unknown;
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
      } catch {
        /* ignored: not allowed outside a user gesture */
      }
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  private press(a: Action): void {
    this.pressed.add(a);
    this.pressed.add('any');
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.code;
    if (k === 'Tab' || k === 'Space') e.preventDefault();
    if (down) {
      this.usingGamepad = false;
      if (e.repeat) return;
      this.keys.add(k);
      switch (k) {
        case 'KeyC':
          this.press('heavy');
          break;
        case 'KeyF':
          this.press('parry');
          break;
        case 'Tab':
        case 'KeyQ':
          this.press('lockon');
          break;
        case 'KeyZ':
          this.press('switchLeft');
          break;
        case 'KeyX':
          this.press('switchRight');
          break;
        case 'KeyR':
          this.press('heal');
          break;
        case 'KeyE':
          this.press('interact');
          break;
        case 'Escape':
          this.press('pause');
          this.press('back');
          break;
        case 'Enter':
          this.press('confirm');
          break;
        case 'Space':
          this.rollKeyDown = this.time;
          break;
        case 'ArrowUp':
          this.press('up');
          break;
        case 'ArrowDown':
          this.press('down');
          break;
        case 'ArrowLeft':
          this.press('left');
          break;
        case 'ArrowRight':
          this.press('right');
          break;
      }
      this.pressed.add('any');
    } else {
      this.keys.delete(k);
      if (k === 'Space') {
        if (this.rollKeyDown >= 0 && this.time - this.rollKeyDown < SPRINT_HOLD) this.press('roll');
        this.rollKeyDown = -1;
      }
    }
  }

  private onMouse(e: MouseEvent, down: boolean): void {
    this.usingGamepad = false;
    if (down) {
      if (e.button === 0) {
        this.press(this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 'heavy' : 'light');
      } else if (e.button === 1) {
        e.preventDefault();
        this.press('lockon');
      } else if (e.button === 2) {
        this.rmb = true;
      }
      this.pressed.add('any');
    } else if (e.button === 2) {
      this.rmb = false;
    }
  }

  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }

  /** Consume a pressed action so later systems don't also react to it. */
  consume(a: Action): boolean {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }

  /** Call once per frame before game logic. */
  update(dt: number): void {
    this.time += dt;
    let mx = 0,
      my = 0;
    if (this.keys.has('KeyW')) my += 1;
    if (this.keys.has('KeyS')) my -= 1;
    if (this.keys.has('KeyD')) mx += 1;
    if (this.keys.has('KeyA')) mx -= 1;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const s = 0.0025 * this.sensitivity;
    let lx = this.mouseDX * s;
    let ly = this.mouseDY * s;
    this.mouseDX = this.mouseDY = 0;

    let block = this.rmb;
    let sprint = this.rollKeyDown >= 0 && this.time - this.rollKeyDown >= SPRINT_HOLD;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected) ?? null;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const ax = dz(pad.axes[0] ?? 0),
        ay = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0),
        ry = dz(pad.axes[3] ?? 0);
      if (ax || ay || rx || ry) this.usingGamepad = true;
      if (ax || ay) {
        mx = ax;
        my = -ay;
      }
      lx += rx * 2.6 * dt * this.sensitivity;
      ly += ry * 1.8 * dt * this.sensitivity;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => b(i) && !this.padPrev[i];
      if (pad.buttons.some((x) => x.pressed)) this.usingGamepad = true;
      if (edge(5)) this.press('light');
      if (edge(7)) this.press('heavy');
      if (edge(6)) this.press('parry');
      if (edge(11)) this.press('lockon');
      if (edge(2)) this.press('heal');
      if (edge(0)) {
        this.press('interact');
        this.press('confirm');
      }
      if (edge(9)) this.press('pause');
      if (edge(1)) {
        this.padRollDown = this.time;
        this.press('back');
      }
      if (!b(1) && this.padPrev[1]) {
        if (this.padRollDown >= 0 && this.time - this.padRollDown < SPRINT_HOLD) this.press('roll');
        this.padRollDown = -1;
      }
      if (b(1) && this.padRollDown >= 0 && this.time - this.padRollDown >= SPRINT_HOLD) sprint = true;
      if (edge(12)) this.press('up');
      if (edge(13)) this.press('down');
      if (edge(14)) this.press('left');
      if (edge(15)) this.press('right');
      if (b(4)) block = true;
      // Right-stick flick to switch lock-on targets.
      const flick = Math.abs(rx) > 0.85 ? Math.sign(rx) : 0;
      if (flick && flick !== this.padStickFlick) this.press(flick > 0 ? 'switchRight' : 'switchLeft');
      this.padStickFlick = flick;
      this.padPrev = pad.buttons.map((x) => x.pressed);
      if (pad.buttons.some((x, i) => x.pressed && !this.padPrevAny[i])) this.pressed.add('any');
      this.padPrevAny = pad.buttons.map((x) => x.pressed);
    }

    this.moveX = mx;
    this.moveY = my;
    this.lookX = lx;
    this.lookY = this.invertY ? -ly : ly;
    this.block = block;
    this.sprint = sprint;
  }
  private padPrevAny: boolean[] = [];

  /** Rotational look input that games should treat as "the stick is pushed". */
  get lookIsAnalog(): boolean {
    return this.usingGamepad;
  }

  /** Call at end of frame. */
  endFrame(): void {
    this.pressed.clear();
  }
}
