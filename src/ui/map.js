// =====================================================================
//  The satchel's hand-drawn map (t256u): kelp paper, watercolour biome washes with soft blended edges, a blobby
//  fog-of-war, doodled icons, a dotted wander-trail, an octopus compass rose and hand-lettered biome names that never
//  overlap. Only what has been explored is drawn; the sea is neither drawn nor named until it has been found.
//  Pure canvas-2D (no ctx.filter, so it looks the same in Safari); it is redrawn only when the map page opens.
// =====================================================================
import { BIOME_INFO } from '../world/biomes.js';

const INK = 'rgba(58, 52, 34, 0.78)';
const FONT = '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Patrick Hand", cursive';
/** watercolour wash per biome (a little more saturated than the lighting tints, which are mostly near-white) */
export const WASH = {
  suburb: [158, 196, 120], town: [176, 172, 182], farm: [226, 200, 120], bush: [120, 168, 104], riverbank: [118, 178, 186],
  wetland: [104, 150, 120], dunes: [238, 214, 150], beach: [244, 226, 170], headland: [150, 158, 170], estuary: [120, 186, 190],
  sea: [96, 160, 206], desert: [222, 140, 96], rainforest: [72, 140, 88],
};
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/** deterministic paper texture: base colour, fibres and stains (same every time, so the page doesn't shimmer) */
function paper(ctx, W, H) {
  ctx.fillStyle = '#cfd9b6'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) {
    const x = hash(i, 1) * W, y = hash(i, 2) * H, r = 30 + hash(i, 3) * 110;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${hash(i, 4) < 0.5 ? '120,110,60' : '250,250,230'},0.07)`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.strokeStyle = 'rgba(90, 100, 50, 0.10)'; ctx.lineWidth = 1;
  for (let i = 0; i < 140; i++) {            // kelp fibres
    const x = hash(i, 5) * W, y = hash(i, 6) * H, a = hash(i, 7) * 0.6 - 0.3, l = 10 + hash(i, 8) * 40;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + l / 2, y + Math.sin(a) * l * 0.5 + 3, x + l * Math.cos(a), y + l * Math.sin(a)); ctx.stroke();
  }
  // darker deckled border
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(80, 70, 30, 0.28)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

/** small doodles, drawn in ink with a slightly wobbly hand */
const DOODLE = {
  tree(c, x, y, s) { c.beginPath(); c.moveTo(x, y + s); c.lineTo(x, y + s * 0.2); c.stroke(); c.beginPath(); c.arc(x - s * 0.35, y, s * 0.42, 0, 6.28); c.arc(x + s * 0.35, y - s * 0.05, s * 0.4, 0, 6.28); c.arc(x, y - s * 0.4, s * 0.45, 0, 6.28); c.fill(); },
  palm(c, x, y, s) { c.beginPath(); c.moveTo(x, y + s); c.quadraticCurveTo(x + s * 0.2, y, x + s * 0.1, y - s * 0.4); c.stroke(); for (let i = 0; i < 5; i++) { const a = -2.6 + i * 0.55; c.beginPath(); c.moveTo(x + s * 0.1, y - s * 0.4); c.quadraticCurveTo(x + Math.cos(a) * s * 0.5, y - s * 0.9, x + Math.cos(a) * s * 0.9, y - s * 0.4 + Math.sin(a + 1.6) * s * 0.1); c.stroke(); } },
  house(c, x, y, s) { c.beginPath(); c.moveTo(x - s * 0.6, y + s * 0.6); c.lineTo(x - s * 0.6, y - s * 0.05); c.lineTo(x, y - s * 0.65); c.lineTo(x + s * 0.6, y - s * 0.05); c.lineTo(x + s * 0.6, y + s * 0.6); c.closePath(); c.stroke(); c.strokeRect(x - s * 0.14, y + s * 0.18, s * 0.28, s * 0.42); },
  wave(c, x, y, s) { for (let k = 0; k < 2; k++) { c.beginPath(); for (let i = 0; i <= 12; i++) { const t = i / 12; c.lineTo(x - s + t * s * 2, y + k * s * 0.5 + Math.sin(t * 9.4) * s * 0.18); } c.stroke(); } },
  wheat(c, x, y, s) { for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(x + k * s * 0.3, y + s); c.quadraticCurveTo(x + k * s * 0.35, y, x + k * s * 0.5, y - s * 0.6); c.stroke(); c.beginPath(); c.ellipse(x + k * s * 0.5, y - s * 0.65, s * 0.12, s * 0.28, k * 0.3, 0, 6.28); c.fill(); } },
  reed(c, x, y, s) { for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(x + k * s * 0.25, y + s); c.quadraticCurveTo(x + k * s * 0.3, y, x + k * s * 0.45, y - s * 0.5); c.stroke(); } c.beginPath(); c.ellipse(x, y - s * 0.2, s * 0.1, s * 0.3, 0, 0, 6.28); c.fill(); },
  dune(c, x, y, s) { c.beginPath(); c.moveTo(x - s, y + s * 0.4); c.quadraticCurveTo(x - s * 0.3, y - s * 0.6, x + s * 0.2, y + s * 0.1); c.quadraticCurveTo(x + s * 0.6, y - s * 0.3, x + s, y + s * 0.4); c.stroke(); },
  rock(c, x, y, s) { c.beginPath(); c.moveTo(x - s * 0.8, y + s * 0.4); c.quadraticCurveTo(x - s * 0.6, y - s * 0.5, x, y - s * 0.45); c.quadraticCurveTo(x + s * 0.7, y - s * 0.4, x + s * 0.8, y + s * 0.4); c.closePath(); c.stroke(); },
  cactus(c, x, y, s) { c.beginPath(); c.moveTo(x, y + s); c.lineTo(x, y - s * 0.6); c.moveTo(x, y); c.quadraticCurveTo(x - s * 0.5, y, x - s * 0.5, y - s * 0.4); c.moveTo(x, y + s * 0.2); c.quadraticCurveTo(x + s * 0.5, y + s * 0.2, x + s * 0.5, y - s * 0.3); c.stroke(); },
  fern(c, x, y, s) { c.beginPath(); c.moveTo(x, y + s); c.quadraticCurveTo(x + s * 0.4, y, x + s * 0.1, y - s * 0.8); c.stroke(); for (let i = 1; i < 5; i++) { const t = i / 5, px = x + s * 0.3 * Math.sin(t * 2.5), py = y + s - t * s * 1.7; c.beginPath(); c.moveTo(px, py); c.lineTo(px - s * 0.35 * (1 - t), py - s * 0.15); c.moveTo(px, py); c.lineTo(px + s * 0.35 * (1 - t), py - s * 0.15); c.stroke(); } },
  jetty(c, x, y, s) { c.strokeRect(x - s * 0.8, y - s * 0.12, s * 1.6, s * 0.24); for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(x + i * s * 0.35, y + s * 0.12); c.lineTo(x + i * s * 0.35, y + s * 0.5); c.stroke(); } },
};
const BIOME_DOODLE = { suburb: 'house', town: 'house', farm: 'wheat', bush: 'tree', riverbank: 'reed', wetland: 'reed', dunes: 'dune', beach: 'palm', headland: 'rock', estuary: 'jetty', sea: 'wave', desert: 'cactus', rainforest: 'fern' };

function shellDoodle(c, x, y, s) {      // a den: a little spiral shell
  c.fillStyle = '#f3dcc9'; c.beginPath(); c.ellipse(x, y, s, s * 0.8, 0, 0, 6.28); c.fill(); c.stroke();
  c.beginPath(); for (let i = 0; i < 26; i++) { const a = i * 0.45, r = s * (1 - i / 30) * 0.8; c.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.7); } c.stroke();
}
function babyDoodle(c, x, y, s) {      // a tiny octopus with a heart
  c.fillStyle = '#e9b98d'; c.beginPath(); c.ellipse(x, y - s * 0.2, s * 0.6, s * 0.5, 0, 0, 6.28); c.fill(); c.stroke();
  for (let i = 0; i < 4; i++) { const ax = x - s * 0.45 + i * s * 0.3; c.beginPath(); c.moveTo(ax, y + s * 0.2); c.quadraticCurveTo(ax + (i % 2 ? 0.2 : -0.2) * s, y + s * 0.55, ax, y + s * 0.8); c.stroke(); }
  c.fillStyle = 'rgba(70,140,230,0.9)'; c.beginPath(); c.arc(x - s * 0.2, y - s * 0.25, s * 0.09, 0, 6.28); c.arc(x + s * 0.2, y - s * 0.25, s * 0.09, 0, 6.28); c.fill();
}
function puddleDoodle(c, x, y, s) { c.fillStyle = 'rgba(90, 170, 220, 0.55)'; c.beginPath(); c.ellipse(x, y, s, s * 0.55, 0.3, 0, 6.28); c.fill(); c.strokeStyle = 'rgba(40, 100, 150, 0.55)'; c.stroke(); }

/** the compass rose: an octopus whose eight arms point to N, NE, E, ...; the N arm curls up and carries the letter */
function compass(c, x, y, s) {
  c.save(); c.translate(x, y);
  c.strokeStyle = INK; c.fillStyle = 'rgba(232, 196, 150, 0.9)'; c.lineWidth = 1.6; c.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 4, L = s * (i % 2 ? 0.62 : 1), w = i % 2 ? 1.1 : 1.8;
    c.lineWidth = w;
    c.beginPath(); c.moveTo(Math.cos(a) * s * 0.22, Math.sin(a) * s * 0.22);
    const mx = Math.cos(a + 0.25) * L * 0.6, my = Math.sin(a + 0.25) * L * 0.6, ex = Math.cos(a) * L, ey = Math.sin(a) * L;
    c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
    c.beginPath(); c.arc(ex + Math.cos(a + 1.6) * 2.2, ey + Math.sin(a + 1.6) * 2.2, 2.2, a, a + 4); c.stroke();   // curled tip
  }
  c.lineWidth = 1.6;
  c.beginPath(); c.ellipse(0, 0, s * 0.3, s * 0.26, 0, 0, 6.28); c.fill(); c.stroke();
  c.fillStyle = INK; c.beginPath(); c.arc(-s * 0.1, -s * 0.03, 1.6, 0, 6.28); c.arc(s * 0.1, -s * 0.03, 1.6, 0, 6.28); c.fill();
  c.strokeStyle = 'rgba(60,130,220,0.85)'; c.lineWidth = 1;
  for (const [rx, ry] of [[-0.14, 0.1], [0.14, 0.1], [0, 0.14]]) { c.beginPath(); c.arc(rx * s, ry * s, 1.8, 0, 6.28); c.stroke(); }
  c.fillStyle = INK; c.font = `bold ${Math.round(s * 0.42)}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('N', 0, -s * 1.28);
  c.restore();
}

