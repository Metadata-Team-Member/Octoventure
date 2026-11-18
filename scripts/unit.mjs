// Fast, headless sanity checks of the world generator (no browser needed).
import assert from 'node:assert/strict';
import { WorldData } from '../src/world/worldData.js';
import { BIOMES, NB, COAST_KINDS } from '../src/world/biomes.js';
import { PROP_GEO } from '../src/world/props.js';
import { CONFIG, TERRAIN } from '../src/config.js';
import { dailySeed, perthDate } from '../src/util/daily.js';
import { Progress } from '../src/systems/progress.js';
import { PARTS, treeGeometries } from '../src/world/models.js';
import { treeConnectivity } from '../src/world/treeCheck.js';
import { waterDisc } from '../src/world/placement.js';
import { existsSync, readFileSync } from 'node:fs';
import { Inventory, RECIPES, RAW, MADE, ALL_ITEMS, FX, USABLE, LORE, loreOf } from '../src/systems/items.js';
import { GATHER_COUNT, GATHER_KINDS, HABITAT, BIOME_MATERIALS } from '../src/world/gather.js';
import { mulberry32 } from '../src/util/rng.js';
import { separate, minGap } from '../src/util/separate.js';
import { ICON_IDS } from '../src/ui/icons.js';
import { Levels, BADGES, xpForLevel, levelOf, perks, XP } from '../src/systems/levels.js';
import { Journal, ENTRIES, TABS, RARE, ENTRY_IDS } from '../src/systems/journal.js';
import { inkDeter, inkUnder, cloudCovers, INK_NEAR, INK_AQUA_NEAR, INK_BLIND, INK_AQUA_BLIND, INK_BIRD_RANGE, AQUA, FLYERS } from '../src/systems/ink.js';
import { Music, ROOT, MOOD } from '../src/systems/music.js';
import { SAVE_VERSION, SAVE_KEY, LEGACY_KEYS, validateSave, migrate, readSaveText, encodeCode, decodeCode, loadSave, writeSave, clearSave, MIGRATIONS, exploreCell, unpackCell } from '../src/systems/save.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const WORLD = CONFIG.worldSeed;
const SEEDS = [WORLD, 1, 7, 42, 1234, 2026, 555];            // the one world, plus a few debug seeds (the generator must stay sound for any seed)
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
// predators show awareness through body language only: no sprite / text marker code may exist in the predator module
{ const { readFileSync } = await import('node:fs'); const src = readFileSync(new URL('../src/entities/predators.js', import.meta.url), 'utf8');
  ok(!/Sprite|setMark|makeMark|CanvasTexture|fillText/.test(src), 'predators.js has no sprite / canvas-text markers above heads'); }

// cicadas are gone for good: no cicada voice in the audio engine or the ambience mix (other sounds remain)
{ const au = readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/systems/atmosphere.js', import.meta.url), 'utf8') + readFileSync(new URL('../src/world/biomes.js', import.meta.url), 'utf8');
  ok(!/cicada/i.test(au), 'no cicada sound code anywhere in audio / atmosphere / biome ambience');
  ok(/birds/.test(au) && /wind/.test(au) && /surf|wave/.test(au), 'the other ambient sounds are still there'); }
// no ground marks at all (t246u: the trail read as car tracks): no trail module, no print/footprint/stamp mesh in effects
{ const fx = readFileSync(new URL('../src/systems/effects.js', import.meta.url), 'utf8');
  ok(!existsSync(new URL('../src/systems/trail.js', import.meta.url)), 'the trail module is gone');
  ok(!/print|trail|CircleGeometry|footstep/i.test(fx.replace(/\(No ground trail\/footprints: removed in t246u\.\)/, '')), 'effects draws no trail / footprint marks'); }
