// =====================================================================
//  Houses, the hedge maze and the small places (pure data, no three.js).
//  Everything comes from the world seed, so the same world hides the same doors.
//  The sea-road (the ray from home toward the water) is left clear: the maze sits off to the side.
// =====================================================================
import { mulberry32 } from '../util/rng.js';

export const POI_IDS = ['shed', 'drain', 'garden', 'light', 'play'];
export const POI_SET = new Set(POI_IDS);
export const LAYOUTS = ['lounge', 'kitchen', 'laundry', 'hall'];
export const FLOORS = ['tile', 'board', 'rug'];
export const HOME_TARGET = 16;
export const MAZE_N = 9;
export const MAZE_CELL = 1.42;

const hash = (seed, i) => {
  let h = Math.imul((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** distance from the ray that runs from home toward the sea. Inland of home counts as "not on the way". */
export function rayDist(world, x, z) {
  const h = world.home, d = world.dir;
  const dx = x - h.x, dz = z - h.z;
  const t = dx * d.x + dz * d.z;
  if (t < 18) return 1e6;
  return Math.hypot(dx - d.x * t, dz - d.z * t);
}

/** odd-sized grid of 1 = hedge, 0 = path. Entrance on the south edge, open middle. */
export function carveMaze(seed, n = MAZE_N) {
  const walls = Array.from({ length: n }, () => Array(n).fill(1));
  const rnd = mulberry32(seed >>> 0);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const carve = (x, z) => {
    walls[z][x] = 0;
    const ord = dirs.slice();
    for (let i = ord.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = ord[i]; ord[i] = ord[j]; ord[j] = t;
    }
    for (let i = 0; i < ord.length; i++) {
      const dx = ord[i][0], dz = ord[i][1];
      const nx = x + dx * 2, nz = z + dz * 2;
      if (nx > 0 && nz > 0 && nx < n - 1 && nz < n - 1 && walls[nz][nx]) {
        walls[z + dz][x + dx] = 0;
        carve(nx, nz);
      }
    }
  };
  carve(1, 1);
  const mid = (n / 2) | 0;
  for (let z = mid - 1; z <= mid + 1; z++) for (let x = mid - 1; x <= mid + 1; x++) walls[z][x] = 0;
  walls[n - 1][mid] = 0;
  walls[n - 2][mid] = 0;
  return walls;
}

export function mazeOpen(walls, x, z) {
  return z >= 0 && x >= 0 && z < walls.length && x < walls[z].length && walls[z][x] === 0;
}

/** breath-first from the south gate to the middle. Returns true when the centre is reachable. */
export function mazeReachable(walls) {
  const n = walls.length, mid = (n / 2) | 0;
  const q = [[mid, n - 1]], seen = new Uint8Array(n * n);
  seen[(n - 1) * n + mid] = 1;
  for (let i = 0; i < q.length; i++) {
    const x = q[i][0], z = q[i][1];
    if (Math.abs(x - mid) <= 1 && Math.abs(z - mid) <= 1) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = nz * n + nx;
      if (!mazeOpen(walls, nx, nz) || seen[k]) continue;
      seen[k] = 1; q.push([nx, nz]);
    }
  }
  return false;
}

/** open cells worth a puddle, a gnome or a lost ball */
export function mazeDress(walls) {
  const n = walls.length, mid = (n / 2) | 0;
  const puddles = [], dead = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    if (!mazeOpen(walls, x, z)) continue;
    const centre = Math.abs(x - mid) <= 1 && Math.abs(z - mid) <= 1;
    const gate = z === n - 1 && x === mid;
    if (!centre && !gate && (x * 3 + z) % 5 === 0) puddles.push([x, z]);
    if (centre || gate) continue;
    let nb = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (mazeOpen(walls, x + dx, z + dz)) nb++;
    if (nb === 1) dead.push([x, z]);
  }
  return { puddles, dead, mid, gate: [mid, n - 1] };
}

function spot(world, opt, avoid) {
  const home = world.home, dir = world.dir, perp = world.perp;
  let loose = null;
  for (let i = 0; i < 180; i++) {
    const side = i % 2 ? 1 : -1;
    const along = side * (opt.along0 + (i % 19) * opt.alongStep);
    const inland = opt.inland0 + ((i * 3) % 15) * opt.inlandStep;
    const x = home.x + perp.x * along - dir.x * inland;
    const z = home.z + perp.z * along - dir.z * inland;
    if (Math.abs(x) > world.half - 26 || Math.abs(z) > world.half - 26) continue;
    const b = world.biomeAt(x, z);
    if (opt.biomes && !opt.biomes.includes(b)) continue;
    if (world.isSea(x, z) || world.waterAt(x, z) || world.isRoad(x, z, opt.road ?? 3)) continue;
    if (Math.hypot(x - home.x, z - home.z) < (opt.minHome ?? 36)) continue;
    if (rayDist(world, x, z) < (opt.minLine ?? 0)) continue;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r || 22))) continue;
    const y = world.heightAt(x, z);
    if (!(y > 0.35)) continue;
    const rec = { x, z, y };
    if (!world._blocked(x, z, opt.pad ?? 5)) return rec;
    if (!loose) loose = rec;
  }
  return loose;
}

