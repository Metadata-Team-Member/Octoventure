// =====================================================================
//  Biomes - the pure (no three.js) description of WHERE each kind of place is.
//
//  Layout idea (inland -> coast, along the secret sea direction `dir`):
//     suburb / town  ->  farm  ->  bushland (eucalypt)  ->  coast
//  with a creek (riverbank) winding through to the estuary, and the coast itself changing
//  along the shoreline in randomly ordered stretches:
//     beach (with dunes behind)  |  mangrove wetland  |  rocky headland  |  estuary (river mouth + jetty)
//  Everything is a smooth blend of weights, so borders are soft (and never a hard seam).
// =====================================================================
import { smoothstep as ss, clamp } from '../util/rng.js';

export const BIOMES = ['suburb', 'town', 'farm', 'bush', 'riverbank', 'wetland', 'dunes', 'beach', 'headland', 'estuary', 'sea'];
export const B = Object.fromEntries(BIOMES.map((n, i) => [n, i]));
export const NB = BIOMES.length;

/** per-biome look & feel: lighting tint, fog thickness and the ambient-sound mix (used by Atmosphere and GameAudio) */
export const BIOME_INFO = {
  suburb:    { label: 'Suburban backyards',  tint: 0xffffff, fog: 1.0,  amb: { hum: 0.5, birds: 0.5 } },
  town:      { label: 'Streets & car park',  tint: 0xe6e8f0, fog: 0.95, amb: { hum: 1.0 } },
  farm:      { label: 'Farmland',            tint: 0xffe9b8, fog: 1.05, amb: { wind: 1.0, birds: 0.6, cows: 1.0 } },
  bush:      { label: 'Eucalypt bushland',   tint: 0xd8efc8, fog: 0.85, amb: { birds: 1.0 } },
  riverbank: { label: 'Creek & riverbank',   tint: 0xcfe8f0, fog: 0.9,  amb: { babble: 1.0, birds: 0.5 } },
  wetland:   { label: 'Wetlands & mangroves', tint: 0xc9dcc0, fog: 0.62, amb: { frogs: 1.0, babble: 0.2 } },
  dunes:     { label: 'Dunes',               tint: 0xfff0c8, fog: 1.1,  amb: { wind: 1.0, surf: 0.5 } },
  beach:     { label: 'Beach',               tint: 0xfffbe6, fog: 1.15, amb: { surf: 1.0, gulls: 0.6 } },
  headland:  { label: 'Rocky headland',      tint: 0xd5dfee, fog: 0.9,  amb: { surf: 1.0, wind: 0.8, gulls: 0.5 } },
  estuary:   { label: 'Estuary & jetty',     tint: 0xd9efee, fog: 0.8,  amb: { gulls: 1.0, babble: 0.5, surf: 0.4 } },
  sea:       { label: 'Open sea',            tint: 0xc4e8f4, fog: 1.0,  amb: { surf: 1.0 } },
};

export const COAST_KINDS = ['beach', 'mangrove', 'headland', 'estuary'];

export class BiomeField {
  /** world: {n (noise), tAt(x,z), lateral(x,z), creekDist(x,z), coast: {segments, period, shift}} */
  constructor(world) {
    this.world = world;
    this._w = new Float32Array(NB);
    this._ck = new Float32Array(4);
  }

  /** soft weights of the four coastal stretches at lateral position u (periodic) */
  coastKinds(u, out = this._ck) {
    const c = this.world.coast;
    let p = (u - c.shift) % c.period; if (p < 0) p += c.period;
    out.fill(0);
    const e = 55;     // blend width
    for (const s of c.segments) {
      for (const off of [-c.period, 0, c.period]) {
        const a = s.a + off, b = s.b + off;
        if (p < a - e || p > b + e) continue;
        out[s.kind] += ss(a - e, a + e, p) - ss(b - e, b + e, p);
      }
    }
    let sum = out[0] + out[1] + out[2] + out[3];
    if (sum < 1e-4) { out[0] = 1; sum = 1; }
    for (let i = 0; i < 4; i++) out[i] /= sum;
    return out;
  }

  /** normalised weights (sum 1) of every biome at x,z. The returned array is reused - copy it if you keep it. */
  weights(x, z, w = this._w) {
    const W = this.world, n = W.n;
    w.fill(0);
    const tw = W.tAt(x, z);
    const u = W.lateral(x, z);
    // ---- inland bands -------------------------------------------------------------------
    let urban = 1 - ss(0.12, 0.20, tw);
    let farm = ss(0.14, 0.22, tw) * (1 - ss(0.36, 0.44, tw));
    let bush = ss(0.36, 0.44, tw) * (1 - ss(0.66, 0.74, tw));
    // far behind the start there is no band structure any more: a patchwork of everything inland
    const behind = ss(-0.12, -0.34, tw);
    if (behind > 0) {
      const pn = n.fbm(x * 0.0032 + 17, z * 0.0032 - 5, 2);
      const tf = ss(0.0, 0.28, pn), tb = ss(0.0, -0.28, pn);
      urban *= 1 - behind * Math.min(1, tf + tb);
      farm = Math.max(farm, behind * tf);
      bush = Math.max(bush, behind * tb);
    }
    const townN = ss(-0.05, 0.3, n.fbm(x * 0.0046 - 31, z * 0.0046 + 9, 2));
    const townMask = townN * ss(0.02, 0.06, tw);                 // none right at the start
    w[B.town] = urban * townMask;
    w[B.suburb] = urban * (1 - townMask);
    w[B.farm] = farm;
    w[B.bush] = bush;
    // ---- coast -------------------------------------------------------------------------
    const coast = ss(0.64, 0.74, tw);
    if (coast > 0) {
      const ck = this.coastKinds(u);
      const beachK = ck[0], mangK = ck[1], headK = ck[2], estK = ck[3];
      w[B.dunes] = coast * beachK * (1 - ss(0.86, 0.92, tw));
      w[B.beach] = coast * beachK * ss(0.86, 0.92, tw);
      w[B.wetland] = coast * (mangK + estK * (1 - ss(0.80, 0.88, tw)));
      w[B.headland] = coast * headK;
      w[B.estuary] = coast * estK * ss(0.80, 0.88, tw);
    }
    // ---- sea beyond the shoreline ----------------------------------------------------------
    const sea = ss(0.985, 1.03, tw);
    if (sea > 0) {
      for (let i = 0; i < NB; i++) w[i] *= 1 - sea;
      w[B.sea] = sea;
    }
    // ---- the creek corridor overlays everything on land --------------------------------------
    const cd = W.creekDist(x, z);
    if (cd < 24) {
      let rb = (1 - ss(5, 22, cd)) * (1 - ss(0.78, 0.9, tw)) * (1 - sea);
      rb *= 1 - 0.85 * clamp(w[B.wetland] + w[B.estuary] + w[B.headland] + w[B.beach] + w[B.dunes] + w[B.town] * 0.5, 0, 1);
      if (rb > 0) {
        for (let i = 0; i < NB; i++) w[i] *= 1 - rb;
        w[B.riverbank] = rb;
      }
    }
    let sum = 0;
    for (let i = 0; i < NB; i++) sum += w[i];
    if (sum < 1e-6) { w[B.bush] = 1; sum = 1; }
    for (let i = 0; i < NB; i++) w[i] /= sum;
    return w;
  }

  /** index of the dominant biome */
  at(x, z) {
    const w = this.weights(x, z);
    let best = 0;
    for (let i = 1; i < NB; i++) if (w[i] > w[best]) best = i;
    return best;
  }
  nameAt(x, z) { return BIOMES[this.at(x, z)]; }
}
