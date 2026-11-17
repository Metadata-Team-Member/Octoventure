// =====================================================================
//  Ambient critters (t241u): harmless life going about its business near the octopus. Skinks bask and dart away, ant trails march
//  across the ground, dragonflies hover over damp places. Which ones appear depends on the biome under them (desert and bush skinks,
//  rainforest dragonflies, ...). Skinks and dragonflies tuck themselves away at night. Ghost crabs (t251u) scuttle sideways over the
//  beach, dunes, estuary and headland sand day and night and pop down a burrow when the octopus comes close.
//
//  Performance: four InstancedMeshes (4 draw calls in total), small fixed pools recycled around the player, all scratch objects
//  preallocated (no per-frame allocation), ground heights for an ant trail sampled once when it is placed.
// =====================================================================
import * as THREE from 'three';
import { toonMat, outlineMat, outline } from '../world/toon.js';
import { tint, merge, at } from '../world/models.js';

const SKINK_B = new Set(['desert', 'bush', 'suburb', 'farm', 'headland', 'dunes', 'rainforest', 'riverbank']);
const ANT_B = new Set(['desert', 'bush', 'suburb', 'farm', 'town', 'dunes', 'rainforest']);
const FLY_B = new Set(['wetland', 'riverbank', 'estuary', 'rainforest', 'farm']);
const CRAB_B = new Set(['beach', 'dunes', 'estuary', 'headland']);
const NS = 10, NT = 6, PER = 22, NF = 8, NC = 8, R_FAR = 46;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _zero = new THREE.Vector3(0, 0, 0);

function skinkGeo() {
  const sph = (r) => new THREE.SphereGeometry(r, 7, 5);
  return merge([
    at(tint(sph(1), 0x6b5a3e), 0, 0.05, 0, 0, 0, 0, 0.07, 0.045, 0.2),               // body (along z)
    at(tint(sph(1), 0x7a6748), 0, 0.055, 0.2, 0, 0, 0, 0.05, 0.04, 0.07),            // head
    at(tint(new THREE.ConeGeometry(0.035, 0.36, 5), 0x5c4c34), 0, 0.04, -0.33, -Math.PI / 2, 0, 0),   // tail
    at(tint(new THREE.BoxGeometry(0.2, 0.015, 0.03), 0x4e4030), 0, 0.02, 0.1),          // front legs
    at(tint(new THREE.BoxGeometry(0.2, 0.015, 0.03), 0x4e4030), 0, 0.02, -0.1),         // back legs
    at(tint(new THREE.BoxGeometry(0.03, 0.005, 0.28), 0xc9b98a), 0, 0.093, 0),          // pale back stripe
  ]);
}
function antGeo() {
  const sph = (r) => new THREE.SphereGeometry(r, 5, 4);
  return merge([at(tint(sph(1), 0x1a0f0a), 0, 0.012, 0.02, 0, 0, 0, 0.012, 0.011, 0.014), at(tint(sph(1), 0x24140c), 0, 0.012, -0.012, 0, 0, 0, 0.014, 0.012, 0.02)]);
}
function flyGeo() {
  return merge([
    at(tint(new THREE.CylinderGeometry(0.012, 0.008, 0.26, 5), 0x2a7fb8), 0, 0, 0, Math.PI / 2, 0, 0),
    at(tint(new THREE.SphereGeometry(0.022, 6, 4), 0x1f5f8a), 0, 0, 0.13),
    at(tint(new THREE.BoxGeometry(0.34, 0.003, 0.05), 0xd8eef8), 0, 0.01, 0.06),
    at(tint(new THREE.BoxGeometry(0.3, 0.003, 0.045), 0xd8eef8), 0, 0.01, 0.01),
  ]);
}

