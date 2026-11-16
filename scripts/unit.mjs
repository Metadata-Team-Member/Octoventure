// Fast, headless sanity checks of the world generator (no browser needed).
import assert from 'node:assert/strict';
import { WorldData } from '../src/world/worldData.js';
import { BIOMES, NB } from '../src/world/biomes.js';
import { PROP_GEO } from '../src/world/props.js';
import { CONFIG, TERRAIN } from '../src/config.js';
import { dailySeed, perthDate } from '../src/util/daily.js';
import { Progress } from '../src/systems/progress.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const SEEDS = [1, 7, 42, 1234, 99999, 2026, 31337, 555];
const worlds = {};
const t0 = performance.now();

for (const seed of SEEDS) {
  const w = worlds[seed] = new WorldData(seed);
  const w2 = new WorldData(seed);
  ok(w.heightAt(10, 20) === w2.heightAt(10, 20), 'seeded worlds are reproducible');
  ok(w.angle === w2.angle, 'ocean direction is seeded');
  ok(w.props.length === w2.props.length && w.shells.length === w2.shells.length, `props/shells reproducible (seed ${seed})`);
  ok(w.half === 800, 'world is 1600 m across (4x the area of the first version)');
  ok(w.heightAt(w.start.x, w.start.z) > 1, `start is on land (seed ${seed})`);
  ok(!w.isSea(w.start.x, w.start.z), 'start is not sea');
  // walk straight from the start to the sea: the sea must exist in that direction and the path must be land first
  let reached = false, minH = 99, dist = 0;
  for (let d = 0; d < 1500; d += 2) {
    const x = w.start.x + w.dir.x * d, z = w.start.z + w.dir.z * d;
    if (Math.abs(x) > w.half || Math.abs(z) > w.half) break;
    if (w.isSea(x, z)) { reached = true; dist = d; break; }
    if (w.progress(x, z) < 0.88) minH = Math.min(minH, w.heightAt(x, z));
  }
  ok(reached, `sea reachable along the sea direction (seed ${seed})`);
  ok(minH > 0, `no flooded hollows on the way (seed ${seed}, min ${minH.toFixed(2)})`);
  // the start is NOT impossibly far from the sea: a straight run is well inside the time the octopus can stay alive
  const survive = 100 / (CONFIG.octopus.baseDryRate * 1.0);               // seconds on plain ground
  ok(dist > 450 && dist < 1000, `start-to-sea distance is a real trek but reasonable (seed ${seed}: ${dist} m)`);
  ok(dist / 7 < survive * 0.45, `a straight run (${(dist / 7).toFixed(0)} s) is well inside the drying time (${survive.toFixed(0)} s)`);
  // the opposite direction is land all the way (no second ocean)
  for (let d = 0; d < 280; d += 4) {
    const x = w.start.x - w.dir.x * d, z = w.start.z - w.dir.z * d;
    if (Math.abs(x) > w.half - 20 || Math.abs(z) > w.half - 20) break;
    ok(!w.isSea(x, z), `inland stays land (seed ${seed})`);
  }
  const kinds = {};
  for (const q of w.waters) kinds[q.kind] = (kinds[q.kind] || 0) + 1;
  ok((kinds.puddle || 0) > 100 && (kinds.stream || 0) >= 8 && (kinds.drip || 0) >= 8 && (kinds.sprinkler || 0) >= 4, `water variety (seed ${seed}): ${JSON.stringify(kinds)}`);
  ok(w.rain.length >= 8, 'rain clouds');
  let near = false;
  for (const q of w.waters) if (Math.hypot(q.x - w.start.x, q.z - w.start.z) < 30) near = true;
  ok(near, 'water near the start');
  const q = w.waters.find((a) => a.kind === 'puddle');
  ok(w.waterAt(q.x, q.z), 'waterAt finds a puddle');
  ok(w.decor.trees.length > 1500 && w.decor.rocks.length > 400 && w.decor.grass.length > 5000, 'decor generated');
  ok(w.houses.length >= 20, `houses (${w.houses.length})`);
  // collisions resolve
  const t = w.decor.trees.find((q) => q.kind !== 'bush' && q.kind !== 'norfolk');
  const r = w.resolve(t.x, t.z, 0.7);
  ok(Math.hypot(r.x - t.x, r.z - t.z) >= 0.4, 'collision pushes out of a tree');
  // every terrain type used by typeAt exists in the config table
  for (let i = 0; i < 600; i++) {
    const x = (Math.random() - 0.5) * 1500, z = (Math.random() - 0.5) * 1500;
    ok(TERRAIN[w.typeAt(x, z)], 'valid type ' + w.typeAt(x, z));
  }
  // ---- biomes: every one exists, is reachable (land points, not blocked) and is dominant somewhere
  for (const name of BIOMES) {
    const s = w.findBiomeSpot(name);
    ok(s && s.w > 0.6, `biome ${name} exists with a clear core (seed ${seed})`);
    ok(w.biomeAt(s.x, s.z) === name, `biomeAt agrees at the core of ${name}`);
  }
  // biome weights are normalised and continuous (no hard borders): max change per metre is small
  let prev = null, worst = 0;
  for (let d = -60; d < 700; d += 1) {
    const q = w.biomes.weights(w.start.x + w.dir.x * d, w.start.z + w.dir.z * d);
    let sum = 0; for (let i = 0; i < NB; i++) sum += q[i];
    ok(Math.abs(sum - 1) < 1e-6, 'weights sum to 1');
    if (prev) { let m = 0; for (let i = 0; i < NB; i++) m = Math.max(m, Math.abs(q[i] - prev[i])); worst = Math.max(worst, m); }
    prev = q.slice ? Array.from(q) : q;
  }
  ok(worst < 0.2, `biome weights are continuous (seed ${seed}: max step ${worst.toFixed(3)}/m)`);
  // the start itself is in the suburbs (a backyard to begin in)
  ok(w.biomeAt(w.start.x, w.start.z) === 'suburb', `start is in a suburb (${w.biomeAt(w.start.x, w.start.z)})`);
  // biome order along the straight run: inland -> coast, ending in a coast biome then sea
  const order = [];
  for (let d = 0; d < 1000; d += 4) {
    const x = w.start.x + w.dir.x * d, z = w.start.z + w.dir.z * d;
    if (Math.abs(x) > w.half || Math.abs(z) > w.half) break;
    const b = w.biomeAt(x, z); if (order[order.length - 1] !== b) order.push(b);
  }
  ok(order.length >= 4, `the run crosses several biomes (seed ${seed}): ${order.join(' > ')}`);
  ok(order[order.length - 1] === 'sea', 'the run ends in the sea');
  ok(['beach', 'headland', 'estuary', 'wetland', 'dunes'].includes(order[order.length - 2]), `a coast biome precedes the sea: ${order.join(' > ')}`);
  // props: all kinds placed have geometry, colliders exist for solid ones
  const pk = new Set(w.props.map((p) => p.kind));
  for (const k of pk) ok(PROP_GEO[k], `geometry for prop kind ${k}`);
  // hidden mechanics data
  ok(w.shells.length >= 220 && w.babies.length >= 12 && w.hides.length > 80 && w.tunnels.length > 30, `collectibles & hiding places (shells ${w.shells.length}, babies ${w.babies.length}, hides ${w.hides.length}, tunnels ${w.tunnels.length})`);
  ok(w.landmarks.some((l) => l.kind === 'lighthouse'), 'a lighthouse on the coast');
  ok(w.landmarks.filter((l) => l.kind === 'norfolk').length >= 3, 'Norfolk pines on the coast');
}
console.log(`generated ${SEEDS.length * 2} worlds in ${(performance.now() - t0).toFixed(0)} ms (${((performance.now() - t0) / (SEEDS.length * 2)).toFixed(0)} ms each)`);