// water entry (t246u): a soft splash with bubbles, not a hard thud; the world goes muffled under water
{ const au = readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
  const sp = au.slice(au.indexOf('  splash('), au.indexOf('  submerge('));
  ok(/bubbles\(/.test(sp) && /highpass/.test(sp) && !/this\.noise\(/.test(sp), 'water entry = airy spray + plip + bubbles (no raw noise hit)');
  ok(!/swish\([^)]*,\s*([1-4]\d{2}|[1-9]\d)\s*,/.test(sp), 'no low-frequency thump in the splash');
  ok(/this\.lp\b/.test(au) && /submerge\(\)/.test(au) && /surface\(\)/.test(au), 'master lowpass muffles the world under water, with going-under / surfacing sounds'); }
// soft toon look (t248u): no PBR material is built anywhere in the game code, outlines only via the toon module
{ const { readdirSync } = await import('node:fs');
  const walk = (u) => readdirSync(u, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(new URL(d.name + '/', u)) : d.name.endsWith('.js') ? [new URL(d.name, u)] : []);
  for (const f of walk(new URL('../src/', import.meta.url))) { const t = readFileSync(f, 'utf8'); ok(!/new THREE\.(MeshStandardMaterial|MeshPhysicalMaterial|PointLight)\(/.test(t), `${f.pathname.split('/src/')[1]}: no PBR material / point light`); }
  const tn = readFileSync(new URL('../src/world/toon.js', import.meta.url), 'utf8');
  ok(/MeshToonMaterial/.test(tn) && /gradientMap/.test(tn) && /uRim/.test(tn), 'toon module: banded gradient + rim light');
  ok(/BackSide/.test(tn) && /uOutlinePx/.test(tn), 'outline = thin screen-space inverted hull'); }
// trees: every primitive overlaps the rest, so canopies / fronds / branches are always attached to the trunk
{ PARTS.on = true; const T = treeGeometries(); PARTS.on = false;
  ok(Object.keys(T).length >= 9, 'all tree kinds built');
  for (const [k, g] of Object.entries(T)) { const r = treeConnectivity(g.userData.parts, -0.03); ok(r.components.length === 1, `${k}: foliage and branches are connected to the trunk (loose ${JSON.stringify(r.loose)})`); }
  // the checker itself must catch a floating canopy
  { const parts = T.oak.userData.parts.map((t) => Float32Array.from(t)); const last = parts[parts.length - 1]; for (let i = 1; i < last.length; i += 3) last[i] += 3;   // lift one crown blob off the tree
    ok(treeConnectivity(parts, -0.03).components.length === 2, 'checker flags a canopy blob floating above its tree'); } }
// still water: a carved puddle / pond is one level disc, at or just under the lowest bank, never tilted
for (const seed of [1, 42, 2026]) {
  const w = worlds[seed]; let n = 0, bad = 0;
  for (const q of w.waters) {
    if (!['puddle', 'pond', 'tidepool', 'trough', 'dam'].includes(q.kind) || !q.carve) continue;
    const d = waterDisc(w, q); n++;
    if (d.gx !== 0 || d.gz !== 0) { bad++; continue; }
    let lo = 1e9; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; lo = Math.min(lo, w.heightAt(q.x + Math.cos(a) * q.r * 1.05, q.z + Math.sin(a) * q.r * 1.05)); }
    if (d.y0 > lo + 0.35) bad++;      // never floats above the bank
  }
  ok(n > 20 && bad === 0, `seed ${seed}: ${n} carved still-water discs are level and sit within the bank (${bad} bad)`);
}
// shells: real shell shapes (smooth, naturally coloured, finite, a few centimetres to ~half a unit across), no metal look
{ const { scallop, turban, cowrie, bigShell } = await import('../src/world/shells.js');
  for (const [k, g] of Object.entries({ scallop: scallop(0), turban: turban(), cowrie: cowrie(), big: bigShell() })) {
    g.computeBoundingBox(); const b = g.boundingBox, P = g.attributes.position.array, Cc = g.attributes.color.array;
    ok(P.every(Number.isFinite) && g.attributes.normal && Cc.length === P.length, `${k}: finite positions, normals and baked colours`);
    const sz = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    ok(k === 'big' ? sz > 1.5 : sz > 0.25 && sz < 0.7, `${k}: sensible size (${sz.toFixed(2)})`);
    let r = 0, g2 = 0, bl = 0; for (let i = 0; i < Cc.length; i += 3) { r += Cc[i]; g2 += Cc[i + 1]; bl += Cc[i + 2]; }
    ok(r >= bl && r / Cc.length > 0.12, `${k}: warm sand / cream / pink / brown tones, not metallic grey or blue`);
  }
  const col = readFileSync(new URL('../src/systems/collect.js', import.meta.url), 'utf8');
  ok(/metalness: 0/.test(col) && !/wireframe|metalness: [1-9]/.test(col), 'shell material is non-metallic'); }
// babies: plenty, spread over the world, a good share along the run from start to sea, and some close to the start
{ let tot = 0, corr = 0, close = 0;
  for (const seed of SEEDS) { const w = worlds[seed]; tot += w.babies.length;
    ok(w.babies.length >= 24, `seed ${seed}: ${w.babies.length} baby octopuses`);
    const d = w.babies.map((b) => Math.hypot(b.x - w.start.x, b.z - w.start.z)); ok(d.filter((x) => x < 250).length >= 3, `seed ${seed}: at least 3 babies within 250 u of the start`);
    corr += w.babies.filter((b) => Math.abs(w.lateral(b.x, b.z) - w.lateral(w.start.x, w.start.z)) < 170 && w.progress(b.x, b.z) > 0 && w.progress(b.x, b.z) < 0.97).length; }
  ok(corr / SEEDS.length >= 9, `${(corr / SEEDS.length).toFixed(1)} babies per world lie along the start-to-sea corridor`); }
// ---- the endless land: no edge, tiles generated on demand, identical whatever the visiting order, seams are continuous
{ const seed = 2026;
  const A = new WorldData(seed), Bw = new WorldData(seed);
  const orig = []; for (let i = 0; i < 400; i++) { const x = -790 + (i * 37) % 1580, z = -790 + (i * 91) % 1580; orig.push([x, z, A.heightAt(x, z)]); }
  const tiles = [[4, 1], [10, 10], [-3, 2], [0, -4], [5, 5], [-7, -7]];
  for (const [rx, rz] of tiles) A.regions.generate(rx, rz);
  for (const [rx, rz] of [...tiles].reverse()) Bw.regions.generate(rx, rz);
  for (const [rx, rz] of tiles) {
    const a = A.regions.get(rx, rz), b = Bw.regions.get(rx, rz), j = (o) => JSON.stringify(o);
    ok(j(a.decor) === j(b.decor) && j(a.waters.map((q) => [q.kind, q.x, q.z, q.r, q.H])) === j(b.waters.map((q) => [q.kind, q.x, q.z, q.r, q.H])) && a.shells.length === b.shells.length && a.babies.length === b.babies.length, `far tile ${rx},${rz} is identical whatever order tiles are visited in`);
    ok(a.rect.x1 - a.rect.x0 === 400, 'far tiles are 400 u square');
    for (const t of a.decor.trees) ok(t.x > a.rect.x0 - 31 && t.x < a.rect.x1 + 31 && t.z > a.rect.z0 - 31 && t.z < a.rect.z1 + 31, 'far tile content stays inside its tile (plus the skirt)');
  }
  ok(orig.every(([x, z, h]) => A.heightAt(x, z) === h), 'generating far tiles never changes the original map terrain');
  // heights are continuous across tile seams and at huge distances (float32 mesh precision stays sub-millimetre-ish: see DESIGN.md)
  for (const [bx, bz] of [[A.half + 400 * 3, 123.4], [-A.half - 400 * 12, 700], [5000, -5000], [-9000, 9000]]) {
    const sx = Math.round((bx + A.half) / 400) * 400 - A.half;
    let worst = 0; for (let k = 0; k < 30; k++) { const z = bz + k * 1.3; worst = Math.max(worst, Math.abs(A.heightAt(sx + 0.01, z) - A.heightAt(sx - 0.01, z))); }
    ok(worst < 0.02, `terrain is continuous across a tile seam near ${bx.toFixed(0)},${bz.toFixed(0)} (max step ${worst.toFixed(4)})`);
    ok(Number.isFinite(A.heightAt(bx, bz)) && Math.abs(A.heightAt(bx, bz)) < 400, 'terrain exists (finite) very far from the start');
    ok(Math.abs(Math.fround(bx) - bx) < 0.001 && Math.abs(Math.fround(A.heightAt(bx, bz)) - A.heightAt(bx, bz)) < 1e-5, 'float32 vertex precision at ~10 km is below a millimetre');
  }
  // harshness: 0 on the original map, rising monotonically inland, 1 far inland; the sea side stays gentle
  const inl = (d) => A.harshAt(-A.dir.x * d, -A.dir.z * d);
  ok(A.harshAt(0, 0) === 0 && inl(700) < 0.05, 'the original map is not harsh');
  let prev = -1; for (let d = 0; d <= 4000; d += 100) { const v = inl(d); ok(v >= prev - 1e-9, 'harshness never decreases inland'); prev = v; }
  ok(inl(3000) > 0.98 && A.harshAt(A.dir.x * 3000, A.dir.z * 3000) === 0, 'far inland is fully harsh, the seaward side is not');
  // far inland: fewer puddles, trees and flowers than near the shore, drier grass
  const near = [], far = [];
  for (let rx = 0; rx < 4; rx++) for (let rz = 0; rz < 4; rz++) { /* original tiles are not generated */ }
  const C = new WorldData(seed); let pn = 0, pf = 0, fn = 0, ff = 0, dn = 0, df = 0, gn = 0, gf = 0, nn = 0, nf = 0;
  for (let rx = -12; rx < 16; rx++) for (let rz = -12; rz < 16; rz++) {
    if (rx >= 0 && rx < 4 && rz >= 0 && rz < 4) continue;
    const cx = -C.half + (rx + 0.5) * 400, cz = -C.half + (rz + 0.5) * 400, h = C.harshAt(cx, cz), tt = C.tAt(cx, cz);
    if (tt > 0.8 || (h > 0.02 && h < 0.98)) continue;
    if (nn >= 6 && nf >= 6) break;
    if (h < 0.02 && nn < 6) { const r = C.regions.generate(rx, rz); nn++; pn += r.waters.length; fn += r.decor.flowers.length; gn += r.decor.grass.length; dn += r.decor.grass.filter((g) => g.dry).length; }
    else if (h > 0.98 && nf < 6) { const r = C.regions.generate(rx, rz); nf++; pf += r.waters.length; ff += r.decor.flowers.length; gf += r.decor.grass.length; df += r.decor.grass.filter((g) => g.dry).length; }
  }
  ok(nn >= 3 && nf >= 3, `found gentle (${nn}) and harsh (${nf}) land tiles to compare`);
  ok(pf / nf < 0.35 * pn / nn && ff / nf < 0.6 * fn / nn, `far inland has far fewer puddles (${(pn / nn).toFixed(0)} -> ${(pf / nf).toFixed(0)} per tile) and flowers (${(fn / nn).toFixed(0)} -> ${(ff / nf).toFixed(0)})`);
  ok(df / gf > dn / gn + 0.3, `far inland grass is mostly dry (${(100 * dn / gn).toFixed(0)}% -> ${(100 * df / gf).toFixed(0)}%)`);
  // babies and shells exist out there too, with unique ids
  let nb = 0; const ids = new Set(); for (const b of C.babies) { ids.add(b.id); } nb = C.babies.filter((b) => typeof b.id === 'string').length;
  ok(nb > 8 && ids.size === C.babies.length, `far regions hide baby octopuses too (${nb}), ids are unique`);
  ok(C.shells.filter((s) => s.reg).length > 20, 'far regions scatter shells too');
}

// ================================================================ gatherables + satchel (t236u)
{
  const w = worlds[2026], w2 = new WorldData(2026);
  ok(w.gather.length === w2.gather.length && w.gather.every((g, i) => g.id === w2.gather[i].id && g.kind === w2.gather[i].kind && g.x === w2.gather[i].x && g.z === w2.gather[i].z), 'gatherables are reproducible (same ids, kinds and positions)');
  const kinds = {}; for (const g of w.gather) kinds[g.kind] = (kinds[g.kind] || 0) + 1;
  ok(GATHER_KINDS.length === 22 && GATHER_KINDS.every((k) => kinds[k] > 0), `all 22 kinds are scattered (${JSON.stringify(kinds)})`);
  const K = w.areaScale;
  ok(GATHER_KINDS.every((k) => kinds[k] >= GATHER_COUNT[k] * K * 0.4), 'every kind reaches at least 40% of its target density');
  ok(new Set(w.gather.map((g) => g.id)).size === w.gather.length && w.gather.every((g) => /^o\d+$/.test(g.id)), 'item ids are unique and stable (o0, o1 ...)');
  const by = (k) => w.gather.filter((g) => g.kind === k);
  const sea = (g) => w.tAt(g.x, g.z) > 1.0;
  ok(by('kelp').every((g) => sea(g) && g.y < -0.1) && by('sponge').every(sea) && by('coral').every(sea) && by('anemone').every(sea), 'kelp, sponge, coral and anemones live on the sea floor');
  ok(by('shrimp').every((g) => g.pool && Math.hypot(g.x - g.pool.x, g.z - g.pool.z) < g.pool.r), 'every shrimp sits inside its pool');
  ok(by('snail').every((g) => !w.isSea(g.x, g.z) && w.tAt(g.x, g.z) < 1.0), 'snails are on land');
  ok(by('crab').every((g) => !w.waterAt(g.x, g.z)), 'crabs are not in water');
  ok(by('cap').every((g) => { const b = w.biomeAt(g.x, g.z); return ['suburb', 'town', 'beach', 'dunes', 'estuary', 'coast', 'headland'].some((n) => String(b).toLowerCase().includes(n)) || w.tAt(g.x, g.z) > 0.7; }), 'bottle caps are in built-up areas or on the shore');
  ok(w.gather.every((g) => Number.isFinite(g.x + g.z + g.y + g.rot + g.s) && g.s > 0.5 && g.s < 2), 'every item has finite numbers and a sane size');
  // far regions: items with their own prefix, deterministic per tile
  const C = new WorldData(2026), r1 = C.regions.generate(6, 1), C2 = new WorldData(2026), r2 = C2.regions.generate(6, 1);
  ok(r1.gather.length > 5 && r1.gather.length === r2.gather.length && r1.gather.every((g, i) => g.id === r2.gather[i].id && g.x === r2.gather[i].x), `far tiles hold gatherables too (${r1.gather.length}), reproducible`);
  ok(r1.gather.every((g) => g.id.startsWith('r6_1_')), 'far tile item ids carry the tile');
  const allIds = C.gather.map((g) => g.id); ok(new Set(allIds).size === allIds.length, 'ids stay unique across the original map and far tiles');
  ok(C.regions.list.flatMap((r) => r.shells).every((s) => typeof s.id === 'string'), 'far shells carry stable ids too');
}
{
  ok(ALL_ITEMS.length === RAW.length + MADE.length && RAW.length === 22 && MADE.length === 12, '22 gathered things and 12 made ones (reef light)');
  ok(ALL_ITEMS.every((id) => ICON_IDS.includes(id)), 'every item has a pictogram');
  ok(RECIPES.every((r) => ALL_ITEMS.includes(r.out) && Object.keys(r.in).every((k) => RAW.includes(k))), 'recipes make known items from raw things');
  ok(MADE.every((m) => RECIPES.some((r) => r.out === m)) && MADE.every((m) => USABLE.has(m)), 'every made item has a recipe and can be used');
  const inv = new Inventory();
  ok(inv.slots().length === 0 && inv.visibleRecipes().length === 0, 'an empty satchel shows nothing');
  inv.add('crab'); ok(inv.visibleRecipes().map((r) => r.id).join() === 'feast', 'a recipe appears with its first ingredient');
  ok(inv.craft('feast') && inv.count('feast') === 1 && inv.count('crab') === 0 && inv.seen.has('crab'), 'crafting consumes ingredients; seen items stay known');
  ok(!inv.craft('feast'), 'a recipe without ingredients can not be crafted');
  inv.add('shellhalf', 2); inv.add('pebble', 3); inv.add('shellhalf', 1);
  ok(inv.craft('den') && inv.count('pebble') === 0 && inv.count('shellhalf') === 2 && inv.craft('shield-shell') && inv.count('shield') === 1, 'den and shield recipes work');
  inv.add('shrimp', 2); inv.add('snail', 2); inv.add('jar'); inv.add('cap'); inv.add('sponge'); inv.add('coral'); inv.add('kelp'); inv.add('lettuce'); inv.add('coconut', 2);
  ok(['inksac', 'gland', 'hideaway', 'mimic', 'wrap', 'shield-coco'].every((id) => inv.craft(id)), 'every other recipe crafts');
  inv.add('kelp'); inv.add('moss', 2); inv.add('sponge'); inv.add('beetle'); inv.add('urchin', 2); inv.add('propagule'); inv.add('worm'); inv.add('spawn');
  ok(['wrap-moss', 'gland-beetle', 'mimic-moss', 'tonic', 'meal'].every((id) => inv.craft(id)) && inv.count('tonic') === 1 && inv.count('meal') === 1 && inv.count('wrap') === 2 && inv.count('mimic') === 2, 'the biome recipes craft too (sea + bush wrap and mimic, bush + headland gland, headland + mangrove tonic, farm + wetland meal)');
  const j = JSON.parse(JSON.stringify(inv.toJSON())), inv2 = new Inventory().load(j);
  ok(JSON.stringify(inv2.toJSON()) === JSON.stringify(inv.toJSON()), 'the satchel round-trips through JSON');
  const bad = new Inventory().load({ counts: { crab: -5, hax: 9, jar: 1e9, kelp: 'x' }, seen: ['crab', 42, 'zzz'], made: ['den', 'crab'] });
  ok(bad.count('crab') === 0 && bad.count('hax') === 0 && bad.count('jar') === 999 && bad.count('kelp') === 0 && bad.made.has('den') && !bad.made.has('crab'), 'garbage in a loaded satchel is cleaned up');
  ok(FX.denMax === 3 && FX.shield > 10 && FX.mimicDrain < 1 && FX.kelpDry < 1, 'effect numbers are sane');
  ok(ALL_ITEMS.every((id) => loreOf(id)?.name && loreOf(id)?.note), 'every item has a name and a short tooltip note');
  ok(!loreOf('not-a-thing') && !('shell' in LORE), 'unknown items have no lore (hidden shell armour stays unmentioned)');
}



// ================================================================ one fixed world, many starts, blended biomes (t239u)
{
  const W = worlds[WORLD];
  ok(CONFIG.worldSeed === WORLD && W.seed === WORLD, `there is ONE canonical world (seed ${WORLD})`);
  const W2 = new WorldData(WORLD);
  ok(W.angle === W2.angle && W.heightAt(-200, 90) === W2.heightAt(-200, 90) && W.biomes.nameAt(150, -300) === W2.biomes.nameAt(150, -300) && W.gather.length === W2.gather.length && W.props.length === W2.props.length, 'the one world is identical every time it is built');
  // ---- start points: random per game, valid, spread out, reproducible when the seed of the pick is shared (daily start)
  const rs = mulberry32(2026), starts = [];
  for (let i = 0; i < 80; i++) { const p = W.pickSpawn(rs, false); if (p.x !== W.home.x || p.z !== W.home.z) starts.push(p); }
  ok(starts.length >= 70, `start points are found (${starts.length} of 80 picks)`);
  ok(starts.every((p) => W.spawnOk(p.x, p.z) && W.heightAt(p.x, p.z) > 1 && !W.isSea(p.x, p.z) && !W.waterAt(p.x, p.z)), 'every start is dry, flat-ish land');
  const toSea = starts.map((p) => -W.distToSea(p.x, p.z));
  ok(Math.min(...toSea) > 250 && Math.max(...toSea) < 1300, `the sea is always a real trek from the start (${Math.min(...toSea).toFixed(0)} - ${Math.max(...toSea).toFixed(0)} m)`);
  const lat = starts.map((p) => W.lateral(p.x, p.z)), prog = starts.map((p) => W.progress(p.x, p.z));
  ok(Math.max(...lat) - Math.min(...lat) > 0.9 * W.half && Math.max(...prog) - Math.min(...prog) > 0.35, `starts are spread across the map (lateral span ${(Math.max(...lat) - Math.min(...lat)).toFixed(0)} m, progress ${Math.min(...prog).toFixed(2)}..${Math.max(...prog).toFixed(2)})`);
  const sector = new Set(starts.map((p) => Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2)) * 8))); ok(sector.size >= 4, `starts surround the centre of the map (${sector.size} of 8 sectors)`);
  const near = (p) => Math.min(...W.waters.map((q) => Math.hypot(q.x - p.x, q.z - p.z) - q.r));
  ok(starts.every((p) => near(p) < 100), 'there is always water within 100 m of the start');
  const a1 = W2.pickSpawn(mulberry32(777), false), a2 = W2.pickSpawn(mulberry32(777), false), a3 = W2.pickSpawn(mulberry32(778), false);
  ok(a1.x === a2.x && a1.z === a2.z && (a1.x !== a3.x || a1.z !== a3.z), 'the same pick seed (the daily start) gives the same start; another seed another start');
  const d1 = W2.pickSpawn(mulberry32(dailySeed(new Date('2026-11-16T12:00:00+08:00'))), false), d2 = W2.pickSpawn(mulberry32(dailySeed(new Date('2026-11-16T20:00:00+08:00'))), false), d3 = W2.pickSpawn(mulberry32(dailySeed(new Date('2026-11-17T12:00:00+08:00'))), false);
  ok(d1.x === d2.x && d1.z === d2.z && (d1.x !== d3.x || d1.z !== d3.z), 'the daily start is shared within a Perth day and changes tomorrow');
  W2.setSpawn(starts[0].x, starts[0].z); ok(W2.start.x === starts[0].x && W2.home.x === W.home.x, 'moving the start keeps the canonical home point');

  // ---- every biome within reach of every start
  const cell = 40, grid = {}; for (const n of BIOMES) grid[n] = [];
  for (let x = -780; x < 800; x += cell) for (let z = -780; z < 800; z += cell) grid[W.biomes.nameAt(x, z)].push([x, z]);
  ok(BIOMES.every((n) => grid[n].length >= 4), `all ${BIOMES.length} biomes exist in the one world (${BIOMES.map((n) => n + ' ' + grid[n].length).join(', ')})`);
  let worst = 0, worstB = '';
  for (const p of starts) for (const n of BIOMES) { let d = 1e9; for (const [x, z] of grid[n]) d = Math.min(d, Math.hypot(x - p.x, z - p.z)); if (d > worst) { worst = d; worstB = n; } }
  ok(worst < 1000, `every biome is within ${worst.toFixed(0)} m of every start (the farthest is ${worstB}; limit 1000 m)`);
  // ---- natural neighbours: what borders what
  const adj = {};
  for (let x = -780; x < 780; x += 20) for (let z = -780; z < 780; z += 20) {
    const a = W.biomes.nameAt(x, z); for (const [dx, dz] of [[20, 0], [0, 20]]) { const b = W.biomes.nameAt(x + dx, z + dz); if (a !== b) { const k = [a, b].sort().join('|'); adj[k] = (adj[k] || 0) + 1; } }
  }
  const has = (a, b) => (adj[[a, b].sort().join('|')] || 0) > 0;
  ok(has('suburb', 'farm') && has('farm', 'bush') && has('bush', 'wetland') && has('beach', 'sea') && has('dunes', 'beach') && has('headland', 'sea') && has('estuary', 'sea'), `natural neighbours exist: suburb-farm, farm-bush, bush-wetland, dunes-beach, beach/headland/estuary-sea`);
  ok(!has('suburb', 'sea') && !has('town', 'sea') && !has('farm', 'sea') && !has('suburb', 'headland') && !has('town', 'beach') && !has('farm', 'beach'), 'and unnatural ones do not (no suburbs on the sea, no farm on the beach)');
  const kinds = W.coast.segments.sort((p, q) => p.a - q.a).map((s) => COAST_KINDS[s.kind]).join('>');
  ok(kinds === 'headland>beach>estuary>mangrove', `the coast runs ${kinds} (headland beside beach, river mouth beside mangroves)`);
  // ---- blended ecotones: along many straight lines, wherever the dominant biome changes the two overlap for a stretch (no hard seams) and the blend is neither a pin-prick nor a smear
  const widths = [], seams = []; const rl = mulberry32(99);
  for (let L = 0; L < 120; L++) {
    const x0 = rl.range(-760, 760), z0 = rl.range(-760, 760), a = rl() * 6.2832, c = Math.cos(a), s2 = Math.sin(a);
    let prev = null, prevName = null;
    const pts = [];
    for (let d = 0; d < 700; d += 2) { const x = x0 + c * d, z = z0 + s2 * d; if (Math.abs(x) > 790 || Math.abs(z) > 790) break; pts.push(Array.from(W.biomes.weights(x, z))); }
    for (let i = 1; i < pts.length; i++) {
      const A = pts[i - 1].indexOf(Math.max(...pts[i - 1])), Bb = pts[i].indexOf(Math.max(...pts[i]));
      if (A === Bb) continue;
      const na = BIOMES[A], nb = BIOMES[Bb];
      if (na === 'riverbank' || nb === 'riverbank') continue;                  // the creek is a narrow corridor by design
      let lo = i, hi = i;
      while (lo > 0 && pts[lo][A] > 0.1 && pts[lo][Bb] > 0.1) lo--;
      while (hi < pts.length - 1 && pts[hi][A] > 0.1 && pts[hi][Bb] > 0.1) hi++;
      const wd = (hi - lo) * 2;
      if (lo > 1 && hi < pts.length - 2) widths.push({ w: wd, pair: na + '>' + nb });          // fully inside the line
      i = hi;
    }
  }
  widths.sort((p, q) => p.w - q.w);
  const med = widths[Math.floor(widths.length / 2)].w, thin = widths.filter((x) => x.w < 16).length;
  ok(widths.length > 150, `${widths.length} biome crossings sampled`);
  console.log(`one world: farthest biome ${worst.toFixed(0)} m from any start (${worstB}); ${widths.length} crossings, median blend ${med} m, widest ${widths[widths.length - 1].w} m, ${thin} thin; ${Object.keys(adj).length} neighbour pairs: ${Object.entries(adj).sort((p, q) => q[1] - p[1]).map(([k, v]) => k + ' ' + v).join(', ')}`);
  ok(med >= 30 && med <= 120, `typical blend band is 30-120 m wide (median ${med} m)`);
  ok(thin / widths.length < 0.06, `almost no hard seams: ${thin} of ${widths.length} crossings blend over < 16 m`);
  ok(widths.every((x) => x.w < 330), `no blend is a smear (widest ${widths[widths.length - 1].w} m: ${widths[widths.length - 1].pair})`);
  // weights stay continuous along random lines across the whole map and a long way beyond it
  let step = 0;
  for (let L = 0; L < 60; L++) { const x0 = rl.range(-2400, 2400), z0 = rl.range(-2400, 2400), a = rl() * 6.2832; let pw = null; for (let d = 0; d < 300; d += 1) { const q = Array.from(W.biomes.weights(x0 + Math.cos(a) * d, z0 + Math.sin(a) * d)); if (pw) for (let i = 0; i < q.length; i++) step = Math.max(step, Math.abs(q[i] - pw[i])); pw = q; } }
  ok(step < 0.2, `biome weights are continuous everywhere, including far tiles (max step ${step.toFixed(3)}/m)`);
  // the mosaic is not stripes: at the same distance from the sea, going along the shore, the inland biome changes
  { const seq = new Set(); for (let u = -700; u <= 700; u += 20) { const p = W.shorePoint(u, 0.3); seq.add(W.biomes.nameAt(p.x, p.z)); } ok(seq.size >= 3, `at one distance from the sea the land varies along the shore (${[...seq].join(', ')})`); }

  // ---- materials differ per biome
  const dist = {};
  for (const g of W.gather) { const b = W.biomes.nameAt(g.x, g.z); (dist[g.kind] ||= {})[b] = (dist[g.kind]?.[b] || 0) + 1; }
  ok(GATHER_KINDS.every((k) => Object.values(dist[k] || {}).reduce((p, q) => p + q, 0) > 0), 'every material is found in the one world');
  ok(GATHER_KINDS.every((k) => { const t = Object.values(dist[k]).reduce((p, q) => p + q, 0); const inB = HABITAT[k].biomes.reduce((p, b) => p + (dist[k][b] || 0), 0); return inB / t > 0.97; }), 'each material is found in the biomes the HABITAT table gives it (and almost nowhere else)');
  const bm = BIOME_MATERIALS;
  ok(['suburb', 'town', 'farm', 'bush', 'wetland', 'dunes', 'beach', 'headland', 'estuary', 'sea'].every((b) => bm[b].length >= 2), `every biome offers at least two materials (${BIOMES.map((b) => b + ':' + bm[b].length).join(' ')})`);
  ok(bm.farm.includes('worm') && bm.bush.includes('beetle') && bm.wetland.includes('propagule') && bm.wetland.includes('spawn') && bm.headland.includes('urchin') && bm.suburb.includes('cap') && bm.sea.includes('coral'), 'signature materials: worm on the farm, beetle in the bush, seed pods and spawn in the wetland, urchins on the headland, caps in the suburbs, coral in the sea');
  const uniq = GATHER_KINDS.filter((k) => HABITAT[k].biomes.length <= 2).length; ok(uniq >= 7, `${uniq} materials live in only one or two biomes`);
  for (const k of ['urchin', 'worm', 'beetle', 'spawn', 'propagule']) ok((dist[k] ? Object.values(dist[k]).reduce((p, q) => p + q, 0) : 0) >= GATHER_COUNT[k] * W.areaScale * 0.4, `${k} reaches 40% of its target density in the one world`);
  // recipes need more than one biome
  const home = (r) => Object.keys(r.in).map((k) => new Set(HABITAT[k].biomes));
  const multi = RECIPES.filter((r) => { const sets = home(r); return [...sets[0]].filter((b) => sets.every((st) => st.has(b))).length === 0; });
  ok(multi.length >= 5, `${multi.length} of ${RECIPES.length} recipes need ingredients from different biomes (${multi.map((r) => r.id).join(', ')})`);
  ok(['tonic', 'meal', 'wrap-moss', 'gland-beetle', 'mimic-moss'].every((id) => multi.some((r) => r.id === id)), 'the new recipes each combine two biomes');
}

