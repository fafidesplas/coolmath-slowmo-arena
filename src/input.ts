/** Keyboard + mouse (pointer lock) and touch (virtual joystick / look drag / buttons). */
export class Input {
  readonly keys = new Set<string>();
  lookDX = 0;
  lookDY = 0;
  attack = false;
  fire = false;
  push = false;
  restart = false;
  mouseBlock = false;
  touchBlock = false;
  joyX = 0;
  joyY = 0;
  locked = false;
  sens = 0.0022;
  touchSens = 0.0058;

  private joyId = -1;
  private lookId = -1;
  private joyOx = 0;
  private joyOy = 0;
  private lookX = 0;
  private lookY = 0;
  private btnPointers = new Map<number, HTMLElement>();

  constructor(private canvas: HTMLCanvasElement, touchLayer: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.fire = true;
      if (e.code === 'KeyE') this.push = true;
      if (e.code === 'KeyR') this.restart = true;
      if (e.code === 'KeyF') this.attack = true;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseBlock = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.mouseBlock = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // browser spikes
      this.lookDX += e.movementX * this.sens;
      this.lookDY += e.movementY * this.sens;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.attack = true;
      if (e.button === 2) this.mouseBlock = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.mouseBlock = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch
    const base = touchLayer.querySelector<HTMLElement>('#joy-base')!;
    const knob = touchLayer.querySelector<HTMLElement>('#joy-knob')!;
    const R = 56;
    touchLayer.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (btn) {
        this.press(btn.dataset.act ?? '', true);
        btn.classList.add('on');
        this.btnPointers.set(e.pointerId, btn);
        return;
      }
      if (e.clientX < innerWidth * 0.45 && this.joyId < 0) {
        this.joyId = e.pointerId;
        this.joyOx = e.clientX;
        this.joyOy = e.clientY;
        base.style.left = `${e.clientX}px`;
        base.style.top = `${e.clientY}px`;
        base.classList.add('on');
        knob.style.transform = 'translate(-50%, -50%)';
      } else if (this.lookId < 0) {
        this.lookId = e.pointerId;
        this.lookX = e.clientX;
        this.lookY = e.clientY;
      }
    });
    touchLayer.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) {
        let dx = e.clientX - this.joyOx;
        let dy = e.clientY - this.joyOy;
        const l = Math.hypot(dx, dy);
        if (l > R) {
          dx = (dx / l) * R;
          dy = (dy / l) * R;
        }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const m = Math.min(1, l / R);
        const dead = 0.12;
        const k = m < dead ? 0 : (m - dead) / (1 - dead) / (m || 1);
        this.joyX = (dx / R) * k;
        this.joyY = (-dy / R) * k;
      } else if (e.pointerId === this.lookId) {
        this.lookDX += (e.clientX - this.lookX) * this.touchSens;
        this.lookDY += (e.clientY - this.lookY) * this.touchSens;
        this.lookX = e.clientX;
        this.lookY = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      const btn = this.btnPointers.get(e.pointerId);
      if (btn) {
        this.press(btn.dataset.act ?? '', false);
        btn.classList.remove('on');
        this.btnPointers.delete(e.pointerId);
      }
      if (e.pointerId === this.joyId) {
        this.joyId = -1;
        this.joyX = this.joyY = 0;
        base.classList.remove('on');
      }
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    touchLayer.addEventListener('pointerup', end);
    touchLayer.addEventListener('pointercancel', end);
  }

  private press(act: string, down: boolean): void {
    if (act === 'block') this.touchBlock = down;
    if (!down) return;
    if (act === 'attack') this.attack = true;
    if (act === 'fire') this.fire = true;
    if (act === 'push') this.push = true;
  }

  get moveX(): number {
    const k = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.joyX));
  }
  get moveY(): number {
    const k = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    return Math.max(-1, Math.min(1, k + this.joyY));
  }
  get block(): boolean {
    return this.mouseBlock || this.touchBlock || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Clear one-shot inputs at the end of a frame. */
  endFrame(): void {
    this.lookDX = this.lookDY = 0;
    this.attack = this.fire = this.push = this.restart = false;
  }

  resetTouch(): void {
    this.joyX = this.joyY = 0;
    this.touchBlock = false;
  }
}
