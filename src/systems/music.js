// Soft generative music (no samples, no extra libraries).
// One Web Audio graph, built once on the first gesture and reused:
//   three drone voices (root + a second tone) that follow the loudest biomes in the blend,
//   a small pool of always-on pluck voices for a slow pentatonic motif,
//   two tension tones that only rise while a predator is actually hunting,
//   one lowpass that closes at night and again in water.
// A place that has faded out is dropped, so silent biomes do not keep an oscillator.
// Continuous levels are written straight onto the nodes (no per-frame automation events,
// no per-frame allocations). The satchel ducks this bus; it keeps its own bed.
import { BIOMES } from '../world/biomes.js';
import { damp, lerp } from '../util/rng.js';

const N = BIOMES.length;
const VOICES = 3;
// Just pentatonic (1, 9/8, 5/4, 3/2, 5/3) above a cosy root, one register per place.
export const ROOT = {
  suburb: 261.63, town: 293.66, farm: 196.0, bush: 220.0,
  riverbank: 246.94, wetland: 174.61, dunes: 329.63, beach: 392.0,
  headland: 220.0, estuary: 233.08, sea: 130.81, desert: 146.83, rainforest: 196.0,
};
const PENT = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
// How often the little tune speaks, and what the second drone is.
// ratio 1.5 is a warm fifth; 2 is a hollow octave. wobble is a slow breath, not a tremolo.
export const MOOD = {
  suburb:     { fifth: 'triangle', ratio: 1.5, wob: 0.16, depth: 0.07, dens: 0.72 },
  town:       { fifth: 'sine',     ratio: 2,   wob: 0.05, depth: 0.04, dens: 0.42 },
  farm:       { fifth: 'sine',     ratio: 1.5, wob: 0.09, depth: 0.11, dens: 0.55 },
  bush:       { fifth: 'triangle', ratio: 1.5, wob: 0.22, depth: 0.09, dens: 0.62 },
  riverbank:  { fifth: 'sine',     ratio: 1.5, wob: 0.34, depth: 0.06, dens: 0.78 },
  wetland:    { fifth: 'sine',     ratio: 1.5, wob: 0.12, depth: 0.14, dens: 0.48 },
  dunes:      { fifth: 'sine',     ratio: 2,   wob: 0.07, depth: 0.05, dens: 0.32 },
  beach:      { fifth: 'triangle', ratio: 1.5, wob: 0.18, depth: 0.10, dens: 0.58 },
  headland:   { fifth: 'sine',     ratio: 1.5, wob: 0.05, depth: 0.03, dens: 0.38 },
  estuary:    { fifth: 'triangle', ratio: 1.5, wob: 0.28, depth: 0.08, dens: 0.60 },
  sea:        { fifth: 'sine',     ratio: 2,   wob: 0.10, depth: 0.18, dens: 0.28 },
  desert:     { fifth: 'sine',     ratio: 1.5, wob: 0.04, depth: 0.02, dens: 0.26 },
  rainforest: { fifth: 'triangle', ratio: 1.5, wob: 0.25, depth: 0.13, dens: 0.84 },
};
const SCALE = new Float32Array(N * 5);
const RATIO = new Float32Array(N);
const WOB = new Float32Array(N);
const DEPTH = new Float32Array(N);
const DENS = new Float32Array(N);
const FIFTH_TYPE = new Array(N);
for (let i = 0; i < N; i++) {
  const name = BIOMES[i];
  const mood = MOOD[name] || MOOD.bush;
  const root = ROOT[name] || 220;
  for (let k = 0; k < 5; k++) SCALE[i * 5 + k] = root * PENT[k];
  RATIO[i] = mood.ratio;
  WOB[i] = mood.wob;
  DEPTH[i] = mood.depth;
  DENS[i] = mood.dens;
  FIFTH_TYPE[i] = mood.fifth;
}
// A short walking tune. Degrees into the pentatonic, not a random scramble.
const MOTIF = [0, 2, 4, 2, 3, 1, 0, 4, 3, 2, 1, 2];
const PLUCKS = 4;

function hunting(state) {
  return state === 'chase' || state === 'attack' || state === 'dive' || state === 'swoop'
    || state === 'pounce' || state === 'stalk' || state === 'carry';
}

