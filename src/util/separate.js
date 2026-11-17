// =====================================================================
//  Boids-style separation on a spatial hash (t257u): animals of every kind (and of the same kind) never interpenetrate.
//  Each agent is { x, z, r, y?, w? } (r = body radius, y = height for birds in the air, w = 0..1 how readily it gets pushed:
//  0 = immovable). Overlapping pairs are pushed apart along the line between them, split by weight; a couple of relaxation
//  passes settle tight groups. The hash lives across calls (no per-frame allocation once warm).
// =====================================================================
const grid = new Map();
const pool = [];
let used = 0;
const cellList = () => { if (used >= pool.length) pool.push([]); const a = pool[used++]; a.length = 0; return a; };
const key = (ix, iz) => ((ix + 32768) & 0xffff) * 65536 + ((iz + 32768) & 0xffff);

/**
 * push overlapping agents apart; returns the number of overlapping pairs found in the first pass.
 * `apply(agent, dx, dz, dy)` moves an agent (lets the caller keep it out of walls / water); default: add to x/z/y.
 */
export function separate(agents, { cell = 3, passes = 2, slack = 1.0, apply = null } = {}) {
  let first = 0;
  for (let pass = 0; pass < passes; pass++) {
    grid.clear(); used = 0;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i], k = key(Math.floor(a.x / cell), Math.floor(a.z / cell));
      let l = grid.get(k); if (!l) { l = cellList(); grid.set(k, l); }
      l.push(i);
    }
    let pairs = 0;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i], ix = Math.floor(a.x / cell), iz = Math.floor(a.z / cell);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const l = grid.get(key(ix + dx, iz + dz)); if (!l) continue;
        for (const j of l) {
          if (j <= i) continue;
          const b = agents[j];
          const min = (a.r + b.r) * slack;
          let ox = b.x - a.x, oz = b.z - a.z, oy = (a.y !== undefined && b.y !== undefined) ? b.y - a.y : 0;
          const d2 = ox * ox + oz * oz + oy * oy;
          if (d2 >= min * min) continue;
          pairs++;
          let d = Math.sqrt(d2);
          if (d < 1e-4) { const t = (i * 7.31 + j * 3.17) % 6.2832; ox = Math.cos(t); oz = Math.sin(t); oy = 0; d = 1; }  // exactly stacked: split on a stable pseudo-random axis
          const over = min - Math.min(d, min), wa = a.w ?? 1, wb = b.w ?? 1, sum = wa + wb || 1;
          const ux = ox / d, uz = oz / d, uy = oy / d;
          const ka = over * (wa / sum), kb = over * (wb / sum);
          if (apply) { if (ka) apply(a, -ux * ka, -uz * ka, -uy * ka); if (kb) apply(b, ux * kb, uz * kb, uy * kb); }
          else { a.x -= ux * ka; a.z -= uz * ka; b.x += ux * kb; b.z += uz * kb; if (a.y !== undefined && b.y !== undefined) { a.y -= uy * ka; b.y += uy * kb; } }
        }
      }
    }
    if (pass === 0) first = pairs;
    if (!pairs) break;
  }
  return first;
}
/** smallest centre distance between any two agents relative to their combined radii (1 = just touching); for tests */
export function minGap(agents) {
  let m = Infinity;
  for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) {
    const a = agents[i], b = agents[j], oy = (a.y !== undefined && b.y !== undefined) ? b.y - a.y : 0;
    m = Math.min(m, Math.hypot(b.x - a.x, b.z - a.z, oy) / (a.r + b.r));
  }
  return m;
}
