// =====================================================================
//  Tree integrity: every primitive of a tree model (trunk, branch, crown blob, frond, root ...) must touch the rest, so no
//  foliage floats free of its trunk. The primitives are convex solids, so two touch when a sample point of one lies inside (or
//  within eps of) the other. Used by scripts/placement.mjs and scripts/unit.mjs.
// =====================================================================
function planes(tri) {
  const out = [];
  for (let i = 0; i < tri.length; i += 9) {
    const ax = tri[i], ay = tri[i + 1], az = tri[i + 2];
    const ux = tri[i + 3] - ax, uy = tri[i + 4] - ay, uz = tri[i + 5] - az, vx = tri[i + 6] - ax, vy = tri[i + 7] - ay, vz = tri[i + 8] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-12) continue;
    nx /= l; ny /= l; nz /= l;
    out.push([nx, ny, nz, nx * ax + ny * ay + nz * az]);
  }
  return out;
}
function samples(tri) {
  const pts = [];
  for (let i = 0; i < tri.length; i += 9) {
    const a = [tri[i], tri[i + 1], tri[i + 2]], b = [tri[i + 3], tri[i + 4], tri[i + 5]], c = [tri[i + 6], tri[i + 7], tri[i + 8]];
    pts.push(a, b, c);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) pts.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
    pts.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
  }
  return pts;
}
const inside = (pl, p, eps) => { for (const q of pl) if (q[0] * p[0] + q[1] * p[1] + q[2] * p[2] - q[3] > eps) return false; return true; };

/** returns { parts, components: [[part indexes]...], loose: [part indexes not connected to the largest component] } */
export function treeConnectivity(parts, eps = 0.04) {
  const P = parts.map((t) => ({ pl: planes(t), pts: samples(t) }));
  const n = P.length, adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const touch = P[i].pts.some((p) => inside(P[j].pl, p, eps)) || P[j].pts.some((p) => inside(P[i].pl, p, eps));
    if (touch) { adj[i].push(j); adj[j].push(i); }
  }
  const seen = new Array(n).fill(false), comps = [];
  for (let i = 0; i < n; i++) if (!seen[i]) { const c = [], st = [i]; seen[i] = true; while (st.length) { const k = st.pop(); c.push(k); for (const m of adj[k]) if (!seen[m]) { seen[m] = true; st.push(m); } } comps.push(c); }
  comps.sort((a, b) => b.length - a.length);
  return { parts: n, components: comps, loose: comps.slice(1).flat() };
}
