// Procedural WebAudio sound-scape (no audio files). Starts on first user input.
//  - per-biome ambient layers (hum, wind, creek babble, surf ...) driven by Atmosphere.ambient
//  - positional (3D) creature sounds: gulls, magpie warble, kookaburra laugh, barks, car engine & horn
//  - squelchy wet footsteps, heartbeat when nearly dry, ink / bite / chime effects
import { CONFIG } from './config.js';
import { clamp, lerp } from './util/rng.js';

const R = () => Math.random();      // audio-only randomness: never affects the world

export class GameAudio {
  constructor() { this.ctx = null; this.muted = false; this.nextGull = 3; this.t = 0; this.timers = {}; this.log = []; this.last = {}; this.croakBeat = 0; }

  start() {
    if (this.ctx || !CONFIG.audio.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = CONFIG.audio.volume;
      // t246u: everything passes through one lowpass that closes when the octopus goes under (muffled underwater world)
      this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 18000; this.lp.Q.value = 0.5;
      this.master.connect(this.lp); this.lp.connect(c.destination); this.under = false;
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = R() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 6; }
      this.noiseBuf = buf;
      const mk = (freq, q, type) => {
        const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = c.createGain(); g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(this.master); src.start();
        return { src, f, g };
      };
      this.wind = mk(420, 0.7, 'lowpass');
      this.surf = mk(700, 0.4, 'lowpass');
      this.hum = mk(150, 1.2, 'lowpass');
      this.babble = mk(1250, 2.2, 'bandpass');
      // car engine (positional)
      this.engine = { o: c.createOscillator(), f: c.createBiquadFilter(), g: c.createGain(), p: this.panner(0, 0, 0) };
      this.engine.o.type = 'sawtooth'; this.engine.o.frequency.value = 62; this.engine.f.type = 'lowpass'; this.engine.f.frequency.value = 420; this.engine.g.gain.value = 0;
      this.engine.o.connect(this.engine.f); this.engine.f.connect(this.engine.g); this.engine.g.connect(this.engine.p); this.engine.o.start();
    } catch (e) { this.ctx = null; }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : CONFIG.audio.volume; return this.muted; }

  /** a 3D panner at a world position, wired to the master bus */
  panner(x, y, z) {
    const c = this.ctx, p = c.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 9; p.rolloffFactor = 1.35; p.maxDistance = 400;
    this.setPos(p, x, y, z); p.connect(this.master);
    return p;
  }
  setPos(p, x, y, z) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  }
  /** keep the WebAudio listener on the camera so sounds pan and fade with distance */
  setListener(cam) {
    const L = this.ctx.listener, p = cam.position, f = cam.getWorldDirection(this._f ??= cam.position.clone());
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  /**
   * ctx: { coast 0..1, ambient {hum,birds,wind,cows,babble,frogs,surf,gulls}, cam (THREE camera), health, moving, swim, night,
   *        car {dist,x,y,z,horn,speed}|null, sprint }
   */
  update(dt, k) {
    if (!this.ctx) return;
    this.t += dt;
    const c = this.ctx, now = c.currentTime, A = k.ambient || {};
    if (k.cam) this.setListener(k.cam);
    const gate = CONFIG.hints.gullSounds ? 1 : 0;
    const under = k.swim > 0.5 ? 0.45 : 1;                  // muffled under water
    const sub = (k.swim ?? 0) > 0.5;
    if (sub !== this.under) { this.under = sub; this.lp.frequency.setTargetAtTime(sub ? 750 : 18000, now, sub ? 0.08 : 0.18); if (sub) this.submerge(); else this.surface(); }
    const coast = k.coast ?? 0;
    this.wind.g.gain.setTargetAtTime((0.035 + 0.05 * Math.sin(this.t * 0.3) ** 2 + 0.08 * (A.wind || 0)) * under, now, 0.4);
    // surf: loud near the coast, also a bed in the coastal biomes
    this.surf.g.gain.setTargetAtTime(gate * (0.02 + 0.22 * coast * coast * (0.7 + 0.3 * Math.sin(this.t * 0.7)) + 0.05 * (A.surf || 0)) * (k.swim > 0.5 ? 1.4 : 1), now, 0.4);
    this.surf.f.frequency.setTargetAtTime(k.swim > 0.5 ? 380 : 700, now, 0.3);
    this.hum.g.gain.setTargetAtTime(0.035 * (A.hum || 0) * under, now, 0.6);
    this.babble.g.gain.setTargetAtTime(0.045 * (A.babble || 0) * (0.8 + 0.2 * Math.sin(this.t * 3.1)) * under, now, 0.4);
    // scheduled one-shots: gulls, birds, cows, frogs
    const due = (name, every) => { this.timers[name] = (this.timers[name] ?? R() * every) - dt; if (this.timers[name] <= 0) { this.timers[name] = every * (0.6 + R() * 0.9); return true; } return false; };
    if (gate && due('gull', (3 + R() * 9) * (1.8 - clamp(coast, 0, 1) * 1.3)) && R() < 0.25 + Math.max(coast, A.gulls || 0) * 0.75) this.gull(0.05 + 0.2 * coast * coast + 0.05 * (A.gulls || 0));
    if ((A.birds || 0) > 0.1 && (k.night || 0) < 0.6 && due('bird', 5 / (0.3 + A.birds))) this.chirp(0.05 * A.birds);
    if ((A.cows || 0) > 0.2 && due('cow', 16)) this.moo(0.07 * A.cows);
    if ((A.frogs || 0) > 0.2 && due('frog', 1.6 / (0.4 + A.frogs + (k.night || 0)))) this.croak(0.05 * A.frogs);
    // heartbeat when nearly dry
    const hp = clamp((k.health ?? 100) / 100, 0, 1);
    if (hp < 0.25 && hp > 0) {
      this.timers.heart = (this.timers.heart ?? 0) - dt;
      if (this.timers.heart <= 0) { this.timers.heart = lerp(0.45, 1.05, hp / 0.25); this.heartbeat(0.2 + 0.25 * (1 - hp / 0.25)); }
    }
    // car engine + horn (positional)
    const car = k.car, e = this.engine;
    if (car) {
      this.setPos(e.p, car.x, car.y ?? 0, car.z);
      e.g.gain.setTargetAtTime(0.5 * clamp(1 - car.dist / 90, 0, 1), now, 0.15);
      e.o.frequency.setTargetAtTime(48 + (car.speed || 10) * 3.2, now, 0.3);
      if (car.horn && due('horn', 1.4)) this.horn(car.x, car.y ?? 0, car.z);
    } else e.g.gain.setTargetAtTime(0, now, 0.2);
  }

  // ------------------------------------------------------------ primitives
  tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0, dest = null) {
    if (!this.ctx || this.muted) return;
    this.note('tone');
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(0.02, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise(dur, freq, vol = 0.2, dest = null, q = 0.8, delay = 0) {
    if (!this.ctx || this.muted) return;
    this.note('noise');
    const c = this.ctx, t0 = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.master); s.start(t0, R()); s.stop(t0 + dur);
  }
  /** shaped noise burst with a soft attack (no click): type lowpass/highpass/bandpass */
  swish(dur, freq, vol, type = 'bandpass', q = 0.7, attack = 0.012, delay = 0, freqEnd = 0) {
    if (!this.ctx || this.muted) return;
    this.note('noise');
    const c = this.ctx, t0 = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t0, R() * 1.5); s.stop(t0 + dur + 0.02);
  }
  /** bubbles: short sine blips that glide UP in pitch (how a real bubble sounds), scattered over `span` seconds */
  bubbles(n = 6, span = 0.7, vol = 0.03, lo = 380, delay = 0) {
    for (let i = 0; i < n; i++) {
      const f = lo * (1 + R() * 1.4), d = 0.04 + R() * 0.05;
      this.tone(f, d, 'sine', vol * (0.5 + R() * 0.6), f * (0.6 + R() * 0.8), delay + R() * span);
    }
  }
  note(kind) { this.count = (this.count || 0) + 1; }
  at(x, y, z) { const p = this.panner(x, y, z); setTimeout(() => { try { p.disconnect(); } catch (e) { /* gone */ } }, 4000); return p; }

  // ------------------------------------------------------------ ambient one-shots
  gull(v = 0.1, pos = null) { const d = pos ? this.at(pos.x, pos.y, pos.z) : null; for (let i = 0; i < 2 + Math.floor(R() * 2); i++) this.tone(1500 + R() * 300, 0.32, 'sawtooth', v, -700, i * 0.34, d); }
  chirp(v = 0.05) { const d = this.at(this.listenerNear(35).x, 6, this.listenerNear(35).z); const f = 2200 + R() * 1400; for (let i = 0; i < 3; i++) this.tone(f + i * 150, 0.09, 'sine', v, 500, i * 0.11, d); }
  moo(v = 0.07) { const p = this.listenerNear(60); const d = this.at(p.x, 1, p.z); this.tone(150, 1.4, 'sawtooth', v * 0.6, -45, 0, d); this.tone(160, 1.3, 'triangle', v, -40, 0.05, d); }
  croak(v = 0.05) { this.croakBeat++; const p = this.listenerNear(30); const d = this.at(p.x, 0.5, p.z); for (let i = 0; i < 3; i++) this.tone(260 + R() * 60, 0.08, 'square', v, -90, i * 0.1, d); }
  listenerNear(r) { const l = this.ctx.listener, x = l.positionX ? l.positionX.value : 0, z = l.positionZ ? l.positionZ.value : 0, a = R() * 6.28; return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r }; }

  // ------------------------------------------------------------ creatures (positional)
  magpie(x, y, z) { const d = this.at(x, y, z); [0, 0.14, 0.3, 0.42, 0.6].forEach((t, i) => this.tone(1250 + (i % 2) * 380 + i * 40, 0.16, 'sine', 0.13, i % 2 ? -250 : 280, t, d)); }
  kookaburra(x, y, z) { const d = this.at(x, y, z); [0, 0.2, 0.4].forEach((t) => this.tone(760, 0.17, 'triangle', 0.14, 120, t, d)); for (let i = 0; i < 6; i++) this.tone(900 - i * 45, 0.11, 'sawtooth', 0.09, -260, 0.75 + i * 0.13, d); }
  creature(kind, x, y, z) {
    if (!this.ctx) return;
    const d = this.at(x, y, z);
    switch (kind) {
      case 'dog': this.noise(0.16, 520, 0.4, d); this.tone(200, 0.2, 'sawtooth', 0.14, -70, 0, d); this.noise(0.16, 520, 0.4, d, 0.8, 0.28); this.tone(190, 0.2, 'sawtooth', 0.14, -70, 0.28, d); break;
      case 'cat': this.noise(0.55, 5200, 0.3, d, 1.4); this.tone(420, 0.4, 'sawtooth', 0.05, 200, 0.05, d); break;
      case 'fox': this.tone(950, 0.18, 'sawtooth', 0.12, -380, 0, d); this.tone(900, 0.2, 'sawtooth', 0.1, -350, 0.25, d); break;
      case 'human': this.tone(210, 0.4, 'sawtooth', 0.12, 80, 0, d); this.noise(0.3, 900, 0.1, d); break;
      case 'eagle': this.tone(2300, 0.7, 'sawtooth', 0.13, -1300, 0, d); break;
      case 'crab': for (let i = 0; i < 3; i++) this.noise(0.04, 2600, 0.25, d, 3, i * 0.07); break;
      case 'gull': this.gull(0.16, { x, y, z }); break;
      case 'magpie': this.magpie(x, y, z); break;
      case 'kookaburra': this.kookaburra(x, y, z); break;
      default: this.tone(520, 0.12, 'square', 0.08, 0, 0, d); this.tone(780, 0.16, 'square', 0.08, 0, 0.1, d);
    }
  }
  horn(x, y, z) { const d = this.at(x, y, z); this.tone(440, 0.55, 'square', 0.16, 0, 0, d); this.tone(349, 0.55, 'square', 0.14, 0, 0, d); }
  carHit() { this.noise(0.4, 140, 0.5); this.tone(90, 0.5, 'sawtooth', 0.3, -50); }

  // ------------------------------------------------------------ the octopus
  /** a gentle, occasional wet squelch under a damp octopus (called at most every ~2-5 s; no chirp, nothing loops) */
  step(wet = 0.5, speed = 5) { const v = 0.025 + 0.045 * clamp(wet, 0, 1); this.noise(0.22, 240 + R() * 90, v, null, 0.6); this.tone(105 + R() * 25, 0.2, 'sine', v * 0.4, -25, 0.02); }
  /** a low thud through the ground when something big walks past (amp 0..1.3) */
  thump(amp, x, y, z) { if (!this.ctx) return; const d = this.at(x, y, z); this.tone(52 + 20 * Math.min(1, amp), 0.16, 'sine', Math.min(0.5, 0.12 + amp * 0.32), -30, 0, d); this.noise(0.1, 140, Math.min(0.3, amp * 0.2), d, 0.8); }
  heartbeat(v = 0.25) { this.tone(62, 0.13, 'sine', v); this.tone(52, 0.16, 'sine', v * 0.8, 0, 0.17); }
  ink() { this.noise(0.6, 800, 0.22); this.tone(210, 0.4, 'sine', 0.12, -120); this.tone(330, 0.2, 'sine', 0.08, -150, 0.05); }
  /** venomous bite: a hard beak crunch and a wet hiss of venom */
  bite() { if (!this.ctx) return; this.swish(0.05, 2600, 0.16, 'bandpass', 2.2, 0.003); this.swish(0.06, 1700, 0.12, 'bandpass', 2.5, 0.003, 0.05); this.swish(0.45, 5200, 0.05, 'highpass', 0.6, 0.04, 0.06, 3000); this.tone(220, 0.18, 'triangle', 0.05, -90, 0.02); }
  /** beak bite: a quick double click of the beak (crisper when it connects) */
  snap(hit = false) { if (!this.ctx) return; this.swish(0.035, 3200, hit ? 0.14 : 0.07, 'bandpass', 3, 0.002); this.swish(0.03, 2400, hit ? 0.12 : 0.05, 'bandpass', 3, 0.002, 0.045); if (hit) this.tone(180, 0.09, 'triangle', 0.05, -60, 0.01); }
  /** a predator bitten to death: a yelp/squawk that drops away, then a soft thud as it falls (bigger animals land heavier) */
  kill(x, y, z, tier = 2) {
    if (!this.ctx) return; const d = this.at(x, y, z), f = 900 - tier * 140;
    this.tone(f, 0.35, 'sawtooth', 0.05, -f * 0.6, 0, d); this.tone(f * 1.5, 0.25, 'sine', 0.04, -f * 0.9, 0.03, d);
    this.tone(70 + 30 / tier, 0.22, 'sine', 0.08 + tier * 0.03, -25, 0.62, d); this.noise(0.12, 200, 0.05 + tier * 0.02, d, 0.8, 0.62);
  }
  climb() { this.noise(0.5, 1800, 0.1, null, 1.5); }
  squeeze() { this.noise(0.5, 500, 0.18); this.tone(120, 0.4, 'sine', 0.1, 60); }
  grab() { this.noise(0.25, 260, 0.35); this.tone(130, 0.3, 'sawtooth', 0.14, -60); }
  /** the quiet reward when a baby octopus is found */
  chime(x, y, z) { const d = x != null ? this.at(x, y, z) : null; [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 1.1, 'sine', 0.085, 0, i * 0.13, d)); this.tone(523, 1.6, 'sine', 0.05, 0, 0, d); }
  /** brushing a flower: a soft leafy rustle, and when dew falls a faint two-note glint */
  flower(x, y, z, dew) { if (!this.ctx) return; const d = this.at(x, y, z); this.noise(0.28, 3400, 0.05, d, 0.9); if (dew) { this.tone(1760, 0.5, 'sine', 0.035, 0, 0.05, d); this.tone(2349, 0.6, 'sine', 0.028, 0, 0.17, d); } }
  /** a faint little bubbling blip from a hidden baby octopus close by */
  /** a soft pluck when something small is taken; a pair of notes for a craft; a low knock for putting something on / eating it */
  gather(x, y, z) { if (!this.ctx) return; const d = x != null ? this.at(x, y, z) : null; this.tone(540 + Math.random() * 160, 0.1, 'sine', 0.035, -180, 0, d); }
  /** level-up (t242u): a rising shimmer of soft bells */
  levelUp() { if (!this.ctx) return; [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, 0.9, 'sine', 0.055, 0, i * 0.085)); this.tone(392, 1.6, 'triangle', 0.035, 0, 0); this.noise(0.9, 6500, 0.025, null, 1.6, 0.05); }
  /** a badge: two warm bell notes */
  badge() { if (!this.ctx) return; this.tone(1319, 0.8, 'sine', 0.05, 0, 0); this.tone(1760, 1.1, 'sine', 0.045, 0, 0.16); this.tone(659, 1.2, 'triangle', 0.025, 0, 0); }
  craft() { if (!this.ctx) return; this.tone(523, 0.22, 'sine', 0.05, 0, 0); this.tone(784, 0.3, 'sine', 0.045, 0, 0.09); }
  use(id) { if (!this.ctx) return; this.tone(id === 'feast' || id === 'mussel' || id === 'moss' ? 330 : 196, 0.16, 'triangle', 0.06, 60, 0); this.tone(660, 0.18, 'sine', 0.025, 0, 0.06); }
  babyTell(x, y, z) { if (!this.ctx) return; const d = this.at(x, y, z); this.tone(760, 0.12, 'sine', 0.03, 380, 0, d); this.tone(1020, 0.1, 'sine', 0.022, 300, 0.11, d); }
  /** entering water (t246u: was a hard filtered-noise hit that sounded like a door shutting). Now a soft natural splash:
   *  a bright airy spray (highpass hiss with a gentle attack), a light wet "plip" (a quick upward-gliding sine, like a drop),
   *  and a little string of bubbles. No low thud. Puddles are quieter and shorter than ponds / the sea. */
  splash(kind = 'pond', speed = 4) {
    if (!this.ctx || this.muted) return;
    const small = kind === 'puddle' || kind === 'storm', k = clamp(0.55 + speed / 14, 0.5, 1.1) * (small ? 0.55 : 1);
    this.swish(0.32 * (small ? 0.7 : 1), 5200, 0.06 * k, 'highpass', 0.5, 0.015, 0, 2600);
    this.swish(0.22, 1700, 0.035 * k, 'bandpass', 0.9, 0.01, 0.02, 900);
    this.tone(520 + R() * 120, 0.07, 'sine', 0.035 * k, 700, 0.01);
    this.bubbles(small ? 3 : 7, small ? 0.35 : 0.8, 0.022 * k, 420, 0.08);
  }
  /** going under: a soft whoomp of water closing overhead (lowpassed, gentle attack) and bubbles rising past */
  submerge() { this.swish(0.6, 900, 0.05, 'lowpass', 0.5, 0.06, 0, 300); this.bubbles(8, 1.1, 0.02, 260, 0.05); }
  /** coming back up: a light drip and a breath of air */
  surface() { this.swish(0.25, 3800, 0.03, 'highpass', 0.5, 0.02); this.tone(700 + R() * 200, 0.06, 'sine', 0.025, 600, 0.12); }
  alert() { this.tone(520, 0.12, 'square', 0.08); this.tone(780, 0.16, 'square', 0.08, 0, 0.1); }
  camo(on) { this.tone(on ? 260 : 420, 0.3, 'sine', 0.1, on ? 220 : -200); }
  hurt() { this.noise(0.18, 300, 0.3); this.tone(160, 0.25, 'sawtooth', 0.15, -80); }
  die() { this.tone(300, 0.9, 'triangle', 0.2, -230); }
  /** first time in the sea: a soft swell of surf and a gentle two-note sigh */
  seaArrival() { this.noise(3.2, 600, 0.18); this.tone(392, 2.2, 'sine', 0.07, 0, 0.1); this.tone(587, 2.6, 'sine', 0.06, 0, 0.9);
    // t241u: a soft swell of music - a slow rising chord that hangs in the water
    [196, 294, 392, 494, 587, 784].forEach((f, i) => this.tone(f, 4.2 - i * 0.3, 'sine', 0.035, 0, 0.4 + i * 0.45)); this.tone(98, 5.5, 'triangle', 0.03, 0, 0.2); }
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.18, 0, i * 0.16)); }
  /** satchel: a muffled underwater bed while it is open, a soft plop when something is crafted, a page rustle when a tab turns */
  menuOpen() {
    if (!this.ctx || this._menu) return;
    const c = this.ctx, g = c.createGain(); g.gain.value = 0;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 0.7;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    g.gain.linearRampToValueAtTime(0.045, c.currentTime + 0.6);
    this._menu = { src, g, f };
    this.tone(196, 1.1, 'sine', 0.02, 0, 0); this.tone(247, 1.3, 'sine', 0.016, 0, 0.2);
  }
  menuClose() {
    const m = this._menu; if (!m || !this.ctx) { this._menu = null; return; }
    const t = this.ctx.currentTime;
    m.g.gain.cancelScheduledValues(t); m.g.gain.setValueAtTime(m.g.gain.value, t); m.g.gain.linearRampToValueAtTime(0, t + 0.4);
    setTimeout(() => { try { m.src.stop(); } catch {} }, 450);
    this._menu = null;
  }
  plop() { if (!this.ctx) return; this.tone(280, 0.12, 'sine', 0.06, -160, 0); this.noise(0.12, 900, 0.04, null, 0.8, 0.02); }
  pageFlip() { if (!this.ctx) return; this.noise(0.18, 2600, 0.03, null, 0.9); this.tone(740, 0.08, 'sine', 0.02, -200, 0.02); }
}

