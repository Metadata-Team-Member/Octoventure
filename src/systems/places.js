// =====================================================================
//  Enterable houses, one hedge maze, and the small neighbourhood places.
//  Interiors are built on the way in and thrown away on the way out. The outdoor
//  world is hidden (not rebuilt) while you are inside. No prompts: walk into a flap.
// =====================================================================
import * as THREE from 'three';
import { toonMat, outline, outlineMat } from '../world/toon.js';
import { planPlaces, carveMaze, mazeDress, mazeOpen, dailyKind, MAZE_CELL } from '../world/places.js';
import { CONFIG } from '../config.js';

const IX = 9200, IZ = 9200;
const RW = 6.6, RD = 5.6;
/** 1 u ~ 32 cm (DESIGN.md). A step through a flap is about 1.5 m, stopped short of a wall. */
export const FLAP_STEP = 1.5 / 0.32;
export const FLAP_COOL = 1;
export const ROOM_D = RD;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _cellV = new THREE.Vector3();
const G = {};
const geo = (id, make) => G[id] || (G[id] = make());
const ball = () => geo('ball', () => new THREE.SphereGeometry(0.5, 8, 6));
const boxG = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const disc = () => geo('disc', () => new THREE.CircleGeometry(1, 10));
const cyl = () => geo('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8));

/** where to stand on the way in: local room metres, facing +z (into the room). */
export function flapInsideLocal() {
  const doorZ = -RD / 2 + 0.55;
  const z = Math.min(doorZ + FLAP_STEP, RD / 2 - 0.62);
  return { x: 0, z, heading: 0, doorZ, gap: z - doorZ };
}
/** where to stand on the way out: 1.5 m past the flap, facing away (+z, the yard). */
export function flapOutside(door) {
  return { x: door.x, z: (door.z ?? 0) + FLAP_STEP, heading: 0 };
}
/** a flap (or the indoor mat) fires only when it is armed, cooled down, and the octopus is inside it. */
export function flapAllows(f, inside) {
  return !!(f && f.armed && f.cool <= 0 && inside);
}

export class Places {
  constructor(game) {
    this.game = game;
    this.plan = planPlaces(game.world);
    this.root = new THREE.Group();
    this.roomRoot = new THREE.Group();
    this.roomRoot.visible = false;
    game.scene.add(this.root, this.roomRoot);
    this.mats = {};
    this.outline = outlineMat();
    this.basic = {};
    this.indoor = null;
    this.phase = null;
    this.phaseT = 0;
    this.pending = null;
    this.outdoor = null;
    this.locking = false;
    this.mazeRun = null;
    this.flaps = [];
    this.leaveCool = 0;
    this.leaveArmed = true;
    this.wets = [];
    this.boxes = [];
    this.waters = [];
    this.pickups = [];
    this.pet = null;
    this.secret = null;
    this.prize = null;
    this.daily = null;
    this.dailyGot = false;
    this.tunnel = null;
    this.proxy = this.makeProxy();
    this._dayT = 30;
    this.critterBase = 0;
    this.buildOutdoor();
    this._bucketStatic();
  }
  /** the yard gnomes, sheds, garden and playground pieces are a few hundred small meshes spread over the town: group them in
   *  80 m cells so a whole cell is skipped once it is past the fog (the pieces keep their own visible flags) */
  _bucketStatic() {
    const C = 80, cells = new Map(), keep = new Set([this.dailyCritter, this.dailyFlower]);
    for (const c of [...this.root.children]) {
      if (keep.has(c)) continue;
      c.updateMatrixWorld(true); const p = _cellV.setFromMatrixPosition(c.matrixWorld);
      const k = Math.floor(p.x / C) + ',' + Math.floor(p.z / C);
      let g = cells.get(k);
      if (!g) { g = new THREE.Group(); g.userData.cx = (Math.floor(p.x / C) + 0.5) * C; g.userData.cz = (Math.floor(p.z / C) + 0.5) * C; cells.set(k, g); this.root.add(g); }
      g.attach(c);
    }
    this.cells = [...cells.values()]; this._cellT = 0;
  }
  _cullCells(dt, o) {
    if ((this._cellT -= dt) > 0 || !this.cells) return;
    this._cellT = 0.25;
    const R = CONFIG.graphics.fogFar * 1.2 + 60;
    for (const g of this.cells) g.visible = Math.hypot(g.userData.cx - o.x, g.userData.cz - o.z) < R;
  }

  mat(hex) {
    const k = hex >>> 0;
    return this.mats[k] || (this.mats[k] = toonMat({ color: k }));
  }
  glow(hex, opacity = 0.85) {
    const k = (hex >>> 0) + ':' + opacity;
    return this.basic[k] || (this.basic[k] = new THREE.MeshBasicMaterial({ color: hex, transparent: opacity < 1, opacity, depthWrite: false }));
  }

  makeProxy() {
    const self = this;
    return {
      hides: [], tunnels: [], raining: false, gates: null, dryMult: 1, seaLevel: -20,
      typeAt() { const f = self.indoor?.floor; return f === 'tile' ? 'paving' : f === 'board' ? 'litter' : 'lawn'; },
      heightAt() { return (self.indoor?.entry ?? self.indoor?.y ?? 0) + 0.02; },
      isSea() { return false; },
      isShallow() { return false; },
      normalAt(x, z, out = { x: 0, y: 1, z: 0 }) { out.x = 0; out.y = 1; out.z = 0; return out; },
      harshAt() { return 0; },
      biomeAt() { return 'suburb'; },
      waterAt(x, z) {
        for (let i = 0; i < self.waters.length; i++) {
          const w = self.waters[i];
          if ((x - w.x) ** 2 + (z - w.z) ** 2 < w.r * w.r) return w;
        }
        return null;
      },
      resolve(x, z, rad, out = { x, z, hit: false }) {
        out.x = x; out.z = z; out.hit = false; out.col = null;
        const list = self.boxes;
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < list.length; i++) {
            const c = list[i];
            if (c.r != null) {
              const dx = out.x - c.x, dz = out.z - c.z, d = Math.hypot(dx, dz), m = c.r + rad;
              if (d < m) {
                const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
                out.x = c.x + nx * m; out.z = c.z + nz * m; out.hit = true; out.col = c;
              }
            } else {
              const px = Math.max(c.x - c.hw, Math.min(c.x + c.hw, out.x));
              const pz = Math.max(c.z - c.hd, Math.min(c.z + c.hd, out.z));
              const dx = out.x - px, dz = out.z - pz, d = Math.hypot(dx, dz);
              if (d < rad) {
                if (d > 1e-5) { out.x = px + (dx / d) * rad; out.z = pz + (dz / d) * rad; }
                else {
                  const ox = c.hw - Math.abs(out.x - c.x), oz = c.hd - Math.abs(out.z - c.z);
                  if (ox < oz) out.x += Math.sign(out.x - c.x || 1) * (ox + rad);
                  else out.z += Math.sign(out.z - c.z || 1) * (oz + rad);
                }
                out.hit = true; out.col = c;
              }
            }
          }
        }
        return out;
      },
    };
  }

  // ---------------------------------------------------------------- outdoor dressing
  buildOutdoor() {
    const w = this.game.world;
    for (let i = 0; i < this.plan.homes.length; i++) this.addFlap(this.plan.homes[i]);
    if (this.plan.maze) this.buildMaze(this.plan.maze);
    for (let i = 0; i < this.plan.pois.length; i++) this.buildPoi(this.plan.pois[i]);
    this.ensureDaily();
    if (this.tunnel) w.tunnels.push(this.tunnel);
  }

  addFlap(home) {
    const g = new THREE.Group();
    g.position.set(home.door.x, (home.door.y || 0) + 0.22, home.door.z);
    const frame = new THREE.Mesh(boxG(), this.mat(0x6b4a33));
    frame.scale.set(0.52, 0.46, 0.08);
    frame.userData.noOutline = true;
    const flap = new THREE.Mesh(boxG(), this.mat(0xc9894a));
    flap.geometry = boxG();
    flap.scale.set(0.36, 0.32, 0.05);
    flap.position.y = -0.02;
    flap.userData.noOutline = true;
    g.add(frame, flap);
    this.root.add(g);
    this.flaps.push({ home, g, flap, ajar: false, cool: 0, armed: true });
  }

  buildMaze(maze) {
    const w = this.game.world, n = maze.n, cell = maze.cell;
    const ox = maze.x - n * cell / 2, oz = maze.z - n * cell / 2;
    let hedges = 0;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (!mazeOpen(maze.walls, x, z)) hedges += 2;
    const mesh = new THREE.InstancedMesh(ball(), this.mat(0x3c8a46), Math.max(1, hedges));
    mesh.userData.noOutline = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    let k = 0;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      if (mazeOpen(maze.walls, x, z)) continue;
      const cx = ox + (x + 0.5) * cell, cz = oz + (z + 0.5) * cell;
      const y = w.heightAt(cx, cz);
      w._addBox(cx, cz, cell * 0.46, cell * 0.46, { kind: 'hedge' });
      for (let s = 0; s < 2; s++) {
        _p.set(cx + (s ? 0.16 : -0.12), y + 0.62, cz + (s ? -0.1 : 0.14));
        _s.set(0.72, 1.25, 0.7);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(k++, _m);
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    this.hedge = mesh;
    const dress = mazeDress(maze.walls);
    const at = (cx, cz) => ({ x: ox + (cx + 0.5) * cell, z: oz + (cz + 0.5) * cell, y: w.heightAt(ox + (cx + 0.5) * cell, oz + (cz + 0.5) * cell) });
    for (let i = 0; i < dress.puddles.length; i++) {
      const p = at(dress.puddles[i][0], dress.puddles[i][1]);
      this.puddle(p.x, p.y, p.z, 0.42);
      this.wets.push({ x: p.x, z: p.z, r: 0.42, kind: 'puddle' });
    }
    const c = at(dress.mid, dress.mid);
    this.fountain(c.x, c.y, c.z);
    this.wets.push({ x: c.x, z: c.z, r: 0.8, kind: 'birdbath' });
    this.prize = { x: c.x, z: c.z, y: c.y };
    const shell = new THREE.Mesh(ball(), this.mat(0xf3dcc9));
    shell.scale.set(0.28, 0.16, 0.28);
    shell.position.set(c.x, c.y + 0.12, c.z);
    shell.userData.noOutline = true;
    this.root.add(shell);
    this.prizeMesh = shell;
    if (dress.dead[0]) this.gnome(at(dress.dead[0][0], dress.dead[0][1]));
    if (dress.dead[1]) this.gnome(at(dress.dead[1][0], dress.dead[1][1]));
    const ballCell = dress.dead[2] || dress.puddles[0];
    if (ballCell) {
      const p = at(ballCell[0], ballCell[1]);
      const b = new THREE.Mesh(ball(), this.mat(0xe24b4b));
      b.scale.setScalar(0.16);
      b.position.set(p.x, p.y + 0.16, p.z);
      b.userData.noOutline = true;
      this.root.add(b);
      this.lostBall = b;
    }
    const sec = at(Math.min(n - 2, dress.mid + 1), dress.mid);
    const nest = new THREE.Mesh(ball(), this.glow(0xfff1c4, 0.95));
    nest.scale.setScalar(0.18);
    nest.position.set(sec.x, sec.y + 0.2, sec.z);
    nest.visible = false;
    this.root.add(nest);
    this.secret = nest;
    const half = n * cell / 2;
    w.quiet = { x: maze.x, z: maze.z, r: half + 0.4 };
    const preds = this.game.predators;
    if (preds) {
      for (let i = preds.list.length - 1; i >= 0; i--) {
        const p = preds.list[i];
        if (p.spec.flying || p.spec.swoop) continue;
        if (Math.abs(p.x - maze.x) < half && Math.abs(p.z - maze.z) < half) {
          p.dispose(this.game.scene);
          preds.list.splice(i, 1);
        }
      }
    }
  }

  puddle(x, y, z, r) {
    const m = new THREE.Mesh(disc(), this.glow(0x6eb6e0, 0.72));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.04, z);
    m.scale.setScalar(r);
    m.userData.noOutline = true;
    this.root.add(m);
  }
  fountain(x, y, z) {
    const rim = new THREE.Mesh(cyl(), this.mat(0xc9c2b4));
    rim.scale.set(0.9, 0.28, 0.9);
    rim.position.set(x, y + 0.14, z);
    rim.userData.noOutline = true;
    const water = new THREE.Mesh(disc(), this.glow(0x7ec8ea, 0.8));
    water.rotation.x = -Math.PI / 2;
    water.position.set(x, y + 0.3, z);
    water.scale.setScalar(0.62);
    water.userData.noOutline = true;
    this.root.add(rim, water);
  }
  gnome(p) {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const body = new THREE.Mesh(ball(), this.mat(0x4aa36a));
    body.scale.set(0.28, 0.36, 0.28); body.position.y = 0.28;
    const hat = new THREE.Mesh(cyl(), this.mat(0xe24b4b));
    hat.scale.set(0.22, 0.28, 0.22); hat.position.y = 0.62;
    const nose = new THREE.Mesh(ball(), this.mat(0xf3dcc9));
    nose.scale.setScalar(0.08); nose.position.set(0, 0.4, 0.16);
    g.add(body, hat, nose);
    outline(g, this.outline);
    this.root.add(g);
  }

  buildPoi(p) {
    const y = p.y || this.game.world.heightAt(p.x, p.z);
    if (p.id === 'shed') this.buildShed(p.x, y, p.z);
    else if (p.id === 'drain') this.buildDrain(p);
    else if (p.id === 'garden') this.buildGarden(p.x, y, p.z);
    else if (p.id === 'play') this.buildPlay(p.x, y, p.z);
  }

  buildShed(x, y, z) {
    const w = this.game.world;
    const wall = (dx, dz, sx, sy, sz) => {
      const m = new THREE.Mesh(boxG(), this.mat(0x8d6a45));
      m.scale.set(sx, sy, sz);
      m.position.set(x + dx, y + sy / 2, z + dz);
      m.userData.noOutline = true;
      this.root.add(m);
    };
    wall(0, -0.9, 2.2, 1.6, 0.16);
    wall(-1.05, 0, 0.16, 1.6, 1.8);
    wall(1.05, 0, 0.16, 1.6, 1.8);
    w._addBox(x, z - 0.9, 1.1, 0.12, { kind: 'shed' });
    w._addBox(x - 1.05, z, 0.12, 0.9, { kind: 'shed' });
    w._addBox(x + 1.05, z, 0.12, 0.9, { kind: 'shed' });
    const shelf = new THREE.Mesh(boxG(), this.mat(0xc9b089));
    shelf.scale.set(0.9, 0.08, 0.28);
    shelf.position.set(x, y + 0.7, z - 0.7);
    shelf.userData.noOutline = true;
    const web = new THREE.Mesh(disc(), this.glow(0xf7f4ee, 0.45));
    web.position.set(x + 0.7, y + 1.15, z - 0.75);
    web.scale.setScalar(0.28);
    web.userData.noOutline = true;
    const can = new THREE.Mesh(cyl(), this.mat(0x3d8fc6));
    can.scale.set(0.16, 0.22, 0.16);
    can.position.set(x - 0.45, y + 0.12, z + 0.35);
    can.userData.noOutline = true;
    this.root.add(shelf, web, can);
    this.puddle(x + 0.15, y, z + 0.55, 0.36);
    this.wets.push({ x: x + 0.15, z: z + 0.55, r: 0.36, kind: 'hose' });
  }

  buildDrain(p) {
    const w = this.game.world;
    const mouth = (x, y, z) => {
      const ring = new THREE.Mesh(cyl(), this.mat(0x6a6e74));
      ring.scale.set(0.7, 0.18, 0.7);
      ring.position.set(x, y + 0.08, z);
      ring.userData.noOutline = true;
      const hole = new THREE.Mesh(disc(), this.glow(0x1c2430, 0.95));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(x, y + 0.12, z);
      hole.scale.setScalar(0.42);
      hole.userData.noOutline = true;
      this.root.add(ring, hole);
    };
    mouth(p.x, p.y, p.z);
    mouth(p.x2, p.y2, p.z2);
    this.tunnel = { a: { x: p.x, z: p.z }, b: { x: p.x2, z: p.z2 }, kind: 'drain', wet: true };
    void w;
  }

  buildGarden(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const px = x + (i % 3) * 0.9 - 0.9, pz = z + Math.floor(i / 3) * 0.9 - 0.3;
      const m = new THREE.Mesh(ball(), this.mat(i % 2 ? 0xc4552c : 0x6aaa48));
      m.scale.set(0.38, 0.22, 0.38);
      m.position.set(px, y + 0.16, pz);
      m.userData.noOutline = true;
      this.root.add(m);
    }
    const post = new THREE.Mesh(cyl(), this.mat(0x8a5a3a));
    post.scale.set(0.08, 1.3, 0.08);
    post.position.set(x + 1.5, y + 0.65, z);
    post.userData.noOutline = true;
    const head = new THREE.Mesh(ball(), this.mat(0xf3dcc9));
    head.scale.setScalar(0.22);
    head.position.set(x + 1.5, y + 1.35, z);
    const arm = new THREE.Mesh(cyl(), this.mat(0x8a5a3a));
    arm.scale.set(0.06, 0.9, 0.06);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(x + 1.5, y + 1.05, z);
    arm.userData.noOutline = true;
    head.userData.noOutline = true;
    this.root.add(post, head, arm);
    this.game.world._addCircle(x + 1.5, z, 0.2, { kind: 'scarecrow' });
    this.puddle(x - 1.3, y, z + 0.2, 0.4);
    this.wets.push({ x: x - 1.3, z: z + 0.2, r: 0.4, kind: 'hose' });
  }

  buildPlay(x, y, z) {
    const sand = new THREE.Mesh(disc(), this.mat(0xe6d29a));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(x, y + 0.03, z);
    sand.scale.setScalar(1.5);
    sand.userData.noOutline = true;
    const bowl = new THREE.Mesh(cyl(), this.mat(0xc9c2b4));
    bowl.scale.set(0.55, 0.22, 0.55);
    bowl.position.set(x + 1.6, y + 0.1, z + 0.4);
    bowl.userData.noOutline = true;
    this.root.add(sand, bowl);
    this.puddle(x + 1.6, y, z + 0.4, 0.38);
    this.wets.push({ x: x + 1.6, z: z + 0.4, r: 0.38, kind: 'birdbath' });
  }

  ensureDaily() {
    const d = dailyKind();
    if (this.daily && this.daily.key === d.key) return;
    this.daily = d;
    this.dailyGot = false;
    if (this.dailyCritter) { this.root.remove(this.dailyCritter); this.dailyCritter = null; }
    if (this.dailyFlower) { this.root.remove(this.dailyFlower); this.dailyFlower = null; }
    const play = this.plan.pois.find((p) => p.id === 'play');
    const garden = this.plan.pois.find((p) => p.id === 'garden');
    if (d.kind === 'critter' && play) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(ball(), this.mat(d.n % 2 ? 0x7a9a4a : 0xd98a4a));
      body.scale.set(0.16, 0.1, 0.22);
      body.position.y = 0.1;
      g.add(body);
      outline(g, this.outline);
      g.position.set(play.x + 0.4, play.y || 0, play.z - 0.3);
      this.critterBase = g.position.y;
      this.root.add(g);
      this.dailyCritter = g;
    } else if (d.kind === 'flower' && garden) {
      const f = new THREE.Mesh(ball(), this.mat([0xffe066, 0xff8fa3, 0xc77dff, 0xf7f4ee, 0xe24b4b, 0x6aa6ff][d.n % 6]));
      f.scale.setScalar(0.16);
      f.position.set(garden.x, (garden.y || 0) + 0.22, garden.z + 1.1);
      f.userData.noOutline = true;
      this.root.add(f);
      this.dailyFlower = f;
      this.dailyFlowerId = ['py', 'pp', 'pu', 'pw', 'pr', 'pb'][d.n % 6];
    } else if (d.kind === 'door' && this.flaps.length) {
      this.flaps[d.n % this.flaps.length].ajar = true;
    }
  }

  // ---------------------------------------------------------------- interiors
  clearRoom() {
    const dump = [];
    this.roomRoot.traverse((o) => { if (o.isMesh && o.userData.own) dump.push(o); });
    for (let i = 0; i < dump.length; i++) { /* shared materials and geometry */ }
    while (this.roomRoot.children.length) this.roomRoot.remove(this.roomRoot.children[0]);
    this.roomRoot.position.y = 0;
    this.boxes.length = 0;
    this.waters.length = 0;
    this.pickups.length = 0;
    this.pet = null;
  }

  wx(lx) { return IX + lx; }
  wz(lz) { return IZ + lz; }

  addMesh(mesh) { mesh.userData.noOutline = true; mesh.castShadow = false; this.roomRoot.add(mesh); return mesh; }

  solid(lx, ly, lz, sx, sy, sz, hex, extra) {
    const m = new THREE.Mesh(boxG(), this.mat(hex));
    m.scale.set(sx, sy, sz);
    m.position.set(this.wx(lx), ly + sy / 2, this.wz(lz));
    this.addMesh(m);
    if (extra !== false) {
      const c = { x: this.wx(lx), z: this.wz(lz), hw: sx / 2, hd: sz / 2, climb: !!extra?.climb, h: extra?.h || sy };
      this.boxes.push(c);
    }
    return m;
  }

  blob(lx, ly, lz, s, hex, r) {
    const m = new THREE.Mesh(ball(), this.mat(hex));
    m.scale.setScalar(s);
    m.position.set(this.wx(lx), ly, this.wz(lz));
    this.addMesh(m);
    if (r) this.boxes.push({ x: this.wx(lx), z: this.wz(lz), r, climb: false });
    return m;
  }

  water(lx, lz, r, kind) {
    this.waters.push({ x: this.wx(lx), z: this.wz(lz), r, kind });
    this.puddleRoom(lx, lz, r, kind === 'birdbath' ? 0x8fd0ea : 0x7ec8ea);
  }
  puddleRoom(lx, lz, r, hex) {
    const m = new THREE.Mesh(disc(), this.glow(hex, 0.75));
    m.rotation.x = -Math.PI / 2;
    m.position.set(this.wx(lx), 0.05, this.wz(lz));
    m.scale.setScalar(r);
    this.addMesh(m);
  }

  buildRoom(home) {
    this.clearRoom();
    this.roomRoot.position.y = home.entry ?? home.y ?? 0;
    const floorHex = home.floor === 'tile' ? 0xd7dbe2 : home.floor === 'board' ? 0xc4a574 : 0x8f4d4d;
    const floor = new THREE.Mesh(boxG(), this.mat(floorHex));
    floor.scale.set(RW, 0.08, RD);
    floor.position.set(IX, 0, IZ);
    this.addMesh(floor);
    if (home.floor === 'rug') {
      const rug = new THREE.Mesh(boxG(), this.mat(0xe7c98a));
      rug.scale.set(RW * 0.72, 0.04, RD * 0.62);
      rug.position.set(IX, 0.06, IZ);
      this.addMesh(rug);
    }
    const wall = 0xded4c6, hh = 2.4;
    this.solid(0, 0, RD / 2, RW, hh, 0.12, wall);                         // north
    this.solid(-RW / 2, 0, 0, 0.12, hh, RD, wall);
    this.solid(RW / 2, 0, 0, 0.12, hh, RD, wall);
    this.solid(-RW / 4 - 0.35, 0, -RD / 2, RW / 2 - 0.7, hh, 0.12, wall);  // south, split for the flap
    this.solid(RW / 4 + 0.35, 0, -RD / 2, RW / 2 - 0.7, hh, 0.12, wall);
    const win = new THREE.Mesh(boxG(), this.glow(0xfff6df, 0.55));
    win.scale.set(1.4, 0.9, 0.06);
    win.position.set(this.wx(1.4), 1.15, this.wz(RD / 2 - 0.08));
    this.addMesh(win);
    const sun = new THREE.Mesh(disc(), this.glow(0xfff1c4, 0.35));
    sun.rotation.x = -Math.PI / 2;
    sun.position.set(this.wx(1.3), 0.07, this.wz(RD / 2 - 1.1));
    sun.scale.setScalar(0.7);
    this.addMesh(sun);
    const lay = home.layout;
    if (lay === 'lounge' || lay === 'hall') this.couch();
    if (lay === 'kitchen' || lay === 'lounge' || lay === 'hall') this.table();
    if (lay === 'kitchen' || lay === 'laundry') this.sink();
    if (lay === 'laundry') this.bath();
    if (lay !== 'laundry') this.tank();
    this.shelf();
    this.bowl();
    this.plant();
    this.finds(home);
    if (home.pet) this.makePet(home);
    if (home.baby && !this.game.progress.rescued.has('home-' + home.id)) this.makeBaby(home);
  }

  couch() {
    this.blob(-1.5, 0.16, 0.15, 0.12, 0x6b4a33, 0.12);
    this.blob(-0.3, 0.16, 0.15, 0.12, 0x6b4a33, 0.12);
    this.blob(-1.5, 0.16, 1.15, 0.12, 0x6b4a33, 0.12);
    this.blob(-0.3, 0.16, 1.15, 0.12, 0x6b4a33, 0.12);
    const seat = new THREE.Mesh(boxG(), this.mat(0x6a8fbf));
    seat.scale.set(1.7, 0.28, 0.8);
    seat.position.set(this.wx(-0.9), 0.7, this.wz(0.65));
    this.addMesh(seat);
    const back = new THREE.Mesh(boxG(), this.mat(0x6a8fbf));
    back.scale.set(1.7, 0.55, 0.18);
    back.position.set(this.wx(-0.9), 0.95, this.wz(1.0));
    this.addMesh(back);
  }
  table() {
    const top = new THREE.Mesh(boxG(), this.mat(0xc4a574));
    top.scale.set(1.1, 0.08, 0.7);
    top.position.set(this.wx(0.4), 0.72, this.wz(-0.4));
    this.addMesh(top);
    for (const [lx, lz] of [[0.05, -0.65], [0.75, -0.65], [0.05, -0.15], [0.75, -0.15]]) {
      this.solid(lx, 0, lz, 0.08, 0.68, 0.08, 0x8a5a3a, { climb: true, h: 0.72 });
    }
  }
  sink() {
    this.solid(2.3, 0, 0.4, 0.7, 0.7, 0.5, 0xe8e4dc, false);
    this.water(2.3, 0.4, 0.28, 'hose');
    const tap = new THREE.Mesh(cyl(), this.mat(0xd9d9de));
    tap.scale.set(0.05, 0.22, 0.05);
    tap.position.set(this.wx(2.3), 0.95, this.wz(0.25));
    this.addMesh(tap);
  }
  bath() {
    this.solid(-2.15, 0, -1.5, 1.3, 0.42, 0.7, 0xf4f1ea, false);
    this.water(-2.15, -1.5, 0.45, 'birdbath');
  }
  tank() {
    this.solid(2.15, 0.85, 1.55, 0.7, 0.08, 0.35, 0xc4a574, { climb: true, h: 0.9 });
    const glass = new THREE.Mesh(boxG(), this.glow(0x9fd4ea, 0.45));
    glass.scale.set(0.55, 0.36, 0.22);
    glass.position.set(this.wx(2.15), 1.15, this.wz(1.55));
    this.addMesh(glass);
    this.blob(2.15, 1.12, 1.55, 0.06, 0xf08c72, 0);
  }
  shelf() {
    this.solid(-2.2, 0.95, 1.7, 0.9, 0.08, 0.28, 0xc4a574, { climb: true, h: 1.0 });
  }
  bowl() {
    this.blob(1.7, 0.08, -1.7, 0.16, 0xe24b4b, 0);
    this.water(1.7, -1.7, 0.22, 'bowl');
  }
  plant() {
    this.blob(-2.2, 0.28, -1.6, 0.16, 0x6aaa48, 0.14);
    const pot = new THREE.Mesh(cyl(), this.mat(0xc4552c));
    pot.scale.set(0.16, 0.16, 0.16);
    pot.position.set(this.wx(-2.2), 0.1, this.wz(-1.6));
    this.addMesh(pot);
  }

  finds(home) {
    const J = this.game.journal;
    const put = (id, how, lx, lz, hex, s) => {
      if (J?.has(id)) return;
      const m = new THREE.Mesh(ball(), this.mat(hex));
      m.scale.setScalar(s);
      m.position.set(this.wx(lx), 0.1, this.wz(lz));
      this.addMesh(m);
      this.pickups.push({ id, how, x: this.wx(lx), z: this.wz(lz), r: 0.36, mesh: m });
    };
    put('find-button', 'place:button', -1.8, 1.35, 0xf2f2f2, 0.06);
    put('find-marble', 'place:marble', 0.2, 0.9, 0x6aa6ff, 0.05);
    put('find-glass', 'place:glass', -2.05, 1.42, 0x9fd4c8, 0.07);
    put('find-photo', 'place:photo', -1.55, 1.42, 0xf3dcc9, 0.1);
    void home;
  }

  makePet(home) {
    const cat = home.pet === 'cat';
    const g = new THREE.Group();
    const body = new THREE.Mesh(ball(), this.mat(cat ? 0xc9894a : 0xd2a06a));
    body.scale.set(cat ? 0.34 : 0.4, 0.26, 0.48);
    body.position.y = 0.2;
    const head = new THREE.Mesh(ball(), this.mat(cat ? 0xc9894a : 0xd2a06a));
    head.scale.setScalar(cat ? 0.2 : 0.22);
    head.position.set(0, 0.28, 0.28);
    g.add(body, head);
    outline(g, this.outline);
    const x = this.wx(2.0), z = this.wz(1.2);
    g.position.set(x, 0.02, z);
    this.roomRoot.add(g);
    this.pet = { kind: home.pet, mesh: g, x, z, state: 'sleep', t: 0, cool: 0 };
  }

  makeBaby(home) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(ball(), this.mat(0xd9a441));
    body.scale.set(0.16, 0.14, 0.18);
    body.position.y = 0.1;
    g.add(body);
    outline(g, this.outline);
    const x = this.wx(-1.15), z = this.wz(0.55);
    g.position.set(x, 0.02, z);
    this.roomRoot.add(g);
    this.baby = { id: 'home-' + home.id, mesh: g, x, z };
  }

  // ---------------------------------------------------------------- frame
  update(dt, o) {
    if (!o) return;
    this._cullCells(dt, o);
    this._hop = (this._hop || 0) + dt;
    this._dayT -= dt;
    if (this._dayT <= 0) { this._dayT = 20; this.ensureDaily(); }
    for (let i = 0; i < this.flaps.length; i++) {
      const f = this.flaps[i];
      if (f.cool > 0) f.cool = Math.max(0, f.cool - dt);
    }
    if (this.leaveCool > 0) this.leaveCool = Math.max(0, this.leaveCool - dt);
    if (this.phase) { this.stepPhase(dt, o); return; }
    if (this.indoor) this.updateIndoor(dt, o);
    else this.updateOutdoor(dt, o);
    this.animateFlaps(dt, o);
    if (this.dailyCritter) this.dailyCritter.position.y = this.critterBase + Math.abs(Math.sin(this._hop * 6)) * 0.08;
  }

  stepPhase(dt, o) {
    this.locking = true;
    this.phaseT += dt;
    const k = Math.min(1, this.phaseT / 0.32);
    this.fade(k < 0.5 ? k * 2 : (1 - k) * 2);
    o.group.scale.setScalar(Math.max(0.05, o.sz * (1 - Math.sin(k * Math.PI) * 0.65)));
    if (k < 1) return;
    if (this.phase === 'in') this.arrive(o);
    else this.finishLeave(o);
  }

  fade(k) {
    const el = document.getElementById('fade');
    if (el) el.style.opacity = k.toFixed(3);
  }

  arrive(o) {
    const home = this.pending;
    this.outdoor = { x: o.x, z: o.z, heading: o.heading };
    this.indoor = home;
    this.buildRoom(home);
    this.roomRoot.visible = true;
    if (this.game.view) this.game.view.root.visible = false;
    const spot = flapInsideLocal();
    o.x = this.wx(spot.x);
    o.z = this.wz(spot.z);
    o.y = (home.entry ?? home.y ?? 0) + 0.02;
    o.heading = spot.heading;
    o.hiddenIn = null;
    o.speed = 0;
    this._armFlap(home);
    this.leaveCool = FLAP_COOL;
    this.leaveArmed = false;
    this.game.journal?.seeHow('place:home');
    this.game.journal?.seeHow('place:' + home.layout);
    this.game.levels?.did('homevisit', home.id);
    this.game.camInit = false;
    this.phase = null;
    this.pending = null;
    this.locking = false;
    this.fade(0);
    o.group.scale.setScalar(o.sz);
    this.game.saveSoon?.('home');
  }

  finishLeave(o) {
    const home = this.indoor;
    const d = home?.door || this.outdoor || { x: o.x, z: o.z };
    const spot = flapOutside(d);
    const w = this.game.world;
    o.x = spot.x;
    o.z = spot.z;
    o.y = w.heightAt(o.x, o.z);
    o.heading = spot.heading;
    o.speed = 0;
    this._armFlap(home);
    this.clearRoom();
    this.baby = null;
    this.indoor = null;
    this.roomRoot.visible = false;
    if (this.game.view) this.game.view.root.visible = true;
    this.phase = null;
    this.locking = false;
    this.fade(0);
    o.group.scale.setScalar(o.sz);
    this.game.camInit = false;
  }

  leaveNow() {
    if (!this.indoor && this.phase !== 'in') { this.phase = null; this.locking = false; return; }
    const o = this.game.octopus;
    if (this.phase === 'in' && this.pending) this.indoor = this.pending;
    if (o && this.indoor) this.finishLeave(o);
  }

  _armFlap(home) {
    if (!home) return;
    for (let i = 0; i < this.flaps.length; i++) {
      const f = this.flaps[i];
      if (f.home === home) { f.cool = FLAP_COOL; f.armed = false; return; }
    }
  }

  tryEnter(home) {
    if (this.phase || this.indoor) return;
    const o = this.game.octopus;
    if (!o?.alive || o.tunnel || o.carried) return;
    this.phase = 'in';
    this.phaseT = 0;
    this.pending = home;
    this.locking = true;
  }

  tryLeave() {
    if (this.phase || !this.indoor) return;
    this.phase = 'out';
    this.phaseT = 0;
    this.locking = true;
  }

  updateOutdoor(dt, o) {
    if (!o.alive) return;
    for (let i = 0; i < this.flaps.length; i++) {
      const f = this.flaps[i], d = f.home.door;
      const rad = f.ajar ? 0.72 : 0.48;
      const inside = (o.x - d.x) ** 2 + (o.z - d.z) ** 2 < rad * rad;
      if (!inside) f.armed = true;
      if (o.moving && flapAllows(f, inside)) { this.tryEnter(f.home); return; }
    }
    this.soak(dt, o);
    const m = this.plan.maze;
    if (m && this.inMaze(o.x, o.z)) {
      if (this.mazeRun == null) this.mazeRun = o.health;
      else if (o.health < this.mazeRun) this.mazeRun = o.health;
      if (this.prize && (o.x - this.prize.x) ** 2 + (o.z - this.prize.z) ** 2 < 0.85) this.reachCentre(o);
    } else this.mazeRun = null;
    if (this.lostBall && o.moving) {
      const b = this.lostBall.position;
      const dx = b.x - o.x, dz = b.z - o.z;
      if (dx * dx + dz * dz < 0.35) { b.x += dx * 0.8; b.z += dz * 0.8; }
    }
    const pois = this.plan.pois;
    for (let i = 0; i < pois.length; i++) {
      const p = pois[i];
      const near = (x, z, r) => (o.x - x) ** 2 + (o.z - z) ** 2 < r * r;
      const hit = p.id === 'drain' ? (near(p.x, p.z, 2.2) || near(p.x2, p.z2, 2.2)) : near(p.x, p.z, p.id === 'light' ? 8 : 3.2);
      if (hit) {
        this.game.journal?.seeHow('place:' + p.id);
        this.game.levels?.did('poi', p.id);
      }
    }
    if (this.dailyFlower && !this.dailyGot) {
      const f = this.dailyFlower.position;
      if ((o.x - f.x) ** 2 + (o.z - f.z) ** 2 < 0.4) {
        this.dailyGot = true;
        this.game.collectPollen?.(this.dailyFlowerId, this.dailyFlower.material.color.getHex(), f.x, f.y, f.z);
        this.dailyFlower.visible = false;
      }
    }
    const st = this.game.levels?.st;
    if (this.secret && st) {
      const show = st.homes.size > 0 && st.maze && !st.secret;
      this.secret.visible = show;
      if (show) {
        const s = this.secret.position;
        if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 < 0.45) {
          this.game.levels.did('secret');
          this.game.journal?.seeHow('place:secret');
          this.secret.visible = false;
        }
      }
    }
    void dt;
  }

  soak(dt, o) {
    let kind = null;
    for (let i = 0; i < this.wets.length; i++) {
      const w = this.wets[i];
      if ((o.x - w.x) ** 2 + (o.z - w.z) ** 2 < w.r * w.r) { kind = w.kind; break; }
    }
    if (!kind) return;
    const gain = CONFIG.water[kind] ?? 16;
    o.health = Math.min(CONFIG.octopus.maxHealth, o.health + gain * dt);
    o.wetness = Math.min(1, o.wetness + dt * 1.2);
    if (!o.waterKind) o.waterKind = kind;
  }

  inMaze(x, z) {
    const m = this.plan.maze;
    if (!m) return false;
    const h = m.n * m.cell / 2;
    return Math.abs(x - m.x) < h && Math.abs(z - m.z) < h;
  }

  reachCentre(o) {
    const L = this.game.levels;
    if (!L) return;
    const wet = (this.mazeRun ?? o.health) >= 50;
    const first = !L.st.maze;
    if (first) {
      this.game.progress?.addShell?.(this.game.runTime);
      if ((this.plan.maze.seed % 100) < 40) this.game.progress?.addBaby?.('maze-baby', this.game.runTime);
      if (this.prizeMesh) this.prizeMesh.visible = false;
    }
    L.did('maze', wet);
    this.game.journal?.seeHow('place:maze');
  }

  updateIndoor(dt, o) {
    const spot = flapInsideLocal();
    const doorZ = this.wz(spot.doorZ);
    const inside = (o.x - this.wx(0)) ** 2 + (o.z - doorZ) ** 2 < 0.42 * 0.42;
    if (!inside) this.leaveArmed = true;
    if (o.moving && flapAllows({ armed: this.leaveArmed, cool: this.leaveCool }, inside)) { this.tryLeave(); return; }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if ((o.x - p.x) ** 2 + (o.z - p.z) ** 2 < p.r * p.r) {
        this.game.journal?.seeHow(p.how);
        if (p.mesh) this.roomRoot.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
    if (this.baby && (o.x - this.baby.x) ** 2 + (o.z - this.baby.z) ** 2 < 0.4) {
      this.game.progress?.addBaby?.(this.baby.id, this.game.runTime);
      this.game.journal?.seeHow('baby');
      this.roomRoot.remove(this.baby.mesh);
      this.baby = null;
    }
    if (this.pet) this.updatePet(dt, o);
  }

  updatePet(dt, o) {
    const p = this.pet;
    p.cool = Math.max(0, p.cool - dt);
    p.t += dt;
    const dx = o.x - p.x, dz = o.z - p.z, dist = Math.hypot(dx, dz) || 1;
    if (o.camoProtected) p.state = 'sleep';
    else if (p.state === 'sleep' && dist < 2.1) { p.state = 'wake'; p.t = 0; }
    else if (p.state === 'wake' && p.t > 0.7) { p.state = 'creep'; p.t = 0; }
    else if (p.state === 'creep') {
      if (o.moving) { /* pause while the octopus moves */ }
      else {
        const step = 0.55 * dt;
        p.x += (dx / dist) * step; p.z += (dz / dist) * step;
      }
      if (dist < 0.85 && p.cool <= 0) { p.state = 'pounce'; p.t = 0; p.toX = o.x; p.toZ = o.z; }
    } else if (p.state === 'pounce') {
      const k = Math.min(1, p.t / 0.28);
      p.x += (p.toX - p.x) * Math.min(1, dt * 8);
      p.z += (p.toZ - p.z) * Math.min(1, dt * 8);
      if (k >= 1) {
        if (Math.hypot(o.x - p.x, o.z - p.z) < 0.5) o.damage(7, p.kind);
        p.state = 'sit'; p.t = 0; p.cool = 2.5;
      }
    } else if (p.state === 'sit' && p.t > 2.2) p.state = 'sleep';
    if (dist < 0.32 && p.state !== 'pounce') { p.x -= dx / dist * 0.04; p.z -= dz / dist * 0.04; }
    const minX = this.wx(-RW / 2 + 0.4), maxX = this.wx(RW / 2 - 0.4);
    const minZ = this.wz(-RD / 2 + 0.4), maxZ = this.wz(RD / 2 - 0.4);
    p.x = Math.max(minX, Math.min(maxX, p.x));
    p.z = Math.max(minZ, Math.min(maxZ, p.z));
    p.mesh.position.set(p.x, p.state === 'creep' ? 0.01 : 0.02, p.z);
    p.mesh.rotation.y = Math.atan2(dx, dz);
    const crouch = p.state === 'creep' || p.state === 'pounce' ? 0.72 : 1;
    p.mesh.scale.y = crouch;
    if (p.state === 'sleep') p.mesh.rotation.z = Math.sin(p.t * 2) * 0.04;
    else p.mesh.rotation.z = 0;
  }

  animateFlaps(dt, o) {
    for (let i = 0; i < this.flaps.length; i++) {
      const f = this.flaps[i];
      const d = f.home.door;
      const near = this.phase && this.pending === f.home || (o && (o.x - d.x) ** 2 + (o.z - d.z) ** 2 < 4);
      const target = f.ajar || near ? -1.15 : -0.18;
      f.flap.rotation.x += (target - f.flap.rotation.x) * Math.min(1, dt * 7);
    }
  }

  marks() {
    const st = this.game.levels?.st;
    if (!st) return [];
    const out = [];
    for (let i = 0; i < this.plan.homes.length; i++) {
      const h = this.plan.homes[i];
      if (st.homes.has(h.id)) out.push({ x: h.x, z: h.z, kind: 'room' });
    }
    if (st.maze && this.plan.maze) out.push({ x: this.plan.maze.x, z: this.plan.maze.z, kind: 'maze' });
    for (let i = 0; i < this.plan.pois.length; i++) {
      const p = this.plan.pois[i];
      if (st.pois.has(p.id)) out.push({ x: p.x, z: p.z, kind: p.id });
    }
    return out;
  }

  applyDebug(params) {
    if (!params?.get) return;
    const o = this.game.octopus, w = this.game.world;
    if (!o || !w) return;
    const go = (x, z) => { o.x = x; o.z = z; o.y = w.heightAt(x, z); this.game.camInit = false; };
    if (params.get('home') === '1' && this.plan.homes[0]) { const d = this.plan.homes[0].door; go(d.x, d.z + 0.15); }
    else if (params.get('maze') === '1' && this.plan.maze) {
      const m = this.plan.maze, n = m.n, cell = m.cell || MAZE_CELL, mid = (n / 2) | 0;
      go(m.x - n * cell / 2 + (mid + 0.5) * cell, m.z + n * cell / 2 + 0.8);
    } else if (params.get('poi')) {
      const p = this.plan.pois.find((q) => q.id === params.get('poi'));
      if (p) go(p.x + 1.4, p.z + 1.4);
    }
  }

  dispose() {
    this.leaveNow();
    this.clearRoom();
    const w = this.game.world;
    if (w && this.tunnel) {
      const i = w.tunnels.indexOf(this.tunnel);
      if (i >= 0) w.tunnels.splice(i, 1);
    }
    this.game.scene.remove(this.root);
    this.game.scene.remove(this.roomRoot);
    this.root.traverse((o) => { if (o.isInstancedMesh) o.dispose?.(); });
    for (const k in this.mats) this.mats[k].dispose?.();
    for (const k in this.basic) this.basic[k].dispose?.();
    this.outline.dispose?.();
  }
}
