// =====================================================================
//  Effects - small visual feedback that makes the octopus feel physical:
//  ink clouds (an ability), wet footprints, droplets shaken off, venom puff, ripples.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { dotTexture } from '../world/worldView.js';
import { clamp } from '../util/rng.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

export class Effects {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    world.ink = [];                         // read by the predators: {x,z,r,k,t,life}
    // ---- ink clouds: a few translucent blobs per cloud
    this.inkPer = 14; this.inkMax = 5;
    const g = new THREE.IcosahedronGeometry(1, 1);
    this.inkMat = new THREE.MeshBasicMaterial({ color: 0x14121f, transparent: true, opacity: 0.55, depthWrite: false });
    this.inkMesh = new THREE.InstancedMesh(g, this.inkMat, this.inkPer * this.inkMax);
    this.inkMesh.count = 0; this.inkMesh.frustumCulled = false; this.inkMesh.renderOrder = 4;
    scene.add(this.inkMesh);
    this.inkSeeds = Array.from({ length: this.inkPer }, (_, i) => ({ a: i * 2.399, r: 0.25 + ((i * 53) % 10) / 14, h: ((i * 29) % 10) / 10, s: 0.5 + ((i * 17) % 10) / 12 }));
    // ---- wet footprints
    this.printN = 48; this.prints = []; this.printI = 0; this.lastPrint = null;
    const pg = new THREE.CircleGeometry(0.3, 8); pg.rotateX(-Math.PI / 2);
    this.printMat = new THREE.MeshBasicMaterial({ color: 0x1b2b3a, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.printMesh = new THREE.InstancedMesh(pg, this.printMat, this.printN); this.printMesh.count = this.printN; this.printMesh.frustumCulled = false;
    for (let i = 0; i < this.printN; i++) { _m.compose(_v.set(0, -999, 0), _q.identity(), _s.set(0.001, 1, 0.001)); this.printMesh.setMatrixAt(i, _m); this.prints.push({ age: 99, x: 0, y: 0, z: 0, rot: 0 }); }
    scene.add(this.printMesh);
    // ---- droplets (shaken off a wet octopus; splash when entering water; venom puff)
    this.dN = 90; this.dp = new Float32Array(this.dN * 3); this.dv = new Float32Array(this.dN * 3); this.dl = new Float32Array(this.dN); this.dI = 0;
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(this.dp, 3));
    this.dMat = new THREE.PointsMaterial({ color: 0xbfe6ff, size: 3.4, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0.85, depthWrite: false });
    this.dPts = new THREE.Points(dg, this.dMat); this.dPts.frustumCulled = false; scene.add(this.dPts);
    for (let i = 0; i < this.dN; i++) this.dp[i * 3 + 1] = -999;
    // venom puff: its own tint
    this.vN = 40; this.vp = new Float32Array(this.vN * 3); this.vv = new Float32Array(this.vN * 3); this.vl = new Float32Array(this.vN); this.vI = 0;
    const vg = new THREE.BufferGeometry(); vg.setAttribute('position', new THREE.BufferAttribute(this.vp, 3));
    this.vMat = new THREE.PointsMaterial({ color: 0x8dff6a, size: 5, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0.8, depthWrite: false });
    this.vPts = new THREE.Points(vg, this.vMat); this.vPts.frustumCulled = false; scene.add(this.vPts);
    for (let i = 0; i < this.vN; i++) this.vp[i * 3 + 1] = -999;
    this.stepT = 0; this.wasWater = false;
  }

  /** ink cloud at the octopus (the ability itself checks "in water" and the cooldown) */
  ink(x, y, z) {
    const A = CONFIG.abilities, w = this.world;
    if (w.ink.length >= this.inkMax) w.ink.shift();
    w.ink.push({ x, y, z, r: A.inkRadius, k: 0.1, t: 0, life: A.inkLife });
  }
  venom(x, y, z, dx, dz) {
    for (let i = 0; i < 18; i++) {
      const k = this.vI++ % this.vN, a = Math.atan2(dx, dz) + (Math.random() - 0.5) * 1.1, sp = 2.5 + Math.random() * 3;
      this.vp[k * 3] = x; this.vp[k * 3 + 1] = y + 0.7; this.vp[k * 3 + 2] = z;
      this.vv[k * 3] = Math.sin(a) * sp; this.vv[k * 3 + 1] = 0.8 + Math.random() * 1.5; this.vv[k * 3 + 2] = Math.cos(a) * sp; this.vl[k] = 0.9;
    }
  }
  splash(x, y, z, n = 14) {
    for (let i = 0; i < n; i++) {
      const k = this.dI++ % this.dN, a = Math.random() * 6.28, sp = 1 + Math.random() * 2.4;
      this.dp[k * 3] = x; this.dp[k * 3 + 1] = y + 0.2; this.dp[k * 3 + 2] = z;
      this.dv[k * 3] = Math.cos(a) * sp; this.dv[k * 3 + 1] = 2 + Math.random() * 2.5; this.dv[k * 3 + 2] = Math.sin(a) * sp; this.dl[k] = 0.9;
    }
  }

