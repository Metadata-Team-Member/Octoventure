// =====================================================================
//  Ambient critters (t241u / t255u): harmless life going about its business near
//  the octopus, in the soft-toon style with outlines. Skinks bask and dart, ants
//  march, dragonflies hover and zip, ghost crabs sidle and burrow. New in t255u:
//  frogs hop at the water's edge, hermit crabs wander the sand, butterflies
//  flutter, and small fairy-wrens hop and flit. All of them may come a little
//  closer out of curiosity, then startle and flee; some tuck themselves away at
//  night or in the rain. None can be hurt. Each discovered kind is noted in the
//  field journal.
//
//  Performance: one InstancedMesh per kind (8 draw calls, plus thin outline
//  hulls except for ants), small fixed pools recycled around the player, all
//  scratch objects preallocated, ground heights for an ant trail sampled once
//  when it is placed.
// =====================================================================
import * as THREE from 'three';
import { toonMat, outlineMat, outline } from '../world/toon.js';
import { tint, merge, at } from '../world/models.js';
import { separate } from '../util/separate.js';

const SKINK_B = new Set(['desert', 'bush', 'suburb', 'farm', 'headland', 'dunes', 'rainforest', 'riverbank']);
const ANT_B = new Set(['desert', 'bush', 'suburb', 'farm', 'town', 'dunes', 'rainforest']);
const FLY_B = new Set(['wetland', 'riverbank', 'estuary', 'rainforest', 'farm']);
const CRAB_B = new Set(['beach', 'dunes', 'estuary', 'headland']);
const FROG_B = new Set(['wetland', 'rainforest', 'riverbank', 'estuary']);
const HERM_B = new Set(['beach', 'dunes', 'estuary']);
const BUTT_B = new Set(['bush', 'rainforest', 'wetland', 'farm', 'suburb', 'riverbank', 'dunes']);
const WREN_B = new Set(['bush', 'farm', 'suburb', 'wetland', 'rainforest', 'riverbank']);
const NS = 10, NT = 6, PER = 22, NF = 8, NC = 8, NFR = 6, NH = 6, NB = 8, NW = 6, R_FAR = 46;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _zero = new THREE.Vector3(0, 0, 0);

const sph = (r, s = 6, t = 5) => new THREE.SphereGeometry(r, s, t);
const eye = (x, y, z, r = 0.012) => at(tint(sph(r, 5, 4), 0x1a1a1a), x, y, z);

