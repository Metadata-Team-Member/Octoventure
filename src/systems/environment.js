// =====================================================================
//  Environment - the passage of time. No three.js in here (pure + testable).
//  - day / night cycle (sun height, daylight, night) and the drying multiplier it causes
//  - weather: clear / heatwave / rain / storm (storms leave temporary puddles)
//  - dawn dew patches, tides (moves world.seaLevel) and wind gusts
//  It writes its results onto the WorldData (`world.dryMult`, `world.night`, `world.seaLevel`,
//  `world.gates`, `world.temp`) so the octopus / predators / views only need the world.
// =====================================================================
import { CONFIG } from '../config.js';
import { mulberry32, clamp, smoothstep as ss, damp } from '../util/rng.js';

export const WEATHER = {
  clear:    { heat: 0, rain: 0, dark: 0 },
  heatwave: { heat: 1, rain: 0, dark: 0 },
  rain:     { heat: 0, rain: 0.55, dark: 0.35 },
  storm:    { heat: 0, rain: 1, dark: 0.7 },
};

export class Environment {
  constructor(world, opts = {}) {
    this.world = world;
    const E = CONFIG.env;
    this.rnd = mulberry32((world.seed ^ 0x51ed270b) >>> 0);
    this.t = opts.startTime ?? E.startTime;      // 0..1 of a day (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset)
    this.abs = 0;                                // seconds since the run began
    this.kind = 'clear'; this.target = 'clear'; this.timer = E.firstWeatherAfter;
    this.heat = 0; this.rain = 0; this.dark = 0; // smoothed intensities 0..1
    this.gust = 0; this.nextGust = 20 + this.rnd() * 20; this.gustT = 0;
    this.lightning = 0; this.nextBolt = 6;
    this.stormBirds = false;
    this.spawnT = 0;
    this.frozen = false;                         // tests can freeze the clock
    this.apply();
  }

  // ---- derived values -------------------------------------------------------------------
  /** sun elevation: 0 at the horizon / night, 1 at noon */
  get sunHeight() { return Math.max(0, Math.sin((this.t - 0.25) * Math.PI * 2)); }
  /** signed sun elevation (negative = below the horizon) */
  get sunElev() { return Math.sin((this.t - 0.25) * Math.PI * 2); }
  get daylight() { return ss(-0.08, 0.35, this.sunElev); }
  get night() { return 1 - ss(-0.25, 0.08, this.sunElev); }
  /** 0..1, only around sunrise: dew sits on the grass */
  get dew() { const t = this.t; return ss(0.2, 0.26, t) * (1 - ss(0.3, 0.4, t)); }
  /** hour of day 0..24 (for tests / debug only) */
  get hour() { return this.t * 24; }
  /** how much faster / slower than normal the octopus dries right now */
  get dryMult() {
    const sun = 0.55 + 0.8 * Math.pow(this.sunHeight, 0.7);
    return sun * (1 + CONFIG.env.heatDryBonus * this.heat) * (1 - 0.25 * this.rain);
  }
  get tide() { if (this.tideOverride != null) return this.tideOverride; const E = CONFIG.env; return E.tideRange * Math.sin((this.abs / E.tidePeriod) * Math.PI * 2 + 0.6); }
  /** is the sky actively raining right now? */
  get raining() { return this.rain > 0.25; }
  get storming() { return this.kind === 'storm' && this.rain > 0.5; }

  setWeather(kind) { this.target = kind; this.timer = CONFIG.env.weatherMin + this.rnd() * (CONFIG.env.weatherMax - CONFIG.env.weatherMin); }

  pickWeather() {
    const r = this.rnd();
    let k = r < 0.38 ? 'clear' : r < 0.58 ? 'heatwave' : r < 0.80 ? 'rain' : 'storm';
    if (k === 'heatwave' && this.daylight < 0.3) k = 'clear';
    if (k === this.target) k = 'clear';
    this.setWeather(k);
  }

  update(dt) {
    const E = CONFIG.env;
    if (!this.frozen) {
      this.t = (this.t + dt / E.dayLength) % 1;
      this.abs += dt;
    }
    this.timer -= dt;
    if (this.timer <= 0) this.pickWeather();
    const W = WEATHER[this.target];
    this.heat = damp(this.heat, W.heat, 0.5, dt);
    this.rain = damp(this.rain, W.rain, 0.6, dt);
    this.dark = damp(this.dark, W.dark, 0.5, dt);
    this.kind = this.heat > 0.5 ? 'heatwave' : this.rain > 0.75 ? 'storm' : this.rain > 0.2 ? 'rain' : 'clear';

    // wind gusts (blow from the sea; carry salt specks)
    this.nextGust -= dt;
    if (this.nextGust <= 0) { this.gustT = 5 + this.rnd() * 3; this.nextGust = 22 + this.rnd() * 30; this.gustLen = this.gustT; }
    if (this.gustT > 0) { this.gustT -= dt; this.gust = Math.sin(Math.PI * clamp(1 - this.gustT / this.gustLen, 0, 1)); } else this.gust = damp(this.gust, 0, 3, dt);

    // lightning
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    this.boltEvent = false;
    if (this.storming) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.lightning = 1; this.boltEvent = true; this.nextBolt = 5 + this.rnd() * 9; }
    }

    this.apply();
  }

  /** push results onto the world */
  apply() {
    const w = this.world;
    w.dryMult = this.dryMult;
    w.night = this.night;
    w.seaLevel = this.tide;
    w.gates.dew = this.dew;
    w.gates.wet = this.rain;
    w.weatherKind = this.kind;
    w.gust = this.gust;
    w.raining = this.raining;
  }

  /** storms: leave temporary puddles around `p`, then let them age / shrink away */
  updatePuddles(dt, p) {
    const w = this.world, E = CONFIG.env;
    for (let i = w.temp.length - 1; i >= 0; i--) {
      const q = w.temp[i];
      q.age += dt;
      const left = q.life - q.age;
      q.grow = clamp(q.age / 4, 0, 1) * clamp(left / 20, 0, 1);
      if (left <= 0) w.temp.splice(i, 1);
    }
    if (this.rain > 0.35 && p) {
      this.spawnT -= dt;
      const rate = this.rain > 0.8 ? 0.35 : 1.1;           // storms flood the ground quickly
      while (this.spawnT <= 0) {
        this.spawnT += rate;
        if (w.temp.length >= E.maxTempPuddles) break;
        const a = this.rnd() * 6.283, d = 5 + Math.sqrt(this.rnd()) * 70;
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (this.rnd() < w.harshAt(x, z) * 0.7) continue;           // far inland the storms leave fewer puddles
        const h = w.heightAt(x, z);
        if (h < 0.5 || w.tAt(x, z) > 0.95 || w._blocked(x, z, 0.5)) continue;
        w.temp.push({ kind: 'storm', x, z, r: 1.6 + this.rnd() * 1.8, H: h, age: 0, life: E.puddleLife + this.rnd() * 60, grow: 0 });
      }
    }
  }
}
