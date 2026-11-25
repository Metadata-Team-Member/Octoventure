// Dev tools (not for players, not in the README): Enter opens a tiny command box; `fly` + Enter starts a free-fly camera.
// While flying the game is frozen (nothing moves, nothing can hurt the octopus, no journal / biome / map discovery), so
// the map can be checked quickly. Esc (or losing the pointer lock, which is what Esc does in a browser) puts the camera
// straight back on the octopus.
import * as THREE from 'three';
import { clamp } from '../util/rng.js';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const SPEED0 = 120, SPEED_MIN = 5, SPEED_MAX = 1500;      // m/s: the default crosses the map in about ten seconds

export class DevTools {
  constructor(game) {
    this.game = game;
    this.box = null;            // the command box (only exists while typing)
    this.fly = null;            // { yaw, pitch, speed, saved } while flying
    this._onMove = (e) => { if (!this.fly || document.pointerLockElement !== game.canvas) return; this.look(e.movementX || 0, e.movementY || 0); };
    this._onWheel = (e) => { if (!this.fly) return; e.preventDefault(); e.stopImmediatePropagation(); this.fly.speed = clamp(this.fly.speed * (e.deltaY > 0 ? 0.8 : 1.25), SPEED_MIN, SPEED_MAX); };
    this._onDrag = (e) => { if (!this.fly || document.pointerLockElement === game.canvas || !(e.buttons & 1)) return; this.look(e.movementX || 0, e.movementY || 0); };
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('pointermove', this._onDrag);
    game.canvas.addEventListener('wheel', this._onWheel, { capture: true, passive: false });
  }
  get busy() { return !!(this.box || this.fly); }
  /** a key the game did not use for a menu. Returns true when the dev tools took it. */
  key(e) {
    const g = this.game;
    if (this.fly) {
      if (e.code === 'Escape' && !e.repeat) { this.exitFly(); return true; }
      return true;                                         // nothing else reacts while flying (no pause, satchel, map ...)
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && g.state === 'playing' && !g.paused && !g.satchelOpen && !g.places?.indoor) { this.openBox(); return true; }
    return false;
  }
  openBox() {
    if (this.box) return;
    const el = document.createElement('input');
    el.id = 'devcmd'; el.type = 'text'; el.autocomplete = 'off'; el.spellcheck = false; el.setAttribute('aria-label', 'dev command');
    el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);width:160px;padding:4px 8px;font:13px monospace;'
      + 'background:rgba(20,22,30,.72);color:#ffe066;border:1px solid rgba(255,224,102,.6);border-radius:6px;outline:none;z-index:50';
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.closeBox(); }
      else if (e.key === 'Enter') { e.preventDefault(); const t = el.value.trim().toLowerCase(); this.closeBox(); this.run(t); }
    });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    el.addEventListener('blur', () => setTimeout(() => { if (this.box === el) this.closeBox(); }, 0));
    document.body.appendChild(el); this.box = el;
    this.game.input.keys.clear(); this.game.input.pressed.clear();
    el.focus();
  }
  closeBox() { const el = this.box; if (!el) return; this.box = null; el.remove(); this.game.canvas.focus?.(); }
  /** run a typed command; unknown ones do nothing */
  run(cmd) { if (cmd === 'fly') return this.enterFly(); return false; }

  enterFly() {
    const g = this.game, cam = g.camera, i = g.input;
    if (this.fly || g.state !== 'playing') return false;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.fly = {
      yaw: Math.atan2(-_f.x, -_f.z), pitch: Math.asin(clamp(_f.y, -1, 1)), speed: SPEED0,
      saved: { yaw: i.yaw, pitch: i.pitch, zoom: i.zoom, far: cam.far, fogNear: g.scene.fog?.near, fogFar: g.scene.fog?.far, vis: g.view?.visRadius },
    };
    cam.far = 4000; cam.updateProjectionMatrix();
    if (g.view) g.view.visRadius = 700;                    // see further from up high (chunks stream in around the camera)
    i.keys.clear(); i.pressed.clear();
    i.requestLock();                                        // Enter is a user gesture, so the mouse can be captured again
    return true;
  }
  exitFly() {
    const g = this.game, f = this.fly, i = g.input;
    if (!f) return false;
    this.fly = null;
    i.yaw = f.saved.yaw; i.pitch = f.saved.pitch; i.zoom = f.saved.zoom;
    g.camera.far = f.saved.far; g.camera.updateProjectionMatrix();
    if (g.scene.fog && f.saved.fogFar != null) { g.scene.fog.near = f.saved.fogNear; g.scene.fog.far = f.saved.fogFar; }
    if (g.view && f.saved.vis) g.view.visRadius = f.saved.vis;
    i.keys.clear(); i.pressed.clear();
    g.updateCamera(0.016, true);                           // straight back to the follow camera behind the octopus
    return true;
  }
  look(dx, dy) {
    const f = this.fly; if (!f) return;
    f.yaw -= dx * 0.0025; f.pitch = clamp(f.pitch - dy * 0.0025, -1.5, 1.5);
  }
  /** one frame of flying: the world stays frozen; only the camera moves and the land streams in around it */
  update(dt) {
    const g = this.game, f = this.fly, k = g.input.keys, cam = g.camera;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1, sp = f.speed * fast * dt;
    _e.set(f.pitch, f.yaw, 0); cam.quaternion.setFromEuler(_e);
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _r.crossVectors(_f, _up).normalize();
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const up = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('ControlLeft') || k.has('ControlRight') ? 1 : 0);
    cam.position.addScaledVector(_f, fwd * sp).addScaledVector(_r, side * sp);
    cam.position.y += up * sp;
    const gy = g.world.heightAt(cam.position.x, cam.position.z);
    if (cam.position.y < gy + 0.3) cam.position.y = gy + 0.3;          // never under the ground
    if (cam.position.y > 900) cam.position.y = 900;
    if (g.scene.fog) { g.scene.fog.near = 200 + cam.position.y; g.scene.fog.far = 900 + cam.position.y * 2; }   // thin the haze from up high
    g.sky.position.copy(cam.position);
    g.view?.update(dt, { x: cam.position.x, y: cam.position.y, z: cam.position.z }, cam);
  }
  dispose() {
    window.removeEventListener('mousemove', this._onMove); window.removeEventListener('pointermove', this._onDrag);
    this.game.canvas.removeEventListener('wheel', this._onWheel, { capture: true });
    this.closeBox();
  }
}