function skinkGeo() {
  return merge([
    at(tint(sph(1, 7, 5), 0x6b5a3e), 0, 0.05, 0, 0, 0, 0, 0.07, 0.045, 0.2),
    at(tint(sph(1, 7, 5), 0x7a6748), 0, 0.055, 0.2, 0, 0, 0, 0.05, 0.04, 0.07),
    at(tint(new THREE.ConeGeometry(0.032, 0.4, 5), 0x5c4c34), 0, 0.04, -0.35, -Math.PI / 2, 0, 0),
    at(tint(new THREE.BoxGeometry(0.2, 0.015, 0.03), 0x4e4030), 0, 0.02, 0.1),
    at(tint(new THREE.BoxGeometry(0.2, 0.015, 0.03), 0x4e4030), 0, 0.02, -0.1),
    at(tint(new THREE.BoxGeometry(0.03, 0.005, 0.28), 0xc9b98a), 0, 0.093, 0),
    eye(0.018, 0.072, 0.245, 0.013), eye(-0.018, 0.072, 0.245, 0.013),
  ]);
}
function antGeo() {
  return merge([
    at(tint(sph(1, 5, 4), 0x1a0f0a), 0, 0.012, 0.026, 0, 0, 0, 0.011, 0.01, 0.013),
    at(tint(sph(1, 5, 4), 0x24140c), 0, 0.012, 0.004, 0, 0, 0, 0.01, 0.009, 0.012),
    at(tint(sph(1, 5, 4), 0x24140c), 0, 0.012, -0.016, 0, 0, 0, 0.013, 0.011, 0.018),
    at(tint(new THREE.BoxGeometry(0.018, 0.003, 0.003), 0x1a0f0a), 0, 0.02, 0.036, 0, 0, 0.6),
  ]);
}
function flyGeo() {
  return merge([
    at(tint(new THREE.CylinderGeometry(0.012, 0.007, 0.28, 5), 0x2a7fb8), 0, 0, 0, Math.PI / 2, 0, 0),
    at(tint(sph(0.026, 6, 5), 0x1f5f8a), 0, 0, 0.14),
    at(tint(sph(0.012, 5, 4), 0x143048), -0.016, 0.008, 0.15),
    at(tint(sph(0.012, 5, 4), 0x143048), 0.016, 0.008, 0.15),
    at(tint(new THREE.BoxGeometry(0.36, 0.003, 0.055), 0xd8eef8), 0, 0.012, 0.07),
    at(tint(new THREE.BoxGeometry(0.3, 0.003, 0.045), 0xd8eef8), 0, 0.008, 0.0),
  ]);
}
function crabGeo() {
  const legs = [];
  for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) legs.push(at(tint(new THREE.BoxGeometry(0.11, 0.012, 0.014), 0xd9c9a3), sd * 0.085, 0.03, -0.04 + i * 0.027, 0, 0, sd * -0.5));
  return merge([
    at(tint(sph(1, 7, 5), 0xe6d6b0), 0, 0.045, 0, 0, 0, 0, 0.075, 0.032, 0.06),
    at(tint(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 4), 0xcbb98f), -0.03, 0.08, 0.045),
    at(tint(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 4), 0xcbb98f), 0.03, 0.08, 0.045),
    eye(-0.03, 0.107, 0.045, 0.011), eye(0.03, 0.107, 0.045, 0.011),
    at(tint(new THREE.BoxGeometry(0.035, 0.025, 0.04), 0xf0e2c0), -0.07, 0.04, 0.07),
    at(tint(new THREE.BoxGeometry(0.025, 0.02, 0.03), 0xf0e2c0), 0.06, 0.04, 0.07),
    ...legs,
  ]);
}
function frogGeo() {
  return merge([
    at(tint(sph(1, 7, 5), 0x5a8f3a), 0, 0.045, 0, 0, 0, 0, 0.08, 0.05, 0.1),
    at(tint(sph(0.04, 6, 5), 0x6aa048), -0.032, 0.095, 0.055),
    at(tint(sph(0.04, 6, 5), 0x6aa048), 0.032, 0.095, 0.055),
    eye(-0.032, 0.108, 0.066, 0.015), eye(0.032, 0.108, 0.066, 0.015),
    at(tint(new THREE.BoxGeometry(0.055, 0.022, 0.09), 0x4e7a32), -0.055, 0.02, -0.05),
    at(tint(new THREE.BoxGeometry(0.055, 0.022, 0.09), 0x4e7a32), 0.055, 0.02, -0.05),
    at(tint(new THREE.BoxGeometry(0.04, 0.016, 0.05), 0x4e7a32), -0.045, 0.02, 0.06),
    at(tint(new THREE.BoxGeometry(0.04, 0.016, 0.05), 0x4e7a32), 0.045, 0.02, 0.06),
  ]);
}
function hermitGeo() {
  return merge([
    at(tint(sph(1, 7, 5), 0xc47a4a), 0, 0.055, -0.01, 0, 0, 0, 0.07, 0.06, 0.08),           // borrowed shell
    at(tint(new THREE.ConeGeometry(0.03, 0.08, 5), 0xb86b3c), 0, 0.11, -0.02, 0.4, 0, 0),
    at(tint(sph(1, 6, 5), 0xd9c9a3), 0, 0.04, 0.07, 0, 0, 0, 0.04, 0.03, 0.05),             // face
    eye(-0.016, 0.055, 0.1, 0.01), eye(0.016, 0.055, 0.1, 0.01),
    at(tint(new THREE.BoxGeometry(0.08, 0.012, 0.014), 0xd9c9a3), -0.05, 0.025, 0.04, 0, 0, 0.5),
    at(tint(new THREE.BoxGeometry(0.08, 0.012, 0.014), 0xd9c9a3), 0.05, 0.025, 0.04, 0, 0, -0.5),
  ]);
}
function butterflyGeo() {
  return merge([
    at(tint(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 5), 0x2a2218), 0, 0, 0, Math.PI / 2, 0, 0),
    at(tint(sph(0.014, 5, 4), 0x1a140e), 0, 0, 0.05),
    at(tint(new THREE.CircleGeometry(0.085, 6), 0xe07a3a), -0.07, 0.01, 0, -0.2, 0, 0.4),
    at(tint(new THREE.CircleGeometry(0.085, 6), 0xe8b84a), 0.07, 0.01, 0, -0.2, 0, -0.4),
    at(tint(new THREE.CircleGeometry(0.05, 6), 0xf2d48a), -0.05, 0.005, -0.05, -0.2, 0, 0.5),
    at(tint(new THREE.CircleGeometry(0.05, 6), 0xf2d48a), 0.05, 0.005, -0.05, -0.2, 0, -0.5),
  ]);
}
function wrenGeo() {
  return merge([
    at(tint(sph(1, 7, 5), 0x3a6fbf), 0, 0.05, 0, 0, 0, 0, 0.045, 0.04, 0.07),              // splendid blue
    at(tint(sph(1, 6, 5), 0x2a4f8a), 0, 0.055, 0.07, 0, 0, 0, 0.032, 0.03, 0.035),
    at(tint(new THREE.ConeGeometry(0.01, 0.04, 4), 0xc9a06a), 0, 0.05, 0.11, Math.PI / 2, 0, 0),
    at(tint(new THREE.BoxGeometry(0.02, 0.04, 0.07), 0x1f3f6a), 0, 0.07, -0.08, 0.6, 0, 0),  // cocked tail
    eye(-0.012, 0.068, 0.09, 0.008), eye(0.012, 0.068, 0.09, 0.008),
    at(tint(new THREE.BoxGeometry(0.01, 0.03, 0.01), 0x1a1a1a), -0.015, 0.015, 0.01),
    at(tint(new THREE.BoxGeometry(0.01, 0.03, 0.01), 0x1a1a1a), 0.015, 0.015, 0.01),
  ]);
}