/** hand-lettered label along a gentle arc, centred at (x, y), rotated by `ang`; returns nothing (layout picks the spot) */
function arcText(c, text, x, y, ang, bend) {
  const w = c.measureText(text).width;
  c.save(); c.translate(x, y); c.rotate(ang);
  let px = -w / 2;
  for (const ch of text) {
    const cw = c.measureText(ch).width, t = (px + cw / 2) / (w / 2 || 1);
    c.save(); c.translate(px + cw / 2, bend * t * t * w * 0.5); c.rotate(bend * t * 1.0);
    c.fillText(ch, 0, 0); c.restore();
    px += cw;
  }
  c.restore();
}

/** pick label boxes that never overlap each other, the compass or the edges (greedy, biggest region first) */
export function placeLabels(items, W, H, blocked = []) {
  const placed = [...blocked], out = [];
  const hit = (b) => b.x0 < 6 || b.y0 < 6 || b.x1 > W - 6 || b.y1 > H - 6 || placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
  const offs = [[0, 0], [0, -22], [0, 22], [-30, -12], [30, -12], [-30, 14], [30, 14], [0, -44], [0, 44], [-60, 0], [60, 0], [-50, -34], [50, -34], [-50, 34], [50, 34], [0, -66], [0, 66]];
  for (const it of [...items].sort((a, b) => b.n - a.n)) {
    let done = null;
    for (const [dx, dy] of offs) {
      const x = it.x + dx, y = it.y + dy, hw = it.w / 2 + 4, hh = 11 + Math.abs(it.ang) * it.w * 0.25;
      const b = { x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh };
      if (!hit(b)) { done = { ...it, x, y, box: b }; break; }
    }
    if (done) { placed.push(done.box); out.push(done); }
  }
  return out;
}

