// =====================================================================
//  Collectibles - shells and baby octopuses. Both are HIDDEN mechanics:
//   - every shell quietly toughens the skin (Progress.armor -> Octopus.armor). Nothing on screen says so.
//   - baby octopuses hide in tins, big shells, rock pools and puddles. Finding one plays a little
//     celebration and is tracked internally (no counter).
// =====================================================================
import * as THREE from 'three';
import { tint, merge, at } from '../world/models.js';
import { buildShellGeos } from '../world/geoLib.js';
import { seat, instanceSpec, geoHeight, shellScale, shellKind, fitDisc } from '../world/placement.js';
import { dotTexture } from '../world/worldView.js';
import { CONFIG } from '../config.js';
import { clamp, lerp, smoothstep as ss } from '../util/rng.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

function babyGeometry() {
  // a tiny blue-ringed octopus: ochre body, stubby arms, glowing blue rings
  const parts = [at(tint(new THREE.SphereGeometry(0.2, 10, 8), 0xe3b04a), 0, 0.28, 0, 0, 0, 0, 1, 1.15, 1)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(at(tint(new THREE.ConeGeometry(0.06, 0.34, 5), 0xd9a63f), Math.cos(a) * 0.18, 0.08, Math.sin(a) * 0.18, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9));
  }
  for (const [x, y, z] of [[0.13, 0.4, 0.1], [-0.13, 0.4, 0.1], [0.0, 0.5, -0.1], [0.16, 0.27, -0.06], [-0.16, 0.27, -0.06]]) parts.push(at(tint(new THREE.TorusGeometry(0.045, 0.014, 5, 8), 0x1a6aff), x, y, z, 0, Math.atan2(x, z), 0));
  for (const x of [-0.08, 0.08]) parts.push(at(tint(new THREE.SphereGeometry(0.045, 6, 5), 0xffffff), x, 0.34, 0.17), at(tint(new THREE.SphereGeometry(0.02, 5, 4), 0x111111), x, 0.34, 0.205));
  return merge(parts);
}