/**
 * @returns {{ homes: object[], maze: object|null, pois: object[] }}
 * homes: pet-door houses. maze: one hedge maze. pois: shed, drain pair, garden, lighthouse, playground.
 */
export function planPlaces(world) {
  const seed = world.seed >>> 0;
  const cand = [];
  for (let i = 0; i < world.houses.length; i++) {
    const h = world.houses[i];
    if (!h || h.farm || !(h.w > 2) || !(h.d > 2)) continue;
    cand.push(h);
  }
  cand.sort((a, b) => a.x - b.x || a.z - b.z);
  const pool = cand.filter((h) => Math.hypot(h.x - world.home.x, h.z - world.home.z) > 16);
  const chosen = [];
  while (chosen.length < HOME_TARGET && pool.length) {
    let best = 0, bd = -1;
    for (let i = 0; i < pool.length; i++) {
      const h = pool[i];
      let d = Math.hypot(h.x - world.home.x, h.z - world.home.z) * 0.2;
      for (let k = 0; k < chosen.length; k++) d += Math.hypot(h.x - chosen[k].x, h.z - chosen[k].z);
      if (d > bd) { bd = d; best = i; }
    }
    chosen.push(pool.splice(best, 1)[0]);
  }
  const homes = chosen.map((h, n) => {
    const layout = LAYOUTS[Math.floor(hash(seed, n * 3 + 1) * LAYOUTS.length)];
    const floor = FLOORS[Math.floor(hash(seed, n * 5 + 2) * FLOORS.length)];
    const r = hash(seed, n * 11 + 4);
    const pet = r < 0.62 ? (hash(seed, n * 13 + 5) < 0.5 ? 'cat' : 'dog') : null;
    const baby = hash(seed, n * 19 + 6) < 0.28;
    const tint = [0xe8d9c2, 0xd7e4ea, 0xf3e7c2, 0xf6d7cc][Math.floor(hash(seed, n * 7 + 8) * 4)];
    return {
      id: 'h' + n, x: h.x, z: h.z, y: h.y, w: h.w, d: h.d,
      layout, floor, pet, baby, tint,
      door: { x: h.x - h.w * 0.28, z: h.z + h.d / 2 + 0.85, y: h.y },
      entry: h.y,
    };
  });

  const avoid = [];
  const mazeAt = spot(world, { biomes: ['farm', 'suburb', 'bush'], minHome: 70, minLine: 36, pad: 11, along0: 50, alongStep: 13, inland0: 40, inlandStep: 8, road: 6 }, avoid);
  let maze = null;
  if (mazeAt) {
    const walls = carveMaze(seed ^ 0x51ed);
    maze = { ...mazeAt, n: MAZE_N, cell: MAZE_CELL, walls, seed: (seed ^ 0x51ed) >>> 0 };
    avoid.push({ x: maze.x, z: maze.z, r: 28 });
  }

  const pois = [];
  const shed = spot(world, { biomes: ['suburb', 'farm'], minHome: 40, pad: 2.2, along0: 36, alongStep: 9, inland0: 18, inlandStep: 7 }, avoid);
  if (shed) { pois.push({ id: 'shed', ...shed }); avoid.push({ ...shed, r: 22 }); }
  const d1 = spot(world, { biomes: ['suburb', 'town'], minHome: 30, pad: 1.4, along0: 24, alongStep: 15, inland0: 16, inlandStep: 6 }, avoid);
  const d2 = d1 && spot(world, { biomes: ['suburb', 'town'], minHome: 30, pad: 1.4, along0: 80, alongStep: 12, inland0: 20, inlandStep: 8 }, avoid.concat([{ x: d1.x, z: d1.z, r: 70 }]));
  if (d1 && d2) { pois.push({ id: 'drain', x: d1.x, z: d1.z, y: d1.y, x2: d2.x, z2: d2.z, y2: d2.y }); avoid.push({ x: d1.x, z: d1.z, r: 18 }, { x: d2.x, z: d2.z, r: 18 }); }
  const garden = spot(world, { biomes: ['farm', 'suburb'], minHome: 48, pad: 4, along0: 60, alongStep: 10, inland0: 28, inlandStep: 9 }, avoid);
  if (garden) { pois.push({ id: 'garden', ...garden }); avoid.push({ ...garden, r: 20 }); }
  const lh = (world.landmarks || []).find((l) => l.kind === 'lighthouse');
  if (lh) pois.push({ id: 'light', x: lh.x, z: lh.z, y: lh.y ?? world.heightAt(lh.x, lh.z) });
  const play = spot(world, { biomes: ['suburb', 'town'], minHome: 34, pad: 3.5, along0: 42, alongStep: 11, inland0: 22, inlandStep: 7 }, avoid);
  if (play) pois.push({ id: 'play', ...play });

  return { homes, maze, pois };
}

/** which small surprise the real-world date turns on. Stable for a whole Perth day. */
export function dailyKind(date = new Date()) {
  let s = '2026-01-01';
  try { s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
  catch { /* keep fallback */ }
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return { key: s, kind: ['critter', 'flower', 'door'][(h >>> 0) % 3], n: h >>> 0 };
}