// every biome has its own palette: the sets of ground types, props and tree kinds differ between biomes
{
  const w = worlds[2026];
  const gt = {}, tr = {}, pr = {};
  const dom = (x, z) => w.biomeAt(x, z);
  for (let i = 0; i < 20000; i++) {
    const x = (Math.random() - 0.5) * 1560, z = (Math.random() - 0.5) * 1560;
    const b = dom(x, z); if (b === 'sea') continue;
    (gt[b] ??= {})[w.baseType(x, z)] = 1;
  }
  for (const t of w.decor.trees) (tr[dom(t.x, t.z)] ??= {})[t.kind] = 1;
  for (const p of w.props) (pr[dom(p.x, p.z)] ??= {})[p.kind] = 1;
  const sig = (b) => JSON.stringify([Object.keys(gt[b] || {}).sort(), Object.keys(tr[b] || {}).sort(), Object.keys(pr[b] || {}).sort()]);
  const sigs = BIOMES.filter((b) => b !== 'sea').map((b) => sig(b));
  ok(new Set(sigs).size === sigs.length, 'every biome has a distinct mix of ground, trees and props');
  ok(tr.bush && tr.bush.gum && tr.wetland.mangrove, 'eucalypts in the bush, mangroves in the wetland');
  ok(pr.farm.barn && pr.town.shop && pr.suburb.fence && pr.beach.umbrella && pr.estuary.plank, 'signature props per biome');
}

