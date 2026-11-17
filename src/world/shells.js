// =====================================================================
//  Seashell models, built from parametric surfaces (smooth shading, natural sand / cream / pink / brown colours baked into
//  the vertices; no metal, no wireframe look): a ribbed scallop fan, a spiral turban / conch and a cowrie. Plus the big
//  "shellhide" dome that shelters a baby. All face +z, are built around the origin and are consistent with models.js
//  (non-indexed, position + normal + color only, so they merge with the primitive helpers).
// =====================================================================
import * as THREE from 'three';
import { tint, merge, at } from './models.js';

const C = (h) => new THREE.Color(h);
const mix = (a, b, t) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** build a surface from f(u, v) -> { p: [x,y,z], c: THREE.Color }, u in 0..1 (nu cells), v in 0..1 (nv cells) */
function surface(nu, nv, f, wrapV = false) {
  const pos = [], col = [], idx = [];
  const rows = nu + 1, cols = wrapV ? nv : nv + 1;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const { p, c } = f(i / nu, j / nv);
    pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < (wrapV ? nv : nv); j++) {
    const j2 = wrapV ? (j + 1) % nv : j + 1;
    const a = i * cols + j, b = i * cols + j2, c = (i + 1) * cols + j, d = (i + 1) * cols + j2;
    idx.push(a, c, b, b, c, d);
  }
  return finish(pos, col, idx);
}
function finish(pos, col, idx) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  g = g.toNonIndexed(); return g;
}

const CREAM = C(0xf3e4d2), PINK = C(0xe7b2a2), SAND = C(0xe3cba6), BROWN = C(0x8d6648), DEEP = C(0xb9806a), PEARL = C(0xfaf1ea);

/** scallop: a ribbed fan of ~9 ribs with growth lines, a thin rim and two little hinge ears. Spans about 0.55 x 0.3, 0.14 tall. */
export function scallop(variant = 0) {
  const R = 0.3, H = 0.14, T = 0.02, half = 0.95, ribs = 9;
  const fan = (under) => (u, v) => {
    const s = u, phi = (v * 2 - 1) * half;
    const rib = Math.cos((phi / half) * Math.PI * ribs);            // -1..1 across the ribs
    const edge = 1 + 0.025 * Math.abs(rib) * s;                     // slightly scalloped rim
    const rr = R * s * edge;
    const dome = H * (1 - Math.pow(s * 0.92, 2)) * (1 - 0.28 * (phi / half) ** 2);
    const y = Math.max(0, dome) + 0.012 * rib * Math.pow(s, 0.8) - (under ? T * (0.4 + 0.6 * s) : 0);
    const growth = 0.04 * Math.sin(s * 34);
    let c = mix(CREAM, variant ? SAND : PINK, 0.5 + 0.5 * rib * 0.9).lerp(DEEP, (1 - s) * 0.5);
    c = under ? mix(PEARL, CREAM, s) : c.multiplyScalar(1 + growth);
    return { p: [rr * Math.sin(phi), y, rr * Math.cos(phi) - R * 0.45], c };
  };
  // t256u audit: these were 14x72 sheets (4200 tris a shell, ~half of every frame's triangles on a beach). 4 columns per rib
  // still reads as ribbed at 20 cm scale; the underside lies on the sand so it gets very few rows.
  const top = surface(8, 36, fan(false)), bot = surface(3, 36, fan(true));
  const rim = surface(1, 36, (u, v) => {                                    // closes the gap between the two sheets along the outer edge
    const a = fan(false)(1, v), b = fan(true)(1, v); return { p: u ? b.p : a.p, c: u ? b.c : a.c };
  });
  const ear = (sx) => at(tint(new THREE.BoxGeometry(0.07, 0.03, 0.05), 0xf0dfcc), sx * 0.06, 0.022, -R * 0.45 + 0.03, 0, sx * -0.35, 0);
  return merge([top, bot, rim, ear(1), ear(-1)]);
}