export class Music {
  constructor() {
    this.enabled = true;
    this.satchel = false;
    this.audio = null;
    this.ctx = null;
    this.weights = new Float32Array(N);
    this.taken = new Uint8Array(N);
    this.slot = [-1, -1, -1];
    this.rankI = [0, 1, 2];
    this.rankW = [0, 0, 0];
    this.hunt = 0;
    this.wet = 0;
    this.t = 0;
    this.next = 0.7;
    this.step = 0;
    this.vi = 0;
    this.oct = -1;
    this.cut = -1;
    this.tenseG0 = 0;
    this.tenseG1 = 0;
  }

  attach(audio) { this.audio = audio; }

  start() {
    const audio = this.audio;
    if (this.sum || !audio?.ctx) return;
    const c = audio.ctx;
    this.ctx = c;
    const sum = c.createGain(); sum.gain.value = 1;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4800; lp.Q.value = 0.45;
    const out = c.createGain(); out.gain.value = 0;
    sum.connect(lp); lp.connect(out); out.connect(audio.master);
    this.sum = sum; this.lp = lp; this.out = out;

    const voice = (type, freq) => {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = freq;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(sum); o.start();
      return { o, g };
    };
    this.voices = new Array(VOICES);
    for (let i = 0; i < VOICES; i++) {
      const root = voice('sine', 220);
      root.o.detune.value = 4 + i * 3;
      this.voices[i] = { root, fifth: voice('sine', 330) };
    }
    this.plucks = new Array(PLUCKS);
    for (let i = 0; i < PLUCKS; i++) this.plucks[i] = voice('triangle', 440);
    // Quiet unease: a low octave and a narrow second. Silent until something is hunting.
    this.tenseLo = voice('sine', 98);
    this.tenseHi = voice('sine', 277);
    this.applyLevel();
  }

  toggle() {
    this.enabled = !this.enabled;
    this.applyLevel();
    return this.enabled;
  }

  setSatchel(open) {
    this.satchel = !!open;
    this.applyLevel();
  }