function crabGeo() {
  const legs = [];
  for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) legs.push(at(tint(new THREE.BoxGeometry(0.11, 0.012, 0.014), 0xd9c9a3), sd * 0.085, 0.03, -0.04 + i * 0.027, 0, 0, sd * -0.5));
  return merge([
    at(tint(new THREE.SphereGeometry(1, 7, 5), 0xe6d6b0), 0, 0.045, 0, 0, 0, 0, 0.075, 0.032, 0.06),     // pale sandy carapace
    at(tint(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 4), 0xcbb98f), -0.03, 0.08, 0.045),           // eye stalks
    at(tint(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 4), 0xcbb98f), 0.03, 0.08, 0.045),
    at(tint(new THREE.SphereGeometry(0.011, 5, 4), 0x1a1a1a), -0.03, 0.107, 0.045),
    at(tint(new THREE.SphereGeometry(0.011, 5, 4), 0x1a1a1a), 0.03, 0.107, 0.045),
    at(tint(new THREE.BoxGeometry(0.035, 0.025, 0.04), 0xf0e2c0), -0.07, 0.04, 0.07), at(tint(new THREE.BoxGeometry(0.025, 0.02, 0.03), 0xf0e2c0), 0.06, 0.04, 0.07),
    ...legs,
  ]);
}