// ================================================================ levels & badges (t241u / t242u)
{
  ok(xpForLevel(1) === 0 && xpForLevel(2) === 60 && xpForLevel(5) === 420 && levelOf(0) === 1 && levelOf(59) === 1 && levelOf(60) === 2 && levelOf(1e9) === 30, 'level curve: 60 xp for level 2, 420 for level 5, capped at 30');
  ok(perks(1).dry === 1 && perks(11).dry < 0.9 && perks(30).dry >= 0.75 && perks(30).camo >= 0.8, 'hidden perks: a little slower drying and camo drain each level, bounded');
  ok(BADGES.length >= 15 && BADGES.length <= 30 && new Set(BADGES.map((b) => b.id)).size === BADGES.length, `${BADGES.length} distinct badges`);
  ok(BADGES.every((b) => b.title && b.note && !/toughen|armou?r|counter/i.test(b.note + b.title)), 'every badge has a tooltip name and note, none of which reveal hidden shell toughening');
  const { ICON_IDS } = await import('../src/ui/icons.js');
  ok(BADGES.every((b) => ICON_IDS.includes(b.glyph)), 'every badge has its own pictogram');
  const L = new Levels(); L.allBiomes = 13;
  for (let i = 0; i < 25; i++) L.did('cell');
  let ev = L.drain();
  ok(L.badges.has('wander') && ev.some((e) => e.type === 'badge' && e.id === 'wander'), 'exploring 25 new patches of ground earns the first badge (queued as an event)');
  L.did('biome', 'bush'); L.did('biome', 'bush'); L.did('biome', 'farm'); L.did('biome', 'beach');
  ok(L.st.biomes.size === 3 && L.badges.has('places3'), 'visiting three different places earns a badge; repeats count once');
  L.add(xpForLevel(L.level + 1) - L.xp - 5); L.drain(); const lv0 = L.level; L.did('baby'); ev = L.drain();
  ok(L.badges.has('baby1') && L.level > lv0 && ev.some((e) => e.type === 'level'), 'a rescue gives a lot of experience: a level-up event');
  for (let i = 0; i < 20; i++) L.did('rain'); ok(L.badges.has('rain'), 'twenty seconds dancing in the rain earns a badge');
  L.did('craft', { all: true }); ok(L.badges.has('craft1') && L.badges.has('craftAll'), 'crafting badges');
  L.add(5000); ev = L.drain(); ok(L.badges.has('level5') && L.badges.has('level10') && ev.filter((e) => e.type === 'level').length >= 5, 'a big jump queues one event per level gained and the level badges');
  const J = JSON.parse(JSON.stringify(L.toJSON())), L2 = new Levels().load(J);
  ok(L2.xp === Math.round(L.xp) && L2.level === L.level && L2.badges.size === L.badges.size && L2.st.biomes.size === 3 && L2.events.length === 0, 'levels round-trip through the save without replaying events');
  ok(new Levels().load('junk').level === 1 && new Levels().load({ xp: NaN, b: 5, st: 7 }).xp === 0, 'junk level data never throws');
}

