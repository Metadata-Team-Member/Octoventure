// Shallow reef life, a longshore current, and one quiet grotto.
// Props are built once and reused. Fish state lives in typed arrays (no per-frame alloc).
import * as THREE from 'three';
import { toonMat, outlineMat, outline } from '../world/toon.js';
import { merge, at } from '../world/models.js';
import { damp, smoothstep as ss } from '../util/rng.js';
import { EDGE } from '../world/bands.js';

const FISH = 18;
const STARS = 7;
const BABIES = 5;

/** a fixed place in the sea for this world (same seed, same grotto) */
export function grottoOf(world) {
  const s = world.seed >>> 0;
  const along0 = (s % 700) - 350;
  for (let k = 0; k < 28; k++) {
    const along = along0 + ((k % 7) - 3) * 48;
    const out = 78 + (s % 36) + Math.floor(k / 7) * 22;
    const c = world.cCoast + out;
    const x = world.dir.x * c + world.perp.x * along;
    const z = world.dir.z * c + world.perp.z * along;
    const depth = world.seaDepth(x, z);
    if (world.isSea(x, z) && depth > 1.1 && depth < 7.5) return { x, z, r: 8 };
  }
  const c = world.cCoast + 140;
  return { x: world.dir.x * c, z: world.dir.z * c, r: 8 };
}

/** gentle current into `out` {x,z}. Zero on land and in the shallows. */
export function flowAt(world, x, z, swim, out) {
  out.x = 0; out.z = 0;
  if (!(swim > 0.35) || !world.isSea(x, z)) return out;
  const depth = world.seaDepth(x, z);
  const k = Math.min(1, depth / 2.4) * Math.min(1, swim);
  const s = 0.7 * k;
  out.x = world.perp.x * s + world.dir.x * 0.12 * k;
  out.z = world.perp.z * s + world.dir.z * 0.12 * k;
  if (world.banded) {                         // out past the shark fins a soft return current turns a swimmer back towards the reef (no wall, no warning)
    const back = ss(EDGE.sea - 60, EDGE.sea - 5, z), side = ss(EDGE.east - 90, EDGE.east - 10, Math.abs(x));
    out.z -= 2.2 * back + 0.12 * k;
    out.x -= Math.sign(x) * 1.8 * side;
  }
  return out;
}

const _flow = { x: 0, z: 0 };
const _dummy = new THREE.Object3D();

export class Reef {
  constructor(scene) {
    this.scene = scene;
    this.world = null;
    this.grotto = null;
    this.built = false;
    this.seen = false;
    this.fish = new Float32Array(FISH * 4); // x, z, vx, vz offsets around the school
    this.phase = new Float32Array(FISH);
    for (let i = 0; i < FISH; i++) {
      const a = (i / FISH) * Math.PI * 2;
      this.fish[i * 4] = Math.cos(a) * (1.2 + (i % 3) * 0.4);
      this.fish[i * 4 + 1] = Math.sin(a) * (1.2 + (i % 3) * 0.4);
      this.fish[i * 4 + 2] = -Math.sin(a) * 0.6;
      this.fish[i * 4 + 3] = Math.cos(a) * 0.6;
      this.phase[i] = a;
    }
    this.t = 0;
    this.school = { x: 0, z: 0 };
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this._flow = _flow;
  }

  bind(world) {
    this.world = world;
    this.grotto = grottoOf(world);
    this.seen = false;
    this.built = false;
    this._seated = false;
    this._schoolOn = false;
    this.clearProps();
  }

  clearProps() {
    const kill = (m) => {
      if (!m) return;
      m.traverse?.((o) => { o.geometry?.dispose?.(); });
    };
    while (this.root.children.length) {
      const c = this.root.children.pop();
      this.root.remove(c);
      kill(c);
    }
    this.fishMesh = null; this.starMesh = null; this.turtle = null; this.babies = null; this.caustic = null; this.arches = null;
  }