/** turban / conch: a tube that spirals up and shrinks (3 whorls), flared aperture, spiral colour bands and fine ridges. ~0.4 wide. */
export function turban() {
  const turns = 3.2, nu = Math.round(turns * 10), nv = 10, q = 0.52;
  const geo = surface(nu, nv, (u, v) => {
    const th = u * turns * Math.PI * 2, g = Math.pow(q, th / (Math.PI * 2)), a = v * Math.PI * 2;
    const flare = 1 + 0.45 * Math.exp(-th * 1.6);
    const rt = 0.098 * g * flare * (1 + 0.05 * Math.sin(th * 7)) ;
    const Rc = 0.17 * g, yc = 0.2 * (1 - g) + 0.1;
    const rx = Math.cos(th), rz = Math.sin(th);
    const rad = Rc + rt * Math.cos(a) * 1.0;
    const p = [rx * rad, yc + rt * Math.sin(a) * 1.05, rz * rad];
    const band = 0.5 + 0.5 * Math.sin(a * 2 + th * 0.6);              // stripes that follow the whorl
    let c = mix(CREAM, BROWN, band * 0.55 + (1 - g) * 0.25).lerp(PINK, 0.12 * (1 - band));
    c = c.multiplyScalar(0.8 + 0.2 * (0.5 + 0.5 * Math.sin(a - 0.6)));  // lighter on top, darker underneath
    return { p, c };
  }, true);
  geo.rotateX(-0.75); geo.rotateY(0.6);
  return geo;
}

/** cowrie: a glossy, humped oval with a toothed slit along the underside; sits tilted so the slit shows. ~0.4 long. */
export function cowrie() {
  const a = 0.21, b = 0.135, c = 0.15;
  const body = surface(10, 16, (u, v) => {
    const lat = u * Math.PI, lon = v * Math.PI * 2;
    const x = Math.cos(lat), y = Math.sin(lat) * Math.cos(lon), z = Math.sin(lat) * Math.sin(lon);
    const hump = 1 + 0.12 * Math.max(0, y);
    const p = [x * a * (1 - 0.1 * Math.abs(y) * 0), y * b * hump, z * c * (1 - 0.18 * x * x)];
    const dorsal = Math.max(0, y), spot = hash(Math.floor(x * 9) * 7 + Math.floor(z * 9) * 13) > 0.78 ? 0.35 : 0;
    let col = mix(CREAM, BROWN, Math.pow(dorsal, 0.7) * 0.9 + spot * dorsal);
    if (y < -0.35) col = mix(col, PEARL, 0.8);
    col = col.lerp(CREAM, Math.pow(Math.abs(z), 3) * 0.5);
    return { p, c: col };
  }, true);
  const parts = [body, at(tint(new THREE.SphereGeometry(1, 8, 4), 0x6a4a3a), 0, -b * 0.88, 0, 0, 0, 0, a * 0.82, 0.012, 0.022)];
  for (let i = -2.5; i <= 2.5; i++) for (const s of [-1, 1]) parts.push(at(tint(new THREE.BoxGeometry(0.02, 0.012, 0.032), 0xf7ece0), i * 0.058, -b * 0.84, s * 0.036, 0.25 * s, 0, 0));
  const g = merge(parts); g.rotateX(-1.15); return g;
}

/** the big hide-away shell (props.js 'shellhide'): a ribbed dome (about 2.2 x 0.8 x 2.6) with a dark mouth at the front (+z) */
export function bigShell() {
  const dome = surface(8, 40, (u, v) => {
    const psi = u * Math.PI / 2, phi = v * Math.PI * 2;
    const rib = Math.cos(phi * 10), rr = 1 + 0.05 * rib * Math.sin(psi * 2);
    const p = [Math.sin(psi) * Math.cos(phi) * 1.1 * rr, Math.cos(psi) * 0.8 * rr, Math.sin(psi) * Math.sin(phi) * 1.3 * rr];
    const c = mix(CREAM, PINK, 0.5 + 0.5 * rib).lerp(DEEP, (1 - u) * 0.0 + 0.25 * (1 - Math.sin(psi))).multiplyScalar(1 + 0.04 * Math.sin(psi * 11));
    return { p, c };
  }, true);
  const mouth = at(tint(new THREE.SphereGeometry(1, 10, 6), 0x4a3535), 0, 0.3, 1.24, 0, 0, 0, 0.62, 0.42, 0.16);
  return merge([dome, mouth]);
}