// ================================================================ biting (t250u / t251u)
{
  const { TIER, killTier, nipsFor, killXP, lethal, BITE } = await import('../src/systems/combat.js');
  ok(killTier(1) === 0 && killTier(2) === 0 && killTier(3) === 1 && killTier(5) === 2 && killTier(8) === 3 && killTier(12) === 4 && killTier(30) === 4, 'the venomous bite kills bigger predators as the octopus levels up (L1-2 deterrent only)');
  ok(!lethal('crab', 1) && lethal('crab', 3) && !lethal('cat', 5) && lethal('cat', 8) && !lethal('dog', 11) && lethal('dog', 12), 'small first, then cats/foxes, then dogs and eagles');
  ok(lethal('dog', 1, true) && lethal('eagle', 1, true) && !lethal('human', 30, true) && !lethal('human', 30), 'a lethal dose kills any predator at any level; people are never killed');
  ok(Object.keys(TIER).length === 9 && nipsFor(1) < nipsFor(4) && nipsFor(TIER.human) > 1e6, 'beak nips needed grow with size (people: never)');
  ok(killXP(4, true) > killXP(1, false) && killXP(1, false) > 0, 'kills give experience, bigger and venomous more');
  ok(BITE.nipCooldown < 1 && BITE.venomCooldown > 5, 'beak bite is quick, the venomous bite has a real cooldown');
  const L = new Levels(); L.did('kill', { tier: 2, xp: killXP(2, true) }); ok(L.st.kills === 1 && L.st.bigKill === 2 && L.badges.has('hunter') && L.xp >= killXP(2, true), 'a kill counts, earns experience and the hunter badge');
  const inv = new Inventory(); inv.add('fungi'); inv.add('urchin'); ok(inv.craft('dose') && inv.count('dose') === 1, 'the lethal dose crafts from rainforest fungi + a headland urchin');
  const inv2 = new Inventory(); inv2.add('ochre'); inv2.add('spawn'); ok(inv2.craft('dose-ochre') && inv2.count('dose') === 1, '... or desert ochre + wetland frogspawn');
  const ui = readFileSync(new URL('../src/input.js', import.meta.url), 'utf8'), pad = readFileSync(new URL('../src/gamepad.js', import.meta.url), 'utf8');
  ok(/Mouse0/.test(ui) && /Mouse2/.test(ui) && /contextmenu[^\n]*preventDefault/.test(ui), 'left click bites, right click bites with venom, the context menu is suppressed');
  ok(/nip: edge\(2\)/.test(pad) && /bite: edge\(7\)/.test(pad), 'gamepad: X bites, RT bites with venom');
}