function hide(mesh, i) { _m.compose(_p.set(0, -999, 0), _q.identity(), _zero); mesh.setMatrixAt(i, _m); }
function pose(mesh, i, x, y, z, yaw, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
  _q.setFromEuler(_e.set(pitch, yaw, roll)); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); mesh.setMatrixAt(i, _m);
}

export class Critters {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.mat = toonMat({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    const mk = (geo, n) => {
      const m = new THREE.InstancedMesh(geo, this.mat, n);
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      for (let i = 0; i < n; i++) hide(m, i);
      scene.add(m); return m;
    };
    this.skMesh = mk(skinkGeo(), NS); this.antMesh = mk(antGeo(), NT * PER);
    this.flyMesh = mk(flyGeo(), NF); this.crMesh = mk(crabGeo(), NC);
    this.frMesh = mk(frogGeo(), NFR); this.hmMesh = mk(hermitGeo(), NH);
    this.buMesh = mk(butterflyGeo(), NB); this.wrMesh = mk(wrenGeo(), NW);
    this.lineMat = outlineMat(0x231a12);
    this.hulls = [this.skMesh, this.flyMesh, this.crMesh, this.frMesh, this.hmMesh, this.buMesh, this.wrMesh].flatMap((m) => outline(m, this.lineMat));
    this.sk = Array.from({ length: NS }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, run: 0, walk: 0, bask: 0, t: Math.random() * 5, cur: 0 }));
    this.tr = Array.from({ length: NT }, () => ({ on: false, x: 0, z: 0, a: 0, len: 3, hs: new Float32Array(9), ph: Math.random() }));
    this.fl = Array.from({ length: NF }, () => ({ on: false, x: 0, z: 0, y: 0, ax: 0, az: 0, tx: 0, tz: 0, ty: 0, g: 0, t: 0, h: 0 }));
    this.cr = Array.from({ length: NC }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, dir: 1, t: 0, run: 0, dig: 0, cur: 0 }));
    this.fr = Array.from({ length: NFR }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, hop: 0, air: 0, t: Math.random() * 3, wet: 0 }));
    this.hm = Array.from({ length: NH }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, dir: 1, t: 0, run: 0, hide: 0 }));
    this.bu = Array.from({ length: NB }, () => ({ on: false, x: 0, z: 0, y: 0, ax: 0, az: 0, tx: 0, tz: 0, ty: 0, t: 0, h: 0, land: 0 }));
    this.wr = Array.from({ length: NW }, () => ({ on: false, x: 0, z: 0, y: 0, g: 0, h: 0, hop: 0, fly: 0, t: 0, tx: 0, tz: 0, ty: 0 }));
    this.slot = 0; this.T = 0;
  }

  /** a random ground spot 8..34 m from the player whose biome allows `set` (null if none on this try) */
  spot(o, set, { wet = false, nearWater = false } = {}) {
    const w = this.world, a = Math.random() * 6.2832, d = 8 + Math.random() * 26;
    const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
    if (!set.has(w.biomeAt(x, z))) return null;
    const inWater = !!w.waterAt?.(x, z);
    if (wet) { if (!inWater && w.heightAt(x, z) < 0.15) return [x, z]; if (inWater) return [x, z]; return null; }
    if (inWater || w.heightAt(x, z) < 0.4 || w._blocked?.(x, z, 0.4)) return null;
    if (nearWater) {
      let ok = false;
      for (let i = 0; i < 6; i++) {
        const ang = i * 1.05, wx = x + Math.cos(ang) * 1.6, wz = z + Math.sin(ang) * 1.6;
        if (w.waterAt?.(wx, wz)) { ok = true; break; }
      }
      if (!ok) return null;
    }
    return [x, z];
  }

  respawn(o, night, rain) {
    const total = NS + NT + NF + NC + NFR + NH + NB + NW;
    const k = this.slot++ % total, w = this.world;
    const far = (c) => !c.on || Math.abs(c.x - o.x) > R_FAR || Math.abs(c.z - o.z) > R_FAR;
    const place = (c, set, extra = {}) => {
      c.on = false; const s = this.spot(o, set, extra); if (!s) return false;
      c.on = true; c.x = s[0]; c.z = s[1]; c.y = w.heightAt(c.x, c.z); return true;
    };
    if (k < NS) {
      const c = this.sk[k]; if (!far(c) && !(night > 0.6) && !(rain > 0.65)) return;
      c.on = false; if (night > 0.6 || rain > 0.65) return;
      if (place(c, SKINK_B)) { c.h = Math.random() * 6.28; c.run = 0; c.walk = 0; c.bask = 1 + Math.random() * 3; c.cur = 0; }
    } else if (k < NS + NT) {
      const c = this.tr[k - NS]; if (!far(c) && !(rain > 0.7)) return;
      c.on = false; if (rain > 0.7) return;
      const s = this.spot(o, ANT_B); if (!s) return;
      c.on = true; c.x = s[0]; c.z = s[1]; c.a = Math.random() * 6.28; c.len = 2.5 + Math.random() * 2.5;
      for (let i = 0; i < 9; i++) { const f = i / 8 - 0.5; c.hs[i] = w.heightAt(c.x + Math.cos(c.a) * f * c.len, c.z + Math.sin(c.a) * f * c.len); }
    } else if (k < NS + NT + NF) {
      const c = this.fl[k - NS - NT]; if (!far(c) && !(night > 0.6) && !(rain > 0.7)) return;
      c.on = false; if (night > 0.6 || rain > 0.7) return;
      if (place(c, FLY_B)) { c.ax = c.x; c.az = c.z; c.g = c.y; c.y = c.g + 1; c.t = 0; c.tx = c.x; c.tz = c.z; c.ty = c.y; }
    } else if (k < NS + NT + NF + NC) {
      const c = this.cr[k - NS - NT - NF]; if (!far(c) && c.dig < 1) return;
      c.on = false; if (!place(c, CRAB_B)) return;
      c.h = Math.random() * 6.28; c.dir = Math.random() < 0.5 ? -1 : 1; c.t = 0; c.run = 0; c.dig = 0; c.cur = 0;
    } else if (k < NS + NT + NF + NC + NFR) {
      const c = this.fr[k - NS - NT - NF - NC]; if (!far(c)) return;
      const s = this.spot(o, FROG_B, { nearWater: Math.random() < 0.7 }) || this.spot(o, FROG_B, { wet: true }) || this.spot(o, FROG_B);
      c.on = false; if (!s) return;
      c.on = true; c.x = s[0]; c.z = s[1]; c.y = w.heightAt(c.x, c.z); c.h = Math.random() * 6.28; c.hop = 0; c.air = 0; c.t = Math.random() * 2; c.wet = w.waterAt?.(c.x, c.z) ? 1 : 0;
    } else if (k < NS + NT + NF + NC + NFR + NH) {
      const c = this.hm[k - NS - NT - NF - NC - NFR]; if (!far(c) && c.hide < 1) return;
      if (!place(c, HERM_B)) return;
      c.h = Math.random() * 6.28; c.dir = Math.random() < 0.5 ? -1 : 1; c.t = 0; c.run = 0; c.hide = 0;
    } else if (k < NS + NT + NF + NC + NFR + NH + NB) {
      const c = this.bu[k - NS - NT - NF - NC - NFR - NH]; if (!far(c) && !(night > 0.55) && !(rain > 0.5)) return;
      c.on = false; if (night > 0.55 || rain > 0.5) return;
      if (place(c, BUTT_B)) { c.ax = c.x; c.az = c.z; c.y = c.y + 0.4; c.tx = c.x; c.tz = c.z; c.ty = c.y; c.t = 0; c.land = 0; }
    } else {
      const c = this.wr[k - NS - NT - NF - NC - NFR - NH - NB]; if (!far(c) && !(night > 0.6) && !(rain > 0.8)) return;
      c.on = false; if (night > 0.6) return;
      if (place(c, WREN_B)) { c.g = c.y; c.h = Math.random() * 6.28; c.hop = 0; c.fly = 0; c.t = Math.random() * 2; c.tx = c.x; c.tz = c.z; c.ty = c.y; }
    }
  }

  /** t257u: critters never overlap each other (same kind too) or a predator: spatial-hash separation on last frame's spots,
   *  so this frame's poses already use the corrected positions. Predators (this.preds, set by the game) are immovable here. */
  spread() {
    const A = this._agents ??= [], w = this.world; A.length = 0;
    const add = (arr, r, kind) => { for (const c of arr) if (c.on && !(c.dig >= 1) && !(c.hide >= 1)) { const a = c._sep ??= { c, x: 0, z: 0, y: 0, r, w: 1, kind }; a.x = c.x; a.z = c.z; a.y = c.y ?? 0; A.push(a); } };
    add(this.sk, 0.24, 'g'); add(this.cr, 0.2, 'g'); add(this.fr, 0.17, 'g'); add(this.hm, 0.15, 'g'); add(this.wr, 0.15, 'g'); add(this.fl, 0.12, 'f'); add(this.bu, 0.12, 'f');
    if (this.preds) for (const p of this.preds) if (!p.dead) { const a = p._csep ??= { c: null, x: 0, z: 0, y: 0, r: 0, w: 0 }; a.x = p.x; a.z = p.z; a.y = p.y + (p.lift || 0) + (p.alt || 0) + 0.3; a.r = 0.6 * p.scale; A.push(a); }
    if (A.length < 2) return 0;
    return separate(A, { cell: 1.5, passes: 2, apply: (a, dx, dz, dy) => {
      const c = a.c; if (!c) return;
      const nx = c.x + dx, nz = c.z + dz;
      if (a.kind === 'f') { c.x = nx; c.z = nz; c.y += dy; if (c.tx !== undefined) { c.tx += dx; c.tz += dz; } }
      else if (!w.waterAt?.(nx, nz)) { c.x = nx; c.z = nz; if (c.y !== undefined && !(c.fly > 0) && !(c.air > 0)) c.y = w.heightAt(nx, nz); }
      a.x = c.x; a.z = c.z;
    } });
  }
  update(dt, o, night = 0, rain = 0) {
    const w = this.world; this.T += dt;
    this.spread();
    for (let i = 0; i < 3; i++) this.respawn(o, night, rain);
    const scare = (c, r2, heading) => {
      const dx = c.x - o.x, dz = c.z - o.z, d2 = dx * dx + dz * dz;
      return { dx, dz, d2, close: d2 < r2, heading: heading ?? Math.atan2(dx, dz) };
    };

    // ---- skinks: bask in the sun, potter, maybe wander closer, then dart away
    for (let i = 0; i < NS; i++) {
      const c = this.sk[i];
      if (!c.on) { hide(this.skMesh, i); continue; }
      const s = scare(c, 6);
      if (s.close && c.run <= 0) { c.run = 0.9 + Math.random() * 0.5; c.h = s.heading + (Math.random() - 0.5) * 0.8; c.bask = 0; c.cur = 0; }
      else if (c.run <= 0 && s.d2 > 16 && s.d2 < 80 && c.cur <= 0 && Math.random() < dt * 0.25) { c.cur = 0.8 + Math.random() * 0.8; c.h = Math.atan2(-s.dx, -s.dz); c.bask = 0; }
      c.t -= dt; if (c.t <= 0) { c.t = 2 + Math.random() * 5; if (c.run <= 0 && Math.random() < 0.45) { c.walk = 0.6 + Math.random(); c.h += (Math.random() - 0.5) * 2; c.bask = 0; } else if (c.run <= 0) c.bask = 1.5 + Math.random() * 3; }
      let sp = 0; if (c.run > 0) { c.run -= dt; sp = 3.2; } else if (c.cur > 0) { c.cur -= dt; sp = 0.35; } else if (c.walk > 0) { c.walk -= dt; sp = 0.5; } else if (c.bask > 0) c.bask -= dt;
      if (sp > 0) {
        const nx = c.x + Math.sin(c.h) * sp * dt, nz = c.z + Math.cos(c.h) * sp * dt;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.2)) { c.x = nx; c.z = nz; c.y = w.heightAt(nx, nz); } else c.h += 2.2;
      }
      const wig = sp > 0 ? Math.sin(this.T * 30) * 0.25 : 0;
      const flat = c.bask > 0 && sp === 0 ? 0.72 : 1;
      pose(this.skMesh, i, c.x, c.y, c.z, c.h + wig, 1, flat, 1);
    }
    this.skMesh.instanceMatrix.needsUpdate = true;

    // ---- ant trails: nest-to-food march; they pack up in heavy rain
    const antSp = rain > 0.35 ? 0.12 : 0.06;
    for (let t = 0; t < NT; t++) {
      const c = this.tr[t], ca = Math.cos(c.a), sa = Math.sin(c.a);
      for (let j = 0; j < PER; j++) {
        const id = t * PER + j;
        if (!c.on) { hide(this.antMesh, id); continue; }
        const f = ((j / PER + this.T * antSp + c.ph) % 1), back = j % 2 === 1;
        const u = back ? 1 - f : f, wob = Math.sin(j * 7.3 + this.T * 3) * 0.05;
        const x = c.x + ca * (u - 0.5) * c.len - sa * wob, z = c.z + sa * (u - 0.5) * c.len + ca * wob;
        const hi = u * 8, i0 = Math.min(7, Math.floor(hi)), y = c.hs[i0] + (c.hs[i0 + 1] - c.hs[i0]) * (hi - i0);
        pose(this.antMesh, id, x, y, z, Math.atan2(ca, sa) + (back ? Math.PI : 0), 1.6, 1.6, 1.6);
      }
    }
    this.antMesh.instanceMatrix.needsUpdate = true;

    // ---- dragonflies: hover, zip, startle further off
    for (let i = 0; i < NF; i++) {
      const c = this.fl[i];
      if (!c.on) { hide(this.flyMesh, i); continue; }
      const s = scare(c, 9);
      c.t -= dt;
      if (s.close && c.t < 2) { c.t = 0.6; const a = s.heading; c.tx = c.x + Math.cos(a) * 5; c.tz = c.z + Math.sin(a) * 5; c.ty = w.heightAt(c.tx, c.tz) + 1.4 + Math.random(); }
      else if (c.t <= 0) { c.t = 1.5 + Math.random() * 3; const a = Math.random() * 6.28, r = Math.random() * 4; c.tx = c.ax + Math.cos(a) * r; c.tz = c.az + Math.sin(a) * r; c.ty = w.heightAt(c.tx, c.tz) + 0.6 + Math.random() * 1.0; }
      const k = 1 - Math.exp(-(s.close ? 7 : 4) * dt), px = c.x, pz = c.z;
      c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.y += (c.ty - c.y) * k;
      if (Math.abs(c.x - px) + Math.abs(c.z - pz) > 1e-3) c.h = Math.atan2(c.x - px, c.z - pz);
      pose(this.flyMesh, i, c.x, c.y + Math.sin(this.T * 3 + i) * 0.04, c.z, c.h, 1, 1, 1, 0, Math.sin(this.T * 48 + i) * 0.12);
    }
    this.flyMesh.instanceMatrix.needsUpdate = true;

    // ---- ghost crabs: sideways scuttles, a curious sidle, then a dash and down a burrow
    for (let i = 0; i < NC; i++) {
      const c = this.cr[i];
      if (!c.on) { hide(this.crMesh, i); continue; }
      const s = scare(c, 7);
      if (s.close && c.run <= 0 && c.dig === 0) { c.run = 0.7; c.h = s.heading - c.dir * Math.PI / 2; c.cur = 0; }
      else if (c.dig === 0 && c.run <= 0 && s.d2 > 16 && s.d2 < 90 && Math.random() < dt * 0.2) { c.cur = 0.7; c.h = Math.atan2(-s.dx, -s.dz) - c.dir * Math.PI / 2; }
      let sp = 0;
      if (c.run > 0) { c.run -= dt; sp = 3.6; if (c.run <= 0) c.dig = 0.001; }
      else if (c.dig > 0) { c.dig = Math.min(1, c.dig + dt * 2.5); }
      else if (c.cur > 0) { c.cur -= dt; sp = 0.5; }
      else { c.t -= dt; if (c.t <= 0) { c.t = 0.6 + Math.random() * 2.4; if (Math.random() < 0.3) c.dir = -c.dir; if (Math.random() < 0.3) c.h += (Math.random() - 0.5) * 1.5; } if (c.t > 1.2) sp = 0.9; }
      if (sp > 0) {
        const mx = Math.cos(c.h) * c.dir, mz = -Math.sin(c.h) * c.dir;
        const nx = c.x + mx * sp * dt, nz = c.z + mz * sp * dt;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.15)) { c.x = nx; c.z = nz; c.y = w.heightAt(nx, nz); } else c.dir = -c.dir;
      }
      const bob = sp > 0 ? Math.abs(Math.sin(this.T * 38 + i)) * 0.012 : 0, sink = c.dig * 0.14;
      pose(this.crMesh, i, c.x, c.y + bob - sink, c.z, c.h);
    }
    this.crMesh.instanceMatrix.needsUpdate = true;

    // ---- frogs: sit at the water's edge, hop, plop in when startled (more lively in the rain and at dusk)
    const frogEager = (rain > 0.25 || night > 0.45) ? 1.6 : 1;
    for (let i = 0; i < NFR; i++) {
      const c = this.fr[i];
      if (!c.on) { hide(this.frMesh, i); continue; }
      const s = scare(c, 5.5);
      if (c.air <= 0) {
        if (s.close) { c.hop = 1; c.h = s.heading; }          // leap away, often into water
        else { c.t -= dt * frogEager; if (c.t <= 0) { c.t = 1.2 + Math.random() * 3; if (Math.random() < 0.55) { c.hop = 1; c.h += (Math.random() - 0.5) * 1.2; } } }
      }
      if (c.hop && c.air <= 0) { c.air = 1; c.hop = 0; }
      if (c.air > 0) {
        c.air -= dt * 2.6;
        const u = 1 - Math.max(0, c.air), lift = Math.sin(u * Math.PI) * 0.28;
        const nx = c.x + Math.sin(c.h) * 1.3 * dt * 2.6, nz = c.z + Math.cos(c.h) * 1.3 * dt * 2.6;
        if (!w._blocked?.(nx, nz, 0.15)) { c.x = nx; c.z = nz; }
        c.y = w.heightAt(c.x, c.z) + lift;
        c.wet = w.waterAt?.(c.x, c.z) ? 1 : 0;
        if (c.air <= 0) c.y = w.heightAt(c.x, c.z);
      } else c.y = w.heightAt(c.x, c.z);
      const squat = c.air > 0 ? 1.15 : 0.92;
      pose(this.frMesh, i, c.x, c.y + (c.wet ? -0.02 : 0), c.z, c.h, 1, squat, 1);
    }
    this.frMesh.instanceMatrix.needsUpdate = true;

    // ---- hermit crabs: sidle with a borrowed shell, tuck in when startled
    for (let i = 0; i < NH; i++) {
      const c = this.hm[i];
      if (!c.on) { hide(this.hmMesh, i); continue; }
      const s = scare(c, 6);
      if (s.close && c.hide <= 0 && c.run <= 0) { c.run = 0.45; c.h = s.heading - c.dir * Math.PI / 2; }
      let sp = 0, tucked = c.hide;
      if (c.run > 0) { c.run -= dt; sp = 1.8; if (c.run <= 0) c.hide = 0.001; }
      else if (c.hide > 0) { c.hide = Math.min(1, c.hide + dt * 3); if (c.hide >= 1 && s.d2 > 16) c.hide = Math.max(0, c.hide - dt * 0.8); }
      else { c.t -= dt; if (c.t <= 0) { c.t = 0.8 + Math.random() * 2.2; if (Math.random() < 0.35) c.dir = -c.dir; if (Math.random() < 0.3) c.h += (Math.random() - 0.5) * 1.2; } if (c.t > 1) sp = 0.45; }
      if (sp > 0) {
        const mx = Math.cos(c.h) * c.dir, mz = -Math.sin(c.h) * c.dir;
        const nx = c.x + mx * sp * dt, nz = c.z + mz * sp * dt;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.15)) { c.x = nx; c.z = nz; c.y = w.heightAt(nx, nz); } else c.dir = -c.dir;
      }
      const bob = sp > 0 ? Math.abs(Math.sin(this.T * 28 + i)) * 0.01 : 0;
      const sy = 1 - tucked * 0.25, y = c.y + bob - tucked * 0.03;
      pose(this.hmMesh, i, c.x, y, c.z, c.h, 1, sy, 1);
    }
    this.hmMesh.instanceMatrix.needsUpdate = true;

    // ---- butterflies: flutter between resting spots, fold in the rain / at night (despawned), startle up
    for (let i = 0; i < NB; i++) {
      const c = this.bu[i];
      if (!c.on) { hide(this.buMesh, i); continue; }
      const s = scare(c, 8);
      c.t -= dt;
      if (s.close) { c.land = 0; c.t = 0.8; const a = s.heading; c.tx = c.x + Math.cos(a) * 4; c.tz = c.z + Math.sin(a) * 4; c.ty = w.heightAt(c.tx, c.tz) + 1.2; }
      else if (c.t <= 0) {
        if (c.land > 0) { c.land = 0; c.t = 1.2 + Math.random() * 2; const a = Math.random() * 6.28, r = 1 + Math.random() * 5; c.tx = c.ax + Math.cos(a) * r; c.tz = c.az + Math.sin(a) * r; c.ty = w.heightAt(c.tx, c.tz) + 0.5 + Math.random() * 0.9; }
        else { c.land = 1; c.t = 2 + Math.random() * 4; c.ty = w.heightAt(c.x, c.z) + 0.12; c.tx = c.x; c.tz = c.z; }
      }
      const k = 1 - Math.exp(-3.2 * dt), px = c.x, pz = c.z;
      c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.y += (c.ty - c.y) * k;
      if (Math.abs(c.x - px) + Math.abs(c.z - pz) > 1e-3) c.h = Math.atan2(c.x - px, c.z - pz);
      const flap = c.land && Math.abs(c.y - c.ty) < 0.05 ? 0.15 : Math.sin(this.T * 22 + i) * 0.55;
      pose(this.buMesh, i, c.x, c.y, c.z, c.h, 1, 0.65 + Math.abs(flap) * 0.5, 1, 0, flap * 0.15);
    }
    this.buMesh.instanceMatrix.needsUpdate = true;

    // ---- fairy-wrens: hop and peck on the ground, short flits, fly up when startled
    for (let i = 0; i < NW; i++) {
      const c = this.wr[i];
      if (!c.on) { hide(this.wrMesh, i); continue; }
      const s = scare(c, 7);
      if (c.fly <= 0) {
        if (s.close) { c.fly = 1; c.h = s.heading; c.tx = c.x + Math.sin(c.h) * 5; c.tz = c.z + Math.cos(c.h) * 5; c.ty = w.heightAt(c.tx, c.tz) + 1.6; }
        else { c.t -= dt; if (c.t <= 0) { c.t = 0.6 + Math.random() * 2; if (Math.random() < 0.7) { c.hop = 1; c.h += (Math.random() - 0.5) * 1.8; } else { c.fly = 1; c.tx = c.x + Math.sin(c.h) * (1 + Math.random() * 2); c.tz = c.z + Math.cos(c.h) * (1 + Math.random() * 2); c.ty = w.heightAt(c.x, c.z) + 0.5 + Math.random() * 0.5; } } }
      }
      if (c.hop && c.fly <= 0) {
        c.hop -= dt * 3.2; if (c.hop <= 0) c.hop = 0;
        const nx = c.x + Math.sin(c.h) * 0.9 * dt * 3.2, nz = c.z + Math.cos(c.h) * 0.9 * dt * 3.2;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.12)) { c.x = nx; c.z = nz; }
        c.g = w.heightAt(c.x, c.z); c.y = c.g + Math.sin(Math.max(0, c.hop) * Math.PI) * 0.12;
      } else if (c.fly > 0) {
        const k = 1 - Math.exp(-4 * dt);
        c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.y += (c.ty - c.y) * k;
        c.g = w.heightAt(c.x, c.z);
        if (Math.hypot(c.x - c.tx, c.z - c.tz) < 0.25) { c.fly = 0; c.y = c.g; c.t = 0.4 + Math.random(); }
      } else { c.g = w.heightAt(c.x, c.z); c.y = c.g; }
      const bob = c.fly > 0 ? Math.sin(this.T * 28 + i) * 0.02 : 0;
      pose(this.wrMesh, i, c.x, c.y + bob, c.z, c.h);
    }
    this.wrMesh.instanceMatrix.needsUpdate = true;
  }

  /** how many of each are out right now (tests) */
  counts() {
    return {
      skinks: this.sk.filter((c) => c.on).length, trails: this.tr.filter((c) => c.on).length,
      flies: this.fl.filter((c) => c.on).length, crabs: this.cr.filter((c) => c.on && c.dig < 1).length,
      frogs: this.fr.filter((c) => c.on).length, hermits: this.hm.filter((c) => c.on && c.hide < 1).length,
      butterflies: this.bu.filter((c) => c.on).length, wrens: this.wr.filter((c) => c.on).length,
    };
  }
  /** kinds of harmless critters currently visible within r metres of the octopus (for the field journal) */
  kindsNear(o, r = 16) {
    const out = new Set(), hit = (arr, id, ok) => { for (const c of arr || []) if (c.on && (!ok || ok(c)) && Math.hypot(c.x - o.x, c.z - o.z) < r) out.add(id); };
    hit(this.sk, 'skink'); hit(this.tr, 'ant'); hit(this.fl, 'dragonfly'); hit(this.cr, 'ghostcrab', (c) => c.dig < 1);
    hit(this.fr, 'frog'); hit(this.hm, 'hermit', (c) => c.hide < 1); hit(this.bu, 'butterfly'); hit(this.wr, 'wren');
    return out;
  }
  dispose() {
    for (const m of [this.skMesh, this.antMesh, this.flyMesh, this.crMesh, this.frMesh, this.hmMesh, this.buMesh, this.wrMesh]) {
      m.geometry.dispose(); this.scene.remove(m);
    }
    this.mat.dispose(); this.lineMat.dispose();
  }
}
