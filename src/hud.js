import { CONFIG, TERRAIN } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), bar: $('bar-health'), num: $('health-num'), camo: $('bar-camo'), camoNote: $('camo-note'), terrain: $('terrain'),
      timer: $('timer'), toasts: $('toasts'), danger: $('danger'), hurt: $('hurt'), debug: $('debug'),
      start: $('start'), end: $('end'), endTitle: $('end-title'), endText: $('end-text'), endStats: $('end-stats'), loading: $('loading'),
      play: $('play'), restart: $('restart'), retry: $('retry'), seedline: $('seedline'),
    };
    this.lastToast = {};
  }
  show(on) { this.el.hud.hidden = !on; }
  setLoading(on) { this.el.loading.hidden = !on; }
  setStartVisible(on) { this.el.start.hidden = !on; }
  setEndVisible(on) { this.el.end.hidden = !on; }

  toast(msg, kind = '', key = msg, cooldown = 4) {
    const now = performance.now() / 1000;
    if (now - (this.lastToast[key] || -99) < cooldown) return;
    this.lastToast[key] = now;
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = msg;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 3300);
  }

  update(o, timeSec, threat) {
    const max = CONFIG.octopus.maxHealth;
    const pct = Math.max(0, Math.min(1, o.health / max));
    this.el.bar.style.width = (pct * 100).toFixed(1) + '%';
    this.el.bar.className = 'fill' + (o.health < CONFIG.octopus.lowHealthWarn ? ' low' : o.health < 55 ? ' mid' : '');
    this.el.num.textContent = Math.ceil(o.health) + (o.waterKind ? '  ▲ rehydrating' : '');
    const cp = o.energy / CONFIG.camo.maxEnergy;
    this.el.camo.style.width = (cp * 100).toFixed(1) + '%';
    this.el.camo.className = 'fill camo' + (o.camoLocked ? ' locked' : '');
    this.el.camoNote.textContent = o.camoLocked ? 'recharging…' : o.camoActive ? 'hidden' : o.camoWanted ? 'blending…' : cp < 0.99 ? 'recovering' : 'ready';
    const T = TERRAIN[o.terrain];
    this.el.terrain.textContent = `${T.name} · speed ×${T.speed.toFixed(2)} · dries ×${T.dry.toFixed(2)}`;
    this.el.terrain.style.color = T.dry >= 1.5 ? '#ffb28a' : T.dry <= 0.75 ? '#9ff0d8' : '#ffffff';
    const m = Math.floor(timeSec / 60), s = Math.floor(timeSec % 60);
    this.el.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    this.el.danger.style.opacity = Math.min(1, threat * 1.2 + (o.health < CONFIG.octopus.lowHealthWarn && o.alive ? 0.25 + 0.15 * Math.sin(performance.now() / 180) : 0)).toFixed(2);
    this.el.hurt.style.opacity = (o.hurtFlash * 0.8).toFixed(2);
  }
  setDebug(text) { this.el.debug.hidden = !text; this.el.debug.textContent = text || ''; }
}
