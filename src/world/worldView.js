// =====================================================================
//  WorldView - turns a WorldData into three.js objects and animates the
//  scenery (water, sprinklers, drips, rain, clouds, wind specks, sea).
// =====================================================================
import * as THREE from 'three';
import { CONFIG, TERRAIN } from '../config.js';
import { smoothstep as ss, lerp, clamp } from '../util/rng.js';
import { tint, merge, at, rockGeometry, treeGeometries, grassGeometry, reedGeometry } from './models.js';

export const FOG_COLOR = 0xcfe6f2;
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

export class WorldView {
  constructor(world, scene, opts = {}) {
    this.world = world;
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.disposables = [];
    this.time = 0;
    this.shadows = opts.shadows ?? CONFIG.graphics.shadows;
    this._buildTerrain();
    this._buildSea();
    this._buildWater();
    this._buildDecor();
    this._buildHouses();
    this._buildProps();
    this._buildRain();
    this._buildClouds();
    this._buildWind();
  }

  track(o) { this.disposables.push(o); return o; }

  // ------------------------------------------------------------ terrain
  _buildTerrain() {
    const w = this.world, cell = CONFIG.terrainCell, half = w.half;
    const n = Math.round(CONFIG.worldSize / cell);
    const stride = n + 1;
    const pos = new Float32Array(stride * stride * 3);
    const col = new Float32Array(stride * stride * 3);
    const tcol = {};
    for (const k in TERRAIN) tcol[k] = new THREE.Color(TERRAIN[k].color);
    const fog = new THREE.Color(FOG_COLOR);
    const foam = new THREE.Color(0xf4fbff);
    const deep = new THREE.Color(0x1f5f86);
    const c = new THREE.Color();
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = -half + ix * cell, z = -half + iz * cell;
        const h = w.heightAt(x, z);
        const i = iz * stride + ix;
        pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
        const type = w.typeAt(x, z);
        c.copy(tcol[type]);
        const v = 0.9 + 0.2 * w.n.noise2(x * 0.35, z * 0.35) + 0.06 * w.n.noise2(x * 0.05 + 3, z * 0.05);
        c.multiplyScalar(v);
        // wet lawn under sprinklers
        for (const q of w.waterHash.at(x, z)) if (q.kind === 'sprinkler' && Math.hypot(x - q.x, z - q.z) < q.r) c.multiplyScalar(0.8);
        if (h < 0.06 && w.tAt(x, z) > 0.95) {
          const d = clamp(-h, 0, 5);
          c.copy(tcol.wet).multiplyScalar(0.95).lerp(deep, ss(0, 3.2, d));
          const f = 1 - Math.abs(h + 0.08) / 0.2;
          if (f > 0) c.lerp(foam, f * 0.55);
        }
        const e = half - Math.max(Math.abs(x), Math.abs(z));
        if (e < 18) c.lerp(fog, 1 - ss(0, 18, e));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    }
    const idx = new Uint32Array(n * n * 6);
    let k = 0;
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const a = iz * stride + ix, b = a + 1, d = a + stride, e2 = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = b; idx[k++] = d; idx[k++] = e2;
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }));
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = this.shadows;
    this.root.add(this.terrain);
  }

  // ------------------------------------------------------------ sea
  _buildSea() {
    const w = this.world;
    const size = 3200;
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
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x2c93c4, roughness: 0.18, metalness: 0.05, normalMap: tex, normalScale: new THREE.Vector2(0.55, 0.55), transparent: true, opacity: 0.72 }));
    const sea = new THREE.Mesh(geo, mat);
    const centre = w.cCoast - 50 + size / 2;
    sea.position.set(w.dir.x * centre, 0, w.dir.z * centre);
    sea.rotation.y = -w.angle;           // local +x now points along the sea direction
    sea.receiveShadow = false;
    this.sea = sea;
    this.root.add(sea);
  }

  // ------------------------------------------------------------ puddles / ponds / streams / tide pools
  _buildWater() {
    const w = this.world;
    const discs = w.waters.filter((q) => ['puddle', 'pond', 'tidepool', 'stream', 'drip'].includes(q.kind));
    const geo = this.track(new THREE.CircleGeometry(1, 22));
    geo.rotateX(-Math.PI / 2);
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x4aa8dc, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const colors = { puddle: 0x4aa8dc, pond: 0x2f8fc8, tidepool: 0x57c2d6, stream: 0x5ab6e6, drip: 0x58b0e0 };
    this.waterMesh = instanced(geo, mat, discs, (o, p, e, s) => {
      p.set(o.x, o.H - 0.02, o.z); e.set(0, (o.x * 7.1 + o.z) % 6.28, 0);
      const r = o.kind === 'drip' ? o.r * 0.7 : o.kind === 'stream' ? o.r * 1.15 : o.r * 0.96;
      s.set(r, 1, r * (o.kind === 'puddle' ? 0.82 + ((o.x * 3.3) % 0.2) : 1));
    }, (o, c) => c.set(colors[o.kind]));
    this.waterMat = mat;
    this.waterMesh.renderOrder = 2;
    this.root.add(this.waterMesh);
  }

  // ------------------------------------------------------------ trees / rocks / grass ...
  _buildDecor() {
    const w = this.world, d = w.decor;
    const sh = this.shadows;
    const vcMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
    const tg = treeGeometries();
    for (const kind of ['pine', 'oak', 'palm', 'bush']) {
      const list = d.trees.filter((t) => t.kind === kind);
      if (!list.length) continue;
      const mesh = instanced(this.track(tg[kind]), vcMat, list, (o, p, e, s) => {
        p.set(o.x, o.y - 0.12, o.z); e.set(0, o.rot, 0); s.setScalar(o.scale);
      }, (o, c) => c.setScalar(o.tint));
      mesh.castShadow = sh && kind !== 'bush'; mesh.receiveShadow = false;
      this.root.add(mesh);
    }
    const rockMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 }));
    const rocks = instanced(this.track(rockGeometry(0)), rockMat, d.rocks, (o, p, e, s) => {
      p.set(o.x, o.y + o.size * o.sy * 0.15, o.z); e.set(0, o.rot, 0); s.set(o.size, o.size * o.sy, o.size);
    }, (o, c) => c.set(0x8f8d88).multiplyScalar(o.tint));
    rocks.castShadow = sh; rocks.receiveShadow = sh;
    this.root.add(rocks);

    const grassMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide }));
    const grass = instanced(this.track(grassGeometry()), grassMat, d.grass, (o, p, e, s) => {
      p.set(o.x, o.y - 0.05, o.z); e.set(0, o.rot, 0); s.set(o.s, o.s, o.s);
    }, (o, c) => (o.dry ? c.set(0xb8a45a) : c.set(0x6fa83c)).multiplyScalar(o.tint));
    this.root.add(grass);
    this.grassMesh = grass;

    const flowerMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }));
    this.root.add(instanced(this.track(new THREE.IcosahedronGeometry(0.14, 0)), flowerMat, d.flowers, (o, p, e, s) => {
      p.set(o.x, o.y + 0.38 * o.s, o.z); e.set(0, 0, 0); s.setScalar(o.s);
    }, (o, c) => c.set(o.color)));

    const reeds = instanced(this.track(reedGeometry()), vcMat, d.reeds, (o, p, e, s) => {
      p.set(o.x, o.y - 0.05, o.z); e.set(0, o.rot, 0); s.setScalar(o.s);
    });
    this.root.add(reeds);

    // beach bits
    const shell = instanced(this.track(new THREE.ConeGeometry(0.16, 0.14, 6)), flowerMat, d.beach.filter((b) => b.kind === 'shell'), (o, p, e, s) => { p.set(o.x, o.y + 0.04, o.z); e.set(0.3, o.rot, 0); s.setScalar(o.s); }, (o, c) => c.set(0xf3d9cf));
    const weed = instanced(this.track(new THREE.IcosahedronGeometry(0.3, 0)), flowerMat, d.beach.filter((b) => b.kind === 'weed'), (o, p, e, s) => { p.set(o.x, o.y + 0.02, o.z); e.set(0, o.rot, 0); s.set(o.s * 1.4, o.s * 0.3, o.s); }, (o, c) => c.set(0x3f5a2c));
    const wood = instanced(this.track(new THREE.BoxGeometry(1.6, 0.18, 0.2)), flowerMat, d.beach.filter((b) => b.kind === 'wood'), (o, p, e, s) => { p.set(o.x, o.y + 0.06, o.z); e.set(0, o.rot, 0.1); s.setScalar(o.s * 1.3); }, (o, c) => c.set(0x7a5d44));
    this.root.add(shell, weed, wood);
  }

  _buildHouses() {
    const g = new THREE.Group();
    for (const h of this.world.houses) {
      const grp = new THREE.Group();
      const wall = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h + 2, h.d), new THREE.MeshStandardMaterial({ color: h.color, flatShading: true, roughness: 0.9 }));
      wall.position.y = (h.h - 2) / 2 + 0.0; wall.castShadow = this.shadows; wall.receiveShadow = this.shadows;
      const roofGeo = new THREE.ConeGeometry(Math.max(h.w, h.d) * 0.78, 2.4, 4);
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: h.roof, flatShading: true, roughness: 0.85 }));
      roof.rotation.y = Math.PI / 4; roof.scale.set(h.w / Math.max(h.w, h.d), 1, h.d / Math.max(h.w, h.d)); roof.position.y = h.h + 1.1; roof.castShadow = this.shadows;
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.2), new THREE.MeshStandardMaterial({ color: 0x6b4a33 }));
      door.position.set(0, 1.2, h.d / 2 + 0.05);
      grp.add(wall, roof, door);
      for (const sx of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 0.15), new THREE.MeshStandardMaterial({ color: 0x9fd3ee, roughness: 0.2, emissive: 0x153040 }));
        win.position.set(sx * h.w * 0.28, 2.6, h.d / 2 + 0.05);
        grp.add(win);
      }
      grp.position.set(h.x, h.y, h.z);
      grp.rotation.y = 0;
      g.add(grp);
    }
    this.root.add(g);
  }

  // ------------------------------------------------------------ taps, seeps, sprinklers, drips
  _buildProps() {
    const w = this.world;
    this.drips = [];
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a949c, metalness: 0.5, roughness: 0.4 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x8b8a86, flatShading: true, roughness: 1 });
    const moss = new THREE.MeshStandardMaterial({ color: 0x5c8a3c, flatShading: true, roughness: 1 });
    for (const t of w.taps) {
      const y = w.heightAt(t.x, t.z);
      const g = new THREE.Group();
      let spoutY = 2.2;
      if (t.type === 'tap') {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.0, 8), metal);
        post.position.y = 1.0;
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 8), metal);
        arm.rotation.z = Math.PI / 2; arm.position.set(0.35, 2.05, 0);
        const knob = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 10), new THREE.MeshStandardMaterial({ color: 0xd24a3a }));
        knob.position.set(0, 2.2, 0); knob.rotation.x = Math.PI / 2;
        g.add(post, arm, knob);
        g.position.set(t.x - 0.35, y - 0.05, t.z);
        this._dripSpot(t.x, t.z, 2.0, y);
      } else {
        const rock = new THREE.Mesh(rockGeometry(0), stone);
        rock.scale.set(2.2, 1.7, 1.8); rock.position.y = 1.2; rock.rotation.y = t.rot;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0), moss);
        m.scale.set(1.2, 0.5, 1); m.position.set(0.2, 2.3, 0);
        g.add(rock, m);
        g.position.set(t.x - 0.9, y - 0.2, t.z);
        this._dripSpot(t.x, t.z, 2.1, y);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = this.shadows; });
      this.root.add(g);
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

    // sprinklers
    this.sprinkleN = 140;
    const sg = new THREE.Group();
    this.sprays = [];
    for (const s of w.sprinklers) {
      const y = w.heightAt(s.x, s.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8), metal);
      base.position.set(s.x, y + 0.2, s.z);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0xe0b020 }));
      head.position.set(s.x, y + 0.6, s.z);
      sg.add(base, head);
      this.sprays.push({ x: s.x, y: y + 0.7, z: s.z, reach: s.r * 0.95, phase: Math.random() });
    }
    this.root.add(sg);
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

  // ------------------------------------------------------------ per-frame
  update(dt, playerPos, camera) {
    this.time += dt;
    const t = this.time, w = this.world;
    w.update(dt);
    this.seaTex.offset.set(t * 0.012, t * 0.007);
    this.sea.material.opacity = 0.72;
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
    for (const m of this.skyClouds) { m.position.x += dt * 2.5; if (m.position.x > 700) m.position.x = -700; }

    // wind specks: float around the player, blowing from the sea toward the land
    if (this.windPoints.visible && playerPos) {
      const wp = this.windPoints.geometry.attributes.position.array;
      const wx = -w.dir.x, wz = -w.dir.z;
      for (let i = 0; i < this.windN; i++) {
        const s = this.windSeeds[i];
        s.x = (s.x + dt * 0.05 * s.s * wx + 1) % 1; s.z = (s.z + dt * 0.05 * s.s * wz + 1) % 1;
        const ox = ((s.x * 60 - playerPos.x) % 60 + 90) % 60 - 30, oz = ((s.z * 60 - playerPos.z) % 60 + 90) % 60 - 30;
        wp[i * 3] = playerPos.x + ox; wp[i * 3 + 1] = playerPos.y + 0.6 + s.y * 7 + Math.sin(t * 1.3 + i) * 0.3; wp[i * 3 + 2] = playerPos.z + oz;
      }
      this.windPoints.geometry.attributes.position.needsUpdate = true;
      // fewer specks the further we are from the coast so it stays subtle
      this.windPoints.material.opacity = 0.18 + 0.45 * clamp(1 - Math.abs(w.distToSea(playerPos.x, playerPos.z)) / 420, 0, 1);
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
