// Keyboard, mouse-look (Pointer Lock, with click-and-drag fallback), wheel zoom and a simple touch joystick.
import { clamp } from './util/rng.js';
import { CONFIG } from './config.js';
import { GamepadInput } from './gamepad.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();         // keys / buttons pressed since the last read() (edge triggers: ink, bite, pause ...)
    this.pad = new GamepadInput();
    this.yaw = Math.random() * Math.PI * 2; this.pitch = 0.42; this.zoom = 0;
    this.touchMove = { x: 0, y: 0 }; this.touchCamo = false; this.touchSprint = false;
    this.listeners = [];
    this.dragging = false;
    this.canvas = canvas;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
    this.lockSupported = CONFIG.camera.usePointerLock && typeof canvas.requestPointerLock === 'function' && !coarse;
    this.locked = false;       // real browser state
    this.everLocked = false;   // did a lock ever succeed? (only then does losing it mean "paused")
    this.lockFailed = false;   // first attempt was refused -> plain click-and-drag mode
    this.lockRequests = 0;
    this._mock = null;         // tests can force true/false
    this.invertY = CONFIG.camera.invertY;
    const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); this.listeners.push([el, ev, fn, o]); };
    on(window, 'keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (!e.repeat) this.pressed.add(e.code);
      if (this.onKey) this.onKey(e);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'mousedown', (e) => { if (e.button === 2) this.pressed.add('Mouse2'); });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) { this.everLocked = true; this.lockFailed = false; this.dragging = false; }
      this.onLockChange?.(this.isLocked);
    });
    on(document, 'pointerlockerror', () => { if (!this.everLocked) this.lockFailed = true; this.onLockError?.(); });
    on(window, 'mousemove', (e) => this.mouseLook(e.movementX || 0, e.movementY || 0));
    on(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (!this.isLocked) this.requestLock();          // every click retries the lock
      this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; try { canvas.setPointerCapture?.(e.pointerId); } catch (err) { /* synthetic / inactive pointer */ }
    });
    on(window, 'pointermove', (e) => {
      if (!this.dragging || e.pointerType === 'touch' || this.isLocked) return;
      this.yaw -= (e.clientX - this.lx) * 0.006; this.pitch = clamp(this.pitch + (e.clientY - this.ly) * 0.005, 0.08, 1.35);
      this.lx = e.clientX; this.ly = e.clientY;
    });
    on(window, 'pointerup', () => { this.dragging = false; });
    on(canvas, 'wheel', (e) => { e.preventDefault(); this.zoom = clamp(this.zoom + e.deltaY * 0.01, -4, 9); }, { passive: false });
    this.setupTouch(canvas, on);
  }

  get isLocked() { return this._mock ?? this.locked; }

  /** mouse movement while the pointer is captured: orbit the camera (no button needed) */
  mouseLook(dx, dy) {
    if (!this.isLocked) return;
    const sens = CONFIG.camera.mouseSensitivity, sgn = this.invertY ? -1 : 1;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch + dy * sens * sgn, CONFIG.camera.minPitch, CONFIG.camera.maxPitch);
  }

  /** must be called from a user gesture (click / key). Safe to call when unsupported. */
  requestLock() {
    if (!this.lockSupported || this.locked) return;
    this.lockRequests++;
    try {
      const r = this.canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => { if (!this.everLocked) this.lockFailed = true; });
    } catch (e) { if (!this.everLocked) this.lockFailed = true; }
  }
  releaseLock() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* ignore */ } }

  setupTouch(canvas, on) {
    const ui = document.getElementById('touch');
    // hidden by default; shown the first time a finger touches the screen, hidden again on keyboard / mouse use
    on(window, 'touchstart', () => { if (ui) ui.hidden = false; }, { passive: true });
    on(window, 'keydown', () => { if (ui) ui.hidden = true; });
    on(window, 'mousedown', (e) => { if (ui && e.sourceCapabilities && !e.sourceCapabilities.firesTouchEvents) ui.hidden = true; });
    const stick = document.getElementById('stick'), knob = document.getElementById('knob');
    const camo = document.getElementById('btn-camo'), sprint = document.getElementById('btn-sprint');
    let sid = null, cx = 0, cy = 0, look = null;
    on(stick, 'touchstart', (e) => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
    on(window, 'touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) {
          let dx = (t.clientX - cx) / 50, dy = (t.clientY - cy) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.touchMove.x = dx; this.touchMove.y = dy; knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
        } else if (look && t.identifier === look.id) {
          this.yaw -= (t.clientX - look.x) * 0.006; this.pitch = clamp(this.pitch + (t.clientY - look.y) * 0.005, 0.08, 1.35); look.x = t.clientX; look.y = t.clientY;
        }
      }
    }, { passive: true });
    on(window, 'touchend', (e) => { for (const t of e.changedTouches) { if (t.identifier === sid) { sid = null; this.touchMove.x = this.touchMove.y = 0; knob.style.transform = ''; } if (look && t.identifier === look.id) look = null; } });
    on(canvas, 'touchstart', (e) => { const t = e.changedTouches[0]; look = { id: t.identifier, x: t.clientX, y: t.clientY }; }, { passive: true });
    const hold = (el, key) => { on(el, 'touchstart', (e) => { this[key] = true; e.preventDefault(); }, { passive: false }); on(el, 'touchend', () => { this[key] = false; }); };
    hold(camo, 'touchCamo'); hold(sprint, 'touchSprint');
  }

  /** returns {fx, fz (screen-space forward/right in -1..1), sprint, camo} */
  read(dt = 0.016) {
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    f -= this.touchMove.y; r += this.touchMove.x;
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint;
    let camo = k.has('Space') || k.has('KeyC') || k.has('KeyE') || this.touchCamo;
    let climb = k.has('KeyR');
    const pr = this.pressed;
    let ink = pr.has('KeyF') || pr.has('KeyQ'), bite = pr.has('KeyB') || pr.has('Mouse2'), pause = false;
    // gamepad: left stick moves, right stick looks, triggers sprint, A camo, B ink, X bite, Y climb, Start pause
    const gp = this.pad.poll(dt);
    if (gp) {
      f += gp.f; r += gp.r; sprint = sprint || gp.sprint; camo = camo || gp.camo; climb = climb || gp.climb;
      ink = ink || gp.ink; bite = bite || gp.bite; pause = gp.pause;
      if (gp.lookX || gp.lookY) { this.yaw -= gp.lookX; this.pitch = clamp(this.pitch + gp.lookY, CONFIG.camera.minPitch, CONFIG.camera.maxPitch); }
    }
    pr.clear();
    return { f: clamp(f, -1, 1), r: clamp(r, -1, 1), sprint, camo, climb, ink, bite, pause };
  }
  dispose() { for (const [el, ev, fn, o] of this.listeners) el.removeEventListener(ev, fn, o); }
}
