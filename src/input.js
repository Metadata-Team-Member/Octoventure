// Keyboard, mouse-drag camera, wheel zoom and a simple touch joystick.
import { clamp } from './util/rng.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.yaw = Math.random() * Math.PI * 2; this.pitch = 0.42; this.zoom = 0;
    this.touchMove = { x: 0, y: 0 }; this.touchCamo = false; this.touchSprint = false;
    this.listeners = [];
    this.dragging = false;
    const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); this.listeners.push([el, ev, fn, o]); };
    on(window, 'keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.keys.clear());
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.dragging = true; this.lx = e.clientX; this.ly = e.clientY; canvas.setPointerCapture?.(e.pointerId);
    });
    on(window, 'pointermove', (e) => {
      if (!this.dragging || e.pointerType === 'touch') return;
      this.yaw -= (e.clientX - this.lx) * 0.006; this.pitch = clamp(this.pitch + (e.clientY - this.ly) * 0.005, 0.08, 1.35);
      this.lx = e.clientX; this.ly = e.clientY;
    });
    on(window, 'pointerup', () => { this.dragging = false; });
    on(canvas, 'wheel', (e) => { e.preventDefault(); this.zoom = clamp(this.zoom + e.deltaY * 0.01, -4, 9); }, { passive: false });
    this.setupTouch(canvas, on);
  }

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
  read() {
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    f -= this.touchMove.y; r += this.touchMove.x;
    return {
      f: clamp(f, -1, 1), r: clamp(r, -1, 1),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint,
      camo: k.has('Space') || k.has('KeyC') || k.has('KeyE') || this.touchCamo,
    };
  }
  dispose() { for (const [el, ev, fn, o] of this.listeners) el.removeEventListener(ev, fn, o); }
}
