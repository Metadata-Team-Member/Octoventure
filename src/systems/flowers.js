// =====================================================================
//  Flowers you can brush past. No prompts, no UI: when the octopus touches a daisy its petals curl shut and slowly reopen,
//  the stem bows away, and (if it still holds dew and the octopus is a little dry) a few dew drops sparkle off and give a tiny
//  sip of moisture. Now and then a butterfly or a bee lifts off and flutters away. A soft rustle / chime plays.
//
//  Performance: the thousands of flowers stay plain instances inside the world chunks. Only a touched flower is swapped for a
//  "live" copy from a small pool (8 meshes): its instance is hidden (zero-scale matrix) while the live copy animates, then the
//  original matrix is restored. Touch tests use a coarse grid and only look at the 3x3 cells around the octopus.
// =====================================================================
import * as THREE from 'three';
import { flowerPieces, FLOWER } from '../world/geoLib.js';
import { dotTexture } from '../world/worldView.js';
import { applyFade } from '../world/fade.js';

export const FLOWER_FX = {
  touch: 0.3, touchPerSize: 0.6,       // touch radius = touch + touchPerSize * octopus size (u)
  closeT: 0.4, holdT: 1.4, openT: 9,   // seconds: curl shut, stay shut, slowly reopen
  closed: 1.4,                          // petal hinge angle when shut (rad)
  cooldown: 150,                        // s before the same flower holds dew again
  sipGap: 6,                            // s between any two sips (can't be farmed by sweeping a patch)
  sip: 0.8,                             // health restored per sip (maxHealth is 100: roughly 2-3 s of life)
  poolN: 8, critterN: 3, sparkN: 24,
  critterChance: 0.22,
};
const CELL = 6;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _ax = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const ease = (x) => x * x * (3 - 2 * x);

