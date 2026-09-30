// Keyboard + mouse input with pointer lock and per-frame edge detection.
const BLOCK = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'KeyM', 'KeyJ', 'KeyT']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: new Set(), pressed: new Set(), released: new Set(), wheel: 0 };
    this.locked = false;
    this.enabled = true;
    this.keyDownTime = {};

    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (BLOCK.has(e.code)) e.preventDefault();
      // any key (a user gesture) re-captures the mouse after a dialogue, Esc or alt-tab,
      // so play never stalls behind a "click to continue" prompt
      if (!this.locked && e.code !== 'Escape' && this.wantLock && this.wantLock()) this.requestLock();
      if (!this.keys.has(e.code)) {
        this.pressed.add(e.code);
        this.keyDownTime[e.code] = performance.now();
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked && this.wantLock && this.wantLock()) this.requestLock();
      this.mouse.buttons.add(e.button);
      this.mouse.pressed.add(e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons.delete(e.button);
      this.mouse.released.add(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        // Clamp spikes some browsers produce on lock/unlock
        const mx = Math.max(-300, Math.min(300, e.movementX || 0));
        const my = Math.max(-300, Math.min(300, e.movementY || 0));
        this.mouse.dx += mx;
        this.mouse.dy += my;
      }
    });
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    window.addEventListener('blur', () => this.clear());
  }

  requestLock() {
    if (!this.locked && this.canvas.requestPointerLock && document.hasFocus()) {
      const retry = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (_) {} };
      try {
        const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(retry);
      } catch (_) { retry(); }
    }
  }
  exitLock() { if (this.locked) document.exitPointerLock(); }

  down(code) { return this.enabled && this.keys.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  up(code) { return this.enabled && this.released.has(code); }
  consume(code) { this.pressed.delete(code); }
  heldFor(code) { return this.keys.has(code) ? (performance.now() - (this.keyDownTime[code] || 0)) / 1000 : 0; }
  mDown(b) { return this.enabled && this.mouse.buttons.has(b); }
  mHit(b) { return this.enabled && this.mouse.pressed.has(b); }
  mUp(b) { return this.enabled && this.mouse.released.has(b); }

  // Generic "advance" for dialogue: E / Space / Enter / left click
  advance() {
    return this.pressed.has('KeyE') || this.pressed.has('Space') || this.pressed.has('Enter') || this.mouse.pressed.has(0);
  }

  clear() {
    this.keys.clear();
    this.mouse.buttons.clear();
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.pressed.clear();
    this.mouse.released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}
