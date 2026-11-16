// =====================================================================
//  Gatherables: where the small things an octopus would pick up are scattered (t236u). Pure data (no three.js), seeded:
//  the same world always holds the same items, each with a stable id (so a save can say which ones have been taken).
//  Used by WorldData for the original map and by regions.js for every generated far tile.
//
//    crab         sandy shore, headland, beside tide pools           (a small critter: it scuttles away)
//    shrimp       inside tide pools / ponds / dams                    (a small critter: it darts)
//    snail        damp inland: wetland, riverbank, bush edges, pond rims
//    mussel       clustered on the headland rocks and tide pool rims
//    kelp         the sea floor, 0.6 - 5 m down
//    lettuce      shallow water, tide pool floors and wet shore rocks
//    sponge       the sea floor near reef rocks
//    coral        the sea floor near coral
//    shellhalf    beach, dunes, estuary and the shallows
//    pebble       river banks, beaches, headland, pond rims
//    moss         damp ground at the foot of rocks and big trees
//    coconut      under palms (and now and then on the beach)
//    cap          bottle caps: streets and car parks of the suburbs and town, a few on the beach
//    jar          glass jars: the suburbs and the beach (rare)
// =====================================================================
import { BIOMES } from './biomes.js';

/** items per 800 x 800 m (tile counts scale by area) */
export const GATHER_COUNT = { crab: 14, shrimp: 14, snail: 20, mussel: 18, kelp: 30, lettuce: 20, sponge: 10, coral: 12, shellhalf: 28, pebble: 30, moss: 22, coconut: 10, cap: 16, jar: 6 };
export const GATHER_KINDS = Object.keys(GATHER_COUNT);
const SIZE = { crab: [0.9, 1.15], shrimp: [0.9, 1.2], snail: [0.85, 1.2], mussel: [0.8, 1.2], kelp: [0.8, 1.3], lettuce: [0.8, 1.3], sponge: [0.8, 1.4], coral: [0.8, 1.4], shellhalf: [0.8, 1.3], pebble: [0.65, 1.1], moss: [0.8, 1.4], coconut: [0.9, 1.15], cap: [1, 1.25], jar: [0.95, 1.1] };

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
  const tts = [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1]].map(([x, z]) => w.tAt(x, z));
  const ttLo = Math.min(...tts), ttHi = Math.max(...tts);
  const near = (lo, hi) => ttHi >= lo && ttLo <= hi;                        // can this tile contain a point with lo <= t <= hi at all?
  const P = () => [rnd.range(rect.x0, rect.x1), rnd.range(rect.z0, rect.z1)];
  const inside = (x, z) => x > rect.x0 && x < rect.x1 && z > rect.z0 && z < rect.z1;
  const dry = (x, z) => !w.waterAt(x, z) && !w._blocked(x, z, 0.35);
  const ring = (c, rMin, rMax) => { const a = rnd() * 6.2832, d = rnd.range(rMin, rMax); return [c.x + Math.cos(a) * d, c.z + Math.sin(a) * d]; };
  const harshOf = (x, z) => w.harshAt(x, z);
  const poolsOf = (kinds) => waters.filter((q) => kinds.includes(q.kind) && inside(q.x, q.z));
  const rocks = (decor.rocks ?? []).filter((r) => inside(r.x, r.z)), trees = (decor.trees ?? []).filter((t) => inside(t.x, t.z)), reef = (decor.reef ?? []).filter((r) => inside(r.x, r.z));
  const palms = trees.filter((t) => t.kind === 'palm');

  const finish = (kind, x, z) => {
    const y = w.heightAt(x, z);
    out.push({ id: `${prefix}${out.length}`, kind, x, z, y, rot: rnd() * 6.2832, s: rnd.range(...SIZE[kind]) });
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
  const landSpot = (names, tLo, tHi, hLo, hHi, tries = 40, minW = 0.45) => {
    for (let i = 0; i < tries; i++) {
      const [x, z] = P(); const tt = w.tAt(x, z);
      if (tt < tLo || tt > tHi) continue;
      const h = w.heightAt(x, z); if (h < hLo || h > hHi) continue;
      if (!names.includes(dom(w, x, z))) continue;
      if (!dry(x, z)) continue;
      return [x, z];
    }
    return null;
  };
  const make = {
    crab() {
      if (!near(0.7, 1.02)) return false;
      const pools = poolsOf(['tidepool']);
      if (pools.length && rnd() < 0.3) { const [x, z] = ring(rnd.pick(pools), 2, 6); if (inside(x, z) && w.heightAt(x, z) > 0.15 && dry(x, z)) return finish('crab', x, z), true; }
      const s = landSpot(['beach', 'dunes', 'estuary', 'headland', 'wetland'], 0.7, 1.0, 0.12, 2.5);
      return s ? (finish('crab', s[0], s[1]), true) : false;
    },
    shrimp() {
      const pools = poolsOf(['tidepool', 'pond', 'dam', 'estuary']).filter((q) => q.r >= 2.2);
      if (!pools.length) return false;
      const q = rnd.pick(pools), a = rnd() * 6.2832, d = q.r * Math.sqrt(rnd()) * 0.6;
      finish('shrimp', q.x + Math.cos(a) * d, q.z + Math.sin(a) * d); out[out.length - 1].pool = { x: q.x, z: q.z, r: q.r };
      return true;
    },
    snail() {
      if (!near(0.1, 0.95)) return false;
      const pools = poolsOf(['pond', 'puddle', 'dam']);
      if (pools.length && rnd() < 0.35) { const [x, z] = ring(rnd.pick(pools), 1.5, 5); if (inside(x, z) && w.heightAt(x, z) > 0.7 && dry(x, z)) return finish('snail', x, z), true; }
      const s = landSpot(['wetland', 'riverbank', 'bush'], 0.1, 0.95, 0.5, 40, 40, 0.5);
      if (!s) return false;
      const dm = dom(w, s[0], s[1]);
      if (dm === 'bush' && rnd() < 0.7) return false;                     // bush is only damp enough near water
      return finish('snail', s[0], s[1]), true;
    },
    mussel() {
      if (!near(0.7, 1.02)) return false;
      const pools = poolsOf(['tidepool']);
      if (pools.length && rnd() < 0.45) { const c = rnd.pick(pools), [px, pz] = ring(c, c.r * 0.95, c.r * 1.25); if (inside(px, pz) && w.heightAt(px, pz) > 0.05 && dry(px, pz)) return finish('mussel', px, pz), true; }
      const rk = rocks.filter((r) => w.tAt(r.x, r.z) > 0.75 && w.tAt(r.x, r.z) < 1.0 && r.y > 0.05);
      if (!rk.length) return false;
      const r = rnd.pick(rk); const [x, z] = ring(r, r.size * 0.9 + 0.2, r.size * 0.9 + 0.7);
      if (!inside(x, z) || w.heightAt(x, z) < 0.05 || !dry(x, z)) return false;
      return finish('mussel', x, z), true;
    },
    kelp() {
      if (!near(1.01, 1.9)) return false;
      const s = seaSpot(-5.2, -0.7); if (!s) return false;
      if (w.n.fbm(s[0] * 0.02, s[1] * 0.02, 2) < -0.05) return false;       // grows in patches
      return finish('kelp', s[0], s[1]), true;
    },
    lettuce() {
      const pools = poolsOf(['tidepool', 'pond']);
      if (pools.length && rnd() < 0.4) { const q = rnd.pick(pools), [x, z] = ring(q, 0, q.r * 0.7); return finish('lettuce', x, z), true; }
      if (!near(0.9, 1.5)) return false;
      const s = seaSpot(-1.4, -0.12); if (!s) return false;
      return finish('lettuce', s[0], s[1]), true;
    },
    sponge() {
      if (!near(1.01, 1.9)) return false;
      if (reef.length && rnd() < 0.7) { const r = rnd.pick(reef.filter((q) => q.kind === 'rock')); if (r) { const [x, z] = ring(r, r.s + 0.3, r.s + 1.4); if (inside(x, z) && w.heightAt(x, z) < -1.2 && w.heightAt(x, z) > -6.5 && w.tAt(x, z) > 1.02) return finish('sponge', x, z), true; } }
      const s = seaSpot(-6, -1.8); if (!s || w.n.fbm(s[0] * 0.03 + 9, s[1] * 0.03, 2) < 0.05) return false;
      return finish('sponge', s[0], s[1]), true;
    },
    coral() {
      if (!near(1.01, 1.9)) return false;
      const cs = reef.filter((q) => q.kind === 'coral');
      if (!cs.length) return false;
      const r = rnd.pick(cs); const [x, z] = ring(r, 0.5, 2.2);
      if (!inside(x, z) || w.heightAt(x, z) > -0.8 || w.heightAt(x, z) < -6.5 || w.tAt(x, z) < 1.02) return false;
      return finish('coral', x, z), true;
    },
    shellhalf() {
      if (!near(0.8, 1.05)) return false;
      if (rnd() < 0.2) { const s = seaSpot(-0.7, -0.1); if (s) return finish('shellhalf', s[0], s[1]), true; }
      const s = landSpot(['beach', 'dunes', 'estuary', 'headland'], 0.8, 1.0, 0.1, 2.2);
      return s ? (finish('shellhalf', s[0], s[1]), true) : false;
    },
    pebble() {
      const pools = poolsOf(['pond', 'puddle', 'dam', 'tidepool']);
      if (pools.length && rnd() < 0.3) { const q = rnd.pick(pools), [x, z] = ring(q, q.r * 0.95, q.r * 1.3); if (inside(x, z) && w.heightAt(x, z) > 0.1 && dry(x, z)) return finish('pebble', x, z), true; }
      const s = landSpot(['riverbank', 'beach', 'headland', 'estuary', 'dunes', 'farm'], 0.05, 1.0, 0.2, 40, 30, rnd() < 0.5 ? 0.6 : 0.45);
      if (!s) return false;
      if (dom(w, s[0], s[1]) === 'farm' && rnd() < 0.7) return false;
      return finish('pebble', s[0], s[1]), true;
    },
    moss() {
      if (!near(0.1, 0.95)) return false;
      const anchors = [...rocks.filter((r) => ['bush', 'riverbank', 'wetland', 'headland'].includes(dom(w, r.x, r.z)) && r.y > 0.3), ...trees.filter((t) => t.kind !== 'bush' && ['wetland', 'riverbank', 'bush'].includes(dom(w, t.x, t.z)))];
      if (!anchors.length) return false;
      const a = rnd.pick(anchors), rr = a.size !== undefined ? a.size * 0.9 + 0.25 : 0.7 * a.scale + 0.2;
      const [x, z] = ring(a, rr, rr + 0.6);
      if (!inside(x, z) || w.heightAt(x, z) < 0.3 || !dry(x, z) || harshOf(x, z) > 0.5) return false;
      return finish('moss', x, z), true;
    },
    coconut() {
      if (palms.length && rnd() < 0.85) { const t = rnd.pick(palms), [x, z] = ring(t, 0.7 * t.scale + 0.4, 3.2); if (inside(x, z) && w.heightAt(x, z) > 0.15 && dry(x, z)) return finish('coconut', x, z), true; return false; }
      if (!near(0.8, 1.0)) return false;
      const s = landSpot(['beach', 'dunes'], 0.84, 1.0, 0.2, 2); return s ? (finish('coconut', s[0], s[1]), true) : false;
    },
    cap() {
      if (rnd() < 0.2 && near(0.88, 1.0)) { const s = landSpot(['beach'], 0.86, 1.0, 0.2, 2); if (s) return finish('cap', s[0], s[1]), true; }
      if (!near(-2, 0.3)) return false;
      for (let i = 0; i < 30; i++) {
        const [x, z] = P();
        if (!w.isRoad(x, z, 4) && !w.isRoad(x, z, 6)) continue;
        const b = dom(w, x, z); if (b !== 'suburb' && b !== 'town') continue;
        if (!dry(x, z) || w.heightAt(x, z) < 0.8) continue;
        return finish('cap', x, z), true;
      }
      return false;
    },
    jar() {
      if (rnd() < 0.15 && near(0.88, 1.0)) { const s = landSpot(['beach'], 0.86, 1.0, 0.2, 2); if (s) return finish('jar', s[0], s[1]), true; }
      if (!near(-2, 0.3)) return false;
      const s = landSpot(['suburb', 'town'], -2, 0.3, 0.8, 40, 40, 0.5); return s ? (finish('jar', s[0], s[1]), true) : false;
    },
  };
  for (const kind of GATHER_KINDS) {
    const want = Math.max(rnd() < (GATHER_COUNT[kind] * K) % 1 ? 1 : 0, 0) + Math.floor(GATHER_COUNT[kind] * K);
    let made = 0;
    for (let tries = 0; made < want && tries < want * 12; tries++) if (make[kind]()) made++;
  }
  return out;
}
