// =====================================================================
//  Gatherables: where the small things an octopus would pick up are scattered (t236u, per-biome since t239u). Pure data (no three.js),
//  seeded: the same world always holds the same items, each with a stable id (so a save can say which ones have been taken).
//  Used by WorldData for the original map and by regions.js for every generated far tile.
//
//  WHERE each kind lives is one table, HABITAT, below: edit a kind's `biomes` list and its distribution follows (an item is only ever
//  placed where the dominant biome is in its list). `GATHER_COUNT` sets how many there are per 800 x 800 m; a placer then finds the
//  exact spot (a pool, a rock, a tree, the tide line ...) inside the allowed biomes.
//
//    crab         sandy shore, mud, headland, beside tide pools      (a small critter: it scuttles away)
//    shrimp       inside tide pools / ponds / dams                    (a small critter: it darts)
//    snail        damp inland: wetland, riverbank, bush, pond rims
//    mussel       clustered on the headland rocks and tide pool rims
//    kelp         the sea floor, 0.6 - 5 m down
//    lettuce      shallow water, tide pool floors and wet shore rocks
//    sponge       the sea floor near reef rocks
//    coral        the sea floor near coral
//    shellhalf    beach, dunes, estuary, headland and the shallows
//    pebble       river banks, beaches, headland, pond rims
//    moss         damp ground at the foot of rocks and big trees
//    coconut      under palms (suburb gardens, beach and dunes)
//    cap          bottle caps: streets and car parks of the suburbs and town, a few on the beach
//    jar          glass jars: the suburbs and the beach (rare)
//    urchin       rock pools and the shallows off the rocky headland (spiky)
//    worm         earthworms in the farm soil and around troughs, a few in suburb gardens
//    beetle       at the foot of eucalypts in the bushland
//    spawn        frog spawn floating in wetland ponds and bush puddles
//    propagule    mangrove seed pods lying in the mud of the wetland and estuary
// =====================================================================
import { BIOMES } from './biomes.js';

/** items per 800 x 800 m (tile counts scale by area) */
export const GATHER_COUNT = { crab: 20, shrimp: 18, snail: 28, mussel: 26, kelp: 44, lettuce: 28, sponge: 14, coral: 16, shellhalf: 42, pebble: 44, moss: 32, coconut: 14, cap: 22, jar: 8, urchin: 20, worm: 24, beetle: 26, spawn: 16, propagule: 26, ochre: 30, fungi: 30, anemone: 12 };
export const GATHER_KINDS = Object.keys(GATHER_COUNT);
const SIZE = { crab: [0.9, 1.15], shrimp: [0.9, 1.2], snail: [0.85, 1.2], mussel: [0.8, 1.2], kelp: [0.8, 1.3], lettuce: [0.8, 1.3], sponge: [0.8, 1.4], coral: [0.8, 1.4], shellhalf: [0.8, 1.3], pebble: [0.65, 1.1], moss: [0.8, 1.4], coconut: [0.9, 1.15], cap: [1, 1.25], jar: [0.95, 1.1], urchin: [0.85, 1.25], worm: [0.9, 1.3], beetle: [0.9, 1.2], spawn: [0.9, 1.3], propagule: [0.85, 1.25], ochre: [0.8, 1.2], fungi: [0.85, 1.3], anemone: [0.85, 1.25] };

/**
 * THE per-biome distribution: the biomes each kind may be found in (dominant biome at the item's spot).
 * Adjust here (and GATHER_COUNT) to rebalance the world. Every kind should live in at least one biome; the unit test prints the result.
 */