// ================================================================ saves (t238u)
{
  const fixture = () => ({
    v: 8, seed: WORLD, fresh: false, saved: 1700000000000,
    octo: { x: 120.5, z: -33.25, heading: 1.2, health: 61.5, energy: 40 }, run: 812.4, sea: true,
    shells: { n: 3, o: [4, 9, 12], r: ['r1_2_s3'] }, babies: ['0', 'r4_4_b1'],
    inv: { counts: { crab: 2, kelp: 3, shield: 1 }, seen: ['crab', 'kelp', 'shield'], made: ['shield'] },
    fx: { buff: { shield: 12.5, jar: 0, kelp: 40, mimic: 0, feast: 0, tonic: 6 }, ink: 2, venom: true, lethal: true },
    dens: [{ x: 10, z: 20 }, { x: -4, z: 8.5 }], decor: [], carry: null, got: ['o12', 'o40', 'r1_2_5'], explored: [50005000, 50015000],
    env: { t: 0.62, abs: 900, kind: 'rain', target: 'storm', timer: 55, heat: 0, rain: 0.8, dark: 0.3 },
    lv: { xp: 200, b: ['wander', 'baby1'], st: { cells: 30, biomes: ['bush', 'farm'], sea: false, babies: 2, gathered: 12, crafted: 1, madeAll: false, shells: 3, nightSwim: false, rainDance: 4, storm: false, escapes: 1, kills: 2, bigKill: 1, grotto: false, home: false, rare: [] } },
    journal: { seen: [], tab: 'bag' },
  });
  const f = fixture(), v = validateSave(f);
  ok(v && JSON.stringify(v) === JSON.stringify(f), 'a good save validates unchanged');
  ok(JSON.stringify(readSaveText(JSON.stringify(f))) === JSON.stringify(f), 'a save round-trips through text');
  ok(SAVE_VERSION === 8 && SAVE_KEY === 'octo.save.v2' && LEGACY_KEYS.includes('octo.save.v1'), 'save key / version (v1 stays readable through the legacy key)');
  // corruption
  const junk = ['', 'null', '[]', '42', '"x"', '{', '{"v":1}', '{"v":2}', '{"v":"1","seed":1}', '{"v":2,"seed":9,"octo":{"x":"q","z":1}}', '{"v":2,"seed":-4,"octo":{"x":1,"z":1}}', '{"v":1,"seed":-4,"octo":{"x":1,"z":1}}', '{"v":1,"seed":1.5,"octo":{"x":1,"z":1}}', '{"v":1,"seed":5,"octo":{"x":"a","z":1}}', '{"v":1,"seed":5,"octo":{"x":1e12,"z":1}}', '{"v":-1,"seed":5}', '{"v":99,"seed":5,"octo":{"x":1,"z":1}}', 'not json at all \u0000\ufffd', '{"v":1,"seed":5,"octo":null}'];
  ok(junk.every((t) => readSaveText(t) === null), `${junk.length} kinds of damaged saves are all rejected, none throws`);
  const wild = fixture(); wild.octo.health = -50; wild.octo.energy = 1e9; wild.env.t = 7; wild.env.kind = 'meteors'; wild.fx.buff.shield = 1e9; wild.fx.ink = 1e6; wild.inv.counts = { crab: -3, hax: 9, jar: 1e9 }; wild.got = ['o1', '<script>', 42, 'x'.repeat(100), 'o2']; wild.dens = [{ x: 1, z: 2 }, { x: 'a' }, null, { x: 1, z: 1 }, { x: 2, z: 2 }, { x: 3, z: 3 }]; wild.shells.o = [-1, 5, 1e9, 'a']; wild.hack = { evil: true };
  const cw = validateSave(wild);
  ok(cw && cw.octo.health === 1 && cw.octo.energy === 100 && cw.env.t === 1 && cw.env.kind === 'clear' && cw.fx.buff.shield === 600 && cw.fx.ink === 20, 'out-of-range numbers are clamped, unknown weather falls back');
  ok(cw.inv.counts.crab === undefined && cw.inv.counts.hax === undefined && cw.inv.counts.jar === 999 && cw.got.join() === 'o1,o2' && cw.dens.length === 3 && JSON.stringify(cw.shells.o) === '[5]' && !('hack' in cw), 'unknown items, odd ids, extra fields and bad dens are dropped');
  const big = fixture(); big.got = Array.from({ length: 20000 }, (_, i) => 'o' + i); big.explored = Array.from({ length: 20000 }, (_, i) => 50000000 + i);
  const cb = validateSave(big); ok(cb.got.length === 6000 && cb.explored.length === 6000, 'huge lists are capped');
  // migration
  const old = { v: 0, seed: 77, pos: { x: 5, z: -6 }, hp: 44 };
  const m0 = migrate(old, 1); ok(m0 && m0.v === 1 && m0.octo.x === 5 && m0.octo.health === 44, 'a v0 save is carried to v1');
  const m02 = migrate(old); ok(m02 && m02.v === 8 && m02.fresh === true && m02.seed === WORLD && m02.fx.lethal === false && Array.isArray(m02.journal?.seen) && Array.isArray(m02.decor), 'and on to the current save: the one world, a fresh start, no lethal dose, empty journal, no decor yet');
  ok(validateSave(m02) && validateSave(m02).seed === WORLD && validateSave(m02).octo.health === 44, 'a migrated save validates');
  ok(migrate({ v: 9, seed: 1 }) === null && migrate({ v: 1.5 }) === null && migrate({}) === null && migrate(null) === null, 'saves from a newer game or without a version are ignored');
  const table = { 0: MIGRATIONS[0], 1: (o) => ({ ...o, v: 2, extra: 'x' }), 2: (o) => ({ ...o, v: 3, more: 1 }) };
  const m3 = migrate({ v: 0, seed: 1 }, 3, table); ok(m3 && m3.v === 3 && m3.extra === 'x' && m3.more === 1, 'migrations chain one step at a time (v0 -> v3)');
  ok(migrate({ v: 1 }, 3, { 1: () => ({ v: 7 }) }) === null && migrate({ v: 1 }, 3, {}) === null && migrate({ v: 1 }, 2, { 1: () => { throw new Error('x'); } }) === null, 'a broken migration step fails safely');
  // v1 (a per-seed random world) -> v2 (the one world)
  const v1 = {
    v: 1, seed: 2026, saved: 1700000000000, octo: { x: 120.5, z: -33.25, heading: 1.2, health: 61.5, energy: 40 }, run: 812.4, sea: true,
    shells: { n: 3, o: [4, 9, 12], r: ['r1_2_s3'] }, babies: ['0', 'r4_4_b1'],
    inv: { counts: { crab: 2, kelp: 3, shield: 1 }, seen: ['crab', 'kelp', 'shield'], made: ['shield'] },
    fx: { buff: { shield: 12.5, jar: 0, kelp: 40, mimic: 0, feast: 0 }, ink: 2, venom: true },
    dens: [{ x: 10, z: 20 }], got: ['o12', 'o40'], explored: [50005000],
    env: { t: 0.62, abs: 900, kind: 'rain', target: 'storm', timer: 55, heat: 0, rain: 0.8, dark: 0.3 },
  };
  const mv = readSaveText(JSON.stringify(v1));
  ok(mv && mv.v === 8 && mv.fresh === true && mv.seed === WORLD && mv.octo.x === null && mv.octo.z === null && mv.journal.tab === 'bag' && mv.decor.length === 0 && mv.carry === null && mv.lv.st.home === false && mv.lv.st.grotto === false && Array.isArray(mv.lv.st.rare), 'a v1 save loads into the one world with no position (a fresh start is picked)');
  ok(mv.inv.counts.crab === 2 && mv.inv.counts.kelp === 3 && mv.inv.counts.shield === 1 && mv.fx.ink === 2 && mv.fx.venom === true && mv.fx.buff.kelp === 40 && mv.fx.buff.tonic === 0, 'v1: the satchel, ink, venom and effects are kept');
  ok(mv.shells.n === 3 && mv.babies.length === 2 && mv.octo.health === 61.5 && mv.octo.energy === 40 && mv.run === 812.4 && mv.sea === true && mv.env.kind === 'rain', 'v1: armour, baby tally, health, clock and weather are kept');
  ok(mv.dens.length === 0 && mv.got.length === 0 && mv.explored.length === 0 && mv.shells.o.length === 0 && mv.shells.r.length === 0, 'v1: everything tied to the old random map is dropped');
  ok(JSON.stringify(validateSave(mv)) === JSON.stringify(mv), 'a migrated v1 save is stable under validation');
  const badV1 = ['{"v":1}', '{"v":1,"seed":5,"octo":{"x":"a","z":1}}', '{"v":1,"seed":-1,"octo":{"x":1,"z":1}}', '{"v":1,"seed":5,"octo":{"x":1e12,"z":1}}', '{"v":1,"seed":5}'];
  ok(badV1.every((t) => readSaveText(t) === null), 'damaged v1 saves are still refused');
  const weird = { ...v1, inv: 'x', fx: 7, babies: 'many', shells: null, env: [] }; ok(readSaveText(JSON.stringify(weird)) !== undefined, 'odd field types in a v1 save never throw');
  // v2 -> v3 (levels & badges)
  { const v3 = { ...fixture(), v: 3, fx: { ...fixture().fx } }; delete v3.fx.lethal; delete v3.lv.st.kills; delete v3.lv.st.bigKill; const m = readSaveText(JSON.stringify(v3));
    ok(m && m.v === 8 && m.fx.lethal === false && m.lv.st.kills === 0 && m.lv.st.bigKill === 0 && m.lv.xp === 200 && m.fx.venom === true && m.octo.x === 120.5 && m.journal.seen.length === 0 && m.decor.length === 0 && m.lv.st.home === false && m.lv.st.grotto === false && Array.isArray(m.lv.st.rare), 'a v3 save migrates: no lethal dose, no kills yet, empty journal, no decor, cave unfound, no secrets yet, everything else kept'); }
  { const v2 = { ...fixture(), v: 2 }; delete v2.lv; const m = readSaveText(JSON.stringify(v2));
    ok(m && m.v === 8 && m.lv.xp === 0 && m.lv.st.cells === 2 && m.lv.st.babies === 2 && m.lv.st.sea === true && m.lv.st.shells === 3 && m.lv.st.home === false && m.lv.st.grotto === false && Array.isArray(m.lv.st.rare) && m.octo.x === 120.5, 'a v2 save migrates forward: level 1, what it already did counts towards badges, position kept'); }
  { const v6 = { ...fixture(), v: 6, lv: { ...fixture().lv, st: { ...fixture().lv.st, grotto: true, home: false } } }; delete v6.decor; delete v6.carry;
    const m = readSaveText(JSON.stringify(v6));
    ok(m && m.v === 8 && m.decor.length === 0 && m.carry === null && m.lv.st.grotto === true && m.lv.st.home === false && Array.isArray(m.lv.st.rare) && m.octo.x === 120.5, 'a v6 grotto save migrates: empty decor, nothing carried, cave flag kept'); }
  { const v7 = { ...fixture(), v: 7, decor: [{ id: 'pebble', x: 1, z: 2, rot: 0, denx: 0, denz: 0 }], carry: 'kelp', lv: { ...fixture().lv, st: { ...fixture().lv.st, grotto: true, home: true } } };
    const m = readSaveText(JSON.stringify(v7));
    ok(m && m.v === 8 && m.decor.length === 1 && m.decor[0].id === 'pebble' && m.carry === 'kelp' && m.lv.st.grotto === true && m.lv.st.home === true && Array.isArray(m.lv.st.rare) && m.octo.x === 120.5, 'a v7 den save migrates: pieces and carry kept, no secrets yet'); }
  { const w = fixture(); w.lv = { xp: -5, b: ['hax', 'sea'], st: { cells: 'x', biomes: ['<b>', 'desert'], babies: 1e12 } }; const c = validateSave(w);
    ok(c && c.lv.xp === 0 && c.lv.b.join() === 'sea' && c.lv.st.cells === 0 && c.lv.st.biomes.join() === 'desert' && c.lv.st.babies === 1e7, 'damaged level data is cleaned'); }
  // storage
  const mem = (init) => { const d = { ...init }; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: (k) => { delete d[k]; }, d }; };
  const st = mem({}); ok(loadSave(st) === null, 'no save: nothing loaded');
  ok(writeSave(f, st) && JSON.stringify(loadSave(st)) === JSON.stringify(f), 'write then load');
  st.d[SAVE_KEY] = '{{{ garbage'; ok(loadSave(st) === null && !(SAVE_KEY in st.d), 'a damaged save is dropped, not kept');
  st.d[SAVE_KEY] = JSON.stringify({ v: 9, seed: 1 }); ok(loadSave(st) === null && (SAVE_KEY in st.d), 'a save from a newer game is ignored but left alone');
  clearSave(st); ok(!(SAVE_KEY in st.d), 'clear removes it');
  { // a save left by the previous game under the old key is carried forward once, then the old key is forgotten
    const lg = mem({ [LEGACY_KEYS[0]]: JSON.stringify(v1) }), got = loadSave(lg);
    ok(got && got.v === 8 && got.fresh && got.inv.counts.crab === 2 && !(LEGACY_KEYS[0] in lg.d) && JSON.parse(lg.d[SAVE_KEY]).v === 8, 'a legacy v1 save in storage migrates, is re-saved under the new key and the old one is removed');
    const lg2 = mem({ [LEGACY_KEYS[0]]: '{broken' }); ok(loadSave(lg2) === null && !(LEGACY_KEYS[0] in lg2.d), 'a damaged legacy save is dropped');
    const lg3 = mem({ [SAVE_KEY]: JSON.stringify(f), [LEGACY_KEYS[0]]: JSON.stringify(v1) }); ok(loadSave(lg3).octo.x === f.octo.x, 'a current save wins over a legacy one');
  }
  ok(writeSave(f, { setItem() { throw new Error('quota'); } }) === false && loadSave({ getItem() { throw new Error('denied'); } }) === null, 'unavailable storage never throws');
  // transfer codes
  const code = await encodeCode(f);
  ok(/^OCTO1-[0-9a-f]{8}-[A-Za-z0-9_-]+$/.test(code), `a code is plain text (${code.length} chars)`);
  ok(JSON.stringify(await decodeCode(code)) === JSON.stringify(f), 'a code decodes to the same save');
  ok(JSON.stringify(await decodeCode(`  ${code}\n`)) === JSON.stringify(f), 'surrounding spaces are fine');
  const flip = code.slice(0, -6) + (code.at(-6) === 'A' ? 'B' : 'A') + code.slice(-5);
  const bads = ['', 'hello', code.slice(0, 20), code.slice(0, -4), flip, code.replace('OCTO1', 'OCTO2'), 'OCTO1-00000000-AAAA', code + '!!', 'OCTO0-' + code.slice(6)];
  const res = await Promise.all(bads.map((b) => decodeCode(b)));
  ok(res.every((r) => r === null), 'damaged, tampered, truncated or foreign codes are all refused');
  const bigCode = await encodeCode(validateSave(big)); ok(bigCode.length < 40000, `even a very full save makes a manageable code (${bigCode.length} chars)`);
  ok(!/[0-9]{9,}@|mail|user|name|ip/.test(JSON.stringify(f).replace(/"[a-z]*"\s*:/g, '')) && !('name' in f) && !('email' in f), 'the save carries no personal data');
}

