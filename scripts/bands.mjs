// Banded world checks (no browser): band order south -> north, the start in the sea by the big shell, the edges hold,
// v9 -> v10 save migration, landmarks sit on the ground, and predators get denser (and sharper-eyed) going north.
import assert from 'node:assert/strict';
import { WorldData } from '../src/world/worldData.js';
import { BANDS, BAND_IDS, EDGE, AGGRO, planLife, bandArea, SHORE_Z } from '../src/world/bands.js';
import { BIOMES } from '../src/world/biomes.js';
import { CONFIG } from '../src/config.js';
import { readSaveText, SAVE_VERSION } from '../src/systems/save.js';
import { mulberry32 } from '../src/util/rng.js';
import { buildGeoLib } from '../src/world/geoLib.js';
import { seat, instanceSpec, geoHeight } from '../src/world/placement.js';
import * as THREE from 'three';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const t0 = performance.now();
const w = new WorldData(CONFIG.worldSeed);

// ---- band order: south (+z) to north, each band its own biomes
ok(BAND_IDS.join() === 'sea,shore,town,bush,outback,waste', `bands run sea > shore > town > bush > outback > waste (${BAND_IDS.join()})`);
for (let i = 1; i < BANDS.length; i++) ok(BANDS[i].z1 === BANDS[i - 1].z0 && BANDS[i].danger > BANDS[i - 1].danger, `band ${BANDS[i].id} lies north of ${BANDS[i - 1].id} and is harder`);
const dom = (x, z) => w.biomeAt(x, z);
const lineBands = []; for (let z = EDGE.sea - 5; z > EDGE.north + 5; z -= 5) { const b = w.bandAt(0, z); if (lineBands[lineBands.length - 1] !== b) lineBands.push(b); }
ok(lineBands.join() === '0,1,2,3,4,5', `walking north from the sea crosses every band once, in order (${lineBands.join()})`);
const expect = { 2: ['suburb', 'town', 'farm', 'riverbank'], 3: ['bush', 'wetland', 'rainforest', 'riverbank'], 4: ['mudflat', 'desert', 'riverbank'], 5: ['wasteland', 'riverbank'] };
for (const [bi, names] of Object.entries(expect)) {
  const b = BANDS[bi], z = (Math.max(b.z0, EDGE.north) + Math.min(b.z1, SHORE_Z)) / 2; let hit = 0, tot = 0;
  for (let x = EDGE.west + 60; x < EDGE.east - 60; x += 20) { tot++; if (names.includes(dom(x, z))) hit++; }
  ok(hit / tot > 0.9, `the middle of the ${b.id} band is its own biomes (${(100 * hit / tot).toFixed(0)}%)`);
}
ok(dom(-200, -420) === 'mudflat' && dom(400, -330) === 'desert', 'mud flats on the west of the outback band, red desert on the east');
ok(BIOMES.every((b) => { const s = w.findBiomeSpot(b); return s && w.biomeAt(s.x, s.z) === b; }), 'every biome can be found');
ok(w.landmarks.some((l) => l.kind === 'factory') && w.smoke?.length === 2 && w.landmarks.some((l) => l.kind === 'octoshell') && w.oasis, 'the shell, the factory with smoking stacks and the oasis exist');
ok(!w.props.some((p) => /castle|keep|turret|rampart|battlement/.test(p.kind)), 'no castle props');
ok(w.waters.filter((q) => q.kind === 'sludge').length >= 10 && w.waters.filter((q) => q.kind === 'sludge').every((q) => w.bandAt(q.x, q.z) === 5 && (q.alt === 0 || q.alt === 1)), 'sludge pools only in the wasteland, purple or yellow');
ok(w.gather.filter((g) => g.kind === 'beetle').every((g) => ['bush', 'riverbank'].includes(dom(g.x, g.z))), 'beetles stay in the bush and by the river');

// ---- the start: in the sea, a few strokes from the big shell
const rs = mulberry32(9);
for (let i = 0; i < 40; i++) {
  const p = w.pickSpawn(rs, false), d = w.seaLevel - w.heightAt(p.x, p.z);
  ok(w.isSea(p.x, p.z) && Math.hypot(p.x - w.shell.x, p.z - w.shell.z) < 30 && d > 0.3 && d < 2.6, `spawn ${i} is in the sea near the shell (depth ${d.toFixed(2)})`);
}

// ---- boundaries hold: resolve() never lets anything past the ranges or the sea edge
const out = {};
for (const [x, z] of [[-2000, 0], [2000, 0], [0, -2000], [0, 3000], [-900, -900], [900, 900], [EDGE.west - 30, 100]]) {
  const r = w.resolve(x, z, 0.3, out);
  ok(r.x >= EDGE.west - 26.01 && r.x <= EDGE.east + 26.01 && r.z >= EDGE.north - 26.01 && r.z <= EDGE.sea + 0.01, `(${x}, ${z}) is held inside the map (${r.x.toFixed(0)}, ${r.z.toFixed(0)})`);
}
ok(w.heightAt(0, EDGE.north - 120) > 25 && w.heightAt(EDGE.west - 120, 0) > 25, 'the ranges rise beyond the edges');
ok(w.regions.ensure(0, 0, 5000) === 0, 'no far tiles');

