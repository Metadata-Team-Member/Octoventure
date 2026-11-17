// =====================================================================
//  Tide-and-sun dial (t254u): the one in-play UI element. A small shell-shaped arc
//  in the corner; the sun travels it by day and the moon by night, and a little
//  water line in the cup shows the tide. Hidden during the sea-arrival moment
//  and while any overlay is open. Soft toon look, no numbers.
// =====================================================================
export class Clock {
  constructor(el) {
    this.el = el;
    el.className = 'tide-clock';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <svg viewBox="0 0 72 64" width="72" height="64">
        <defs>
          <clipPath id="tc-cup"><path d="M10 34 C10 54 26 60 36 60 C46 60 62 54 62 34 Q36 42 10 34z"/></clipPath>
        </defs>
        <path class="tc-shell" d="M8 34 C8 16 20 8 36 8 C52 8 64 16 64 34 C64 54 48 62 36 62 C24 62 8 54 8 34z" />
        <path class="tc-arc" d="M12 34 C12 18 22 12 36 12 C50 12 60 18 60 34" />
        <g clip-path="url(#tc-cup)">
          <rect class="tc-tide" x="8" y="30" width="56" height="36" />
        </g>
        <path class="tc-lip" d="M10 34 Q36 42 62 34" />
        <g class="tc-sun"><circle r="5.2" cx="0" cy="0"/><circle class="tc-sun-glow" r="8" cx="0" cy="0"/></g>
        <g class="tc-moon"><circle r="4.6" cx="0" cy="0"/><circle class="tc-moon-cut" r="3.6" cx="2.2" cy="-1.4"/></g>
      </svg>`;
    this.sun = el.querySelector('.tc-sun');
    this.moon = el.querySelector('.tc-moon');
    this.tide = el.querySelector('.tc-tide');
  }
  /** env is Environment; hide when a cinematic or overlay should cover it */
  update(env, hide) {
    const on = !hide;
    if (this.el.hidden !== !on) this.el.hidden = !on;
    if (!on || !env) return;
    const t = ((env.t % 1) + 1) % 1;
    const isDay = t >= 0.25 && t < 0.75;
    const u = isDay ? (t - 0.25) / 0.5 : (t >= 0.75 ? (t - 0.75) / 0.5 : (t + 0.25) / 0.5);
    const ang = Math.PI * (1 - u);
    const x = 36 + Math.cos(ang) * 24, y = 34 - Math.sin(ang) * 22;
    this.sun.setAttribute('transform', `translate(${x} ${y})`);
    this.moon.setAttribute('transform', `translate(${x} ${y})`);
    this.sun.style.opacity = isDay ? '1' : '0';
    this.moon.style.opacity = isDay ? '0' : '1';
    const range = Math.max(0.01, env.world ? (env.constructor /* unused */) : 0.45);
    // env.tide is metres ±tideRange; fall back to a gentle sin if something is off
    const raw = Number.isFinite(env.tide) ? env.tide : 0;
    const n = Math.max(0, Math.min(1, (raw / 0.45 + 1) / 2));
    this.tide.setAttribute('y', String(46 - n * 18));
    void range;
  }
}