// ================================================================ ink deterrence (t253u)
{
  const cloud = { x: 0, z: 0, r: 6.5, k: 1 };
  ok(cloudCovers(cloud, 0, 0) && cloudCovers(cloud, 6, 0) && !cloudCovers(cloud, 7, 0), 'a fully grown cloud covers its radius, not beyond');
  ok(cloudCovers(cloud, 7, 0, INK_NEAR) && !cloudCovers(cloud, 9, 0, INK_NEAR), '"near" reaches a little past the visible edge');
  ok(inkUnder([cloud], 4, 0) && !inkUnder([], 0, 0) && !inkUnder([{ x: 0, z: 0, r: 6.5, k: 0 }], 0, 0), 'inkUnder finds a covering cloud and ignores empty or ungrown ones');
  const inCloud = inkDeter('dog', 4, 0, 0, 0, [cloud]);
  ok(inCloud && inCloud.secs === INK_BLIND, 'a dog inside the cloud is deterred');
  const near = inkDeter('dog', 6.5 + INK_NEAR - 0.2, 0, 0, 0, [cloud]);
  ok(near, 'a dog just outside the visible edge is still near enough');
  ok(!inkDeter('dog', 12, 0, 0, 0, [cloud]), 'a dog well away from the cloud is not deterred');
  const crab = inkDeter('crab', 6.5 + INK_AQUA_NEAR - 0.2, 0, 0, 0, [cloud]);
  ok(crab && crab.secs === INK_AQUA_BLIND && crab.secs > INK_BLIND, 'a crab feels the cloud sooner and stays lost longer');
  const eagleOver = inkDeter('eagle', 20, 0, 0, 0, [cloud]);
  ok(eagleOver && eagleOver.secs === INK_BLIND, 'an eagle overhead loses sight when the octopus is under the cloud, even if the bird itself is not in it');
  ok(!inkDeter('eagle', INK_BIRD_RANGE + 2, 0, 0, 0, [cloud]), 'a far-off eagle is not affected by a cloud it cannot have been watching');
  ok(!inkDeter('dog', 20, 0, 0, 0, [cloud]), 'a land hunter far from the cloud is not deterred just because the octopus is under it');
  ok(!inkDeter('eagle', 15, 0, 20, 0, [cloud]), 'a bird does not lose sight if the octopus is outside the cloud');
  ok(!inkDeter('dog', 15, 0, 0, 0, [cloud]), 'a land hunter well outside the near-edge is not deterred');

  ok(AQUA.has('crab') && AQUA.has('gull') && FLYERS.has('eagle') && FLYERS.has('magpie') && FLYERS.has('kookaburra'), 'shore and flying kinds are classified');
}