// ---- v9 -> v10: old saves load fresh, keeping what was earned
{
  const v9 = { v: 9, seed: CONFIG.worldSeed, fresh: false, saved: 1, octo: { x: 3000, z: -9000, heading: 1, health: 80, energy: 50 }, run: 10, sea: true,
    shells: { n: 4, o: [1, 2], r: [] }, babies: ['3', '9', 'r1_1_b2'], inv: { counts: { kelp: 2 }, seen: ['kelp'], made: [] }, fx: { buff: {}, ink: 1, venom: false, lethal: false },
    dens: [{ x: 1, z: 1 }], decor: [{ id: 'pebble', x: 1, z: 1, rot: 0, denx: 1, denz: 1 }], carry: 'kelp', got: ['o1'], explored: [50005000],
    env: { t: 0.5, abs: 1, kind: 'clear', target: 'clear', timer: 5, heat: 0, rain: 0, dark: 0 },
    lv: { xp: 450, b: ['wander', 'sea'], st: { cells: 40, biomes: ['beach'] } }, journal: { seen: ['ant'], tab: 'bag' } };
  const m = readSaveText(JSON.stringify(v9));
  ok(SAVE_VERSION === 10 && m && m.v === 10 && m.fresh && m.octo.x === null, 'a v9 save migrates to v10 with no old position');
  ok(m.inv.counts.kelp === 3 && m.inv.counts.pebble === 1 && m.lv.xp === 450 && m.lv.b.join() === 'wander,sea' && m.journal.seen.includes('ant') && m.shells.n === 4 && m.babies.length === 3, 'items, levels, badges, journal and tallies are kept');
  const W2 = new WorldData(CONFIG.worldSeed); W2.setSpawn(3000, -9000);
  ok(W2.start.x <= EDGE.east + 26 && W2.start.z >= EDGE.north - 26, 'a far-away saved position is moved back inside the map');
}

// ---- nothing floats: the new landmarks and props sit on the ground
{
  const L = buildGeoLib(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const p of w.props.filter((q) => ['octoshell', 'factory', 'outfall', 'ruin', 'hoist', 'letterbox', 'sheep', 'arch', 'coralhead', 'plank'].includes(q.kind))) {
    const g = L.propGeo(p.kind);
    seat(w, g, instanceSpec('prop', p.kind, p, geoHeight(g)), m);
    g.computeBoundingBox(); const bb = g.boundingBox; v.set(0, bb.min.y, 0).applyMatrix4(m); const bottom = v.y;
    // the lowest point must touch the ground somewhere under the footprint (the ground may slope under a wide prop)
    let top = -Infinity;
    for (const [fx, fz] of [[0, 0], [bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.min.x, bb.max.z], [bb.max.x, bb.max.z]]) { v.set(fx, bb.min.y, fz).applyMatrix4(m); top = Math.max(top, w.heightAt(v.x, v.z)); }
    ok(bottom - top < 0.02, `${p.kind} at ${p.x.toFixed(0)},${p.z.toFixed(0)} sits on the ground (${(bottom - top).toFixed(3)})`);
  }
}

// ---- predators: denser and sharper-eyed going north, none in the sea
{
  const Wp = new WorldData(CONFIG.worldSeed), life = planLife(Wp, { safe: 35 }), dens = [];
  for (let i = 1; i < BANDS.length; i++) dens.push(life.filter((a) => a.band === i).length / bandArea(i));
  for (let i = 1; i < dens.length; i++) ok(dens[i] > dens[i - 1], `predators per hectare rise northward (${dens.map((d) => d.toFixed(2)).join(' < ')})`);
  ok(life.every((a) => a.band >= 1 && Wp.bandAt(a.x, a.z) === a.band), 'every predator lives in its own band, none out at sea');
  ok(life.every((a) => Math.hypot(a.x - Wp.start.x, a.z - Wp.start.z) > 35), 'nobody spawns on top of the start');
  for (let i = 1; i < AGGRO.length; i++) ok(AGGRO[i] > AGGRO[i - 1], 'animals notice the octopus from further away up north');
  const kinds = (bi) => new Set(life.filter((a) => a.band === bi).map((a) => a.kind));
  ok(kinds(5).has('dog') && kinds(5).has('fox') && !kinds(1).has('fox'), 'the wasteland has the tough hunters; the shore has none');
}
console.log(`bands checks passed (${n} assertions, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
