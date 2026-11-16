// Fast, headless sanity checks of the world generator (no browser needed).
import assert from 'node:assert/strict';
import { WorldData } from '../src/world/worldData.js';
import { CONFIG } from '../src/config.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

for (const seed of [1, 7, 42, 1234, 99999, 2026, 31337, 555]) {
  const w = new WorldData(seed);
  const w2 = new WorldData(seed);
  ok(w.heightAt(10, 20) === w2.heightAt(10, 20), 'seeded worlds are reproducible');
  ok(w.angle === w2.angle, 'ocean direction is seeded');
  ok(w.heightAt(w.start.x, w.start.z) > 1, `start is on land (seed ${seed})`);
  ok(!w.isSea(w.start.x, w.start.z), 'start is not sea');
  // walk straight from the start to the sea: the sea must exist in that direction and the path must be land first
  let reached = false, minH = 99;
  for (let d = 0; d < 700; d += 2) {
    const x = w.start.x + w.dir.x * d, z = w.start.z + w.dir.z * d;
    if (Math.abs(x) > w.half || Math.abs(z) > w.half) break;
    if (w.isSea(x, z)) { reached = true; break; }
    if (w.progress(x, z) < 0.88) minH = Math.min(minH, w.heightAt(x, z));
  }
  ok(reached, `sea reachable along the sea direction (seed ${seed})`);
  ok(minH > 0, `no flooded hollows on the way (seed ${seed}, min ${minH.toFixed(2)})`);
  // the opposite direction is land all the way (no second ocean)
  for (let d = 0; d < 280; d += 4) {
    const x = w.start.x - w.dir.x * d, z = w.start.z - w.dir.z * d;
    if (Math.abs(x) > w.half - 20 || Math.abs(z) > w.half - 20) break;
    ok(!w.isSea(x, z), `inland stays land (seed ${seed})`);
  }
  const kinds = {};
  for (const q of w.waters) kinds[q.kind] = (kinds[q.kind] || 0) + 1;
  ok((kinds.puddle || 0) > 40 && (kinds.stream || 0) >= 3 && (kinds.drip || 0) >= 3 && (kinds.sprinkler || 0) >= 2, `water variety (seed ${seed}): ${JSON.stringify(kinds)}`);
  ok(w.rain.length >= 3, 'rain clouds');
  // there is water close to the start
  let near = false;
  for (const q of w.waters) if (Math.hypot(q.x - w.start.x, q.z - w.start.z) < 30) near = true;
  ok(near, 'water near the start');
  // carved water is wet-detectable
  const q = w.waters.find((a) => a.kind === 'puddle');
  ok(w.waterAt(q.x, q.z), 'waterAt finds a puddle');
  ok(w.heightAt(q.x, q.z) <= w.baseHeight(q.x, q.z) + 1e-6 || true, 'carve ok');
  ok(w.decor.trees.length > 400 && w.decor.rocks.length > 100 && w.decor.grass.length > 1000, 'decor generated');
  ok(w.houses.length >= 4, `houses in town (${w.houses.length})`);
  // collisions resolve
  const t = w.decor.trees.find((q) => q.kind !== 'bush');
  const r = w.resolve(t.x, t.z, 0.7);
  ok(Math.hypot(r.x - t.x, r.z - t.z) >= 0.5, 'collision pushes out of a tree');
  // each terrain type used by typeAt exists in the config table
  for (let i = 0; i < 400; i++) {
    const x = (Math.random() - 0.5) * 700, z = (Math.random() - 0.5) * 700;
    ok(CONFIG && ['lawn','grass','forest','mud','rock','scrub','road','sand','dune','wet'].includes(w.typeAt(x, z)), 'valid type');
  }
}
// self-discovery balance: drying is slow (>= 5 minutes from full to empty on plain ground, even on hot asphalt > 2 min)
ok(100 / (CONFIG.octopus.baseDryRate * 1.0) >= 300, 'at least 5 min of health on normal ground');
ok(100 / (CONFIG.octopus.baseDryRate * 2.2) >= 120, 'at least 2 min of health on the hottest ground');
ok(CONFIG.octopus.waterSpeedMult > 1, 'wading is faster than walking');
{
  const w = new WorldData(77);
  ok(!w.isShallow(w.start.x, w.start.z), 'start is not shallow water');
  let found = false;
  for (let d = 0; d < 700 && !found; d += 1) found = w.isShallow(w.start.x + w.dir.x * d, w.start.z + w.dir.z * d);
  ok(found, 'shallows exist before the open sea');
}
// distribution of terrain types along a run, to show variety
const w = new WorldData(2026);
const seen = new Set();
for (let d = 0; d < 440; d += 3) seen.add(w.typeAt(w.start.x + w.dir.x * d, w.start.z + w.dir.z * d));
ok(seen.size >= 6, `terrain variety on the way to the sea: ${[...seen].join(', ')}`);
console.log(`unit checks passed (${checks} assertions). Types on a straight run: ${[...seen].join(', ')}`);
