// Secrets of night and rain. A few deterministic spots per world tile (own hash, not the
// gather stream). Most of the time a tile has none. Each kind is a journal silhouette
// until it is met, then a collection portrait and a badge. No prompts in the world.
import * as THREE from 'three';
import { toonMat, outlineMat, outline } from '../world/toon.js';
import { scallop } from '../world/shells.js';

export const RARE_IDS = ['gold', 'pearl', 'glowfrog', 'rainbloom', 'moonrace', 'ring'];
export const RARE_SET = new Set(RARE_IDS);
const REGION = 400;
const STEP = 78;
const SPEC = {
  gold:     { biomes: ['beach', 'dunes'], mod: 4, cap: 2 },
  pearl:    { biomes: ['beach', 'estuary', 'headland'], mod: 5, cap: 2, pearl: true },
  glowfrog: { biomes: ['rainforest'], mod: 2, cap: 2, night: true },
  rainbloom:{ biomes: ['desert'], mod: 2, cap: 2, rain: true },
  moonrace: { biomes: ['beach'], mod: 5, cap: 1, night: true },
  ring:     { biomes: ['bush', 'rainforest'], mod: 9, cap: 1 },
};

export function rareHash(seed, rx, rz, ix, iz, k) {
  let h = (seed ^ Math.imul(rx + 3, 0x9e3779b1) ^ Math.imul(rz + 7, 0x85ebca6b) ^ Math.imul(ix + 11, 0xc2b2ae35) ^ Math.imul(iz + 13, 0x27d4eb2f) ^ Math.imul(k + 1, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** visible / touchable right now. night 0..1, wet 0..1 (lingers after rain). The desert flower opens only after the rain has stopped, while the ground is still wet. */
export function rareOpen(id, night, wet, raining = false) {
  const s = SPEC[id];
  if (!s) return false;
  if (s.night && !(night > 0.55)) return false;
  if (s.rain && (raining || !(wet > 0.35))) return false;
  return true;
}

function accept(world, id, x, z) {
  const sea = world.isSea(x, z);
  const depth = world.seaDepth(x, z);
  if (id === 'pearl') {
    if (sea && depth > 0.45 && depth < 2.6) return true;
    if (!sea && !world.waterAt(x, z)) {
      const h = world.heightAt(x, z);
      if (h > 0.06 && h < 1.35) return true;
    }
    return false;
  }
  if (sea || world.waterAt(x, z)) return false;
  if (world.heightAt(x, z) < 0.12) return false;
  if (world.isRoad?.(x, z)) return false;
  return true;
}

/** rare spots inside one 400 m tile. Same tile, same list, whatever order you ask. */
export function planTile(world, rx, rz) {
  const h = world.half;
  const x0 = -h + rx * REGION, z0 = -h + rz * REGION;
  const counts = Object.create(null);
  const spots = [];
  const nx = Math.ceil(REGION / STEP);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nx; iz++) {
      const x = x0 + (ix + 0.5) * STEP;
      const z = z0 + (iz + 0.5) * STEP;
      if (x > x0 + REGION - 8 || z > z0 + REGION - 8) continue;
      const biome = world.biomeAt(x, z);
      for (let k = 0; k < RARE_IDS.length; k++) {
        const id = RARE_IDS[k], spec = SPEC[id];
        if ((counts[id] || 0) >= spec.cap) continue;
        if (!spec.biomes.includes(biome)) continue;
        const hv = rareHash(world.seed >>> 0, rx, rz, ix, iz, k);
        if (hv % spec.mod !== 0) continue;
        const px = Math.min(x0 + REGION - 6, Math.max(x0 + 6, x + ((hv >>> 8) % 1000) / 1000 * 16 - 8));
        const pz = Math.min(z0 + REGION - 6, Math.max(z0 + 6, z + ((hv >>> 18) % 1000) / 1000 * 16 - 8));
        if (world.biomeAt(px, pz) !== biome) continue;
        if (!accept(world, id, px, pz)) continue;
        let crowded = false;
        for (let i = 0; i < spots.length; i++) if ((spots[i].x - px) ** 2 + (spots[i].z - pz) ** 2 < 18 * 18) { crowded = true; break; }
        if (crowded) continue;
        spots.push({ id, x: px, z: pz, rx, rz, ang: (hv % 6283) / 1000 });
        counts[id] = (counts[id] || 0) + 1;
      }
    }
  }
  return spots;
}

const JID = { gold: 'rare-gold', pearl: 'rare-pearl', glowfrog: 'rare-frog', rainbloom: 'rare-bloom', moonrace: 'rare-race', ring: 'rare-ring' };
const GEO = {};
function geos() {
  if (GEO.shell) return GEO;
  GEO.shell = new THREE.SphereGeometry(0.16, 7, 5);
  GEO.gold = scallop(1);
  GEO.gold.scale(1.9, 1.9, 1.9);
  GEO.gold.rotateX(-0.35);
  GEO.gold.computeBoundingBox();
  GEO.gold.translate(0, -GEO.gold.boundingBox.min.y - 0.02, 0);
  GEO.bead = new THREE.SphereGeometry(0.07, 6, 4);
  GEO.body = new THREE.SphereGeometry(0.11, 7, 5);
  GEO.eye = new THREE.SphereGeometry(0.022, 5, 4);
  GEO.stem = new THREE.CylinderGeometry(0.018, 0.026, 0.2, 5);
  GEO.cap = new THREE.SphereGeometry(0.08, 6, 4);
  GEO.glow = new THREE.SphereGeometry(0.2, 6, 4);
  GEO.bud = new THREE.SphereGeometry(0.06, 6, 4);
  return GEO;
}
const MAT = {};
function mats() {
  if (MAT.gold) return MAT;
  MAT.gold = toonMat({ vertexColors: true, emissive: 0xf2c14a, emissiveIntensity: 0.55 });
  MAT.sand = toonMat({ color: 0xf3dcc9 });
  MAT.pearl = toonMat({ color: 0xfff8ee });
  MAT.frog = toonMat({ color: 0x8dffb0 });
  MAT.eye = toonMat({ color: 0x142018 });
  MAT.petal = toonMat({ color: 0xff8fb0 });
  MAT.leaf = toonMat({ color: 0x6aaa48 });
  MAT.crab = toonMat({ color: 0xf6f1e6 });
  MAT.stalk = toonMat({ color: 0xf4f0e4 });
  MAT.cap = toonMat({ color: 0xd45a68 });
  MAT.hole = toonMat({ color: 0x3a342c });
  MAT.glow = new THREE.MeshBasicMaterial({ color: 0xc8ffb0, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  return MAT;
}

function shellMesh(mat, sx, sy, sz) {
  const g = geos(), m = mats();
  const mesh = new THREE.Mesh(g.shell, mat || m.sand);
  mesh.scale.set(sx, sy, sz);
  mesh.position.y = 0.16 * sy;
  mesh.castShadow = false;
  return mesh;
}

export class RareFinds {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.root.name = 'rares';
    game.scene.add(this.root);
    this.oline = outlineMat();
    this.cache = new Map();
    this.wet = 0;
    this.t = 0;
    this.scan = 0;
    this.pool = {};
    for (let i = 0; i < RARE_IDS.length; i++) {
      const id = RARE_IDS[i];
      this.pool[id] = [this.slot(id), this.slot(id)];
    }
    this.sync();
  }

  /** a loaded journal or badge list fills the other, once, without playing the find again */
  sync() {
    for (let i = 0; i < RARE_IDS.length; i++) {
      const id = RARE_IDS[i], jid = JID[id];
      if (this.game.journal?.has(jid)) this.game.levels?.did('rare', id);
    }
  }

  slot(id) {
    const g = geos(), m = mats();
    const root = new THREE.Group();
    root.visible = false;
    const sl = { id, g: root, spot: null, d: 1e12, seated: null, crabs: null, bits: null, petals: null, glow: null, body: null, holes: null };
    if (id === 'gold') {
      const mesh = new THREE.Mesh(g.gold, m.gold);
      mesh.position.y = 0;
      root.add(mesh);
    } else if (id === 'pearl') {
      root.add(shellMesh(m.sand, 0.9, 0.5, 0.75));
      const p = new THREE.Mesh(g.bead, m.pearl);
      p.position.set(0, 0.12, 0.04);
      p.userData.noOutline = true;
      root.add(p);
    } else if (id === 'glowfrog') {
      const body = new THREE.Mesh(g.body, m.frog);
      body.scale.set(1.15, 0.72, 1.35);
      body.position.y = 0.08;
      const e1 = new THREE.Mesh(g.eye, m.eye), e2 = e1.clone();
      e1.position.set(0.04, 0.13, 0.08); e2.position.set(-0.04, 0.13, 0.08);
      const glow = new THREE.Mesh(g.glow, m.glow);
      glow.position.y = 0.1;
      glow.userData.noOutline = true;
      root.add(body, e1, e2, glow);
      outline(root, this.oline);
      sl.body = body; sl.glow = glow;
    } else if (id === 'rainbloom') {
      const stem = new THREE.Mesh(g.stem, m.leaf);
      stem.position.y = 0.1;
      const petals = new THREE.Mesh(g.cap, m.petal);
      petals.scale.set(1.3, 0.45, 1.3);
      petals.position.y = 0.2;
      const bud = new THREE.Mesh(g.bud, m.petal);
      bud.position.y = 0.2;
      root.add(stem, petals, bud);
      sl.petals = petals; sl.bud = bud;
    } else if (id === 'moonrace') {
      sl.crabs = [];
      sl.holes = [];
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Group();
        const body = new THREE.Mesh(g.body, m.crab);
        body.scale.set(1.15, 0.45, 0.9);
        body.position.y = 0.05;
        const e1 = new THREE.Mesh(g.eye, m.eye), e2 = e1.clone();
        e1.position.set(0.04, 0.09, 0.07); e2.position.set(-0.04, 0.09, 0.07);
        c.add(body, e1, e2);
        outline(c, this.oline);
        root.add(c);
        sl.crabs.push(c);
      }
      for (let i = 0; i < 2; i++) {
        const h = new THREE.Mesh(g.bead, m.hole);
        h.scale.set(1.4, 0.25, 1.1);
        h.userData.noOutline = true;
        root.add(h);
        sl.holes.push(h);
      }
    } else {
      sl.bits = [];
      for (let i = 0; i < 7; i++) {
        const bit = new THREE.Group();
        const stalk = new THREE.Mesh(g.stem, m.stalk);
        stalk.scale.set(0.7, 0.55, 0.7);
        stalk.position.y = 0.05;
        const cap = new THREE.Mesh(g.cap, m.cap);
        cap.scale.set(0.85, 0.4, 0.85);
        cap.position.y = 0.12;
        bit.add(stalk, cap);
        root.add(bit);
        sl.bits.push(bit);
      }
    }
    this.root.add(root);
    return sl;
  }

  tile(rx, rz) {
    const k = rx + ',' + rz;
    let s = this.cache.get(k);
    if (!s) { s = planTile(this.game.world, rx, rz); this.cache.set(k, s); }
    return s;
  }

  /** every spot of a kind on the original map (debug / tests) */
  spotsOf(id) {
    const w = this.game.world, n = Math.round(w.cfg.worldSize / REGION);
    const out = [];
    for (let rz = 0; rz < n; rz++) for (let rx = 0; rx < n; rx++) {
      const list = this.tile(rx, rz);
      for (let i = 0; i < list.length; i++) if (!id || list[i].id === id) out.push(list[i]);
    }
    return out;
  }

  update(dt, o) {
    const world = this.game.world, env = this.game.env;
    if (!o || !world) return;
    this.t += dt;
    const rain = (env?.rain || 0) > 0.2 || world.raining;
    if (rain) this.wet = Math.min(1, this.wet + dt * 0.7);
    else this.wet = Math.max(0, this.wet - dt * 0.05);
    this.scan -= dt;
    if (this.scan <= 0) { this.scan = 0.4; this.rebind(o); }
    const night = world.night;
    const openWet = this.wet;
    for (let k = 0; k < RARE_IDS.length; k++) {
      const pool = this.pool[RARE_IDS[k]];
      for (let i = 0; i < pool.length; i++) {
        const sl = pool[i];
        if (!sl.spot) { sl.g.visible = false; continue; }
        sl.g.visible = true;
        this.place(sl, night, rain);
      }
    }
    this.touch(o, night, openWet, rain);
  }

  rebind(o) {
    const world = this.game.world;
    const [rx, rz] = world.regions.tileOf(o.x, o.z);
    for (let k = 0; k < RARE_IDS.length; k++) {
      const pool = this.pool[RARE_IDS[k]];
      for (let i = 0; i < pool.length; i++) { pool[i].spot = null; pool[i].d = 1e12; }
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = this.tile(rx + dx, rz + dz);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const d = (s.x - o.x) ** 2 + (s.z - o.z) ** 2;
        if (d > 78 * 78) continue;
        const pool = this.pool[s.id];
        let worst = 0;
        for (let j = 1; j < pool.length; j++) if (pool[j].d > pool[worst].d) worst = j;
        if (d < pool[worst].d) { pool[worst].spot = s; pool[worst].d = d; }
      }
    }
  }

  place(sl, night, raining) {
    const s = sl.spot, w = this.game.world;
    if (s.id === 'moonrace') {
      const on = night > 0.55;
      const ang = s.ang;
      for (let i = 0; i < sl.crabs.length; i++) {
        const c = sl.crabs[i];
        c.visible = on;
        if (!on) continue;
        const u = (this.t * 0.33 + i * 0.22) % 1;
        const along = (u * 2 - 1) * 3.3;
        const x = s.x + Math.cos(ang) * along, z = s.z + Math.sin(ang) * along;
        c.position.set(x, w.heightAt(x, z) + 0.02, z);
        c.rotation.y = -ang;
      }
      for (let i = 0; i < sl.holes.length; i++) {
        const along = i === 0 ? -3.3 : 3.3;
        const x = s.x + Math.cos(ang) * along, z = s.z + Math.sin(ang) * along;
        sl.holes[i].position.set(x, w.heightAt(x, z) + 0.01, z);
        sl.holes[i].visible = !on;
      }
      return;
    }
    if (sl.seated !== s) {
      sl.seated = s;
      const y = w.heightAt(s.x, s.z);
      sl.g.position.set(s.x, y, s.z);
      sl.g.rotation.y = s.ang;
      if (s.id === 'ring') {
        for (let i = 0; i < sl.bits.length; i++) {
          const a = s.ang + i / sl.bits.length * Math.PI * 2;
          const x = Math.cos(a) * 0.85, z = Math.sin(a) * 0.85;
          sl.bits[i].position.set(x, w.heightAt(s.x + x, s.z + z) - y, z);
        }
      }
    }
    if (s.id === 'glowfrog') {
      const on = night > 0.55;
      sl.g.visible = on;
      if (sl.glow) sl.glow.scale.setScalar(0.85 + Math.sin(this.t * 3.1) * 0.12);
    } else if (s.id === 'rainbloom') {
      const open = !raining && this.wet > 0.35 ? 1 : 0.22;
      if (sl.petals) { sl.petals.scale.set(open * 1.35, 0.4, open * 1.35); sl.petals.position.y = 0.12 + open * 0.08; }
      if (sl.bud) sl.bud.visible = open < 0.5;
    }
  }

  touch(o, night, wet, raining = false) {
    if (!o.alive || o.carried) return;
    const reach = o.swim > 0.3 ? 1.7 : 1.25;
    for (let k = 0; k < RARE_IDS.length; k++) {
      const id = RARE_IDS[k];
      if (this.game.journal?.has(JID[id]) && this.game.levels?.st.rare?.has(id)) continue;
      if (!rareOpen(id, night, wet, raining)) continue;
      const pool = this.pool[id];
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i].spot;
        if (!s) continue;
        const r = id === 'moonrace' ? 6 : reach;
        if ((s.x - o.x) ** 2 + (s.z - o.z) ** 2 < r * r) { this.discover(id, s); return; }
      }
    }
  }

  discover(id, s) {
    const jid = JID[id];
    const knew = !!this.game.journal?.has(jid);
    this.game.journal?.see(jid);
    this.game.levels?.did('rare', id);
    if (knew) return;
    const y = this.game.world?.heightAt(s.x, s.z) || 0;
    if (id === 'rainbloom') this.game.collectPollen?.('pd', 0xf0b429, s.x, y, s.z);
    this.game.audio?.gather?.(s.x, y, s.z);
    this.game.saveSoon?.('rare');
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.oline?.dispose?.();
    this.cache.clear();
    this.root = null;
  }
}