export const HABITAT = {
  crab:      { biomes: ['beach', 'dunes', 'estuary', 'headland', 'wetland'] },
  shrimp:    { biomes: ['headland', 'estuary', 'wetland', 'riverbank', 'bush', 'farm'] },
  snail:     { biomes: ['wetland', 'riverbank', 'bush'] },
  mussel:    { biomes: ['headland', 'beach', 'estuary'] },
  kelp:      { biomes: ['sea'] },
  lettuce:   { biomes: ['sea', 'headland', 'wetland', 'riverbank'] },
  sponge:    { biomes: ['sea'] },
  coral:     { biomes: ['sea'] },
  shellhalf: { biomes: ['beach', 'dunes', 'estuary', 'headland', 'sea'] },
  pebble:    { biomes: ['riverbank', 'beach', 'dunes', 'headland', 'estuary'] },
  moss:      { biomes: ['bush', 'riverbank', 'wetland', 'headland'] },
  coconut:   { biomes: ['suburb', 'beach', 'dunes'] },
  cap:       { biomes: ['suburb', 'town', 'beach'] },
  jar:       { biomes: ['suburb', 'town', 'beach'] },
  urchin:    { biomes: ['headland', 'sea'] },
  worm:      { biomes: ['farm', 'suburb'] },
  beetle:    { biomes: ['bush', 'riverbank'] },
  spawn:     { biomes: ['wetland', 'riverbank', 'bush'] },
  propagule: { biomes: ['wetland', 'estuary'] },
  ochre:     { biomes: ['desert'] },                     // t241u: lumps of red ochre on the desert sand
  fungi:     { biomes: ['rainforest'] },                 // t241u: glowing ghost fungi on the rainforest floor
  anemone:   { biomes: ['sea'] },                      // reef flowers, offshore only
};
/** the same table the other way round: biome -> the kinds found there (for tests, docs and the DESIGN notes) */
export const BIOME_MATERIALS = Object.fromEntries(BIOMES.map((b) => [b, GATHER_KINDS.filter((k) => HABITAT[k].biomes.includes(b))]));

const dom = (w, x, z) => { const q = w.biomes.weights(x, z); let id = 0; for (let i = 1; i < q.length; i++) if (q[i] > q[id]) id = i; return BIOMES[id]; };

/**
 * @param w     WorldData
 * @param rnd   seeded random function with .range / .pick (util/rng)
 * @param o     { rect, K (area / 640000), decor: {rocks, trees, reef}, waters: [...], prefix, harsh (0..1 optional) }
 * @returns     [{ id, kind, x, z, y, rot, s }]
 */
