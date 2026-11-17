// =====================================================================
//  Biomes - the pure (no three.js) description of WHERE each kind of place is.
//
//  Layout idea (inland -> coast, along the secret sea direction `dir`):
//     suburb / town  ->  farm  ->  bushland (eucalypt)  ->  coast
//  with a creek (riverbank) winding through to the estuary, and the coast itself changing
//  along the shoreline in a fixed, natural order (headland > beach > estuary > mangroves, repeating):
//     rocky headland  |  beach (with dunes behind)  |  estuary (river mouth + jetty)  |  mangrove wetland
//  The same fixed world for everyone (CONFIG.worldSeed): inland the regions are a warped patchwork
//  (hamlets in the farmland, farm clearings in the bush, ...) so one place hands over to the next.
//  Everything is a smooth blend of weights, so borders are soft (and never a hard seam).
// =====================================================================
import { smoothstep as ss, clamp } from '../util/rng.js';

export const BIOMES = ['suburb', 'town', 'farm', 'bush', 'riverbank', 'wetland', 'dunes', 'beach', 'headland', 'estuary', 'sea', 'desert', 'rainforest'];   // (t241u: desert + rainforest appended so older placement stays put)
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
  desert:    { label: 'Red desert',          tint: 0xffd2a8, fog: 1.2,  amb: { wind: 1.0 } },
  rainforest:{ label: 'Rainforest gully',    tint: 0xbfe0b0, fog: 0.55, amb: { birds: 1.0, babble: 0.5, frogs: 0.3 } },
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
    // ---- inland bands: a warped mosaic, not stripes ---------------------------------------
    // the band coordinate is pushed around by two scales of noise (borders meander by ~70 m), and patches of the
    // neighbouring biome (a farm in the bush hills, a stand of bush in the paddocks, a hamlet) break the bands up.
    const tb = tw + n.fbm(x * 0.0042 + 101, z * 0.0042 - 57, 3) * 0.1 + n.fbm(x * 0.012 - 8, z * 0.012 + 3, 2) * 0.025;
    const pk = n.fbm(x * 0.0038 - 211, z * 0.0038 + 61, 2);
    let urban = 1 - ss(0.12, 0.20, tb);
    let farm = ss(0.14, 0.22, tb) * (1 - ss(0.36, 0.44, tb));
    let bush = ss(0.36, 0.44, tb) * (1 - ss(0.66, 0.74, tb));
    const farmInBush = ss(0.1, 0.28, pk) * ss(0.38, 0.5, tb) * (1 - ss(0.58, 0.68, tb));
    const bushInFarm = ss(0.1, 0.28, -pk) * ss(0.14, 0.24, tb) * (1 - ss(0.34, 0.44, tb));
    const hamlet = ss(0.25, 0.45, n.fbm(x * 0.0036 + 400, z * 0.0036 - 90, 2)) * ss(0.2, 0.27, tb) * (1 - ss(0.36, 0.44, tb));
    farm = Math.max(farm * (1 - bushInFarm) * (1 - hamlet), farmInBush);
    bush = Math.max(bush * (1 - farmInBush), bushInFarm);
    urban = Math.max(urban, hamlet * 0.9);
    // far behind the start there is no band structure any more: a patchwork of everything inland
    const behind = ss(-0.12, -0.34, tw);
    if (behind > 0) {
      const pn = n.fbm(x * 0.0032 + 17, z * 0.0032 - 5, 2);
      const tf = ss(0.0, 0.28, pn), tb2 = ss(0.0, -0.28, pn);
      urban *= 1 - behind * Math.min(1, tf + tb2);
      farm = Math.max(farm, behind * tf);
      bush = Math.max(bush, behind * tb2);
    }
    // beyond the original map there are no more streets: the suburbs and town thin out into farmland and bush
    const out = Math.max(Math.abs(x), Math.abs(z)) - W.half;
    if (out > -80) { const f = ss(-80, 120, out); farm = Math.max(farm, urban * f * 0.5); bush = Math.max(bush, urban * f * 0.5); urban *= 1 - f; }
    const townN = ss(-0.05, 0.3, n.fbm(x * 0.0046 - 31, z * 0.0046 + 9, 2));
    const townMask = townN * ss(0.02, 0.06, tw) * (1 - hamlet * 0.9);  // none right at the start, and hamlets are all houses
    w[B.town] = urban * townMask;
    w[B.suburb] = urban * (1 - townMask);
    w[B.farm] = farm;
    w[B.bush] = bush;
    // ---- t241u: a red desert on the harsh inland side (far from the sea, out where the streets end) and rainforest gullies
    // tucked into the bush hills. Both are noise patches with wide smooth edges, so you see one country hand over to the next.
    const dn = n.fbm(x * 0.0026 + 701, z * 0.0026 - 313, 3);
    const desert = ss(0.08, 0.28, dn) * (1 - ss(-0.04, 0.06, tb)) * Math.max(ss(-0.04, -0.16, tw), ss(-40, 80, out));   // never in the home suburbs of the original map
    if (desert > 0) { const k = 1 - desert; w[B.town] *= k; w[B.suburb] *= k; w[B.farm] *= k; w[B.bush] *= k; w[B.desert] = desert; }
    const rn = n.fbm(x * 0.0042 - 333, z * 0.0042 + 77, 3);
    const rain = ss(-0.12, 0.08, rn) * ss(0.36, 0.45, tb) * (1 - ss(0.55, 0.62, tb));   // (kept back from the coast)
    if (rain > 0) { const k = 1 - rain; w[B.bush] *= k; w[B.farm] *= k; w[B.town] *= k; w[B.suburb] *= k; w[B.rainforest] = rain; }
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

  /**
   * a biome id drawn AT RANDOM in proportion to the weights at x,z (u = a uniform random number). In the middle of a biome this is
   * always that biome; across a blended ecotone it hands out both, so trees, rocks and props of the two biomes intermix and thin out
   * instead of stopping at a line.
   */
  sample(x, z, u) {
    const q = this.weights(x, z); let acc = 0;
    for (let i = 0; i < NB; i++) { acc += q[i]; if (u <= acc) return i; }
    return this.at(x, z);
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
