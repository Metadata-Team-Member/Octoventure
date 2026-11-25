// =====================================================================
//  Gatherables at runtime (t236u). Everything the octopus can pick up by touching it: the data lives in world.gather
//  (world/gather.js: each item has a stable id), this file shows it and notices the touch.
//   - still things (kelp, pebbles, shells ...) are instanced meshes: each kind owns a small pool of slots handed to whichever items are
//     near the octopus (the world holds thousands; only a few dozen are drawn);
//   - crabs and shrimp are small live critters: a crab scuttles sideways away from you, a shrimp darts about its pool. You catch them by touch.
//   - taking something is silent apart from a soft pluck and a little animation: it lifts and shrinks into the octopus. No pop-ups.
// =====================================================================
import * as THREE from 'three';
import { toonMat } from '../world/toon.js';
import { buildGatherGeos } from '../world/gatherModels.js';
import { seat, instanceSpec, geoHeight } from '../world/placement.js';

const _m = new THREE.Matrix4(), _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const POOL = 90, CELL = 20;
const CRITTER = { crab: 26, shrimp: 22 };
const TAU = Math.PI * 2;
const hash = (id) => { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

export class Gatherer {
  constructor(world, scene, audio) {
    this.world = world; this.scene = scene; this.audio = audio;
    this.root = new THREE.Group(); scene.add(this.root);
    this.geos = buildGatherGeos();
    this.mat = toonMat({ vertexColors: true, roughness: 0.68, metalness: 0, side: THREE.DoubleSide });
    this.jarMat = toonMat({ vertexColors: true, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.meshes = {}; this.free = {};
    for (const k in this.geos) {
      if (CRITTER[k]) continue;
      const m = new THREE.InstancedMesh(this.geos[k], k === 'jar' ? this.jarMat : this.mat, POOL); m.frustumCulled = false; this.root.add(m);
      for (let j = 0; j < POOL; j++) m.setMatrixAt(j, _zero);
      m.instanceMatrix.needsUpdate = true; m.visible = false; m.count = 0; this.meshes[k] = m; this.free[k] = Array.from({ length: POOL }, (_, j) => POOL - 1 - j);
    }
    // critter pools
    this.pool = { crab: [], shrimp: [] };
    for (const k in CRITTER) for (let i = 0; i < CRITTER[k]; i++) { const m = new THREE.Mesh(this.geos[k], this.mat); m.visible = false; m.frustumCulled = false; this.root.add(m); this.pool[k].push(m); }
    this.live = [];                       // active critters
    this.grid = new Map();
    this.collected = new Set();           // ids taken so far (saved)
    this.active = new Set(); this.anims = [];
    this.scanT = 0; this.clock = 0; this.count = 0;
    this.onPick = null;                   // (item) => void   set by the game: adds to the satchel
    // original map's items now; each far tile adds its own as it is generated (the replay includes the tiles that exist already)
    for (const g of world.gather) if (g.id[0] === 'o') this.addItem(g);
    world.regions.onGenerate((reg) => { for (const g of reg.gather) this.addItem(g); });
  }
  addItem(g) {
    if (g.reg0) return; g.reg0 = 1;           // (the replay can offer an item twice)
    g.slot = -1; g.got = this.collected.has(g.id);
    if (CRITTER[g.kind]) { g.cx = g.x; g.cz = g.z; g.mode = 0; g.t = hash(g.id) * 4; g.hd = hash(g.id + 'h') * TAU; }
    const k = Math.floor(g.x / CELL) + ',' + Math.floor(g.z / CELL);
    (this.grid.get(k) || this.grid.set(k, []).get(k)).push(g); this.count++;
  }
  /** a save said these were taken */
  markCollected(ids) {
    for (const id of ids) this.collected.add(id);
    for (const cell of this.grid.values()) for (const g of cell) if (!g.got && this.collected.has(g.id)) { g.got = true; this.release(g); }
  }
  /** every item (the tests and the save read it) */
  items() { const o = []; for (const cell of this.grid.values()) for (const g of cell) o.push(g); return o; }

  seatMatrix(g, out) {
    const geo = this.geos[g.kind];
    return seat(this.world, geo, instanceSpec('gather', g.kind, { x: g.x, z: g.z, rot: g.rot, s: g.s }, geoHeight(geo)), out);
  }
  acquire(g) {
    if (CRITTER[g.kind]) {
      const m = this.pool[g.kind].find((q) => !q.visible); if (!m) return;
      g.mesh = m; m.visible = true; m.matrixAutoUpdate = true; m.scale.setScalar(g.s); m.userData.g = g; this.live.push(g); g.slot = 1;
      this.placeCritter(g, 0);
      return;
    }
    const f = this.free[g.kind]; if (!f.length) return;
    g.slot = f.pop(); this.active.add(g);
    const m = this.meshes[g.kind]; m.visible = true; m.setMatrixAt(g.slot, this.seatMatrix(g, _m)); m.instanceMatrix.needsUpdate = true;
    if (g.slot >= m.count) m.count = g.slot + 1;
  }
  /** draw only up to the highest slot in use (empty slots still cost their vertices) */
  fit(kind) { let top = 0; for (const a of this.active) if (a.kind === kind && a.slot >= top) top = a.slot + 1; this.meshes[kind].count = top; }
  release(g) {
    if (g.slot < 0) return;
    if (CRITTER[g.kind]) {
      const i = this.live.indexOf(g); if (i >= 0) this.live.splice(i, 1);
      if (g.mesh) { g.mesh.visible = false; g.mesh = null; }
      g.slot = -1; return;
    }
    const m = this.meshes[g.kind]; m.setMatrixAt(g.slot, _zero); m.instanceMatrix.needsUpdate = true;
    this.free[g.kind].push(g.slot); g.slot = -1; this.active.delete(g);
    m.visible = this.free[g.kind].length < POOL;               // nothing of this kind near: not drawn at all
    this.fit(g.kind);
  }
  /** bring the nearby items to life and put the far ones away (a couple of times a second) */
  scan(o) {
    const cx = Math.floor(o.x / CELL), cz = Math.floor(o.z / CELL);
    for (const g of [...this.active]) if (g.got || Math.hypot(g.x - o.x, g.z - o.z) > 130) this.release(g);
    for (const g of [...this.live]) if (g.got || Math.hypot(g.cx - o.x, g.cz - o.z) > 75) this.release(g);
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const cell = this.grid.get((cx + dx) + ',' + (cz + dz)); if (!cell) continue;
      for (const g of cell) {
        if (g.got || g.slot >= 0) continue;
        const d = Math.hypot(g.x - o.x, g.z - o.z);
        if (CRITTER[g.kind] ? d < 55 : d < 100) this.acquire(g);
      }
    }
  }

  /** where a critter stands: on the ground (the lowest of a few probes, so the legs touch) */
  placeCritter(g, dt) {
    const w = this.world, m = g.mesh, s = g.s, r = 0.09 * s;
    const y = Math.min(w.heightAt(g.cx, g.cz), w.heightAt(g.cx + r, g.cz), w.heightAt(g.cx - r, g.cz), w.heightAt(g.cx, g.cz + r), w.heightAt(g.cx, g.cz - r));
    const bob = g.mode ? Math.abs(Math.sin(this.clock * 24 + g.t)) * 0.012 * s : 0;
    m.position.set(g.cx, y + bob - 0.003, g.cz);
    if (g.kind === 'crab') {
      m.rotation.set(0, g.face, g.mode ? Math.sin(this.clock * 26 + g.t) * 0.06 : 0);       // the body rocks as the legs work
    } else {
      m.rotation.set(g.mode ? -0.18 - Math.sin(this.clock * 30 + g.t) * 0.1 : 0, g.face, 0);   // tail flicks when darting
    }
  }
  moveOk(g, nx, nz) {
    const w = this.world;
    if (g.kind === 'crab') {
      if (Math.hypot(nx - g.x, nz - g.z) > 11) return false;
      if (w.waterAt(nx, nz) || w.heightAt(nx, nz) < 0.02) return false;
      return !w._blocked(nx, nz, 0.15);
    }
    return Math.hypot(nx - g.pool.x, nz - g.pool.z) < g.pool.r * 0.82;                 // a shrimp stays in its pool
  }
  updateCritters(dt, o) {
    for (const g of this.live) {
      if (g.got || !g.mesh) continue;
      g.t -= dt;
      const dx = g.cx - o.x, dz = g.cz - o.z, d = Math.hypot(dx, dz) || 1e-3;
      const crab = g.kind === 'crab';
      const alarm = crab ? (o.camoProtected ? 2.2 : 5.5) : (o.inWater ? 4.5 : 2.2);          // how close before it bolts
      let vx = 0, vz = 0, sp = 0;
      if (d < alarm && o.alive) {                                                           // flee: away from the octopus
        let a = Math.atan2(dz, dx) + Math.sin(g.t * 3 + g.hd) * 0.5;
        sp = crab ? 2.5 : 3.8; g.mode = 2;
        for (let k = 0; k < 6; k++) {                                                        // find a way that is free (swing left / right)
          const aa = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.55;
          const nx = g.cx + Math.cos(aa) * sp * dt, nz = g.cz + Math.sin(aa) * sp * dt;
          if (this.moveOk(g, nx, nz)) { vx = Math.cos(aa); vz = Math.sin(aa); break; }
        }
      } else if (g.t <= 0) {                                                                 // idle: a short wander, then a pause
        if (g.mode === 1) { g.mode = 0; g.t = 1.5 + hash(g.id + Math.floor(this.clock)) * 4; }
        else { g.mode = 1; g.t = 0.25 + hash(g.id + Math.floor(this.clock * 3)) * (crab ? 0.8 : 0.4); g.hd = (g.hd + 1.2 + hash(g.id + Math.floor(this.clock * 7)) * 2.8) % TAU; }
      }
      if (g.mode === 1) { sp = crab ? 0.7 : 2.2; vx = Math.cos(g.hd); vz = Math.sin(g.hd); }
      if (g.mode === 2 && !sp) g.mode = 0;
      if (g.mode === 2 && d >= alarm) g.mode = 0;
      if (sp && (vx || vz)) {
        const nx = g.cx + vx * sp * dt, nz = g.cz + vz * sp * dt;
        if (this.moveOk(g, nx, nz)) {
          g.cx = nx; g.cz = nz;
          // a crab walks sideways: its body is square to the line of travel; a shrimp swims head first
          const want = Math.atan2(vx, vz) + (crab ? Math.PI / 2 : 0);
          let da = (want - g.face) % TAU; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
          g.face += da * Math.min(1, dt * 12);
        } else if (g.mode === 1) g.hd += 2.1;
      }
      if (g.face === undefined || Number.isNaN(g.face)) g.face = g.hd;
      this.placeCritter(g, dt);
    }
  }

  update(dt, o) {
    this.clock += dt;
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 0.4; this.scan(o); }
    for (const g of this.live) if (g.face === undefined) g.face = g.hd;
    this.updateCritters(dt, o);
    // ---- touch
    if (o.alive && !o.tunnel && !o.carried) {
      const R = 0.35 + 1.3 * (o.sz ?? 0.42), R2 = R * R, reach = o.inWater ? 3 : 2;
      const cx = Math.floor(o.x / CELL), cz = Math.floor(o.z / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const cell = this.grid.get((cx + dx) + ',' + (cz + dz)); if (!cell) continue;
        for (const g of cell) {
          if (g.got || g.slot < 0 || CRITTER[g.kind]) continue;
          const ex = g.x - o.x, ez = g.z - o.z;
          if (ex * ex + ez * ez < R2 && Math.abs(g.y - o.y) < reach) this.take(g, o);
        }
      }
      for (const g of [...this.live]) {
        if (g.got) continue;
        const ex = g.cx - o.x, ez = g.cz - o.z;
        if (ex * ex + ez * ez < R2 * 0.85 && Math.abs(g.mesh.position.y - o.y) < reach) this.take(g, o);
      }
    }
    // ---- pickup animations: tuck under the body and shrink, then the satchel takes it (once)
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i]; a.t += dt / 0.36;
      const e = Math.min(1, a.t), ee = e * e * (3 - 2 * e), tx = this.target?.x ?? a.p.x, tz = this.target?.z ?? a.p.z, ty = (this.target?.y ?? a.p.y) + 0.06;
      const lift = Math.sin(e * Math.PI) * 0.1 * (1 - e);
      const px = a.p.x + (tx - a.p.x) * ee, pz = a.p.z + (tz - a.p.z) * ee, py = a.p.y + (ty - a.p.y) * ee + lift;
      const sc = Math.max(0.001, 1 - ee);
      if (a.crit) { a.mesh.position.set(px, py, pz); a.mesh.scale.setScalar(a.s * sc); a.mesh.rotation.y += dt * 9; }
      else {
        _a.makeTranslation(px, py, pz).multiply(_b.makeScale(sc, sc, sc)).multiply(_m.makeTranslation(-a.p.x, -a.p.y, -a.p.z)).multiply(a.base);
        a.mesh.matrix.copy(_a);
      }
      if (e >= 1) {
        if (!a.gave) { a.gave = true; this.onPick?.(a.item); }
        this.root.remove(a.mesh); if (a.crit) { a.mesh.visible = false; a.mesh.scale.setScalar(a.s); this.pool[a.kind].push(a.mesh); this.root.add(a.mesh); } this.anims.splice(i, 1);
      }
    }
  }
  take(g, o) {
    g.got = true; this.collected.add(g.id); this.target = o;
    const at = new THREE.Vector3();
    if (CRITTER[g.kind]) {
      const m = g.mesh; at.copy(m.position);
      const i = this.live.indexOf(g); if (i >= 0) this.live.splice(i, 1);
      const pi = this.pool[g.kind].indexOf(m); if (pi >= 0) this.pool[g.kind].splice(pi, 1);       // flying-to-you critter leaves the pool until done
      g.mesh = null; g.slot = -1;
      this.anims.push({ mesh: m, crit: true, kind: g.kind, p: at, t: 0, s: g.s, item: g, gave: false });
    } else {
      const base = this.seatMatrix(g, new THREE.Matrix4()); at.setFromMatrixPosition(base); at.y += 0.05;
      const mesh = new THREE.Mesh(this.geos[g.kind], g.kind === 'jar' ? this.jarMat : this.mat); mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.matrix.copy(base); this.root.add(mesh);
      this.release(g);
      this.anims.push({ mesh, base, p: at, t: 0, item: g, gave: false });
    }
    o.scoopToward?.(at.x, at.y, at.z);
  }
  dispose() {
    for (let i = 0; i < this.anims.length; i++) { const a = this.anims[i]; if (!a.gave) { a.gave = true; this.onPick?.(a.item); } }
    this.scene.remove(this.root); for (const k in this.geos) this.geos[k].dispose(); this.mat.dispose(); this.jarMat.dispose(); for (const k in this.meshes) this.meshes[k].dispose();
  }
}