  ensure() {
    if (this.built) return;
    this.built = true;
    const g = this.grotto;
    const coralMat = toonMat({ color: 0xef6a78 });
    const sandMat = toonMat({ color: 0xe7d3a1 });
    const kelpMat = toonMat({ color: 0x2f8f4e });
    const rockMat = toonMat({ color: 0x6d7c78 });
    const starMat = toonMat({ color: 0xe07a3d });
    const fishMat = toonMat({ color: 0xf2c14e });
    const shellMat = toonMat({ color: 0xf4e2c4 });

    const coralGeo = new THREE.SphereGeometry(0.45, 6, 5);
    const kelpGeo = new THREE.CapsuleGeometry(0.06, 1.1, 2, 5);
    const archGeo = merge([
      at(new THREE.CapsuleGeometry(0.46, 1.15, 2, 6), -0.82, 0.95, 0),
      at(new THREE.CapsuleGeometry(0.46, 1.15, 2, 6), 0.82, 0.95, 0),
      at(new THREE.SphereGeometry(0.62, 6, 5), 0, 1.85, 0, 0, 0, 0, 1.45, 0.72, 0.9),
      at(new THREE.SphereGeometry(0.4, 5, 4), -0.48, 1.62, 0.05),
      at(new THREE.SphereGeometry(0.4, 5, 4), 0.48, 1.62, 0.05),
    ]);
    this.arches = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      const m = new THREE.Mesh(archGeo, rockMat);
      m.position.set(g.x + Math.cos(a) * 5.5, 0, g.z + Math.sin(a) * 5.5);
      m.rotation.y = -a;
      m.userData.lift = 0;
      this.arches.add(m);
      const head = new THREE.Mesh(coralGeo, i % 2 ? coralMat : sandMat);
      head.position.set(g.x + Math.cos(a + 0.4) * 3.2, 0, g.z + Math.sin(a + 0.4) * 3.2);
      head.scale.set(1.4, 0.8, 1.4);
      head.userData.lift = 0.28;
      this.arches.add(head);
      const frond = new THREE.Mesh(kelpGeo, kelpMat);
      frond.position.set(g.x + Math.cos(a) * 7.5, 0, g.z + Math.sin(a) * 7.5);
      frond.userData.lift = 0.15;
      this.arches.add(frond);
      const sand = new THREE.Mesh(coralGeo, sandMat);
      sand.position.set(g.x + Math.cos(a + 1.1) * 8.2, 0, g.z + Math.sin(a + 1.1) * 8.2);
      sand.scale.set(2.6, 0.16, 1.15);
      sand.rotation.y = a;
      sand.userData.lift = 0.02;
      this.arches.add(sand);
    }
    this.root.add(this.arches);

