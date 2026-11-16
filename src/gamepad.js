// Gamepad support (standard mapping):
//   left stick  move          right stick  look          triggers (LT/RT)  sprint
//   A  camouflage (hold)      B  ink cloud (water only)  X  venom bite       Y  climb (hold)      Start  pause
// `mock` lets tests feed a fake pad: { axes: [lx, ly, rx, ry], buttons: [pressedBool x 16] }.
const DEAD = 0.18;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));

export class GamepadInput {
  constructor() { this.prev = new Array(17).fill(false); this.mock = null; this.connected = false; }
  pad() {
    if (this.mock) return this.mock;
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of list) if (p && p.connected) return p;
    return null;
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
    };
    edge(0); edge(3); edge(6); edge(7);
    return out;
  }
}