// ================================================================ field journal, map cells, tabs (t254u)
{
  ok(TABS.join() === 'bag,journal,map,collection' && ENTRIES.length >= 30, `journal has ${ENTRIES.length} entries and four satchel pages`);
  ok(ENTRIES.every((e) => e.title && e.note && e.how && e.glyph && ICON_IDS.includes(e.glyph)), 'every journal entry has a title, note, discovery rule and pictogram');
  ok(ENTRIES.every((e) => e.glyph !== 'shell' && !/toughen|armou?r|counter/i.test(e.note + e.title)), 'journal notes never mention hidden shell toughening or a baby counter');
  const J = new Journal();
  ok(!J.has('kelp') && J.seeItem('kelp') && J.has('kelp') && !J.seeItem('kelp'), 'a material is discovered once, then stays known');
  ok(J.seePred('dog') && J.has('dog') && J.seeHow('baby') && J.has('octo-baby') && J.seeHow('flower') && J.has('flower'), 'creatures, a baby and a flower can be discovered');
  J.tab = 'map';
  const snap = J.toJSON(), J2 = new Journal().load(snap);
  ok(J2.has('kelp') && J2.has('dog') && J2.tab === 'map' && J2.seen.size === J.seen.size, 'the journal round-trips through JSON');
  ok(new Journal().load({ seen: ['kelp', 'hax', 7], tab: 'nope' }).tab === 'bag' && !new Journal().load({ seen: ['hax'] }).has('hax'), 'junk journal data is cleaned');
  const c = exploreCell(120, -40), u = unpackCell(c);
  ok(u.ix === 1 && u.iz === -1, 'explored cells pack and unpack as 100 m tiles');
  ok(RARE.includes('jar') && RARE.includes('fungi'), 'rare collection portraits are defined');
}