export class Collectibles {
  constructor(world, scene, progress, audio) {
    this.world = world; this.scene = scene; this.progress = progress; this.audio = audio;
    this.root = new THREE.Group(); scene.add(this.root);
    // ---- shells: three models (scallop, turban, cowrie), each one instanced mesh. The original map's shells have fixed slots;
    // shells in the endless far regions borrow a slot from a small pool while the octopus is near them.
    const list = world.shells.filter((sh) => !sh.reg);
    this.geos = buildShellGeos();
    // natural, matte-to-satin shell (no metal): the colours are baked into the vertices, instances only vary the tone a little
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
    this.meshes = {}; this.counts = { c: 0, t: 0, k: 0 }; this.free = { c: [], t: [], k: [] };
    const POOL = 140;
    for (const k of ['c', 't', 'k']) {
      const n = list.filter((_, i) => shellKind(i) === k).length;
      const m = new THREE.InstancedMesh(this.geos[k], this.mat, n + POOL); m.count = n + POOL; m.frustumCulled = false; this.meshes[k] = m; this.root.add(m);
      _m.makeScale(0, 0, 0);
      for (let j = 0; j < POOL; j++) { m.setMatrixAt(n + j, _m); this.free[k].push(n + j); }
    }
    this.mesh = this.meshes.c;
    const pal = [0xffffff, 0xfff3ea, 0xf8e6dc, 0xf3ecf6, 0xfaf0d8, 0xe9dccb];
    this.pal = pal;
    list.forEach((sh, i) => {
      const k = shellKind(i), m = this.meshes[k]; sh.i = i; sh.k = k; sh.j = this.counts[k]++; sh.s = shellScale(i);
      this.setShell(i, sh, sh.s);
      m.setColorAt(sh.j, _c.set(pal[i % pal.length]));
    });
    for (const k in this.meshes) { const m = this.meshes[k]; for (let j = this.counts[k]; j < m.count; j++) m.setColorAt(j, _c.set(0xffffff)); }
    for (const m of Object.values(this.meshes)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.grid = new Map();
    this.bgrid = new Map();
    const gadd = (map, size, o) => { const k = Math.floor(o.x / size) + ',' + Math.floor(o.z / size); (map.get(k) || map.set(k, []).get(k)).push(o); };
    for (const sh of list) gadd(this.grid, 20, sh);
    this.active = new Set(); this.actT = 0;
    // ---- babies
    this.babyGeo = babyGeometry();
    this.babyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, emissive: 0x0a3a9a, emissiveIntensity: 0.0 });
    this.fx = [];                 // running rescue animations
    this.dotMat = new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, map: dotTexture(), transparent: true, depthWrite: false, vertexColors: true });
    this.hearts = 0;
    // ---- subtle tells: a tiny wriggling baby peeks out beside its hiding place when the octopus is near, with a faint glint
    // (a small pool of 24 live slots is reused for whichever babies are close)
    const nb = 24;
    this.peek = new THREE.InstancedMesh(this.babyGeo, this.babyMat, nb); this.peek.count = 0; this.peek.frustumCulled = false; this.root.add(this.peek);
    this.glint = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(nb * 3).fill(-999), 3)),
      new THREE.PointsMaterial({ color: 0xbfe0ff, size: 3.4, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glint.frustumCulled = false; this.root.add(this.glint);
    this.babyInit = (b, i) => { const a = i * 2.4; b.px = b.x + Math.cos(a) * 0.55; b.pz = b.z + Math.sin(a) * 0.55; b.py = world.heightAt(b.px, b.pz); b.ph = i * 1.7; };
    let bi = 0;
    for (const b of world.babies) { b.ph = undefined; gadd(this.bgrid, 50, b); bi++; }
    this.bi = bi;
    // regions generated later (the endless land) register their shells and babies here
    world.regions.onGenerate((reg) => {
      for (const sh of reg.shells) { sh.reg = true; sh.slot = -1; if (this.savedShells?.has(sh.id)) sh.got = true; gadd(this.grid, 20, sh); }
      for (const b of reg.babies) { if (this.savedBabies?.has(String(b.id))) b.found = true; gadd(this.bgrid, 50, b); }
    });
    this.tellT = 0; this.tellGap = 3; this.clock = 0;
  }
  /** a loaded save: shells already taken (original ones by index, far ones by id) and babies already found stay gone */
  restore(shellIdx, shellIds, babyIds) {
    this.savedShells = new Set(shellIds); this.savedBabies = new Set(babyIds.map(String));
    const list = this.world.shells.filter((s) => !s.reg);
    for (const i of shellIdx) { const sh = list[i]; if (sh && !sh.got) { sh.got = true; sh.fade = 0; this.setShell(i, sh, 0); } }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
    for (const r of this.world.regions.list) for (const sh of r.shells) if (this.savedShells.has(sh.id)) sh.got = true;
    for (const b of this.world.babies) if (this.savedBabies.has(String(b.id))) b.found = true;
  }
  /** wriggle + glint for the babies close to the octopus (<= ~40 u) */
  tells(dt, o) {
    const P = this.glint.geometry.attributes.position; this.clock += dt;
    const t = this.clock; let nearest = 1e9, nb = null, n = 0;
    const cx = Math.floor(o.x / 50), cz = Math.floor(o.z / 50);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const cell = this.bgrid.get((cx + dx) + ',' + (cz + dz)); if (!cell) continue;
      for (const b of cell) {
        if (b.found) continue;
        const d = Math.hypot(b.x - o.x, b.z - o.z);
        if (d > 40 || n >= 24) continue;
        if (b.ph === undefined) this.babyInit(b, this.bi++);
        if (d < nearest) { nearest = d; nb = b; }
        const wig = Math.sin(t * 3.1 + b.ph), k = 0.42 * (1 + 0.06 * Math.sin(t * 5 + b.ph));
        _q.setFromEuler(_e.set(0.12 * Math.sin(t * 2.3 + b.ph), b.ph + 0.5 * wig, 0.18 * Math.cos(t * 2.7 + b.ph)));
        _m.compose(_v.set(b.px, b.py - 0.02, b.pz), _q, _s.set(k, k * (1 + 0.1 * wig), k)); this.peek.setMatrixAt(n, _m);
        const on = Math.sin(t * 2.2 + b.ph) > -0.25;                                    // the glint comes and goes
        P.setXYZ(n, b.px, on ? b.py + 0.55 + 0.05 * Math.sin(t * 4 + b.ph) : -999, b.pz);
        n++;
      }
    }
    for (let j = n; j < 24; j++) P.setXYZ(j, 0, -999, 0);
    this.peek.count = n;
    this.peek.instanceMatrix.needsUpdate = true; P.needsUpdate = true;
    // a very soft little blip now and then when one is close
    this.tellT -= dt;
    if (nb && nearest < 16 && this.tellT <= 0) { this.tellT = 5 + Math.random() * 4; this.audio.babyTell?.(nb.px, nb.py + 0.2, nb.pz); }
  }
  /** far-region shells: give the ones near the octopus a mesh slot, take it back from the ones left behind (twice a second) */
  streamShells(o) {
    const cx = Math.floor(o.x / 20), cz = Math.floor(o.z / 20);
    for (const sh of this.active) {
      if (Math.hypot(sh.x - o.x, sh.z - o.z) > 150 || (sh.got && !(sh.fade > 0))) this.release(sh);
    }
    for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
      const cell = this.grid.get((cx + dx) + ',' + (cz + dz)); if (!cell) continue;
      for (const sh of cell) {
        if (!sh.reg || sh.got || sh.slot >= 0) continue;
        if (Math.hypot(sh.x - o.x, sh.z - o.z) > 120) continue;
        const f = this.free[sh.k]; if (!f.length) continue;
        sh.j = sh.slot = f.pop(); this.active.add(sh);
        sh.s ??= 1;
        this.setShell(-1, sh, sh.s);
        this.meshes[sh.k].setColorAt(sh.j, _c.set(this.pal[sh.j % this.pal.length])); this.meshes[sh.k].instanceColor.needsUpdate = true;
        this.meshes[sh.k].instanceMatrix.needsUpdate = true;
      }
    }
  }
  release(sh) {
    this.active.delete(sh);
    const m = this.meshes[sh.k]; _m.makeScale(0, 0, 0); m.setMatrixAt(sh.slot, _m); m.instanceMatrix.needsUpdate = true;
    this.free[sh.k].push(sh.slot); sh.slot = -1;
  }
  setShell(i, sh, s) {
    const geo = this.geos[sh.k];
    seat(this.world, geo, instanceSpec('shell', sh.k, { x: sh.x, z: sh.z, rot: sh.rot, s }, geoHeight(geo)), _m);   // lies on the ground, tilted to the slope
    this.meshes[sh.k].setMatrixAt(sh.j, _m);
  }

  update(dt, o, runTime, ctx = {}) {
    const w = this.world;
    // ---- shells: silent pick-up, quietly adds armour
    this.actT -= dt; if (this.actT <= 0) { this.actT = 0.5; this.streamShells(o); }
    if (o.alive && !o.tunnel) {
      const cx = Math.floor(o.x / 20), cz = Math.floor(o.z / 20);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const cell = this.grid.get((cx + dx) + ',' + (cz + dz)); if (!cell) continue;
        for (const sh of cell) {
          if (sh.reg && sh.slot < 0) continue;
          if (sh.got) { if (sh.fade > 0) { sh.fade = Math.max(0, sh.fade - dt * 4); this.setShell(sh.i, sh, sh.s * sh.fade); this.meshes[sh.k].instanceMatrix.needsUpdate = true; } continue; }
          const ddx = sh.x - o.x, ddz = sh.z - o.z;
          if (ddx * ddx + ddz * ddz < (1.5 * (o.sz ?? 1) + 0.35) ** 2 && Math.abs(sh.y - o.y) < 3.5) {
            sh.got = true; sh.fade = 1;
            this.progress.addShell(runTime);
            o.armor = this.progress.armor;
          }
        }
      }
    }
    // ---- babies
    this.tells(dt, o);
    if (o.alive) {
      const bx = Math.floor(o.x / 50), bz = Math.floor(o.z / 50);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const cell = this.bgrid.get((bx + dx) + ',' + (bz + dz)); if (!cell) continue;
        for (const b of cell) {
          if (b.found) continue;
          const d = Math.hypot(b.x - o.x, b.z - o.z);
          if (d < 2.6 * Math.max(0.6, o.sz ?? 1) && Math.abs(b.y - o.y) < 3) this.rescue(b, o, runTime);
        }
      }
    }
    for (let i = this.fx.length - 1; i >= 0; i--) if (!this.fx[i].update(dt)) { this.fx[i].dispose(); this.fx.splice(i, 1); }
  }

  rescue(b, o, runTime) {
    b.found = true;
    this.progress.addBaby(b.id, runTime);
    const fx = new BabyRescue(this, b, o);
    this.fx.push(fx);
    this.audio.chime?.(b.x, b.y, b.z);
    // a little joy: a sip of health and energy (hidden, never mentioned)
    o.health = Math.min(100, o.health + 12); o.energy = Math.min(o.energy + 20, CONFIG.camo.maxEnergy);
    o.glowBoost = 1;
  }
  dispose() { for (const f of this.fx) f.dispose(); this.scene.remove(this.root); for (const k in this.geos) { this.geos[k].dispose(); this.meshes[k].dispose(); } this.mat.dispose(); this.babyGeo.dispose(); this.babyMat.dispose(); this.peek.dispose(); this.glint.geometry.dispose(); this.glint.material.dispose(); this.dotMat.dispose(); }
}

