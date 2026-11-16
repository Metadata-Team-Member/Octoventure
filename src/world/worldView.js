// =====================================================================
//  WorldView - turns a WorldData into three.js objects and animates the
//  scenery (water, sprinklers, drips, rain, clouds, wind specks, sea).
//
//  The world is 1600 m across (or more), so everything static is CHUNKED:
//  the map is cut into 100 m chunks, each with its own terrain mesh and
//  per-kind InstancedMeshes (trees, rocks, grass, props, water ...). Chunks
//  are built near-first (a few ms per frame), hidden beyond the fog, and the
//  small stuff (grass, flowers ...) is further culled by distance.
// =====================================================================
import * as THREE from 'three';
import { CONFIG, TERRAIN } from '../config.js';
import { smoothstep as ss, lerp, clamp } from '../util/rng.js';
import { tint, merge, at, rockGeometry, treeGeometries, grassGeometry, reedGeometry, seagrassGeometry, coralGeometry } from './models.js';
import { HUE_KINDS, LANDMARK_KINDS } from './props.js';
import { buildGeoLib } from './geoLib.js';
import { seat, instanceSpec, geoFor, geoHeight, waterDisc, discMatrix, fitDisc, ringMin } from './placement.js';

export const FOG_COLOR = 0xcfe6f2;
export const CHUNK = 100;
let _dot;
/** soft round sprite so particle 'points' are circles, not squares */
export function dotTexture() {
  if (_dot) return _dot;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(16, 16, 0, 16, 16, 15);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

function instanced(geo, mat, list, place, color) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  list.forEach((o, i) => {
    place(o, _v, _e, _s);
    _q.setFromEuler(_e);
    _m.compose(_v, _q, _s);
    mesh.setMatrixAt(i, _m);
    if (color) { color(o, _c); mesh.setColorAt(i, _c); }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** like instanced(), but every instance is seated on the terrain by placement.js (base on the ground, tilted/sunk as the category needs) */
function instancedSeat(world, geo, mat, list, cat, sub, color) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  const gh = geoHeight(geo);
  list.forEach((o, i) => {
    seat(world, geo, instanceSpec(cat, sub, o, gh), _m);
    mesh.setMatrixAt(i, _m);
    if (color) { color(o, _c); mesh.setColorAt(i, _c); }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** colour of a hue-tinted prop (cars, umbrellas, towels, boat hulls) */
function hueColor(p, c) {
  const h = p.hue ?? p.tint ?? 0;
  const grey = (h * 7) % 1 < 0.3;
  return c.setHSL(h, grey ? 0.05 : 0.62, grey ? 0.62 : 0.52);
}
const coralColor = (o, c) => c.setHSL((0.92 + o.hue * 0.2) % 1, 0.62, 0.56);

// far-distance (m) beyond which a small-stuff mesh is hidden even though its chunk is drawn
const FAR = { grass: 135, flower: 110, reed: 190, beach: 120, seagrass: 120, reef: 200, drop: 160 };

export class WorldView {
  constructor(world, scene, opts = {}) {
    this.world = world;
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.disposables = [];
    this.time = 0;
    this.shadows = opts.shadows ?? CONFIG.graphics.shadows;
    this.stats = { chunksBuilt: 0, chunksTotal: 0, buildMs: 0 };
    this._initChunks();
    this._buildSea();
    this._buildLandmarks();
    this._buildProps();
    this._buildRain();
    this._buildClouds();
    this._buildWind();
    this._buildTransient();
    this._buildFish();
    const s = world.start;
    this.flushAround(s.x, s.z, 230);
    this.visRadius = CONFIG.graphics.fogFar + 70;
    this._cullT = 0;
  }

  track(o) { this.disposables.push(o); return o; }

  // ------------------------------------------------------------ chunk bookkeeping
  _initChunks() {
    const w = this.world;
    this.nch = Math.ceil(CONFIG.worldSize / CHUNK);
    this.chunks = new Array(this.nch * this.nch).fill(null);
    this.stats.chunksTotal = this.nch * this.nch;
    this.buckets = new Map();
    const d = w.decor;
    const put = (x, z, cat, sub, item) => {
      const key = this._key(x, z);
      let b = this.buckets.get(key); if (!b) { b = {}; this.buckets.set(key, b); }
      const c = (b[cat] ??= {});
      (c[sub] ??= []).push(item);
    };
    this.landTrees = [];
    for (const t of d.trees) { if (t.kind === 'norfolk') this.landTrees.push(t); else put(t.x, t.z, 'tree', t.kind, t); }
    for (const r of d.rocks) put(r.x, r.z, 'rock', 'r', r);
    for (const g of d.grass) put(g.x, g.z, 'grass', 'g', g);
    for (const f of d.flowers) put(f.x, f.z, 'flower', 'f', f);
    for (const r of d.reeds) put(r.x, r.z, 'reed', 'r', r);
    for (const b of d.beach) put(b.x, b.z, 'beach', b.kind, b);
    for (const s of d.seagrass) put(s.x, s.z, 'seagrass', 's', s);
    for (const r of d.reef) put(r.x, r.z, 'reef', r.kind, r);
    this.landProps = [];
    for (const p of w.props) { if (LANDMARK_KINDS.has(p.kind)) this.landProps.push(p); else put(p.x, p.z, 'prop', p.kind, p); }
    for (const q of w.waters) { if (q.kind !== 'sprinkler' && q.kind !== 'rain' && q.kind !== 'sea') put(q.x, q.z, 'water', 'w', q); }
    // shared geometry & materials
    const sh = this.shadows;
    this.vcMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
    this.whiteMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 }));
    this.grassMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide }));
    this.terrainMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }));
    this.waterMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4aa8dc, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.lib = buildGeoLib();                       // the same geometry the placement audit uses
    const L = this.lib;
    this.geo = {
      tree: Object.fromEntries(Object.entries(L.tree).map(([k, g]) => [k, this.track(g)])),
      rock: this.track(L.rock), grass: this.track(L.grass), reed: this.track(L.reed), flower: this.track(L.flower),
      shell: this.track(L.shell), weed: this.track(L.weed), wood: this.track(L.wood),
      seagrass: this.track(L.seagrass), coral: this.track(L.coral),
      water: this.track(new THREE.CircleGeometry(1, 22)),
      prop: L.propCache,
    };
    this.geo.water.rotateX(-Math.PI / 2);
    this.tcol = {};
    for (const k in TERRAIN) this.tcol[k] = new THREE.Color(TERRAIN[k].color);
    this.shadowKinds = new Set(['house0', 'house1', 'house2', 'shop', 'barn', 'silo', 'shed', 'bin', 'parkedcar', 'lamp', 'shack', 'hull', 'umbrella', 'cairn', 'slab', 'hollowlog', 'birdbath', 'trough']);
    this._queue = [];
    this._lastCC = '';
  }
  _key(x, z) {
    const h = this.world.half;
    const ix = clamp(Math.floor((x + h) / CHUNK), 0, this.nch - 1), iz = clamp(Math.floor((z + h) / CHUNK), 0, this.nch - 1);
    return iz * this.nch + ix;
  }
  _propGeo(kind) {
    const had = kind in this.lib.propCache; const g = this.lib.propGeo(kind); if (!had) this.track(g); return g;
  }

  /** build every not-yet-built chunk whose centre is within r metres (synchronous: used at start and on teleports) */
  flushAround(x, z, r) {
    const h = this.world.half;
    for (let k = 0; k < this.chunks.length; k++) {
      if (this.chunks[k]) continue;
      const ix = k % this.nch, iz = Math.floor(k / this.nch);
      const cx = -h + (ix + 0.5) * CHUNK, cz = -h + (iz + 0.5) * CHUNK;
      if (Math.hypot(cx - x, cz - z) < r) this._buildChunk(ix, iz);
    }
  }
  _chunkCentre(ix, iz) { const h = this.world.half; return [-h + (ix + 0.5) * CHUNK, -h + (iz + 0.5) * CHUNK]; }

  _buildChunk(ix, iz) {
    const t0 = performance.now();
    const key = iz * this.nch + ix, h = this.world.half;
    const grp = new THREE.Group();
    const x0 = -h + ix * CHUNK, z0 = -h + iz * CHUNK;
    const [cx, cz] = this._chunkCentre(ix, iz);
    grp.userData = { cx, cz, items: [] };
    const add = (mesh, far = 0) => { mesh.userData.far = far; grp.add(mesh); grp.userData.items.push(mesh); return mesh; };
    grp.add(this._terrainChunk(x0, z0));
    const b = this.buckets.get(key) || {};
    const sh = this.shadows;
    if (b.tree) for (const kind in b.tree) {
      const m = instancedSeat(this.world, this.geo.tree[kind], this.vcMat, b.tree[kind], 'tree', kind, (o, c) => c.setScalar(o.tint));
      m.castShadow = sh && kind !== 'bush'; add(m);
    }
    if (b.rock) {
      const m = instancedSeat(this.world, this.geo.rock, this.whiteMat, b.rock.r, 'rock', 'r', (o, c) => c.set(o.dark ? 0x56595f : 0x8f8d88).multiplyScalar(o.tint));
      m.castShadow = sh; m.receiveShadow = sh; add(m);
    }
    if (b.grass) add(instancedSeat(this.world, this.geo.grass, this.grassMat, b.grass.g, 'grass', 'g',
      (o, c) => (o.wet ? c.set(0x4f8a3a) : o.dry ? c.set(0xb8a45a) : c.set(0x6fa83c)).multiplyScalar(o.tint)), FAR.grass);
    if (b.flower) add(instancedSeat(this.world, this.geo.flower, this.vcMat, b.flower.f, 'flower', 'f', (o, c) => c.set(o.color)), FAR.flower);
    if (b.reed) add(instancedSeat(this.world, this.geo.reed, this.vcMat, b.reed.r, 'reed', 'r'), FAR.reed);
    if (b.beach) {
      const col = { shell: 0xf3d9cf, weed: 0x3f5a2c, wood: 0x7a5d44 };
      for (const kind in b.beach) add(instancedSeat(this.world, this.geo[kind], this.whiteMat, b.beach[kind], 'beach', kind, (o, c) => c.set(col[kind])), FAR.beach);
    }
    if (b.seagrass) add(instancedSeat(this.world, this.geo.seagrass, this.vcMat, b.seagrass.s, 'seagrass', 's', (o, c) => c.setHSL(0.27 + (o.rot % 1) * 0.07, 0.55, 0.3)), FAR.seagrass);
    if (b.reef) {
      if (b.reef.coral) add(instancedSeat(this.world, this.geo.coral, this.vcMat, b.reef.coral, 'reef', 'coral', coralColor), FAR.reef);
      if (b.reef.rock) add(instancedSeat(this.world, this.geo.rock, this.whiteMat, b.reef.rock, 'reef', 'rock', (o, c) => c.set(0x62807c)), FAR.reef);
    }
    if (b.prop) for (const kind in b.prop) {
      const hue = HUE_KINDS.has(kind);
      const m = instancedSeat(this.world, this._propGeo(kind), this.vcMat, b.prop[kind], 'prop', kind, (o, c) => (hue ? hueColor(o, c) : c.setScalar(o.tint)));
      m.castShadow = sh && this.shadowKinds.has(kind); m.receiveShadow = sh && (kind.startsWith('house') || kind === 'barn'); add(m);
    }
    if (b.water) {
      const colors = { puddle: 0x4aa8dc, pond: 0x2f8fc8, tidepool: 0x57c2d6, stream: 0x5ab6e6, drip: 0x58b0e0, trough: 0x5aa6c8, dam: 0x3d86a8, estuary: 0x4fa3c0, birdbath: 0x6cc0ea, bowl: 0x6cc0ea, aircon: 0x58b0e0, hose: 0x58b0e0, swamp: 0x3f7f78, creek: 0x4ea6d6 };
      const list = b.water.w;
      const m = new THREE.InstancedMesh(this.geo.water, this.waterMat, Math.max(1, list.length));
      m.count = list.length;
      list.forEach((o, i) => {
        const d = waterDisc(this.world, o);
        discMatrix(d, o.x, o.z, d.r, d.r * (o.kind === 'puddle' ? 0.82 + ((o.x * 3.3) % 0.2) : 1), (o.x * 7.1 + o.z) % 6.28, _m);
        m.setMatrixAt(i, _m); m.setColorAt(i, _c.set(colors[o.kind] ?? 0x4aa8dc));
      });
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere();
      m.renderOrder = 2; add(m);
    }
    for (const m of grp.userData.items) m.userData.cull = true;
    this.root.add(grp);
    this.chunks[key] = grp;
    this.stats.chunksBuilt++;
    this.stats.buildMs += performance.now() - t0;
    return grp;
  }

  _terrainChunk(x0, z0) {
    const w = this.world, cell = CONFIG.terrainCell, half = w.half;
    const n = Math.round(CHUNK / cell), stride = n + 1;
    const pos = new Float32Array(stride * stride * 3), col = new Float32Array(stride * stride * 3);
    const tcol = this.tcol;
    const fog = this._fogC ??= new THREE.Color(FOG_COLOR), foam = this._foamC ??= new THREE.Color(0xf4fbff), deep = this._deepC ??= new THREE.Color(0x1f5f86);
    const c = new THREE.Color();
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = x0 + ix * cell, z = z0 + iz * cell;
        const hh = w.gridH(Math.round((x + half) / cell), Math.round((z + half) / cell));
        const i = iz * stride + ix;
        pos[i * 3] = x; pos[i * 3 + 1] = hh; pos[i * 3 + 2] = z;
        const type = w.typeAt(x, z);
        c.copy(tcol[type] ?? tcol.grass);
        const v = 0.9 + 0.2 * w.n.noise2(x * 0.35, z * 0.35) + 0.06 * w.n.noise2(x * 0.05 + 3, z * 0.05);
        c.multiplyScalar(v);
        for (const q of w.waterHash.at(x, z)) if (q.kind === 'sprinkler' && Math.hypot(x - q.x, z - q.z) < q.r) c.multiplyScalar(0.8);
        if (hh < 0.06 && w.tAt(x, z) > 0.95) {
          const d = clamp(-hh, 0, 5);
          c.copy(tcol.wet).multiplyScalar(0.95).lerp(deep, ss(0, 3.2, d));
          const f = 1 - Math.abs(hh + 0.08) / 0.2;
          if (f > 0) c.lerp(foam, f * 0.55);
        }
        const e = half - Math.max(Math.abs(x), Math.abs(z));
        if (e < 18) c.lerp(fog, 1 - ss(0, 18, e));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    }
    const idx = new Uint16Array(n * n * 6);
    let k = 0;
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const a = iz * stride + ix, b = a + 1, d = a + stride, e2 = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = b; idx[k++] = d; idx[k++] = e2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.receiveShadow = this.shadows;
    return mesh;
  }

  /** stream chunks near the player (budgeted) and cull what is out of range */
  _streamAndCull(dt, px, pz, force) {
    const h = this.world.half, R = this.visRadius, nch = this.nch;
    const pix = clamp(Math.floor((px + h) / CHUNK), 0, nch - 1), piz = clamp(Math.floor((pz + h) / CHUNK), 0, nch - 1);
    // never leave the chunk under/around the player unbuilt
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ix = pix + dx, iz = piz + dz;
      if (ix >= 0 && iz >= 0 && ix < nch && iz < nch && !this.chunks[iz * nch + ix]) this._buildChunk(ix, iz);
    }
    const cc = pix + ',' + piz;
    if (cc !== this._lastCC) {
      this._lastCC = cc;
      this._queue = [];
      const rr = Math.ceil((R + 60) / CHUNK);
      for (let iz = Math.max(0, piz - rr); iz <= Math.min(nch - 1, piz + rr); iz++) for (let ix = Math.max(0, pix - rr); ix <= Math.min(nch - 1, pix + rr); ix++) {
        if (this.chunks[iz * nch + ix]) continue;
        const [cx, cz] = this._chunkCentre(ix, iz); const d = Math.hypot(cx - px, cz - pz);
        if (d < R + 30) this._queue.push({ ix, iz, d });
      }
      this._queue.sort((a, b) => b.d - a.d);     // pop() takes the nearest
    }
    const t0 = performance.now();
    while (this._queue.length && performance.now() - t0 < 6) {
      const q = this._queue.pop();
      if (!this.chunks[q.iz * nch + q.ix]) this._buildChunk(q.ix, q.iz);
    }
    // culling pass (cheap, ~10 Hz)
    this._cullT -= dt;
    if (this._cullT > 0 && !force) return;
    this._cullT = 0.1;
    const R2 = R * R;
    let vis = 0;
    for (const grp of this.chunks) {
      if (!grp) continue;
      const u = grp.userData, dx = u.cx - px, dz = u.cz - pz, d2 = dx * dx + dz * dz;
      const on = d2 < R2;
      grp.visible = on;
      if (!on) continue;
      vis++;
      const d = Math.sqrt(d2);
      for (const m of u.items) { const far = m.userData.far; if (far) m.visible = d - 70 < far; }
    }
    this.stats.chunksVisible = vis;
  }

  // ------------------------------------------------------------ sea
  _buildSea() {
    const w = this.world;
    const size = Math.max(6000, CONFIG.worldSize * 3);
    const geo = this.track(new THREE.PlaneGeometry(size, size, 1, 1));
    geo.rotateX(-Math.PI / 2);
    // normal map made of soft noise, scrolled to look like ripples
    const S = 256, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S * Math.PI * 2, v = y / S * Math.PI * 2;
      hgt[y * S + x] = Math.sin(u * 3 + Math.sin(v * 2) * 1.3) * 0.5 + Math.sin(v * 4 + u * 2) * 0.35 + Math.sin(u * 7 - v * 5) * 0.2 + Math.sin(u * 11 + v * 9) * 0.1;
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
      const dy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const i = (y * S + x) * 4;
      img.data[i] = 128 + dx * 60; img.data[i + 1] = 128 + dy * 60; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = this.track(new THREE.CanvasTexture(cv));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(size / 28, size / 28);
    this.seaTex = tex;
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x2c93c4, roughness: 0.18, metalness: 0.05, normalMap: tex, normalScale: new THREE.Vector2(0.55, 0.55), transparent: true, opacity: 0.72, side: THREE.DoubleSide }));
    const sea = new THREE.Mesh(geo, mat);
    const centre = w.cCoast - 120 + size / 2;
    sea.position.set(w.dir.x * centre, 0, w.dir.z * centre);
    sea.rotation.y = -w.angle;           // local +x now points along the sea direction
    sea.receiveShadow = false;
    this.sea = sea;
    this.root.add(sea);
  }

  // ------------------------------------------------------------ landmarks (lighthouse, Norfolk pines, windmills, water tower): always drawn, hazed
  _buildLandmarks() {
    this.landMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, fog: false, color: 0xb0b0b0, emissive: 0x606a70 }));
    const g = new THREE.Group();
    const trees = this.landTrees;
    if (trees.length) {
      const m = instancedSeat(this.world, this.geo.tree.norfolk, this.landMat, trees, 'tree', 'norfolk', (o, c) => c.setScalar(o.tint));
      m.castShadow = this.shadows; g.add(m);
    }
    for (const p of this.landProps) {
      const mesh = new THREE.Mesh(this._propGeo(p.kind), this.landMat);
      const pg = this._propGeo(p.kind);
      seat(this.world, pg, instanceSpec('prop', p.kind, p, geoHeight(pg)), _m); mesh.matrixAutoUpdate = false; mesh.matrix.copy(_m); mesh.castShadow = this.shadows;
      g.add(mesh);
    }
    this.landmarkGroup = g;
    this.root.add(g);
  }

  // ------------------------------------------------------------ fish (ambient life in the sea)
  _buildFish() {
    const body = merge([at(tint(new THREE.ConeGeometry(0.16, 0.7, 5), 0xffffff), 0, 0, 0, 0, 0, Math.PI / 2), at(tint(new THREE.ConeGeometry(0.2, 0.3, 4), 0xffffff), -0.42, 0, 0, 0, 0, -Math.PI / 2)]);
    this.fishN = 36;
    this.fishMesh = new THREE.InstancedMesh(this.track(body), this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5 })), this.fishN);
    this.fishMesh.frustumCulled = false; this.fishMesh.count = 0;
    for (let i = 0; i < this.fishN; i++) this.fishMesh.setColorAt(i, _c.setHSL(0.05 + (i % 3) * 0.14 + (i % 7) * 0.01, 0.6, 0.6));
    this.root.add(this.fishMesh);
    this.schools = [];
    for (let i = 0; i < 4; i++) this.schools.push({ x: 0, z: 0, y: -2, r: 5 + i, a: i * 1.7, ok: false });
    this._schoolFor = null;
  }
  _updateFish(dt, px, pz) {
    const w = this.world, t = this.time;
    const near = Math.hypot(px - (this._schoolFor?.x ?? 1e9), pz - (this._schoolFor?.z ?? 1e9)) < 90;
    if (!near) {
      this._schoolFor = { x: px, z: pz };
      for (const s of this.schools) {
        s.ok = false;
        for (let k = 0; k < 14; k++) {
          const a = Math.random() * 6.28, d = 14 + Math.random() * 60;
          const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
          if (w.isSea(x, z) && w.heightAt(x, z) < -1.4) { s.x = x; s.z = z; s.y = w.heightAt(x, z) + 0.8 + Math.random() * 1.6; s.ok = true; break; }
        }
      }
    }
    let n = 0;
    const per = this.fishN / this.schools.length;
    for (const s of this.schools) {
      if (!s.ok) continue;
      for (let i = 0; i < per; i++) {
        const a = t * (0.35 + 0.05 * (i % 3)) + i * 0.7 + s.a;
        const x = s.x + Math.cos(a) * s.r + Math.sin(t * 0.3 + i) * 1.2, z = s.z + Math.sin(a) * s.r + Math.cos(t * 0.27 + i) * 1.2;
        _v.set(x, s.y + Math.sin(t + i * 2) * 0.35, z); _q.setFromEuler(_e.set(0, -a, 0)); _s.setScalar(0.8 + (i % 4) * 0.12);
        _m.compose(_v, _q, _s); this.fishMesh.setMatrixAt(n++, _m);
      }
    }
    this.fishMesh.count = n;
    this.fishMesh.instanceMatrix.needsUpdate = true;
    this.fishMesh.visible = n > 0;
  }

  // ------------------------------------------------------------ taps, seeps, sprinklers, drips
  _buildProps() {
    const w = this.world;
    this.drips = [];
    const parts = [];                       // every tap/seep/AC/pump merged into ONE static mesh
    const P = (g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => parts.push(at(g, x, y, z, rx, ry, rz, sx, sy, sz));
    const cylG = (r1, r2, h, hex, seg = 8) => tint(new THREE.CylinderGeometry(r1, r2, h, seg), hex);
    const boxG = (a, b, c, hex) => tint(new THREE.BoxGeometry(a, b, c), hex);
    for (const t of w.taps) {
      const y = ringMin(w, t.x, t.z, 0.9, 8);          // lowest ground under the fixture: the base never floats
      if (t.type === 'tap') {
        P(cylG(0.12, 0.14, 2.0, 0x8a949c), t.x - 0.35, y + 0.95, t.z);
        P(cylG(0.09, 0.09, 0.8, 0x8a949c), t.x, y + 2.0, t.z, 0, 0, Math.PI / 2);
        P(tint(new THREE.TorusGeometry(0.18, 0.04, 6, 10), 0xd24a3a), t.x - 0.35, y + 2.15, t.z, Math.PI / 2);
        this._dripSpot(t.x, t.z, 2.0, y);
      } else if (t.type === 'ac') {
        // a wall-mounted air-con unit on a bracket, dripping condensate
        P(boxG(1.3, 0.9, 0.55, 0xc9ced3), t.x, y + 2.4, t.z, 0, t.rot);
        P(boxG(1.1, 0.5, 0.06, 0x7d858c), t.x, y + 2.4, t.z + 0.3, 0, t.rot);
        P(boxG(0.14, 2.0, 0.14, 0x8a949c), t.x - 0.5, y + 1.0, t.z - 0.1);
        P(boxG(0.14, 2.0, 0.14, 0x8a949c), t.x + 0.5, y + 1.0, t.z - 0.1);
        this._dripSpot(t.x, t.z, 1.95, y);
      } else if (t.type === 'pump') {
        // a bore pump: blue cylinder + spout over a trough
        P(cylG(0.35, 0.4, 1.4, 0x2f6aa8, 10), t.x, y + 0.7, t.z);
        P(cylG(0.1, 0.1, 1.0, 0x8a949c), t.x + 0.5, y + 1.3, t.z, 0, 0, Math.PI / 2);
        P(cylG(0.2, 0.2, 0.3, 0x1c1c1e, 8), t.x, y + 1.5, t.z);
        this._dripSpot(t.x + 0.9, t.z, 1.2, y);
      } else {
        const rock = tint(rockGeometry(0), 0x8b8a86);
        P(rock, t.x - 0.9, y + 1.0, t.z, 0, t.rot, 0, 2.2, 1.7, 1.8);
        P(tint(new THREE.IcosahedronGeometry(0.8, 0), 0x5c8a3c), t.x - 0.7, y + 2.1, t.z, 0, 0, 0, 1.2, 0.5, 1);
        this._dripSpot(t.x, t.z, 2.1, y);
      }
    }
    // sprinkler posts
    this.sprays = [];
    for (const sp of w.sprinklers) {
      const y = ringMin(w, sp.x, sp.z, 0.3, 8);
      P(cylG(0.16, 0.2, 0.5, 0x8a949c), sp.x, y + 0.2, sp.z);
      P(cylG(0.07, 0.07, 0.4, 0xe0b020, 6), sp.x, y + 0.6, sp.z);
      this.sprays.push({ x: sp.x, y: y + 0.7, z: sp.z, reach: sp.r * 0.95, phase: Math.random() });
    }
    if (parts.length) {
      const m = new THREE.Mesh(this.track(merge(parts)), this.vcMat);
      m.castShadow = this.shadows; this.root.add(m);
    }
    // drop particles
    const total = this.drips.length * 3;
    const dgeo = this.track(new THREE.SphereGeometry(0.09, 5, 4));
    const dmat = this.track(new THREE.MeshStandardMaterial({ color: 0x7ec8f2, roughness: 0.1, transparent: true, opacity: 0.9 }));
    this.dropMesh = new THREE.InstancedMesh(dgeo, dmat, Math.max(1, total));
    this.dropMesh.count = total;
    this.dropMesh.frustumCulled = false;
    this.root.add(this.dropMesh);
    const rgeo = this.track(new THREE.RingGeometry(0.85, 1.0, 20));
    rgeo.rotateX(-Math.PI / 2);
    const rmat = this.track(new THREE.MeshBasicMaterial({ color: 0xd8f1ff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rippleMesh = new THREE.InstancedMesh(rgeo, rmat, Math.max(1, total));
    this.rippleMesh.count = total; this.rippleMesh.frustumCulled = false;
    this.root.add(this.rippleMesh);

    this.sprinkleN = 140;
    const pts = new Float32Array(this.sprays.length * this.sprinkleN * 3);
    const pg = this.track(new THREE.BufferGeometry());
    pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const pm = this.track(new THREE.PointsMaterial({ color: 0xd6f0ff, size: 4, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.02, transparent: true, opacity: 0.85, depthWrite: false }));
    this.sprayPoints = new THREE.Points(pg, pm);
    this.sprayPoints.frustumCulled = false;
    this.root.add(this.sprayPoints);
  }
  _dripSpot(x, z, h, y) {
    this.drips.push({ x, z, top: y + h, ground: y + 0.08, phase: Math.random() * 3 });
  }

  // ------------------------------------------------------------ rain
  _buildRain() {
    const w = this.world;
    this.rainN = 150;
    this.clouds = [];
    const cgeo = this.track(merge([
      at(tint(new THREE.IcosahedronGeometry(4, 1), 0x7c8591), 0, 0, 0, 0, 0, 0, 1.6, 0.6, 1.2),
      at(tint(new THREE.IcosahedronGeometry(3.4, 1), 0x6f7883), 5, -0.4, 1.5, 0, 0, 0, 1.5, 0.6, 1.1),
      at(tint(new THREE.IcosahedronGeometry(3.2, 1), 0x838c97), -5.5, -0.2, -1, 0, 0, 0, 1.4, 0.6, 1.2),
      at(tint(new THREE.IcosahedronGeometry(3.0, 1), 0x6a737e), 1, 0.6, -3.6, 0, 0, 0, 1.5, 0.6, 1.1),
    ]));
    const cmat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false }));
    const pts = new Float32Array(w.rain.length * this.rainN * 3);
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = this.track(new THREE.PointsMaterial({ color: 0xbfe3ff, size: 3, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.02, transparent: true, opacity: 0.8, depthWrite: false }));
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.frustumCulled = false;
    this.root.add(this.rainPoints);
    this.rainSeeds = new Float32Array(this.rainN * 3);
    for (let i = 0; i < this.rainSeeds.length; i++) this.rainSeeds[i] = Math.random();
    for (const c of w.rain) {
      const m = new THREE.Mesh(cgeo, cmat);
      m.castShadow = false; this.root.add(m);
      this.clouds.push(m);
    }
    // wet ground ring decal under each cloud
    const rg = this.track(new THREE.RingGeometry(0.1, 1, 28)); rg.rotateX(-Math.PI / 2);
    this.rainRing = [];
  }

  _buildClouds() {
    const geo = this.track(merge([
      at(tint(new THREE.IcosahedronGeometry(8, 1), 0xffffff), 0, 0, 0, 0, 0, 0, 1.6, 0.5, 1.1),
      at(tint(new THREE.IcosahedronGeometry(6, 1), 0xf4f8fc), 12, -1, 3, 0, 0, 0, 1.5, 0.5, 1),
      at(tint(new THREE.IcosahedronGeometry(6.5, 1), 0xf6f9fd), -13, -1, -2, 0, 0, 0, 1.5, 0.5, 1),
    ]));
    const mat = this.track(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92 }));
    this.skyClouds = [];
    const r = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(r(-600, 600), r(110, 160), r(-600, 600));
      m.rotation.y = r(0, 6);
      m.scale.setScalar(r(0.8, 1.8));
      this.root.add(m);
      this.skyClouds.push(m);
    }
  }

  _buildWind() {
    this.windN = 120;
    const g = this.track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.windN * 3), 3));
    this.windSeeds = Array.from({ length: this.windN }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), s: 0.7 + Math.random() }));
    const m = this.track(new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, map: dotTexture(), alphaTest: 0.02, transparent: true, opacity: 0.55, depthWrite: false }));
    this.windPoints = new THREE.Points(g, m);
    this.windPoints.frustumCulled = false;
    this.windPoints.visible = CONFIG.hints.seaWind;
    this.root.add(this.windPoints);
  }

  // ------------------------------------------------------------ storm puddles, dew, gated water (one instanced mesh each)
  _buildTransient() {
    const w = this.world;
    const geo = this.track(new THREE.CircleGeometry(1, 20)); geo.rotateX(-Math.PI / 2);
    this.tempMat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a9fd0, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.82, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.tempMesh = new THREE.InstancedMesh(geo, this.tempMat, CONFIG.env.maxTempPuddles + 10);
    this.tempMesh.count = 0; this.tempMesh.frustumCulled = false; this.tempMesh.renderOrder = 2;
    this.root.add(this.tempMesh);
    const gated = w.seasonal;
    this.gatedMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd8f2ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.0, emissive: 0x7fb6d8, emissiveIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }));
    this.gatedMesh = new THREE.InstancedMesh(geo, this.gatedMat, Math.max(1, gated.length));
    this.gatedMesh.count = gated.length; this.gatedMesh.frustumCulled = false; this.gatedMesh.renderOrder = 2;
    this.gatedLast = -1;
    this.root.add(this.gatedMesh);
  }
  _updateTransient() {
    const w = this.world, M = _m;
    // storm puddles grow and shrink
    const T = w.temp;
    this.tempMesh.count = T.length;
    for (let i = 0; i < T.length; i++) {
      const q = T[i], r = Math.max(0.001, q.r * q.grow);
      q._fit ??= fitDisc(w, q.x, q.z, q.r);
      discMatrix(q._fit, q.x, q.z, r, r * 0.85, q.x * 3.1, M); this.tempMesh.setMatrixAt(i, M);
    }
    this.tempMesh.instanceMatrix.needsUpdate = true;
    // dew / bin lids: fade in and out with their gate
    const key = Math.round((w.gates.dew * 7 + w.gates.wet * 13) * 50);
    if (key !== this.gatedLast) {
      this.gatedLast = key;
      const G = w.seasonal;
      let any = 0;
      for (let i = 0; i < G.length; i++) {
        const q = G[i], on = clamp(w.gates[q.gate] * 2.2 - 0.3, 0, 1);
        any = Math.max(any, on);
        const r = Math.max(0.001, q.r * (q.gate === 'dew' ? 1 : 0.55) * on);
        q._fit ??= fitDisc(w, q.x, q.z, q.r * (q.gate === 'dew' ? 1 : 0.55));
        discMatrix(q._fit, q.x, q.z, r, r, 0, M);
        if (q.lift) M.elements[13] += q.lift - 0.03;            // bin lids: the lid is above the ground
        this.gatedMesh.setMatrixAt(i, M);
      }
      this.gatedMesh.instanceMatrix.needsUpdate = true;
      this.gatedMat.opacity = 0.55 * (any > 0 ? 1 : 0);
      this.gatedMesh.visible = any > 0.01;
    }
  }

  // ------------------------------------------------------------ per-frame
  update(dt, playerPos, camera) {
    this.time += dt;
    const t = this.time, w = this.world;
    w.update(dt);
    this.seaTex.offset.set(t * 0.012, t * 0.007);
    this.sea.material.opacity = 0.72;
    this.sea.position.y = w.seaLevel;
    this._updateTransient();
    if (playerPos) {
      this._streamAndCull(dt, playerPos.x, playerPos.z);
      this._updateFish(dt, playerPos.x, playerPos.z);
    }
    // landmarks sit in the haze: tint them with the fog colour and dim them at night
    if (this.scene.fog) {
      this.landMat.emissive.copy(this.scene.fog.color).multiplyScalar(0.55);
      const lum = 0.2 + 0.5 * clamp((this.scene.fog.color.r + this.scene.fog.color.g + this.scene.fog.color.b) / 2.2, 0, 1);
      this.landMat.color.setScalar(lum);
    }
    this.waterMat.emissive?.setHex(0x0a2a3c);
    this.waterMat.emissiveIntensity = 0.25 + 0.08 * Math.sin(t * 2);

    // drops + ripples
    const n = this.drips.length;
    for (let i = 0; i < n; i++) {
      const d = this.drips[i];
      for (let k = 0; k < 3; k++) {
        const ph = ((t * 0.9 + d.phase + k / 3) % 1);
        const idx = i * 3 + k;
        const fall = ph < 0.55 ? ph / 0.55 : 1;
        const y = lerp(d.top, d.ground, fall * fall);
        _v.set(d.x, y, d.z);
        _s.setScalar(ph < 0.55 ? 1 : 0.0001);
        _m.compose(_v, _q.identity(), _s);
        this.dropMesh.setMatrixAt(idx, _m);
        const rp = clamp((ph - 0.55) / 0.45, 0, 1);
        _v.set(d.x, d.ground + 0.03, d.z);
        _s.setScalar(ph < 0.55 ? 0.0001 : 0.15 + rp * 1.1);
        _m.compose(_v, _q.identity(), _s);
        this.rippleMesh.setMatrixAt(idx, _m);
      }
    }
    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.rippleMesh.instanceMatrix.needsUpdate = true;

    // sprinklers
    const N = this.sprinkleN, arr = this.sprayPoints.geometry.attributes.position.array;
    for (let s = 0; s < this.sprays.length; s++) {
      const sp = this.sprays[s];
      const rot = t * 1.1 + sp.phase * 6.28;
      for (let i = 0; i < N; i++) {
        const jet = i % 4;
        const f = ((i / N) * 3.7 + t * 0.9 + (i * 0.37)) % 1;
        const a = rot + jet * (Math.PI / 2) + Math.sin(i * 7.1) * 0.08;
        const r = sp.reach * f;
        const idx = (s * N + i) * 3;
        arr[idx] = sp.x + Math.cos(a) * r;
        arr[idx + 1] = sp.y + 4 * 2.3 * f * (1 - f) + Math.sin(i) * 0.05;
        arr[idx + 2] = sp.z + Math.sin(a) * r;
      }
    }
    this.sprayPoints.geometry.attributes.position.needsUpdate = true;

    // rain clouds
    const R = this.rainN, rp = this.rainPoints.geometry.attributes.position.array;
    for (let c = 0; c < w.rain.length; c++) {
      const cl = w.rain[c];
      const gy = w.baseHeight(cl.x, cl.z);
      const top = gy + 22;
      this.clouds[c].position.set(cl.x, top + 2, cl.z);
      for (let i = 0; i < R; i++) {
        const f = (this.rainSeeds[i * 3] + t * (0.9 + this.rainSeeds[i * 3 + 1] * 0.5)) % 1;
        const a = this.rainSeeds[i * 3 + 1] * 6.283 * 7, rr = Math.sqrt(this.rainSeeds[i * 3 + 2]) * cl.r * 1.05;
        const idx = (c * R + i) * 3;
        rp[idx] = cl.x + Math.cos(a) * rr; rp[idx + 1] = top - f * (top - gy); rp[idx + 2] = cl.z + Math.sin(a) * rr;
      }
    }
    this.rainPoints.geometry.attributes.position.needsUpdate = true;

    // sky clouds
    if (playerPos) for (const m of this.skyClouds) {
      m.position.x += dt * 2.5;
      // keep the cloud deck around the player (wraps within +-700 m)
      if (m.position.x - playerPos.x > 700) m.position.x -= 1400; else if (m.position.x - playerPos.x < -700) m.position.x += 1400;
      if (m.position.z - playerPos.z > 700) m.position.z -= 1400; else if (m.position.z - playerPos.z < -700) m.position.z += 1400;
    }

    // wind specks: float around the player, blowing from the sea toward the land
    if (this.windPoints.visible && playerPos) {
      const wp = this.windPoints.geometry.attributes.position.array;
      const wx = -w.dir.x, wz = -w.dir.z;
      for (let i = 0; i < this.windN; i++) {
        const s = this.windSeeds[i];
        const gv = 1 + w.gust * 7; s.x = (s.x + dt * 0.05 * s.s * wx * gv + 1) % 1; s.z = (s.z + dt * 0.05 * s.s * wz * gv + 1) % 1;
        const ox = ((s.x * 60 - playerPos.x) % 60 + 90) % 60 - 30, oz = ((s.z * 60 - playerPos.z) % 60 + 90) % 60 - 30;
        wp[i * 3] = playerPos.x + ox; wp[i * 3 + 1] = playerPos.y + 0.6 + s.y * 7 + Math.sin(t * 1.3 + i) * 0.3; wp[i * 3 + 2] = playerPos.z + oz;
      }
      this.windPoints.geometry.attributes.position.needsUpdate = true;
      // fewer specks the further we are from the coast so it stays subtle
      this.windPoints.material.opacity = 0.18 + 0.45 * clamp(1 - Math.abs(w.distToSea(playerPos.x, playerPos.z)) / 420, 0, 1) + 0.3 * w.gust;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh || o.isPoints) {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m?.dispose?.();
      }
      if (o.isInstancedMesh) o.dispose();
    });
    this.disposables.forEach((d) => d.dispose?.());
  }
}
