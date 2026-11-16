// Gamepad support (standard mapping):
//   left stick  move          right stick  look          triggers (LT/RT)  sprint
//   A  camouflage (hold)      B  ink cloud (water only)  X  venom bite       Y  climb (hold)      Start  pause   View  satchel   LB  shell / jar   RB  quick use
// `mock` lets tests feed a fake pad: { axes: [lx, ly, rx, ry], buttons: [pressedBool x 16] }.
const DEAD = 0.18;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));

export class GamepadInput {
  constructor() { this.prev = new Array(17).fill(false); this.navPrev = [0, 0]; this.mock = null; this.connected = false; }
  pad() {
    if (this.mock) return this.mock;
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list) if (p && p.connected) return p;
    return null;
  }
  /** -1 / 0 / 1 once per push of a stick (or d-pad) in one direction */
  stickEdge(i, v, neg, pos) {
    const d = neg ? -1 : pos ? 1 : v < -0.6 ? -1 : v > 0.6 ? 1 : 0;
    const was = this.navPrev[i]; this.navPrev[i] = d;
    return d !== 0 && d !== was ? d : 0;
  }
  /** returns null if no pad, else the state for this frame (edge-triggered buttons are true for one frame only) */
  poll(dt) {
    const p = this.pad();
    this.connected = !!p;
    if (!p) return null;
    const b = (i) => { const x = p.buttons[i]; return !!x && (typeof x === 'object' ? x.pressed || x.value > 0.5 : x); };
    const val = (i) => { const x = p.buttons[i]; return !x ? 0 : typeof x === 'object' ? x.value ?? (x.pressed ? 1 : 0) : (x ? 1 : 0); };
    const edge = (i) => { const now = b(i), was = this.prev[i]; this.prev[i] = now; return now && !was; };
    const ax = (i) => p.axes[i] || 0;
    const out = {
      r: dz(ax(0)), f: -dz(ax(1)),
      lookX: dz(ax(2)) * dt * 2.7, lookY: dz(ax(3)) * dt * 1.7,
      sprint: val(6) > 0.4 || val(7) > 0.4,
      camo: b(0), climb: b(3),
      ink: edge(1), bite: edge(2), pause: edge(9),
      // satchel: View / Back opens it; LB = shell / jar, RB = quick use; d-pad or left stick moves around it, A uses, B closes (= ink)
      back: edge(8), shelter: edge(4), boost: edge(5), a: edge(0),
      navX: this.stickEdge(0, ax(0), b(14), b(15)), navY: this.stickEdge(1, ax(1), b(12), b(13)),
    };
    edge(3); edge(6); edge(7);
    return out;
  }
}