/**
 * draw the map
 * @param ctx 2D context, W/H canvas size
 * @param d { cells:[{x,z}] explored 100 m cells (centres), biomeAt(x,z), seaOk, trail:[x,z,...], dens:[{x,z}], babies:[{x,z}], puddles:[{x,z}], me:{x,z,heading} }
 */
export function drawMap(ctx, W, H, d) {
  paper(ctx, W, H);
  const cells = d.cells.filter((q) => d.seaOk || d.biomeAt(q.x, q.z) !== 'sea');
  if (!cells.length) { compass(ctx, W - 54, H - 64, 26); return { labels: [] }; }
  let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
  for (const q of cells) { minX = Math.min(minX, q.x); minZ = Math.min(minZ, q.z); maxX = Math.max(maxX, q.x); maxZ = Math.max(maxZ, q.z); }
  const pad = 170; minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
  const sc = Math.min(W / (maxX - minX), H / (maxZ - minZ));
  const ox = (W - (maxX - minX) * sc) / 2, oz = (H - (maxZ - minZ) * sc) / 2;
  const to = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];

  // ---- 1. watercolour washes on their own layer: soft overlapping blots sampled every 25 m inside explored cells
  const wash = document.createElement('canvas'); wash.width = W; wash.height = H;
  const wc = wash.getContext('2d');
  const step = 25, rBlot = Math.max(6, step * sc * 1.25);
  const groups = new Map();
  for (const q of cells) for (let iz = 0; iz < 4; iz++) for (let ix = 0; ix < 4; ix++) {
    const x = q.x - 50 + (ix + 0.5) * step + (hash(q.x + ix, q.z + iz) - 0.5) * 10, z = q.z - 50 + (iz + 0.5) * step + (hash(q.z + iz, q.x - ix) - 0.5) * 10;
    const b = d.biomeAt(x, z);
    if (b === 'sea' && !d.seaOk) continue;
    const col = WASH[b] || [200, 210, 180];
    const [px, py] = to(x, z), r = rBlot * (0.85 + hash(x, z) * 0.4);
    const g = wc.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.55)`); g.addColorStop(0.6, `rgba(${col[0]},${col[1]},${col[2]},0.32)`); g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    wc.fillStyle = g; wc.fillRect(px - r, py - r, r * 2, r * 2);
    const gg = groups.get(b) || { x: 0, z: 0, n: 0, pts: [] }; gg.x += x; gg.z += z; gg.n++; gg.pts.push(x, z); groups.set(b, gg);
  }
  // anchor each name on the wash itself: the sample nearest the biome's centroid (a scattered biome's centroid can be in the fog)
  for (const g of groups.values()) { const cx = g.x / g.n, cz = g.z / g.n; let bd = 1e18; for (let i = 0; i < g.pts.length; i += 2) { const dd = (g.pts[i] - cx) ** 2 + (g.pts[i + 1] - cz) ** 2; if (dd < bd) { bd = dd; g.ax = g.pts[i]; g.az = g.pts[i + 1]; } } }
  // ---- 2. blobby fog-of-war: a soft mask of overlapping circles around every explored cell; the wash only shows inside it
  const mask = document.createElement('canvas'); mask.width = W; mask.height = H;
  const mc = mask.getContext('2d');
  for (const q of cells) for (let k = 0; k < 3; k++) {
    const [px, py] = to(q.x + (hash(q.x, k) - 0.5) * 50, q.z + (hash(k, q.z) - 0.5) * 50), r = (62 + hash(q.x + k, q.z) * 30) * sc;
    const g = mc.createRadialGradient(px, py, r * 0.45, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    mc.fillStyle = g; mc.fillRect(px - r, py - r, r * 2, r * 2);
  }
  wc.globalCompositeOperation = 'destination-in'; wc.drawImage(mask, 0, 0);
  // a darker "pigment pooling" rim: the mask's edge, offset a hair
  ctx.save(); ctx.globalAlpha = 0.16; ctx.drawImage(mask, 1.5, 2); ctx.restore();
  ctx.drawImage(wash, 0, 0);
  // granulation speckles inside the explored area
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(120,110,80,0.10)';
  for (let i = 0; i < 260; i++) { const x = hash(i, 11) * W, y = hash(i, 12) * H; ctx.beginPath(); ctx.arc(x, y, 0.6 + hash(i, 13) * 1.3, 0, 6.28); ctx.fill(); }
  ctx.restore();

  // ---- 3. dotted wander-trail
  const tr = d.trail || [];
  if (tr.length >= 4) {
    ctx.save(); ctx.strokeStyle = 'rgba(120, 60, 40, 0.55)'; ctx.lineWidth = 1.6; ctx.setLineDash([1, 5]); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < tr.length; i += 2) {
      const [x, y] = to(tr[i], tr[i + 1]);
      const jump = i === 0 || Math.hypot(tr[i] - tr[i - 2], tr[i + 1] - tr[i - 1]) > 45;      // a den hop / new start: lift the pen
      if (jump) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.restore();
  }
  // ---- 4. biome doodles (one or two per biome group, at the busiest spots)
  ctx.save(); ctx.strokeStyle = INK; ctx.fillStyle = 'rgba(70, 90, 50, 0.55)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const icons = [];
  for (const [b, g] of groups) {
    if (b === 'sea' && !d.seaOk) continue;
    const f = DOODLE[BIOME_DOODLE[b]]; if (!f) continue;
    const [x, y] = to(g.ax ?? g.x / g.n, g.az ?? g.z / g.n);
    const s = Math.max(5, Math.min(11, 3 + Math.sqrt(g.n) * 0.8));
    icons.push({ b, x, y: y + 18, s }); f(ctx, x, y + 18, s);
  }
  for (const p of (d.puddles || []).slice(0, 14)) { const [x, y] = to(p.x, p.z); puddleDoodle(ctx, x, y, 3 + hash(p.x, p.z) * 2); }
  ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
  for (const den of d.dens || []) { const [x, y] = to(den.x, den.z); shellDoodle(ctx, x, y, 6.5); }
  for (const b of d.babies || []) { const [x, y] = to(b.x, b.z); babyDoodle(ctx, x, y, 6); }
  ctx.restore();

  // ---- 5. labels (hand-lettered, slightly angled and curved, never overlapping each other, the icons or the compass)
  ctx.save();
  ctx.font = `16px ${FONT}`; ctx.fillStyle = 'rgba(52, 46, 28, 0.82)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const comp = { x0: W - 100, x1: W - 6, y0: H - 116, y1: H - 6 };
  const blocked = [comp, ...icons.map((i) => ({ x0: i.x - i.s, x1: i.x + i.s, y0: i.y - i.s, y1: i.y + i.s }))];
  const items = [];
  for (const [b, g] of groups) {
    if (b === 'sea' && !d.seaOk) continue;
    const label = BIOME_INFO[b]?.label || b; const [x, y] = to(g.ax, g.az);
    items.push({ b, label, x, y: y - 6, n: g.n, w: ctx.measureText(label).width, ang: (hash(g.n, b.length) - 0.5) * 0.24, bend: (hash(b.length, g.n) - 0.5) * 0.18 });
  }
  const labels = placeLabels(items, W, H, blocked);
  for (const l of labels) arcText(ctx, l.label, l.x, l.y, l.ang, l.bend);
  ctx.restore();

  // ---- 6. you-are-here: a little octopus head in blue ink with a heading tick
  if (d.me) {
    const [x, y] = to(d.me.x, d.me.z);
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 6.28); ctx.fill();
    ctx.fillStyle = '#3d8fe0'; ctx.strokeStyle = '#1d4f86'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, -1, 5, 4.4, 0, 0, 6.28); ctx.fill(); ctx.stroke();
    for (let i = 0; i < 4; i++) { const ax = -3.6 + i * 2.4; ctx.beginPath(); ctx.moveTo(ax, 2.5); ctx.quadraticCurveTo(ax + (i % 2 ? 1.2 : -1.2), 5.5, ax, 7.5); ctx.stroke(); }
    ctx.restore();
  }
  compass(ctx, W - 56, H - 66, 30);
  return { labels };
}
