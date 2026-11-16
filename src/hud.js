// Deliberately tiny: there is no health bar, timer, hints or controls on screen.
// The only UI is the title / end overlays, a brief red flash when you are bitten, and ?debug=1.
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hurt: $('hurt'), debug: $('debug'), start: $('start'), pause: $('pause'), end: $('end'), endTitle: $('end-title'),
      loading: $('loading'), satchel: $('satchel'), copy: $('chip-copy'), paste: $('chip-paste'), codeIn: $('code-in'), play: $('play'), restart: $('restart'), opts: $('opts'), daily: $('chip-daily'), newWorld: $('chip-new'),
    };
  }
  /** reflect the current difficulty / daily setting on the pause-menu chips */
  setOptions({ difficulty, daily }) {
    for (const b of this.el.opts.querySelectorAll('[data-diff]')) b.classList.toggle('on', b.dataset.diff === difficulty);
    this.el.daily.classList.toggle('on', !!daily);
  }
  setLoading(on) { this.el.loading.hidden = !on; }
  setStartVisible(on) { this.el.start.hidden = !on; }
  setPauseVisible(on) { this.el.pause.hidden = !on; }
  setSatchelVisible(on) { this.el.satchel.hidden = !on; }
  setEndVisible(on) { this.el.end.hidden = !on; }
  update(o) { this.el.hurt.style.opacity = (o.hurtFlash * 0.45).toFixed(2); }
  setDebug(text) { this.el.debug.hidden = !text; this.el.debug.textContent = text || ''; }
}