// density stays similar when the map is bigger: counts per km^2 for water, shells and babies within +-25% of an 800 m world
{
  const per = (wd) => { let n = 0, tp = 0; for (const q of wd.waters) if (q.kind === 'puddle') tp++; return { puddles: tp, shells: wd.shells.length, babies: wd.babies.length, hides: wd.hides.length, area: (wd.half * 2) ** 2 / 1e6 }; };
  const save = CONFIG.worldSize;
  CONFIG.worldSize = 800;
  const small = per(new WorldData(2026));
  CONFIG.worldSize = save;
  const big = per(worlds[2026]);
  for (const k of ['puddles', 'shells', 'babies', 'hides']) {
    const a = small[k] / small.area, b = big[k] / big.area;
    ok(Math.abs(b / a - 1) < 0.25, `${k} density per km2 similar across map sizes (${a.toFixed(1)} vs ${b.toFixed(1)})`);
  }
  // bigger sizes work too
  CONFIG.worldSize = 2400;
  const huge = new WorldData(5);
  CONFIG.worldSize = save;
  ok(huge.half === 1200, 'worldSize is configurable (2400 m)');
  let hugeSea = false; for (let d = 0; d < 2400 && !hugeSea; d += 2) hugeSea = huge.isSea(huge.start.x + huge.dir.x * d, huge.start.z + huge.dir.z * d);
  ok(hugeSea, 'the sea is reachable in a 2400 m world too');
  ok(huge.shells.length > big.shells * 1.8, 'a 2400 m world has proportionally more shells');
}

// hidden shell armour: 6% each, capped at 50%, never visible
{
  const p = new Progress();
  ok(p.armor === 0, 'no armour at the start');
  for (let i = 0; i < 3; i++) p.addShell();
  ok(Math.abs(p.armor - 0.18) < 1e-9, 'three shells = 18% armour');
  for (let i = 0; i < 40; i++) p.addShell();
  ok(p.armor === CONFIG.shells.maxArmor, 'armour is capped at 50%');
}

// self-discovery balance: drying is slow (>= 5 minutes from full to empty on plain ground, even on hot asphalt > 2 min)
ok(100 / (CONFIG.octopus.baseDryRate * 1.0) >= 300, 'at least 5 min of health on normal ground');
ok(100 / (CONFIG.octopus.baseDryRate * 2.2) >= 120, 'at least 2 min of health on the hottest ground');
ok(CONFIG.octopus.waterSpeedMult > 1, 'wading is faster than walking');
{
  const w = worlds[7];
  ok(!w.isShallow(w.start.x, w.start.z), 'start is not shallow water');
  let found = false;
  for (let d = 0; d < 1200 && !found; d += 1) found = w.isShallow(w.start.x + w.dir.x * d, w.start.z + w.dir.z * d);
  ok(found, 'shallows exist before the open sea');
}
// daily seed: same Perth calendar day -> same seed; next day differs; the day rolls over at Perth midnight (UTC+8)
ok(dailySeed(new Date('2026-11-16T00:00:00+08:00')) === dailySeed(new Date('2026-11-16T23:59:00+08:00')), 'daily seed stable within a Perth day');
ok(dailySeed(new Date('2026-11-16T12:00:00+08:00')) !== dailySeed(new Date('2026-11-17T12:00:00+08:00')), 'daily seed differs between days');
ok(perthDate(new Date('2026-11-16T17:00:00Z')) === '2026-11-17', 'Perth date rolls over at 16:00 UTC');
{ const a = new WorldData(dailySeed(new Date('2026-11-16T12:00:00+08:00'))), b = new WorldData(dailySeed(new Date('2026-11-16T20:00:00+08:00')));
  ok(a.angle === b.angle && a.waters.length === b.waters.length && a.shells.length === b.shells.length, 'daily seed reproduces the same world'); }
console.log(`unit checks passed (${checks} assertions).`);
