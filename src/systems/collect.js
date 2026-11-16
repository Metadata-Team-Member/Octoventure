// =====================================================================
//  Collectibles - shells and baby octopuses. Both are HIDDEN mechanics:
//   - every shell quietly toughens the skin (Progress.armor -> Octopus.armor). Nothing on screen says so.
//   - baby octopuses hide in tins, big shells, rock pools and puddles. Finding one plays a little
//     celebration and is tracked internally (no counter).
// =====================================================================
import * as THREE from 'three';
import { tint, merge, at } from '../world/models.js';
import { shellGeometry } from '../world/geoLib.js';
import { seat, instanceSpec, geoHeight, shellScale, fitDisc } from '../world/placement.js';
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
    // ---- shells: one instanced mesh, always cheap (a few hundred instances)
    const list = world.shells;
    this.geo = shellGeometry();
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(1, list.length));
    this.mesh.count = list.length;
    const pal = [0xf6e3d8, 0xf1c9b8, 0xfff5e6, 0xe8cdb0, 0xd9b8d9, 0xf4d9a3];
    list.forEach((sh, i) => {
      sh.i = i; sh.s = shellScale(i);
      this.setShell(i, sh, sh.s);
      this.mesh.setColorAt(i, _c.set(pal[i % pal.length]));
    });
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor && (this.mesh.instanceColor.needsUpdate = true);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.grid = new Map();
    for (const sh of list) { const k = Math.floor(sh.x / 20) + ',' + Math.floor(sh.z / 20); (this.grid.get(k) || this.grid.set(k, []).get(k)).push(sh); }
    // ---- babies
    this.babyGeo = babyGeometry();
    this.babyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.4, emissive: 0x0a3a9a, emissiveIntensity: 0.0 });
    this.fx = [];                 // running rescue animations
    this.dotMat = new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, map: dotTexture(), transparent: true, depthWrite: false, vertexColors: true });
    this.hearts = 0;
  }
  setShell(i, sh, s) {
    seat(this.world, this.geo, instanceSpec('shell', 'c', { x: sh.x, z: sh.z, rot: sh.rot, s }, geoHeight(this.geo)), _m);   // lies on the ground, tilted to the slope
    this.mesh.setMatrixAt(i, _m);
  }

  update(dt, o, runTime, ctx = {}) {
    const w = this.world;
    // ---- shells: silent pick-up, quietly adds armour
    if (o.alive && !o.tunnel) {
      const cx = Math.floor(o.x / 20), cz = Math.floor(o.z / 20);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const cell = this.grid.get((cx + dx) + ',' + (cz + dz)); if (!cell) continue;
        for (const sh of cell) {
          if (sh.got) { if (sh.fade > 0) { sh.fade = Math.max(0, sh.fade - dt * 4); this.setShell(sh.i, sh, sh.s * sh.fade); this.mesh.instanceMatrix.needsUpdate = true; } continue; }
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
    if (o.alive) for (const b of w.babies) {
      if (b.found) continue;
      const d = Math.hypot(b.x - o.x, b.z - o.z);
      if (d < 1.9 * Math.max(0.6, o.sz ?? 1) && Math.abs(b.y - o.y) < 3) this.rescue(b, o, runTime);
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
  dispose() { for (const f of this.fx) f.dispose(); this.scene.remove(this.root); this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); this.babyGeo.dispose(); this.babyMat.dispose(); this.dotMat.dispose(); }
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
