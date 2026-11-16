// Debug render of the one world: a top-down biome map (colour = dominant biome, blended by the soft weights, shaded by relief).
//   node scripts/biomemap.mjs out.png [halfWidthMetres=1000] [pixels=1000] [seed]
// White dots = a sample of possible start points, the black ring = the canonical "home" garden. Legend colours are in BIOME_RGB below.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { WorldData } from '../src/world/worldData.js';
import { BIOMES } from '../src/world/biomes.js';
import { CONFIG } from '../src/config.js';
import { mulberry32 } from '../src/util/rng.js';

export const BIOME_RGB = {
  suburb: [150, 190, 120], town: [150, 150, 160], farm: [226, 205, 120], bush: [70, 130, 70], riverbank: [90, 170, 190],
  wetland: [90, 120, 90], dunes: [232, 210, 150], beach: [250, 240, 200], headland: [120, 110, 120], estuary: [150, 200, 190], sea: [40, 110, 170],
};
const out = process.argv[2] || 'biomemap.png', half = +process.argv[3] || 1000, px = +process.argv[4] || 1000, seed = process.argv[5] ? +process.argv[5] : CONFIG.worldSeed;
const w = new WorldData(seed);
const img = Buffer.alloc(px * px * 3), step = (half * 2) / px;
for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
  const x = -half + (i + 0.5) * step, z = -half + (j + 0.5) * step;
  const q = w.biomes.weights(x, z); let r = 0, g = 0, b = 0;
  for (let k = 0; k < q.length; k++) { const c = BIOME_RGB[BIOMES[k]]; r += c[0] * q[k]; g += c[1] * q[k]; b += c[2] * q[k]; }
  const h = w.heightAt(x, z), hx = w.heightAt(x + 4, z) - w.heightAt(x - 4, z), sh = 1 + Math.max(-0.25, Math.min(0.25, hx * 0.07 + Math.max(0, h) * 0.01));
  const o = (j * px + i) * 3; img[o] = Math.min(255, r * sh); img[o + 1] = Math.min(255, g * sh); img[o + 2] = Math.min(255, b * sh);
}
const dot = (x, z, rad, c) => { const ci = (x + half) / step, cj = (z + half) / step; for (let j = Math.floor(cj - rad); j <= cj + rad; j++) for (let i = Math.floor(ci - rad); i <= ci + rad; i++) { if (i < 0 || j < 0 || i >= px || j >= px) continue; const d = Math.hypot(i - ci, j - cj); if (d <= rad && d > rad - 1.6 || (c.fill && d <= rad)) { const o = (j * px + i) * 3; img[o] = c.r; img[o + 1] = c.g; img[o + 2] = c.b; } } };
const rs = mulberry32(5); for (let k = 0; k < 40; k++) { const p = w.pickSpawn(rs, false); dot(p.x, p.z, 3.2, { r: 255, g: 255, b: 255, fill: true }); }
dot(w.home.x, w.home.z, 7, { r: 0, g: 0, b: 0 });
// the original map's edge (thin dark line) so the endless land beyond it is visible
for (const e of [-w.half, w.half]) for (let t = 0; t < px; t++) for (const [i, j] of [[(e + half) / step, t], [t, (e + half) / step]]) { const ii = Math.floor(i), jj = Math.floor(j); if (ii >= 0 && jj >= 0 && ii < px && jj < px && t % 6 < 3) { const o = (jj * px + ii) * 3; img[o] = img[o] * 0.55; img[o + 1] = img[o + 1] * 0.55; img[o + 2] = img[o + 2] * 0.55; } }
// PNG
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cc]); };
const raw = Buffer.alloc((px * 3 + 1) * px); for (let j = 0; j < px; j++) { raw[j * (px * 3 + 1)] = 0; img.copy(raw, j * (px * 3 + 1) + 1, j * px * 3, (j + 1) * px * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(px, 0); ihdr.writeUInt32BE(px, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out, `(${px}px, ±${half} m, seed ${seed})`);