export function scatterGather(w, rnd, o) {
  const { rect, K, decor, waters, prefix } = o;
  const out = [];
  const P = () => [rnd.range(rect.x0, rect.x1), rnd.range(rect.z0, rect.z1)];
  const inside = (x, z) => x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1;
  const dry = (x, z) => !w.waterAt(x, z) && !w._blocked(x, z, 0.35);
  const ring = (c, rMin, rMax) => { const a = rnd() * 6.2832, d = rnd.range(rMin, rMax); return [c.x + Math.cos(a) * d, c.z + Math.sin(a) * d]; };
  const harshOf = (x, z) => w.harshAt(x, z);
  const poolsOf = (kinds) => waters.filter((q) => kinds.includes(q.kind) && inside(q.x, q.z));
  const rocks = (decor.rocks ?? []).filter((r) => inside(r.x, r.z)), trees = (decor.trees ?? []).filter((t) => inside(t.x, t.z)), reef = (decor.reef ?? []).filter((r) => inside(r.x, r.z));
  const palms = trees.filter((t) => t.kind === 'palm');

  // which biomes does this tile touch at all? (a coarse grid) - kinds whose biomes are absent are skipped outright
  const present = new Set();
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const q = w.biomes.weights(rect.x0 + (rect.x1 - rect.x0) * i / 8, rect.z0 + (rect.z1 - rect.z0) * j / 8);
    for (let b = 0; b < q.length; b++) if (q[b] > 0.12) present.add(BIOMES[b]);
  }
  const okAt = (kind, x, z) => HABITAT[kind].biomes.includes(dom(w, x, z));

  const finish = (kind, x, z) => {
    if (!okAt(kind, x, z)) return false;
    const y = w.heightAt(x, z);
    out.push({ id: `${prefix}${out.length}`, kind, x, z, y, rot: rnd() * 6.2832, s: rnd.range(...SIZE[kind]) });
    return true;
  };
  const seaSpot = (hLo, hHi, tries = 30) => {
    for (let i = 0; i < tries; i++) {
      const [x, z] = P(); const tt = w.tAt(x, z);
      if (tt < 1.01 || tt > 1.9) continue;
      const h = w.heightAt(x, z); if (h > hHi || h < hLo) continue;
      return [x, z];
    }
    return null;
  };
  /** a dry land spot inside the kind's biomes */
  const landSpot = (kind, hLo, hHi, tries = 40, minW = 0.45) => {
    const names = HABITAT[kind].biomes, ids = names.map((n) => BIOMES.indexOf(n));
    for (let i = 0; i < tries; i++) {
      const [x, z] = P();
      const h = w.heightAt(x, z); if (h < hLo || h > hHi) continue;
      const q = w.biomes.weights(x, z); let best = 0; for (let b = 1; b < q.length; b++) if (q[b] > q[best]) best = b;
      if (!ids.includes(best) || q[best] < minW) continue;
      if (!dry(x, z)) continue;
      return [x, z];
    }
    return null;
  };
  const make = {
    ochre() { const s = landSpot('ochre', 0.3, 60, 40, 0.5); return s ? finish('ochre', s[0], s[1]) : false; },
    fungi() { const s = landSpot('fungi', 0.3, 60, 40, 0.5); return s ? finish('fungi', s[0], s[1]) : false; },
    crab() {
      const pools = poolsOf(['tidepool']);
      if (pools.length && rnd() < 0.3) { const [x, z] = ring(rnd.pick(pools), 2, 6); if (inside(x, z) && w.heightAt(x, z) > 0.15 && dry(x, z)) return finish('crab', x, z); }
      const s = landSpot('crab', 0.12, 2.5);
      return s ? finish('crab', s[0], s[1]) : false;
    },
    shrimp() {
      const pools = poolsOf(['tidepool', 'pond', 'dam', 'estuary']).filter((q) => q.r >= 2.2);
      if (!pools.length) return false;
      const q = rnd.pick(pools), a = rnd() * 6.2832, d = q.r * Math.sqrt(rnd()) * 0.45;
      if (!finish('shrimp', q.x + Math.cos(a) * d, q.z + Math.sin(a) * d)) return false;
      out[out.length - 1].pool = { x: q.x, z: q.z, r: q.r };
      return true;
    },
    snail() {
      const pools = poolsOf(['pond', 'puddle', 'dam']);
      if (pools.length && rnd() < 0.35) { const [x, z] = ring(rnd.pick(pools), 1.5, 5); if (inside(x, z) && w.heightAt(x, z) > 0.7 && dry(x, z)) return finish('snail', x, z); }
      const s = landSpot('snail', 0.5, 40, 40, 0.5);
      if (!s) return false;
      if (dom(w, s[0], s[1]) === 'bush' && rnd() < 0.7) return false;     // bush is only damp enough near water
      return finish('snail', s[0], s[1]);
    },
    mussel() {
      const pools = poolsOf(['tidepool']);
      if (pools.length && rnd() < 0.45) { const c = rnd.pick(pools), [px, pz] = ring(c, c.r * 0.95, c.r * 1.25); if (inside(px, pz) && w.heightAt(px, pz) > 0.05 && dry(px, pz)) return finish('mussel', px, pz); }
      const rk = rocks.filter((r) => w.tAt(r.x, r.z) > 0.75 && w.tAt(r.x, r.z) < 1.0 && r.y > 0.05);
      if (!rk.length) return false;
      const r = rnd.pick(rk); const [x, z] = ring(r, r.size * 0.9 + 0.2, r.size * 0.9 + 0.7);
      if (!inside(x, z) || w.heightAt(x, z) < 0.05 || !dry(x, z)) return false;
      return finish('mussel', x, z);
    },
    kelp() {
      const s = seaSpot(-5.2, -0.7); if (!s) return false;
      if (w.n.fbm(s[0] * 0.02, s[1] * 0.02, 2) < -0.05) return false;       // grows in patches
      return finish('kelp', s[0], s[1]);
    },
    lettuce() {
      const pools = poolsOf(['tidepool', 'pond']);
      if (pools.length && rnd() < 0.4) { const q = rnd.pick(pools), [x, z] = ring(q, 0, q.r * 0.7); return finish('lettuce', x, z); }
      const s = seaSpot(-1.4, -0.12); if (!s) return false;
      return finish('lettuce', s[0], s[1]);
    },
    sponge() {
      if (reef.length && rnd() < 0.7) { const r = rnd.pick(reef.filter((q) => q.kind === 'rock')); if (r) { const [x, z] = ring(r, r.s + 0.3, r.s + 1.4); if (inside(x, z) && w.heightAt(x, z) < -1.2 && w.heightAt(x, z) > -6.5 && w.tAt(x, z) > 1.02) return finish('sponge', x, z); } }
      const s = seaSpot(-6, -1.8); if (!s || w.n.fbm(s[0] * 0.03 + 9, s[1] * 0.03, 2) < 0.05) return false;
      return finish('sponge', s[0], s[1]);
    },
    coral() {
      const cs = reef.filter((q) => q.kind === 'coral');
      if (!cs.length) return false;
      const r = rnd.pick(cs); const [x, z] = ring(r, 0.5, 2.2);
      if (!inside(x, z) || w.heightAt(x, z) > -0.8 || w.heightAt(x, z) < -6.5 || w.tAt(x, z) < 1.02) return false;
      return finish('coral', x, z);
    },
    shellhalf() {
      if (rnd() < 0.2) { const s = seaSpot(-0.7, -0.1); if (s) return finish('shellhalf', s[0], s[1]); }
      const s = landSpot('shellhalf', 0.1, 2.2);
      return s ? finish('shellhalf', s[0], s[1]) : false;
    },
    pebble() {
      const pools = poolsOf(['pond', 'puddle', 'dam', 'tidepool']);
      if (pools.length && rnd() < 0.3) { const q = rnd.pick(pools), [x, z] = ring(q, q.r * 0.95, q.r * 1.3); if (inside(x, z) && w.heightAt(x, z) > 0.1 && dry(x, z)) return finish('pebble', x, z); }
      const s = landSpot('pebble', 0.2, 40, 30, rnd() < 0.5 ? 0.6 : 0.45);
      return s ? finish('pebble', s[0], s[1]) : false;
    },
    moss() {
      const anchors = [...rocks.filter((r) => r.y > 0.3), ...trees.filter((t) => t.kind !== 'bush')].filter((a) => okAt('moss', a.x, a.z));
      if (!anchors.length) return false;
      const a = rnd.pick(anchors), rr = a.size !== undefined ? a.size * 0.9 + 0.25 : 0.7 * a.scale + 0.2;
      const [x, z] = ring(a, rr, rr + 0.6);
      if (!inside(x, z) || w.heightAt(x, z) < 0.3 || !dry(x, z) || harshOf(x, z) > 0.5) return false;
      return finish('moss', x, z);
    },
    coconut() {
      if (palms.length && rnd() < 0.85) { const t = rnd.pick(palms), [x, z] = ring(t, 0.7 * t.scale + 0.4, 3.2); if (inside(x, z) && w.heightAt(x, z) > 0.15 && dry(x, z)) return finish('coconut', x, z); return false; }
      const s = landSpot('coconut', 0.2, 2); return s ? finish('coconut', s[0], s[1]) : false;
    },
    cap() {
      if (rnd() < 0.2 && present.has('beach')) { const s = landSpot('cap', 0.2, 2, 40, 0.6); if (s && dom(w, s[0], s[1]) === 'beach') return finish('cap', s[0], s[1]); }
      for (let i = 0; i < 30; i++) {
        const [x, z] = P();
        if (!w.isRoad(x, z, 4) && !w.isRoad(x, z, 6)) continue;
        if (!dry(x, z) || w.heightAt(x, z) < 0.8) continue;
        if (finish('cap', x, z)) return true;
      }
      return false;
    },
    jar() {
      if (rnd() < 0.15 && present.has('beach')) { const s = landSpot('jar', 0.2, 2, 40, 0.6); if (s && dom(w, s[0], s[1]) === 'beach') return finish('jar', s[0], s[1]); }
      const s = landSpot('jar', 0.8, 40, 40, 0.5); return s ? finish('jar', s[0], s[1]) : false;
    },
    urchin() {
      const pools = poolsOf(['tidepool']).filter((q) => q.r >= 2);
      if (pools.length && rnd() < 0.5) {
        const q = rnd.pick(pools), a = rnd() * 6.2832, d = q.r * Math.sqrt(rnd()) * 0.45;
        return finish('urchin', q.x + Math.cos(a) * d, q.z + Math.sin(a) * d);
      }
      const s = seaSpot(-2.4, -0.25);                                              // the shallows, but only off the rocky headland
      if (!s || w.biomes.coastKinds(w.lateral(s[0], s[1]))[2] < 0.5) return false;
      return finish('urchin', s[0], s[1]);
    },
    worm() {
      const troughs = poolsOf(['trough']);
      if (troughs.length && rnd() < 0.35) { const q = rnd.pick(troughs), [x, z] = ring(q, q.r * 0.9, q.r * 1.5); if (inside(x, z) && w.heightAt(x, z) > 0.4 && dry(x, z)) return finish('worm', x, z); }
      const s = landSpot('worm', 0.8, 40, 40, 0.5);
      if (!s) return false;
      if (dom(w, s[0], s[1]) === 'suburb' && rnd() < 0.7) return false;           // mostly a farm thing
      return finish('worm', s[0], s[1]);
    },
    beetle() {
      const anchors = trees.filter((t) => t.kind === 'gum' || t.kind === 'pine' || t.kind === 'willow').filter((t) => okAt('beetle', t.x, t.z));
      if (!anchors.length) return false;
      const a = rnd.pick(anchors), rr = 0.7 * a.scale + 0.3;
      const [x, z] = ring(a, rr, rr + 0.9);
      if (!inside(x, z) || w.heightAt(x, z) < 0.3 || !dry(x, z) || harshOf(x, z) > 0.6) return false;
      return finish('beetle', x, z);
    },
    spawn() {
      const pools = poolsOf(['pond', 'puddle', 'dam']).filter((q) => q.r >= 1.6 && okAt('spawn', q.x, q.z));
      if (!pools.length) return false;
      const q = rnd.pick(pools), [x, z] = ring(q, 0, q.r * 0.4);
      return finish('spawn', x, z);
    },
    propagule() {
      const mang = trees.filter((t) => t.kind === 'mangrove' || t.kind === 'paperbark').filter((t) => okAt('propagule', t.x, t.z));
      if (mang.length && rnd() < 0.6) { const t = rnd.pick(mang), [x, z] = ring(t, 0.6 * t.scale + 0.3, 2.6); if (inside(x, z) && w.heightAt(x, z) > 0.05 && dry(x, z)) return finish('propagule', x, z); }
      const s = landSpot('propagule', 0.05, 2.5, 40, 0.45);
      return s ? finish('propagule', s[0], s[1]) : false;
    },
    anemone() {
      const cs = reef.filter((q) => q.kind === 'coral' || q.kind === 'rock');
      if (cs.length && rnd() < 0.7) {
        const r = rnd.pick(cs);
        const rad = (r.s || r.size || 0.6);
        const [x, z] = ring(r, rad + 0.35, rad + 2.1);
        if (inside(x, z) && w.heightAt(x, z) < -0.55 && w.heightAt(x, z) > -6.2 && w.tAt(x, z) > 1.02) return finish('anemone', x, z);
      }
      const s = seaSpot(-4.8, -0.7);
      return s ? finish('anemone', s[0], s[1]) : false;
    },
  };
  for (const kind of GATHER_KINDS) {
    if (!HABITAT[kind].biomes.some((b) => present.has(b))) continue;                // nothing of this kind can live in this tile
    const want = Math.max(rnd() < (GATHER_COUNT[kind] * K) % 1 ? 1 : 0, 0) + Math.floor(GATHER_COUNT[kind] * K);
    let made = 0;
    for (let tries = 0; made < want && tries < want * 12; tries++) if (make[kind]()) made++;
  }
  return out;
}