    const starBits = [at(new THREE.SphereGeometry(0.2, 6, 4), 0, 0.08, 0, 0, 0, 0, 1, 0.55, 1)];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      starBits.push(at(new THREE.SphereGeometry(0.12, 5, 4), Math.cos(a) * 0.3, 0.07, Math.sin(a) * 0.3, 0, -a, 0, 0.72, 0.55, 1.45));
    }
    const starGeo = merge(starBits);
    this.starMesh = new THREE.InstancedMesh(starGeo, starMat, STARS);
    this.starMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < STARS; i++) {
      const a = (i / STARS) * Math.PI * 2;
      _dummy.position.set(g.x + Math.cos(a) * (2.2 + (i % 2)), 0, g.z + Math.sin(a) * (2.2 + (i % 2)));
      _dummy.rotation.set(-Math.PI / 2 * 0, a, 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.starMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.starMesh.count = STARS;
    this.root.add(this.starMesh);
    outline(this.starMesh, outlineMat());

    const fishGeo = merge([
      at(new THREE.SphereGeometry(0.16, 6, 5), 0, 0, 0, 0, 0, 0, 1.7, 0.75, 0.85),
      at(new THREE.SphereGeometry(0.08, 5, 4), -0.26, 0.01, 0, 0, 0, 0, 0.7, 1.15, 0.28),
      at(new THREE.SphereGeometry(0.06, 4, 3), 0.02, 0.08, 0.12, 0.5, 0, 0.3, 0.35, 1.3, 0.7),
      at(new THREE.SphereGeometry(0.06, 4, 3), 0.02, 0.08, -0.12, -0.5, 0, -0.3, 0.35, 1.3, 0.7),
    ]);
    this.fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, FISH);
    this.fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fishMesh.frustumCulled = false;
    this.root.add(this.fishMesh);
    this.fishHull = outline(this.fishMesh, outlineMat())[0];

    const shell = toonMat({ color: 0x2f7a52 });
    const skin = toonMat({ color: 0x3d8f62 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 7, 6), shell);
    body.scale.set(1.25, 0.5, 1.55);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 5), skin);
    belly.scale.set(1.05, 0.32, 1.2); belly.position.y = -0.08;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 6, 5), skin);
    head.position.set(0, 0.08, 0.72); head.scale.set(0.9, 0.8, 1.15);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), skin);
    tail.position.set(0, 0.05, -0.78); tail.scale.set(0.45, 0.9, 0.7);
    const flip = (x) => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.22, 5, 4), skin); f.position.set(x, -0.02, 0.05); f.scale.set(0.7, 0.22, 1.3); return f; };
    this.turtle = new THREE.Group();
    this.turtle.add(body, belly, head, tail, flip(0.55), flip(-0.55));
    outline(this.turtle, outlineMat());
    this.root.add(this.turtle);

    const babyGeo = new THREE.SphereGeometry(0.12, 6, 5);
    this.babies = new THREE.InstancedMesh(babyGeo, toonMat({ color: 0x4aa8ff }), BABIES);
    this.babies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.babies.count = 0;
    this.root.add(this.babies);

    const cgeo = new THREE.PlaneGeometry(16, 16);
    this.caustic = new THREE.Mesh(cgeo, new THREE.MeshBasicMaterial({
      color: 0xc8f4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.caustic.rotation.x = -Math.PI / 2;
    this.caustic.renderOrder = 4;
    this.root.add(this.caustic);
    this.shellMat = shellMat;
  }

  seatY(mesh) {
    const w = this.world;
    mesh.traverse((o) => {
      if (!o.isMesh || o === this.caustic || o === this.fishMesh) return;
    });
    // seat arches and stars on the sea floor once
    if (this._seated) return;
    this._seated = true;
    const wld = this.world;
    this.arches.children.forEach((m) => {
      const lift = m.userData.lift != null ? m.userData.lift : 0.35;
      m.position.y = wld.heightAt(m.position.x, m.position.z) + lift;
    });
    for (let i = 0; i < STARS; i++) {
      this.starMesh.getMatrixAt(i, _dummy.matrix);
      _dummy.matrix.decompose(_dummy.position, _dummy.quaternion, _dummy.scale);
      _dummy.position.y = wld.heightAt(_dummy.position.x, _dummy.position.z) + 0.08;
      _dummy.updateMatrix();
      this.starMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.starMesh.instanceMatrix.needsUpdate = true;
    void mesh; void w;
  }

  update(dt, game) {
    const o = game.octopus, w = this.world;
    if (!o || !w || !this.grotto) return;
    this.t += dt;
    const sea = !!(o.swim > 0.25 && w.isSea(o.x, o.z));
    const near = Math.hypot(o.x - this.grotto.x, o.z - this.grotto.z) < 140;
    this.root.visible = near || sea;
    if (!near && !sea) return;
    this.ensure();
    this.seatY(this.root);

    if (sea) {
      flowAt(w, o.x, o.z, o.swim, _flow);
      if (!o.carried && !o.tunnel) {
        const nx = o.x + _flow.x * dt, nz = o.z + _flow.z * dt;
        const r = w.resolve(nx, nz, 0.7 * (o.sz || 1));
        o.x = r.x; o.z = r.z;
      }
    }

    // school drifts just ahead of a swimming octopus, else idles over the grotto
    const sx = sea ? o.x + w.perp.x * 4 : this.grotto.x;
    const sz = sea ? o.z + w.perp.z * 4 : this.grotto.z;
    if (!this._schoolOn) { this.school.x = sx; this.school.z = sz; this._schoolOn = true; }
    else {
      this.school.x = damp(this.school.x, sx, 0.6, dt);
      this.school.z = damp(this.school.z, sz, 0.6, dt);
    }
    const yFish = (w.seaLevel || 0) - 0.8;
    for (let i = 0; i < FISH; i++) {
      const px = this.fish[i * 4], pz = this.fish[i * 4 + 1];
      let vx = this.fish[i * 4 + 2], vz = this.fish[i * 4 + 3];
      // steer toward a ring and away from the origin of the school
      const ang = Math.atan2(pz, px) + 0.7;
      const tx = Math.cos(ang) * 2.4, tz = Math.sin(ang) * 2.4;
      vx += (tx - px) * 0.8 * dt;
      vz += (tz - pz) * 0.8 * dt;
      const sp = Math.hypot(vx, vz) || 1;
      const max = 1.4;
      if (sp > max) { vx = vx / sp * max; vz = vz / sp * max; }
      this.fish[i * 4] = px + vx * dt;
      this.fish[i * 4 + 1] = pz + vz * dt;
      this.fish[i * 4 + 2] = vx;
      this.fish[i * 4 + 3] = vz;
      _dummy.position.set(this.school.x + px, yFish + Math.sin(this.t * 2 + this.phase[i]) * 0.25, this.school.z + pz);
      _dummy.rotation.set(0, Math.atan2(vx, vz), 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.fishMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.fishMesh.instanceMatrix.needsUpdate = true;
    this.fishMesh.count = near || sea ? FISH : 0;
    if (this.fishHull) this.fishHull.count = this.fishMesh.count;

    const ta = this.t * 0.15;
    const tx = this.grotto.x + Math.cos(ta) * 10;
    const tz = this.grotto.z + Math.sin(ta) * 6;
    this.turtle.position.set(tx, w.heightAt(tx, tz) + 0.45, tz);
    this.turtle.rotation.y = -ta + Math.PI / 2;

    const wet = sea || !!o.waterKind;
    this.caustic.visible = wet;
    if (wet) {
      this.caustic.position.set(o.x, (w.seaLevel || 0) + 0.15, o.z);
      const pulse = 0.08 + 0.05 * Math.sin(this.t * 1.7);
      this.caustic.material.opacity = o.swim > 0.4 ? pulse * 1.4 : pulse;
      this.caustic.rotation.z = this.t * 0.15;
    }

    const inside = Math.hypot(o.x - this.grotto.x, o.z - this.grotto.z) < this.grotto.r;
    const babies = game.progress?.babies > 0 || (game.progress?.rescued && game.progress.rescued.size > 0);
    const showBabies = inside && babies && (o.swim > 0.2 || o.waterKind);
    this.babies.count = showBabies ? BABIES : 0;
    if (showBabies) {
      for (let i = 0; i < BABIES; i++) {
        const a = this.t * 0.4 + i * 1.25;
        const bx = this.grotto.x + Math.cos(a) * 1.6;
        const bz = this.grotto.z + Math.sin(a) * 1.6;
        _dummy.position.set(bx, w.heightAt(bx, bz) + 0.25 + Math.sin(this.t * 3 + i) * 0.08, bz);
        _dummy.rotation.set(0, -a, 0);
        _dummy.scale.setScalar(0.7 + (i % 2) * 0.15);
        _dummy.updateMatrix();
        this.babies.setMatrixAt(i, _dummy.matrix);
      }
      this.babies.instanceMatrix.needsUpdate = true;
      if (!this.seen && game.state === 'playing') {
        this.seen = true;
        game.levels?.did('grotto');
        game.journal?.seeHow('grotto');
        game.grottoMoment = { t: 0, dur: 6 };
      }
    }
  }
}