export class Critters {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.mat = toonMat({ vertexColors: true, flatShading: true, roughness: 0.8 });
    const mk = (geo, n) => { const m = new THREE.InstancedMesh(geo, this.mat, n); m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; for (let i = 0; i < n; i++) { _m.compose(_p.set(0, -999, 0), _q.identity(), _zero); m.setMatrixAt(i, _m); } scene.add(m); return m; };
    this.skMesh = mk(skinkGeo(), NS); this.antMesh = mk(antGeo(), NT * PER); this.flyMesh = mk(flyGeo(), NF); this.crMesh = mk(crabGeo(), NC);
    this.lineMat = outlineMat(0x231a12); this.hulls = [this.skMesh, this.flyMesh, this.crMesh].flatMap((m) => outline(m, this.lineMat));       // (ants are too small to outline)
    this.sk = Array.from({ length: NS }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, run: 0, walk: 0, t: Math.random() * 5 }));
    this.tr = Array.from({ length: NT }, () => ({ on: false, x: 0, z: 0, a: 0, len: 3, hs: new Float32Array(9), ph: Math.random() }));
    this.fl = Array.from({ length: NF }, () => ({ on: false, x: 0, z: 0, y: 0, ax: 0, az: 0, tx: 0, tz: 0, ty: 0, g: 0, t: 0, h: 0 }));
    this.cr = Array.from({ length: NC }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, dir: 1, t: 0, run: 0, dig: 0 }));
    this.slot = 0; this.T = 0;
  }
  /** a random ground spot 8..34 m from the player whose biome allows `set` (null if none on this try) */
  spot(o, set) {
    const w = this.world, a = Math.random() * 6.2832, d = 8 + Math.random() * 26;
    const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
    if (!set.has(w.biomeAt(x, z)) || w.waterAt?.(x, z) || w.heightAt(x, z) < 0.4 || w._blocked?.(x, z, 0.4)) return null;
    return [x, z];
  }
  respawn(o, night) {
    // one pool slot per call, round-robin across the three kinds
    const k = this.slot++ % (NS + NT + NF + NC), w = this.world;
    const far = (c) => !c.on || Math.abs(c.x - o.x) > R_FAR || Math.abs(c.z - o.z) > R_FAR;
    if (k < NS) {
      const c = this.sk[k]; if (!far(c) && !(night > 0.6)) return;
      c.on = false; if (night > 0.6) return;
      const s = this.spot(o, SKINK_B); if (!s) return;
      c.on = true; c.x = s[0]; c.z = s[1]; c.y = w.heightAt(c.x, c.z); c.h = Math.random() * 6.28; c.run = 0; c.walk = 0;
    } else if (k < NS + NT) {
      const c = this.tr[k - NS]; if (!far(c)) return;
      c.on = false; const s = this.spot(o, ANT_B); if (!s) return;
      c.on = true; c.x = s[0]; c.z = s[1]; c.a = Math.random() * 6.28; c.len = 2.5 + Math.random() * 2.5;
      for (let i = 0; i < 9; i++) { const f = i / 8 - 0.5; c.hs[i] = w.heightAt(c.x + Math.cos(c.a) * f * c.len, c.z + Math.sin(c.a) * f * c.len); }
    } else if (k >= NS + NT + NF) {
      const c = this.cr[k - NS - NT - NF]; if (!far(c) && c.dig < 1) return;
      c.on = false; const s = this.spot(o, CRAB_B); if (!s) return;
      c.on = true; c.x = s[0]; c.z = s[1]; c.y = w.heightAt(c.x, c.z); c.h = Math.random() * 6.28; c.dir = Math.random() < 0.5 ? -1 : 1; c.t = 0; c.run = 0; c.dig = 0;
    } else {
      const c = this.fl[k - NS - NT]; if (!far(c) && !(night > 0.6)) return;
      c.on = false; if (night > 0.6) return;
      const s = this.spot(o, FLY_B); if (!s) return;
      c.on = true; c.ax = c.x = s[0]; c.az = c.z = s[1]; c.g = w.heightAt(c.x, c.z); c.y = c.g + 1; c.t = 0; c.tx = c.x; c.tz = c.z; c.ty = c.y;
    }
  }
  update(dt, o, night = 0) {
    const w = this.world; this.T += dt;
    for (let i = 0; i < 2; i++) this.respawn(o, night);
    // ---- skinks: bask, potter about, dart away from the octopus
    for (let i = 0; i < NS; i++) {
      const c = this.sk[i];
      if (!c.on) { _m.compose(_p.set(0, -999, 0), _q.identity(), _zero); this.skMesh.setMatrixAt(i, _m); continue; }
      const dx = c.x - o.x, dz = c.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 < 6 && c.run <= 0) { c.run = 0.9 + Math.random() * 0.5; c.h = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.8; }
      c.t -= dt; if (c.t <= 0) { c.t = 2 + Math.random() * 5; if (Math.random() < 0.5) { c.walk = 0.6 + Math.random(); c.h += (Math.random() - 0.5) * 2; } }
      let sp = 0; if (c.run > 0) { c.run -= dt; sp = 3.2; } else if (c.walk > 0) { c.walk -= dt; sp = 0.5; }
      if (sp > 0) {
        const nx = c.x + Math.sin(c.h) * sp * dt, nz = c.z + Math.cos(c.h) * sp * dt;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.2)) { c.x = nx; c.z = nz; c.y = w.heightAt(nx, nz); } else c.h += 2.2;
      }
      const wig = sp > 0 ? Math.sin(this.T * 30) * 0.25 : 0;
      _q.setFromEuler(_e.set(0, c.h + wig, 0)); _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(1, 1, 1)); this.skMesh.setMatrixAt(i, _m);
    }
    this.skMesh.instanceMatrix.needsUpdate = true;
    // ---- ant trails
    for (let t = 0; t < NT; t++) {
      const c = this.tr[t], ca = Math.cos(c.a), sa = Math.sin(c.a);
      for (let j = 0; j < PER; j++) {
        const id = t * PER + j;
        if (!c.on) { _m.compose(_p.set(0, -999, 0), _q.identity(), _zero); this.antMesh.setMatrixAt(id, _m); continue; }
        const f = ((j / PER + this.T * 0.06 + c.ph) % 1), back = j % 2 === 1;      // half go out, half come home
        const u = back ? 1 - f : f, wob = Math.sin(j * 7.3 + this.T * 3) * 0.05;
        const x = c.x + ca * (u - 0.5) * c.len - sa * wob, z = c.z + sa * (u - 0.5) * c.len + ca * wob;
        const hi = u * 8, i0 = Math.min(7, Math.floor(hi)), y = c.hs[i0] + (c.hs[i0 + 1] - c.hs[i0]) * (hi - i0);
        _q.setFromEuler(_e.set(0, Math.atan2(ca, sa) + (back ? Math.PI : 0), 0)); _m.compose(_p.set(x, y, z), _q, _s.set(1.6, 1.6, 1.6)); this.antMesh.setMatrixAt(id, _m);
      }
    }
    this.antMesh.instanceMatrix.needsUpdate = true;
    // ---- dragonflies: hover, dart to a new spot, hover again
    for (let i = 0; i < NF; i++) {
      const c = this.fl[i];
      if (!c.on) { _m.compose(_p.set(0, -999, 0), _q.identity(), _zero); this.flyMesh.setMatrixAt(i, _m); continue; }
      c.t -= dt;
      if (c.t <= 0) { c.t = 1.5 + Math.random() * 3; const a = Math.random() * 6.28, r = Math.random() * 4; c.tx = c.ax + Math.cos(a) * r; c.tz = c.az + Math.sin(a) * r; c.ty = w.heightAt(c.tx, c.tz) + 0.6 + Math.random() * 1.0; }
      const k = 1 - Math.exp(-4 * dt), px = c.x, pz = c.z;
      c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.y += (c.ty - c.y) * k;
      if (Math.abs(c.x - px) + Math.abs(c.z - pz) > 1e-3) c.h = Math.atan2(c.x - px, c.z - pz);
      _q.setFromEuler(_e.set(0, c.h, Math.sin(this.T * 40 + i) * 0.05)); _m.compose(_p.set(c.x, c.y + Math.sin(this.T * 3 + i) * 0.04, c.z), _q, _s.set(1, 1, 1)); this.flyMesh.setMatrixAt(i, _m);
    }
    this.flyMesh.instanceMatrix.needsUpdate = true;
    // ---- ghost crabs: sideways scuttles, then a dash and down a burrow when the octopus comes close
    for (let i = 0; i < NC; i++) {
      const c = this.cr[i];
      if (!c.on) { _m.compose(_p.set(0, -999, 0), _q.identity(), _zero); this.crMesh.setMatrixAt(i, _m); continue; }
      const dx = c.x - o.x, dz = c.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 < 7 && c.run <= 0 && c.dig === 0) { c.run = 0.7; c.h = Math.atan2(dx, dz) - c.dir * Math.PI / 2; }
      let sp = 0;
      if (c.run > 0) { c.run -= dt; sp = 3.6; if (c.run <= 0) c.dig = 0.001; }
      else if (c.dig > 0) { c.dig = Math.min(1, c.dig + dt * 2.5); }
      else { c.t -= dt; if (c.t <= 0) { c.t = 0.6 + Math.random() * 2.4; if (Math.random() < 0.3) c.dir = -c.dir; if (Math.random() < 0.3) c.h += (Math.random() - 0.5) * 1.5; } if (c.t > 1.2) sp = 0.9; }
      if (sp > 0) {      // crabs walk sideways: move along the body's local x axis
        const mx = Math.cos(c.h) * c.dir, mz = -Math.sin(c.h) * c.dir;
        const nx = c.x + mx * sp * dt, nz = c.z + mz * sp * dt;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.15)) { c.x = nx; c.z = nz; c.y = w.heightAt(nx, nz); } else c.dir = -c.dir;
      }
      const bob = sp > 0 ? Math.abs(Math.sin(this.T * 38 + i)) * 0.012 : 0, sink = c.dig * 0.14;
      _q.setFromEuler(_e.set(0, c.h, 0)); _m.compose(_p.set(c.x, c.y + bob - sink, c.z), _q, _s.set(1, 1, 1)); this.crMesh.setMatrixAt(i, _m);
    }
    this.crMesh.instanceMatrix.needsUpdate = true;
  }
  /** how many of each are out right now (tests) */
  counts() { return { skinks: this.sk.filter((c) => c.on).length, trails: this.tr.filter((c) => c.on).length, flies: this.fl.filter((c) => c.on).length, crabs: this.cr.filter((c) => c.on && c.dig < 1).length, frogs: this.fr?.filter((c) => c.on).length || 0, hermits: this.hm?.filter((c) => c.on).length || 0, butterflies: this.bu?.filter((c) => c.on).length || 0, wrens: this.wr?.filter((c) => c.on).length || 0 }; }
  /** kinds of harmless critters currently visible within r metres of the octopus (for the field journal) */
  kindsNear(o, r = 16) {
    const out = new Set(), hit = (arr, id, ok) => { for (const c of arr || []) if (c.on && (!ok || ok(c)) && Math.hypot(c.x - o.x, c.z - o.z) < r) out.add(id); };
    hit(this.sk, 'skink'); hit(this.tr, 'ant'); hit(this.fl, 'dragonfly'); hit(this.cr, 'ghostcrab', (c) => c.dig < 1);
    hit(this.fr, 'frog'); hit(this.hm, 'hermit'); hit(this.bu, 'butterfly'); hit(this.wr, 'wren');
    return out;
  }
  dispose() { for (const m of [this.skMesh, this.antMesh, this.flyMesh, this.crMesh]) { m.geometry.dispose(); this.scene.remove(m); } this.mat.dispose(); this.lineMat.dispose(); }
}