  applyLevel() {
    if (!this.out) return;
    const on = this.enabled && !this.satchel;
    this.out.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, on ? 0.45 : 0.18);
  }

  tune(v, bi, oct) {
    const base = SCALE[bi * 5] * oct;
    v.root.o.frequency.value = base;
    v.fifth.o.frequency.value = base * RATIO[bi];
    if (v.fifth.o.type !== FIFTH_TYPE[bi]) v.fifth.o.type = FIFTH_TYPE[bi];
  }

  update(dt, game) {
    if (!this.sum) {
      if (game.audio?.ctx) { this.audio = game.audio; this.start(); }
      if (!this.sum) return;
    }
    const o = game.octopus, world = game.world;
    if (!o || !world) return;
    const w = world.biomeWeights(o.x, o.z, this.weights);
    const night = world.night || 0;
    const swim = o.swim || 0;
    const wetTarget = o.waterKind ? (swim > 0.5 ? 1 : 0.62) : 0;
    this.wet = damp(this.wet, wetTarget, 1.7, dt);
    this.hunt = damp(this.hunt, this.huntLevel(game.predators?.list, o), 1.15, dt);
    this.t += dt;

    const oct = 1 / (1 + night * 0.85);
    const pad = (0.02 * (0.78 + 0.22 * (1 - night))) * (1 - this.wet * 0.28) * (1 - this.hunt * 0.22);
    const fifthMul = 0.42 + 0.28 * (1 - night);
    const tuneFreq = Math.abs(oct - this.oct) > 0.0015;
    if (tuneFreq) this.oct = oct;

    let a = 0, b = 0, c = 0, aw = -1, bw = -1, cw = -1, dens = 0;
    for (let i = 0; i < N; i++) {
      const wi = w[i];
      dens += wi * DENS[i];
      if (wi > aw) { c = b; cw = bw; b = a; bw = aw; a = i; aw = wi; }
      else if (wi > bw) { c = b; cw = bw; b = i; bw = wi; }
      else if (wi > cw) { c = i; cw = wi; }
    }
    const rankI = this.rankI, rankW = this.rankW;
    rankI[0] = a; rankI[1] = b; rankI[2] = c;
    rankW[0] = aw; rankW[1] = bw; rankW[2] = cw;

    const taken = this.taken;
    taken.fill(0);
    for (let s = 0; s < VOICES; s++) {
      const bi = this.slot[s];
      let keep = false;
      if (bi >= 0) {
        for (let k = 0; k < VOICES; k++) if (rankI[k] === bi && rankW[k] > 0.004) keep = true;
      }
      if (keep) taken[bi] = 1;
      else {
        if (bi >= 0) { this.voices[s].root.g.gain.value = 0; this.voices[s].fifth.g.gain.value = 0; }
        this.slot[s] = -1;
      }
    }
    for (let s = 0; s < VOICES; s++) {
      if (this.slot[s] >= 0) continue;
      for (let k = 0; k < VOICES; k++) {
        const bi = rankI[k];
        if (rankW[k] <= 0.004 || taken[bi]) continue;
        this.slot[s] = bi;
        taken[bi] = 1;
        this.tune(this.voices[s], bi, oct);
        break;
      }
    }

    const t = this.t;
    for (let s = 0; s < VOICES; s++) {
      const bi = this.slot[s];
      const v = this.voices[s];
      if (bi < 0) {
        if (v.root.g.gain.value !== 0) { v.root.g.gain.value = 0; v.fifth.g.gain.value = 0; }
        continue;
      }
      if (tuneFreq) this.tune(this.voices[s], bi, oct);
      const wob = 1 + DEPTH[bi] * Math.sin(t * WOB[bi] + bi);
      const wi = w[bi];
      v.root.g.gain.value = wi * pad * wob;
      v.fifth.g.gain.value = wi * pad * fifthMul * wob;
    }

    const cut = lerp(lerp(5200, 980, night), 640, this.wet);
    if (Math.abs(cut - this.cut) > 12) { this.cut = cut; this.lp.frequency.value = cut; }

    const huntingNow = this.hunt > 0.004 || this.tenseG0 > 0.0004;
    if (huntingNow) {
      const root = SCALE[a * 5] * oct;
      const pulse = 0.62 + 0.38 * Math.sin(t * (1.6 + this.hunt * 3.2));
      this.tenseLo.o.frequency.value = root * 0.5;
      this.tenseHi.o.frequency.value = root * (16 / 15);
      this.tenseG0 = this.hunt * 0.03 * pulse;
      this.tenseG1 = this.hunt * 0.016 * pulse;
      this.tenseLo.g.gain.value = this.tenseG0;
      this.tenseHi.g.gain.value = this.tenseG1;
    } else if (this.tenseG0 || this.tenseG1) {
      this.tenseG0 = this.tenseG1 = 0;
      this.tenseLo.g.gain.value = 0;
      this.tenseHi.g.gain.value = 0;
    }

    const interval = lerp(0.92, 2.2, night) * lerp(1.4, 0.72, dens) * lerp(1, 0.78, this.hunt);
    this.next -= dt;
    if (this.next <= 0 && this.enabled && !this.satchel) {
      this.next = interval;
      const useSecond = bw > 0.18 && Math.random() < bw * 0.8;
      const bi = useSecond ? b : a;
      const deg = MOTIF[this.step % MOTIF.length];
      this.step++;
      let freq = SCALE[bi * 5 + deg] * oct;
      if (night < 0.35 && (this.step % 9) === 0) freq *= 2;
      const vol = 0.034 * (1 - night * 0.62) * (1 - this.wet * 0.45) * (0.85 + aw * 0.3);
      this.blip(freq, vol);
    } else if (this.next <= 0) this.next = interval;
  }

  huntLevel(list, o) {
    if (!list) return 0;
    let h = 0;
    const ox = o.x, oz = o.z;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!hunting(p.state)) continue;
      const dx = p.x - ox, dz = p.z - oz;
      const d = Math.hypot(dx, dz);
      const k = d >= 50 ? 0 : 1 - d / 50;
      if (k > h) h = k;
    }
    return h;
  }

  blip(freq, vol) {
    const v = this.plucks[this.vi];
    this.vi++; if (this.vi === PLUCKS) this.vi = 0;
    const t = this.ctx.currentTime;
    v.o.frequency.setValueAtTime(freq, t);
    const g = v.g.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.045);
    g.exponentialRampToValueAtTime(0.0001, t + 1.7);
  }
}