  update(dt, o, ctx) {
    const w = this.world;
    // ---- ink clouds grow, drift, thin out
    for (let i = w.ink.length - 1; i >= 0; i--) { const c = w.ink[i]; c.t += dt; c.k = clamp(c.t / 0.7, 0.1, 1); if (c.t >= c.life) w.ink.splice(i, 1); }
    let n = 0;
    for (const c of w.ink) {
      const fade = clamp((c.life - c.t) / 2.2, 0, 1);
      for (let j = 0; j < this.inkPer; j++) {
        const sd = this.inkSeeds[j], a = sd.a + c.t * 0.25 * (j % 2 ? 1 : -1), rr = sd.r * c.r * c.k * 0.85;
        _v.set(c.x + Math.cos(a) * rr, c.y + 0.3 + sd.h * 1.8 * c.k + Math.sin(c.t * 0.8 + j) * 0.12, c.z + Math.sin(a) * rr);
        const s = sd.s * c.r * 0.34 * c.k * (0.55 + 0.45 * fade);
        _q.identity(); _s.set(s, s * 0.8, s);
        _m.compose(_v, _q, _s); this.inkMesh.setMatrixAt(n++, _m);
      }
    }
    this.inkMesh.count = n; this.inkMesh.instanceMatrix.needsUpdate = true;
    this.inkMat.opacity = w.ink.length ? 0.5 : 0;

    // ---- wet footprints while walking on dry ground
    const wet = o.wetness ?? 0;
    for (let i = 0; i < this.printN; i++) {
      const p = this.prints[i];
      if (p.age < 90) { p.age += dt; const f = clamp(1 - p.age / (3 + 5 * p.wet), 0, 1);
        _m.compose(_v.set(p.x, p.y + 0.05, p.z), _q.setFromEuler(_e.set(0, p.rot, 0)), _s.set(Math.max(0.001, f) * p.sz, 1, Math.max(0.001, f) * p.sz * 1.5)); this.printMesh.setMatrixAt(i, _m); if (f <= 0) p.age = 99; }
    }
    this.printMesh.instanceMatrix.needsUpdate = true;
    const onDry = !o.waterKind && !o.swim && !o.tunnel && !o.climb && !o.carried && o.alive;
    if (onDry && o.moving && wet > 0.25) {
      if (!this.lastPrint || Math.hypot(o.x - this.lastPrint.x, o.z - this.lastPrint.z) > 0.9 * (o.sz ?? 1)) {
        const p = this.prints[this.printI++ % this.printN];
        const side = (this.printI % 2 ? 1 : -1) * 0.22 * (o.sz ?? 1);
        p.x = o.x + Math.cos(o.heading) * side; p.z = o.z - Math.sin(o.heading) * side; p.y = w.heightAt(p.x, p.z); p.rot = o.heading; p.age = 0; p.wet = wet; p.sz = (0.7 + wet * 0.5) * (o.sz ?? 1);
        this.lastPrint = { x: o.x, z: o.z };
        ctx?.step?.(wet, o.speed);
      }
    }
    // ---- droplets: shaken off while moving fast and wet, big splash on entering water
    if (o.alive && o.moving && wet > 0.4 && o.speed > 6 * (o.sz ?? 1) && Math.random() < dt * 14) this.splash(o.x, o.y, o.z, 1);
    const inW = !!o.waterKind;
    if (inW && !this.wasWater) this.splash(o.x, o.y, o.z, 16);
    if (inW && o.moving && Math.random() < dt * 10) this.splash(o.x, o.y, o.z, 1);
    this.wasWater = inW;
    for (let i = 0; i < this.dN; i++) {
      if (this.dl[i] <= 0) continue;
      this.dl[i] -= dt; this.dv[i * 3 + 1] -= 9 * dt;
      this.dp[i * 3] += this.dv[i * 3] * dt; this.dp[i * 3 + 1] += this.dv[i * 3 + 1] * dt; this.dp[i * 3 + 2] += this.dv[i * 3 + 2] * dt;
      if (this.dl[i] <= 0) this.dp[i * 3 + 1] = -999;
    }
    this.dPts.geometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < this.vN; i++) {
      if (this.vl[i] <= 0) continue;
      this.vl[i] -= dt; this.vv[i * 3 + 1] -= 2 * dt;
      this.vp[i * 3] += this.vv[i * 3] * dt; this.vp[i * 3 + 1] += this.vv[i * 3 + 1] * dt; this.vp[i * 3 + 2] += this.vv[i * 3 + 2] * dt;
      if (this.vl[i] <= 0) this.vp[i * 3 + 1] = -999;
    }
    this.vPts.geometry.attributes.position.needsUpdate = true;
  }
  dispose() {
    for (const o of [this.inkMesh, this.printMesh, this.dPts, this.vPts]) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); o.dispose?.(); }
    this.world.ink = [];
  }
}
