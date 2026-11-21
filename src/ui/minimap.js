// =====================================================================
//  Corner map (M). The satchel's watercolour sketch, round and small, centred
//  on the octopus. Off until asked. Redrawn a few times a second, never while hidden.
// =====================================================================
import { drawMini } from './map.js';
import { unpackCell } from '../systems/save.js';

const SIZE = 160;

export class MiniMap {
  constructor(el, game) {
    this.el = el;
    this.game = game;
    this.on = false;
    this.acc = 0;
    this.draws = 0;
    this.heading = 0;
    el.width = SIZE; el.height = SIZE;
    el.className = 'minimap';
    const wash = document.createElement('canvas'); wash.width = SIZE; wash.height = SIZE;
    const mask = document.createElement('canvas'); mask.width = SIZE; mask.height = SIZE;
    this.scratch = { wash, wc: wash.getContext('2d'), mask, mc: mask.getContext('2d') };
    this.ctx = el.getContext('2d');
    this.sync();
  }
  setOn(on) {
    this.on = !!on;
    this.acc = 0;
    this.sync();
  }
  hidden() {
    return !this.on || !!this.game.clockHidden?.();
  }
  sync() {
    const hide = this.hidden();
    const was = this.el.hidden;
    if (was !== hide) this.el.hidden = hide;
    if (was && !hide) { this.acc = 0; this.draw(); }
  }
  /** draw at most about three times a second, and not at all while the map is put away */
  tick(dt) {
    const hide = this.hidden();
    if (this.el.hidden !== hide) this.el.hidden = hide;
    if (hide) return;
    this.acc += dt;
    if (this.acc < 0.3) return;
    this.acc = 0;
    this.draw();
  }
  draw() {
    const g = this.game, world = g.world, o = g.octopus;
    if (!world || !o || !this.ctx) return;
    const cells = [];
    const ex = g.explored || [];
    for (const n of ex) {
      const { ix, iz } = unpackCell(n);
      cells.push({ x: ix * 100 + 50, z: iz * 100 + 50 });
    }
    this.heading = o.heading;
    drawMini(this.ctx, SIZE, SIZE, {
      cells, seaOk: !!g.progress?.seaReached, biomeAt: (x, z) => world.biomeAt(x, z),
      trail: g.trail || [], me: { x: o.x, z: o.z, heading: o.heading },
    }, this.scratch);
    this.draws++;
  }
}