{ // t257u group separation: a flock stacked on one spot spreads out; immovable agents stay put; no allocation surprises
  const flock = Array.from({ length: 6 }, () => ({ x: 5, z: 5, y: 2, r: 0.5 }));
  ok(minGap(flock) === 0, 'a stacked flock starts fully overlapped');
  for (let k = 0; k < 40; k++) separate(flock, { passes: 3 });
  ok(minGap(flock) > 0.95, `a stacked flock of gulls spreads apart (min gap ${minGap(flock).toFixed(2)})`);
  const rock = { x: 0, z: 0, r: 1, w: 0 }, pup = { x: 0.3, z: 0, r: 0.5 };
  for (let k = 0; k < 10; k++) separate([rock, pup]);
  ok(rock.x === 0 && rock.z === 0 && Math.hypot(pup.x, pup.z) > 1.45, 'weight 0 agents are never pushed; the other one moves away');
  const far = [{ x: 0, z: 0, r: 0.5 }, { x: 40, z: 40, r: 0.5 }];
  ok(separate(far) === 0 && far[0].x === 0 && far[1].x === 40, 'distant animals are left alone');
  const ring = Array.from({ length: 30 }, (_, i) => ({ x: Math.cos(i) * 0.4, z: Math.sin(i) * 0.4, r: 0.4 }));
  for (let k = 0; k < 60; k++) separate(ring, { passes: 3 });
  ok(minGap(ring) > 0.9, `a crowd of 30 settles without overlap (min gap ${minGap(ring).toFixed(2)})`);
}


{ // adaptive music: every place has a mood, and hunt tension only follows a real hunt
  ok(BIOMES.every((n) => ROOT[n] > 0 && MOOD[n] && MOOD[n].ratio && MOOD[n].fifth), 'every biome has a root and a mood');
  const m = new Music();
  const o = { x: 0, z: 0 };
  ok(m.huntLevel(null, o) === 0 && m.huntLevel([], o) === 0, 'no predators means no hunt layer');
  ok(m.huntLevel([{ state: 'idle', x: 0, z: 0 }, { state: 'alert', x: 0, z: 0 }], o) === 0, 'idle or alert animals do not raise the hunt layer');
  ok(m.huntLevel([{ state: 'chase', x: 0, z: 0 }], o) === 1, 'a chase on top of the octopus is full tension');
  ok(m.huntLevel([{ state: 'swoop', x: 25, z: 0 }], o) === 0.5, 'hunt tension falls off with distance');
  ok(m.huntLevel([{ state: 'dive', x: 50, z: 0 }], o) === 0, 'a hunt 50 m away is silent');
  ok(m.huntLevel([{ state: 'wander', x: 0, z: 0 }, { state: 'pounce', x: 10, z: 0 }], o) > 0.79, 'the nearest hunting predator wins');
  ok(m.enabled === true && m.toggle() === false && m.toggle() === true, 'the score can be toggled off and on');
}

{ // rare finds: deterministic per tile, rare, and each one can be met
  const { RARE_IDS, planTile, rareOpen } = await import('../src/systems/rares.js');
  const { SECRET_IDS } = await import('../src/systems/journal.js');
  const w = new WorldData(45), w2 = new WorldData(2026);
  const pile = (world) => {
    const all = [];
    for (let rz = 0; rz < 4; rz++) for (let rx = 0; rx < 4; rx++) all.push(...planTile(world, rx, rz));
    return all;
  };
  const a = pile(w), b = pile(w);
  ok(JSON.stringify(a) === JSON.stringify(b), 'rare spots do not move between asks');
  const far = planTile(w, 8, -2);
  ok(JSON.stringify(far) === JSON.stringify(planTile(w, 8, -2)), 'a far tile\'s secrets are deterministic');
  const count = (list) => { const n = {}; for (const s of list) n[s.id] = (n[s.id] || 0) + 1; return n; };
  const c = count(a), c2 = count(pile(w2));
  for (const id of RARE_IDS) {
    ok(c[id] >= 1 && c[id] <= 12, `the one world has a few ${id} (${c[id] || 0})`);
    ok(c2[id] >= 1 && c2[id] <= 12, `seed 2026 has a few ${id} (${c2[id] || 0})`);
  }
  ok(a.length < 40, `secrets stay rare on the original map (${a.length})`);
  ok(a.every((s) => s.x > -800 && s.x < 800 && s.z > -800 && s.z < 800), 'original-map secrets stay inside it');
  ok(!rareOpen('glowfrog', 0.1, 1) && rareOpen('glowfrog', 0.8, 0) && !rareOpen('moonrace', 0.2, 1) && rareOpen('moonrace', 0.9, 0), 'the frog and the race only happen at night');
  ok(!rareOpen('rainbloom', 0.9, 0.1) && rareOpen('rainbloom', 0, 0.5) && rareOpen('gold', 0, 0) && rareOpen('ring', 0, 0), 'the desert flower waits for rain; shells and the ring do not');
  const L = new Levels();
  ok(!L.did('rare', 'nope') && L.badges.size === 0, 'an unknown secret is ignored');
  L.did('rare', 'gold');
  ok(L.badges.has('sgold') && L.st.rare.has('gold') && L.toJSON().st.rare.join() === 'gold', 'finding a golden shell earns its badge and is saved');
  ok(!L.did('rare', 'gold') && L.badges.size === 1, 'the same secret is only earned once');
  for (const id of ['pearl', 'glowfrog', 'rainbloom', 'moonrace', 'ring']) L.did('rare', id);
  ok(['spearl', 'sfrog', 'sbloom', 'srace', 'sring'].every((id) => L.badges.has(id)), 'each secret has its own badge');
  ok(SECRET_IDS.length === 6 && SECRET_IDS.every((id) => ENTRIES.some((e) => e.id === id && e.glyph && ICON_IDS.includes(e.glyph))), 'each secret has a journal entry and a pictogram');
}
{ // den decorations: a ring of things, then a home
  const { denNear, planSpot, countAt, HOME_NEED, DECOR_MAX } = await import('../src/systems/decor.js');
  const dens = [{ x: 0, z: 0 }, { x: 20, z: 0 }];
  ok(denNear(dens, 1, 0)?.x === 0 && denNear(dens, 19, 0)?.x === 20 && denNear(dens, 8, 0) === null, 'only a nearby den counts');
  const list = [];
  for (let i = 0; i < HOME_NEED; i++) {
    const s = planSpot(list, dens[0], i * 0.4);
    ok(s, `spot ${i} around the den`);
    list.push({ id: 'pebble', ...s, denx: 0, denz: 0 });
  }
  ok(countAt(list, 0, 0) === HOME_NEED, 'four things make a dressed den');
  ok(planSpot(list, dens[0], 0), 'the ring still has room before the cap');
  while (list.length < DECOR_MAX) { const s = planSpot(list, dens[0], list.length); if (!s) break; list.push({ id: 'kelp', ...s, denx: 0, denz: 0 }); }
  ok(list.length === DECOR_MAX && planSpot(list, dens[0], 1) === null, 'a den holds only eight decorations');
  const L = new Levels();
  L.did('home');
  ok(L.badges.has('home') && L.st.home && L.toJSON().st.home === true, 'a dressed den earns the home badge and it is saved');
  ok(!L.did('home') && L.badges.size === 1, 'the home badge is only earned once');
}

{ // the reef: one grotto per seed, current only while swimming at sea
  const { grottoOf, flowAt } = await import('../src/systems/reef.js');
  const a = new WorldData(45), b = new WorldData(45), c = new WorldData(2026);
  const ga = grottoOf(a), gb = grottoOf(b), gc = grottoOf(c);
  ok(ga.x === gb.x && ga.z === gb.z && ga.r === 8, 'the grotto is the same place for the same seed');
  ok(Math.hypot(ga.x - gc.x, ga.z - gc.z) > 1, 'a different seed can hide the grotto somewhere else');
  ok(a.isSea(ga.x, ga.z) && c.isSea(gc.x, gc.z) && a.seaDepth(ga.x, ga.z) > 1, 'the grotto sits in the sea, deep enough to swim');
  const flow = { x: 0, z: 0 };
  flowAt(a, a.start.x, a.start.z, 1, flow);
  ok(flow.x === 0 && flow.z === 0, 'there is no current on land');
  flowAt(a, ga.x, ga.z, 0.1, flow);
  ok(flow.x === 0 && flow.z === 0, 'a resting octopus is not carried');
  flowAt(a, ga.x, ga.z, 0.8, flow);
  ok(Math.hypot(flow.x, flow.z) > 0.2 && Math.hypot(flow.x, flow.z) < 1.2, `a swimming octopus gets a soft current (${Math.hypot(flow.x, flow.z).toFixed(2)})`);
  const L = new Levels();
  L.did('grotto');
  ok(L.badges.has('grotto') && L.st.grotto && L.toJSON().st.grotto === true, 'finding the grotto earns the quiet-cave badge and is saved');
  const inv = new Inventory();
  inv.add('anemone'); inv.add('coral');
  ok(inv.craft('glow-coral') && inv.count('glow') === 1 && inv.count('anemone') === 0, 'an anemone and coral make a reef light');
  inv.add('anemone'); inv.add('urchin');
  ok(inv.craft('glow-urchin') && inv.count('glow') === 2, 'an anemone and an urchin make one too');
  ok(new Journal().seeHow('grotto') === 1, 'the cave has a journal entry');
}

console.log(`unit checks passed (${checks} assertions).`);