export class Flowers {
  constructor(world, scene, audio) {
    this.world = world; this.scene = scene; this.audio = audio;
    this.rand = Math.random;
    this.t = 0; this.nextSip = 0; this.touches = 0; this.sips = 0;
    this.grid = null;
    this.live = [];
    const P = flowerPieces();
    this.geo = { stem: P.stem, centre: P.centre, petal: P.petal };
    this.pool = [];
    for (let i = 0; i < FLOWER_FX.poolN; i++) this.pool.push(this._makeLive());
    // ---- dew sparkles
    const N = FLOWER_FX.sparkN;
    this.sp = new Float32Array(N * 3); this.sv = new Float32Array(N * 3); this.sl = new Float32Array(N); this.si = 0;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.sp, 3));
    this.sMat = new THREE.PointsMaterial({ color: 0xeafcff, size: 3.6, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sPts = new THREE.Points(g, this.sMat); this.sPts.frustumCulled = false; this.sPts.renderOrder = 5; scene.add(this.sPts);
    for (let i = 0; i < N; i++) this.sp[i * 3 + 1] = -999;
    // ---- butterflies and bees
    this.critters = [];
    const wing = new THREE.PlaneGeometry(1, 1); wing.translate(0.5, 0, 0); wing.rotateX(-Math.PI / 2);
    this.wingGeo = wing; this.bodyGeo = new THREE.CapsuleGeometry(0.4, 1.2, 2, 5); this.bodyGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < FLOWER_FX.critterN; i++) this.critters.push(this._makeCritter());
  }

  _makeLive() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }); applyFade(mat);
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body); root.visible = false;
    body.add(new THREE.Mesh(this.geo.stem, mat), new THREE.Mesh(this.geo.centre, mat));
    const hinges = [];
    for (let i = 0; i < FLOWER.petals; i++) {
      const pivot = new THREE.Group(); pivot.position.y = FLOWER.headY; pivot.rotation.y = (i / FLOWER.petals) * Math.PI * 2;
      const hinge = new THREE.Group(); hinge.add(new THREE.Mesh(this.geo.petal, mat)); pivot.add(hinge); body.add(pivot); hinges.push(hinge);
    }
    this.scene.add(root);
    return { root, body, hinges, mat, busy: false };
  }
  _makeCritter() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x2b2420 });
    const root = new THREE.Group(); root.visible = false;
    const body = new THREE.Mesh(this.bodyGeo, bodyMat);
    const wl = new THREE.Mesh(this.wingGeo, mat), wr = new THREE.Mesh(this.wingGeo, mat); wr.scale.x = -1;
    root.add(body, wl, wr); this.scene.add(root);
    return { root, body, wl, wr, mat, bodyMat, on: false, t: 0 };
  }

  _build() {
    this.grid = new Map();
    const add = (f) => { const k = Math.floor(f.x / CELL) * 1000003 + Math.floor(f.z / CELL); let c = this.grid.get(k); if (!c) this.grid.set(k, c = []); c.push(f); };
    for (const f of this.world.decor.flowers) add(f);
    this.world.regions.onGenerate((reg) => { for (const f of reg.decor.flowers) add(f); });    // the endless far land has flowers too
  }
  /** flowers within r of (x, z) (grid lookup, no allocation when none) */
  near(x, z, r, out = []) {
    if (!this.grid) this._build();
    out.length = 0;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), r2 = r * r;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = this.grid.get((cx + i) * 1000003 + (cz + j)); if (!c) continue;
      for (const f of c) { const dx = f.x - x, dz = f.z - z; if (dx * dx + dz * dz < r2) out.push(f); }
    }
    return out;
  }

  update(dt, o, runTime) {
    this.t += dt;
    const F = FLOWER_FX;
    if (o.alive && !o.tunnel && !o.climb && !o.carried && !o.swim && !o.waterKind) {
      const hits = this.near(o.x, o.z, F.touch + F.touchPerSize * (o.sz ?? 1), this._hits ??= []);
      for (const f of hits) if (!f.live && Math.abs((f.y ?? o.y) - o.y) < 1.2) this.touch(f, o);
    }
    for (let i = this.live.length - 1; i >= 0; i--) if (!this._anim(this.live[i], dt)) { this._finish(this.live[i]); this.live.splice(i, 1); }
    this._sparks(dt); this._critters(dt);
  }

  /** the octopus brushes flower f. Returns the live record, or null if nothing happens (all pool slots busy / no instance) */
  touch(f, o) {
    if (f.live) return null;
    const slot = this.pool.find((s) => !s.busy); const inst = f.inst;
    if (!slot || !inst || !inst.mesh.parent) return null;
    const F = FLOWER_FX;
    this.touches++;
    inst.mesh.getMatrixAt(inst.i, _m); f.m0 = _m.clone(); _m.decompose(_p, _q, _s);
    inst.mesh.setMatrixAt(inst.i, ZERO); inst.mesh.instanceMatrix.needsUpdate = true;
    slot.busy = true; f.live = slot;
    slot.root.position.copy(_p); slot.root.visible = true; slot.root.quaternion.identity();
    slot.body.quaternion.copy(_q); slot.body.scale.copy(_s);
    slot.mat.color.setHex(f.color ?? 0xffffff);
    const dx = f.x - o.x, dz = f.z - o.z, l = Math.hypot(dx, dz) || 1;
    const rec = { f, slot, t: 0, dx: dx / l, dz: dz / l, mesh: inst.mesh };
    this.live.push(rec);
    // dew: only if this flower still has some, nothing was sipped in the last few seconds and the octopus could use it
    const now = this.t;
    const dew = now >= (f.cd ?? 0) && now >= this.nextSip && o.health < (o.maxHealth ?? 100) - 0.5;
    if (dew) {
      f.cd = now + F.cooldown; this.nextSip = now + F.sipGap; this.sips++;
      o.health = Math.min(100, o.health + F.sip);
      this._burst(_p.x, _p.y + FLOWER.headY * _s.y, _p.z);
    }
    this.audio?.flower?.(_p.x, _p.y + 0.3, _p.z, dew);
    if (this.rand() < F.critterChance) this._lift(_p.x, _p.y + FLOWER.headY * _s.y, _p.z, f.color ?? 0xffffff);
    return rec;
  }

  _anim(r, dt) {
    const F = FLOWER_FX; r.t += dt;
    const inst = r.f.inst;
    if (inst && inst.mesh !== r.mesh) {          // chunk was rebuilt while this flower was animating: hide the fresh copy again
      r.mesh = inst.mesh; if (inst.mesh.parent) { inst.mesh.setMatrixAt(inst.i, ZERO); inst.mesh.instanceMatrix.needsUpdate = true; }
    }
    const t = r.t, a = F.closeT, b = a + F.holdT;
    const c = t < a ? ease(t / a) : t < b ? 1 : 1 - ease(Math.min(1, (t - b) / F.openT));
    r.curl = c;
    for (const h of r.slot.hinges) h.rotation.z = c * F.closed;
    // the stem bows away from the octopus and wobbles back upright
    const bow = 0.34 * Math.exp(-t * 1.3) * Math.cos(t * 7.5) + 0.14 * Math.exp(-t * 0.5) * (1 - Math.exp(-t * 6));
    _ax.set(r.dz, 0, -r.dx);
    r.slot.root.quaternion.setFromAxisAngle(_ax, bow);
    return t < b + F.openT;
  }
  _finish(r) {
    const f = r.f, inst = f.inst;
    if (inst && inst.mesh.parent !== null && f.m0) { inst.mesh.setMatrixAt(inst.i, f.m0); inst.mesh.instanceMatrix.needsUpdate = true; }
    r.slot.root.visible = false; r.slot.busy = false; f.live = null;
  }

  // ---- dew sparkles
  _burst(x, y, z) {
    const n = FLOWER_FX.sparkN, k = 5 + Math.floor(this.rand() * 3);
    for (let j = 0; j < k; j++) {
      const i = this.si++ % n, a = this.rand() * 6.283, sp = 0.35 + this.rand() * 0.6;
      this.sp[i * 3] = x; this.sp[i * 3 + 1] = y; this.sp[i * 3 + 2] = z;
      this.sv[i * 3] = Math.cos(a) * sp; this.sv[i * 3 + 1] = 0.9 + this.rand() * 0.9; this.sv[i * 3 + 2] = Math.sin(a) * sp;
      this.sl[i] = 0.7 + this.rand() * 0.5;
    }
  }
  _sparks(dt) {
    const n = FLOWER_FX.sparkN; let any = false;
    for (let i = 0; i < n; i++) {
      if (this.sl[i] <= 0) continue; any = true;
      this.sl[i] -= dt; this.sv[i * 3 + 1] -= 2.6 * dt;
      this.sp[i * 3] += this.sv[i * 3] * dt; this.sp[i * 3 + 1] += this.sv[i * 3 + 1] * dt; this.sp[i * 3 + 2] += this.sv[i * 3 + 2] * dt;
      if (this.sl[i] <= 0) { this.sl[i] = 0; this.sp[i * 3 + 1] = -999; }
    }
    this.sMat.opacity = 0.7 + 0.3 * Math.sin(this.t * 40);          // the whole burst glints
    if (any || this._sparkOn) this.sPts.geometry.attributes.position.needsUpdate = true;
    this._sparkOn = any;
  }

  // ---- a butterfly or a bee lifts off
  _lift(x, y, z, color) {
    const c = this.critters.find((k) => !k.on); if (!c) return null;
    const bee = this.rand() < 0.4;
    c.on = true; c.t = 0; c.bee = bee; c.root.visible = true;
    c.x = x; c.y = y + 0.05; c.z = z; c.h = this.rand() * 6.283; c.turn = (this.rand() - 0.5) * 2.2; c.ph = this.rand() * 6;
    c.sp = bee ? 1.6 : 0.9; c.life = bee ? 6 : 8;
    if (bee) { c.mat.color.setHex(0xe9eef4); c.bodyMat.color.setHex(0xe6b422); c.root.scale.setScalar(0.07); c.wl.scale.set(1.1, 1, 0.8); c.wr.scale.set(-1.1, 1, 0.8); }
    else { c.mat.color.setHex([0xf3c552, 0xe8f0ff, 0xff9f7a, 0xc9a7ff][Math.floor(this.rand() * 4)] || color); c.bodyMat.color.setHex(0x2b2420); c.root.scale.setScalar(0.1); c.wl.scale.set(1.6, 1, 1.4); c.wr.scale.set(-1.6, 1, 1.4); }
    return c;
  }
  _critters(dt) {
    for (const c of this.critters) {
      if (!c.on) continue;
      c.t += dt; if (c.t > c.life) { c.on = false; c.root.visible = false; continue; }
      c.h += (c.turn + Math.sin(c.t * 1.7 + c.ph) * 1.4) * dt;
      c.x += Math.sin(c.h) * c.sp * dt; c.z += Math.cos(c.h) * c.sp * dt;
      c.y += (c.t < 2.5 ? 0.35 : 0.05) * dt + Math.sin(c.t * (c.bee ? 9 : 4) + c.ph) * 0.004;
      c.root.position.set(c.x, c.y, c.z); c.root.rotation.y = c.h + Math.PI;
      const k = Math.sin(c.t * (c.bee ? 70 : 24)) * (c.bee ? 0.6 : 0.95);
      c.wl.rotation.z = k; c.wr.rotation.z = -k;
      const fade = Math.min(1, (c.life - c.t) / 1.2); const base = c.bee ? 0.07 : 0.1; c.root.scale.setScalar(base * fade);
    }
  }

  dispose() {
    for (const r of this.live) this._finish(r);
    for (const s of this.pool) { this.scene.remove(s.root); s.mat.dispose(); }
    for (const c of this.critters) { this.scene.remove(c.root); c.mat.dispose(); c.bodyMat.dispose(); }
    this.scene.remove(this.sPts); this.sPts.geometry.dispose(); this.sMat.dispose();
    for (const g of [this.geo.stem, this.geo.centre, this.geo.petal, this.wingGeo, this.bodyGeo]) g.dispose();
  }
}