/** ~5 s of celebration: pops up, bubbles, rings glow, scampers & swirls, dissolves into a puddle, soft chime (audio) */
class BabyRescue {
  constructor(col, b, o) {
    this.col = col; this.b = b; this.t = 0; this.dur = 5.4;
    const g = this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(col.babyGeo, col.babyMat.clone());
    this.mesh.scale.setScalar(0.001);
    g.add(this.mesh);
    g.position.set(b.x, b.y, b.z);
    col.scene.add(g);
    this.light = new THREE.PointLight(0x4f9bff, 0, 9, 2); this.light.position.set(0, 0.6, 0); g.add(this.light);
    // bubbles (joy / ink): points rising from the spot
    this.N = 34;
    this.pos = new Float32Array(this.N * 3); this.colr = new Float32Array(this.N * 3);
    this.seed = Array.from({ length: this.N }, (_, i) => ({ a: i * 2.4, s: 0.6 + (i % 7) / 7, d: (i % 5) * 0.1 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.colr, 3));
    const pal = [0x9fd8ff, 0xffd6f2, 0xc8ffe6, 0xfff0a8, 0xc9b6ff];
    for (let i = 0; i < this.N; i++) { _c.set(pal[i % pal.length]); this.colr.set([_c.r, _c.g, _c.b], i * 3); }
    this.points = new THREE.Points(geo, col.dotMat); this.points.frustumCulled = false;
    col.scene.add(this.points);
    // the puddle it dissolves into
    const pg = new THREE.CircleGeometry(1, 24); pg.rotateX(-Math.PI / 2);
    this.puddle = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0x59b4ea, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const fit = fitDisc(col.world, b.x, b.z, 1.9);          // the puddle lies on the slope, not flat in the air
    this.puddle.position.set(b.x, fit.y0 + 0.02, b.z); this.puddle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-fit.gx, 1, -fit.gz).normalize()); this.puddle.scale.setScalar(0.01);
    col.scene.add(this.puddle);
    this.madePuddle = false;
  }
  update(dt) {
    this.t += dt;
    const t = this.t, k = t / this.dur, b = this.b, m = this.mesh;
    if (k >= 1) return false;
    // 0 - 0.7 s: pops up in an arc; 0.7 - 3.6 s: scampers in a widening swirl, hopping; 3.6 - 5 s: melts into the puddle
    let x = 0, y = 0, z = 0, sc = 1, spin = 0;
    if (t < 0.7) { const f = t / 0.7; sc = ss(0, 0.5, f) * 1.25; y = Math.sin(Math.PI * f) * 1.5 + 0.1; }
    else if (t < 3.6) {
      const f = (t - 0.7) / 2.9, a = f * Math.PI * 4.2, r = 0.3 + f * 2.3;
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = Math.abs(Math.sin(t * 9)) * 0.28; spin = a;
      sc = 1.25;
    } else {
      const f = (t - 3.6) / 1.4; sc = 1.25 * (1 - ss(0, 1, f)); y = -f * 0.1;
      const a = 4.2 * Math.PI + f * 3; x = Math.cos(a) * 2.3 * (1 - f * 0.6); z = Math.sin(a) * 2.3 * (1 - f * 0.6); spin = a;
    }
    m.position.set(x, this.b.y * 0 + y, z); m.rotation.y = -spin + Math.PI / 2; m.scale.setScalar(Math.max(0.001, sc));
    // squish when dissolving
    if (t > 3.6) m.scale.y *= 0.7;
    const glow = t < 3.6 ? 0.7 + 0.5 * Math.sin(t * 8) : 0.7 * (1 - (t - 3.6) / 1.4);
    m.material.emissiveIntensity = Math.max(0, glow);
    this.light.intensity = Math.max(0, glow) * 3.0;
    // bubbles
    for (let i = 0; i < this.N; i++) {
      const sd = this.seed[i], f = ((t * 0.5 * sd.s + sd.d) % 1);
      const born = t > sd.d, rr = 0.2 + f * 1.4;
      this.pos[i * 3] = b.x + Math.cos(sd.a + t * 0.8) * rr; this.pos[i * 3 + 1] = b.y + 0.2 + f * 3.4 * (born ? 1 : 0); this.pos[i * 3 + 2] = b.z + Math.sin(sd.a + t * 0.8) * rr;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.col.dotMat.opacity = clamp(1 - (t - 3.8) / 1.4, 0, 1);
    // puddle fades in under the dissolving baby, then hands over to a real temporary puddle
    const pf = ss(3.4, 5.0, t);
    this.puddle.scale.setScalar(0.01 + pf * 1.9); this.puddle.material.opacity = 0.8 * pf;
    if (t > 4.9 && !this.madePuddle) {
      this.madePuddle = true;
      const w = this.col.world;
      w.temp.push({ kind: 'storm', x: b.x, z: b.z, r: 1.9, H: b.y, age: 4, life: 190, grow: 0 });
    }
    return true;
  }
  dispose() {
    const sc = this.col.scene;
    sc.remove(this.group); sc.remove(this.points); sc.remove(this.puddle);
    this.mesh.material.dispose(); this.points.geometry.dispose(); this.puddle.geometry.dispose(); this.puddle.material.dispose(); this.light.dispose?.();
    this.col.dotMat.opacity = 1;
  }
}
