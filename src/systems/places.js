// =====================================================================
//  Enterable houses, one hedge maze, and the small neighbourhood places.
//  Interiors are built on the way in and thrown away on the way out. The outdoor
//  world is hidden (not rebuilt) while you are inside. No prompts: walk into a flap.
// =====================================================================
import * as THREE from 'three';
import { toonMat, outline, outlineMat } from '../world/toon.js';
import { planPlaces, carveMaze, mazeDress, mazeOpen, dailyKind, MAZE_CELL, planTower, towerFloor, nextPetIdle } from '../world/places.js';
import { merge, at as placeGeo } from '../world/models.js';
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
    this.tower = null;
    this.towerPlan = null;
    this.towerCool = 0;
    this.towerArmed = true;
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
    const fog = CONFIG.graphics.fogFar;
    // phone: yard gnomes and sheds are a pixel inside the haze, and the beach looks straight into the town.
    // keep only the nearby cells (about 140 m) so those spots stay inside the old draw-call budget.
    const R = this.game.mobile ? fog * 0.62 : fog * 1.2 + 60;
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
      heightAt(x, z) {
        if (self.tower && self.towerPlan) return self.towerY(x, z);
        return (self.indoor?.entry ?? self.indoor?.y ?? 0) + 0.02;
      },
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
        if (self.tower && self.towerPlan) return self.resolveTower(x, z, rad, out);
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
    const jar = merge([
      placeGeo(cyl().clone(), 0, 0.18, 0, 0, 0, 0, 0.18, 0.32, 0.18),
      placeGeo(ball().clone(), 0, 0.36, 0, 0, 0, 0, 0.11, 0.08, 0.11),
      placeGeo(ball().clone(), 0.2, 0.22, 0.06, 0, 0, 0, 0.05, 0.05, 0.05),
      placeGeo(ball().clone(), -0.14, 0.28, 0.12, 0, 0, 0, 0.042, 0.042, 0.042),
      placeGeo(ball().clone(), 0.04, 0.4, -0.16, 0, 0, 0, 0.04, 0.04, 0.04),
    ]);
    const nest = new THREE.Mesh(jar, this.glow(0xffe08a, 0.92));
    nest.scale.setScalar(1.35);
    nest.position.set(sec.x, sec.y + 0.02, sec.z);
    nest.userData.noOutline = true;
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
    this.lamp = null;
  }

  wx(lx) { return IX + lx + (this._rx || 0); }
  wz(lz) { return IZ + lz + (this._rz || 0); }

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

  towerPlanOf() {
    if (this._tw !== undefined) return this._tw;
    const lh = this.game.world?.landmarks?.find((l) => l.kind === 'lighthouse');
    this._tw = planTower(lh || null, this.game.world);
    return this._tw;
  }
  towerY(x, z) { return towerFloor(this.towerPlan, x, z) + 0.08; }
  resolveTower(x, z, rad, out = { x, z, hit: false }) {
    const p = this.towerPlan;
    out.x = x; out.z = z; out.hit = false; out.col = null;
    if (!p) return out;
    const span = Math.PI * 2 * p.turns;
    let da = Math.atan2(z - p.cz, x - p.cx) - p.gapA;
    while (da <= -Math.PI) da += Math.PI * 2;
    while (da > Math.PI) da -= Math.PI * 2;
    if (da < 0 && da + Math.PI * 2 <= span + 0.05) da += Math.PI * 2;
    let clamped = da;
    if (clamped < 0.04) clamped = 0.04;
    if (clamped > span - 0.04) clamped = span - 0.04;
    const inner = 3.25 + rad, outer = p.R + 0.78 - rad;
    let d = Math.hypot(x - p.cx, z - p.cz);
    if (d < inner) d = inner;
    else if (d > outer) d = outer;
    const ang = p.gapA + clamped;
    const nx = p.cx + Math.cos(ang) * d, nz = p.cz + Math.sin(ang) * d;
    if ((nx - x) ** 2 + (nz - z) ** 2 > 1e-8) out.hit = true;
    out.x = nx; out.z = nz;
    return out;
  }

  buildRoom(home) {
    this.clearRoom();
    this._rx = 0; this._rz = 0;
    this.roomRoot.position.y = home.entry ?? home.y ?? 0;
    const rooms = home.rooms && home.rooms.length ? home.rooms : [{ kind: home.layout, floor: home.floor, link: null }];
    const north = rooms.length > 1;
    const east = rooms.length > 2;
    this.petBox = {
      minX: -RW / 2 + 0.4,
      maxX: (east ? RW + RW / 2 : RW / 2) - 0.4,
      minZ: -RD / 2 + 0.4,
      maxZ: (north ? RD + RD / 2 : RD / 2) - 0.4,
      north, east,
    };
    this.roomFloor(0, 0, rooms[0].floor || home.floor);
    if (north) this.roomFloor(0, RD, rooms[1].floor);
    if (east) this.roomFloor(RW, 0, rooms[2].floor);
    const wall = 0xded4c6, hh = 2.4;
    this.wallBox(0, -RD / 2, RW, 0.12, hh, 1.15);                 // south, flap in the middle
    this.wallRun(-RW / 2, 0, 0.12, RD, hh, false);
    if (east) this.wallBox(RW / 2, 0, 0.12, RD, hh, 1.15);
    else this.wallRun(RW / 2, 0, 0.12, RD, hh, false);
    if (north) this.wallBox(0, RD / 2, RW, 0.12, hh, 1.15);
    else this.wallRun(0, RD / 2, RW, 0.12, hh, true);
    if (north) {
      this.wallRun(-RW / 2, RD, 0.12, RD, hh, false);
      this.wallRun(RW / 2, RD, 0.12, RD, hh, false);
      this.wallRun(0, RD + RD / 2, RW, 0.12, hh, true);
    }
    if (east) {
      this.wallRun(RW + RW / 2, 0, 0.12, RD, hh, false);
      this.wallRun(RW, RD / 2, RW, 0.12, hh, true);
      this.wallRun(RW, -RD / 2, RW, 0.12, hh, true);
    }
    const winZ = north ? RD + RD / 2 - 0.08 : RD / 2 - 0.08;
    const win = new THREE.Mesh(boxG(), this.glow(0xfff6df, 0.55));
    win.scale.set(1.4, 0.9, 0.06);
    win.position.set(this.wx(1.1), 1.15, this.wz(winZ));
    this.addMesh(win);
    const sun = new THREE.Mesh(disc(), this.glow(0xfff1c4, 0.35));
    sun.rotation.x = -Math.PI / 2;
    sun.position.set(this.wx(1.0), 0.07, this.wz((north ? RD : 0) + RD / 2 - 1.1));
    sun.scale.setScalar(0.7);
    this.addMesh(sun);
    this.furnish(rooms[0].kind || home.layout, 0, 0);
    if (north) this.furnish(rooms[1].kind, 0, RD);
    if (east) this.furnish(rooms[2].kind, RW, 0);
    this.finds(home);
    if (home.pet) this.makePet(home);
    if (home.baby && !this.game.progress.rescued.has('home-' + home.id)) this.makeBaby(home);
  }

  buildTower(plan) {
    this.clearRoom();
    this.roomRoot.position.y = 0;
    const stamp = this._stamp || (this._stamp = new THREE.Object3D());
    const n = plan.steps.length;
    const treads = new THREE.InstancedMesh(boxG(), this.mat(0xd9cbb4), n);
    const rails = new THREE.InstancedMesh(boxG(), this.mat(0x6b4a33), n);
    const posts = new THREE.InstancedMesh(cyl(), this.mat(0x6b4a33), n);
    let pi = 0;
    for (let i = 0; i < n; i++) {
      const s = plan.steps[i];
      const ox = Math.cos(s.a) * 0.52, oz = Math.sin(s.a) * 0.52;
      stamp.position.set(s.x, s.y, s.z);
      stamp.rotation.set(0, -s.a, 0);
      stamp.scale.set(0.9, 0.12, 1.15);
      stamp.updateMatrix();
      treads.setMatrixAt(i, stamp.matrix);
      stamp.position.set(s.x + ox, s.y + 0.46, s.z + oz);
      stamp.scale.set(0.05, 0.05, 0.95);
      stamp.updateMatrix();
      rails.setMatrixAt(i, stamp.matrix);
      if (i % 4 === 0) {
        stamp.position.set(s.x + ox, s.y + 0.4, s.z + oz);
        stamp.rotation.set(0, 0, 0);
        stamp.scale.set(0.08, 0.8, 0.08);
        stamp.updateMatrix();
        posts.setMatrixAt(pi++, stamp.matrix);
      }
    }
    posts.count = pi;
    for (const mesh of [treads, rails, posts]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.needsUpdate = true;
      this.addMesh(mesh);
    }
    const top = plan.top;
    const land = new THREE.Mesh(disc(), this.mat(0xe7e0d4));
    land.rotation.x = -Math.PI / 2;
    land.position.set(top.x, top.y + 0.08, top.z);
    land.scale.setScalar(0.9);
    this.addMesh(land);
    const glass = new THREE.Mesh(cyl(), this.glow(0xfff6c8, 0.72));
    glass.scale.set(0.55, 0.95, 0.55);
    glass.position.set(plan.cx + Math.cos(top.a) * (plan.R - 1.35), top.y + 1.4, plan.cz + Math.sin(top.a) * (plan.R - 1.35));
    this.addMesh(glass);
    if (!this.game.journal?.has('find-lamp')) {
      const shard = new THREE.Mesh(ball(), this.glow(0xfff2b0, 0.95));
      shard.scale.setScalar(0.2);
      shard.position.set(plan.find.x, plan.find.y + 0.12, plan.find.z);
      this.addMesh(shard);
      this.lamp = shard;
    }
  }

  roomFloor(ox, oz, floor) {
    const hex = floor === 'tile' ? 0xd7dbe2 : floor === 'board' ? 0xc4a574 : 0x8f4d4d;
    const m = new THREE.Mesh(boxG(), this.mat(hex));
    m.scale.set(RW, 0.08, RD);
    m.position.set(IX + ox, 0, IZ + oz);
    this.addMesh(m);
    if (floor === 'rug') {
      const rug = new THREE.Mesh(boxG(), this.mat(0xe7c98a));
      rug.scale.set(RW * 0.72, 0.04, RD * 0.62);
      rug.position.set(IX + ox, 0.06, IZ + oz);
      this.addMesh(rug);
    }
  }

  /** a wall of size (sx, sz) centred at (lx, lz). split opens a doorway on the long axis. */
  wallBox(lx, lz, sx, sz, hh, door) {
    const longX = sx >= sz;
    const span = (longX ? sx : sz);
    if (!door || door * 2 >= span - 0.2) { this.solid(lx, 0, lz, sx, hh, sz, 0xded4c6); return; }
    const side = (span - door * 2) / 2;
    if (longX) {
      this.solid(lx - door - side / 2, 0, lz, side, hh, sz, 0xded4c6);
      this.solid(lx + door + side / 2, 0, lz, side, hh, sz, 0xded4c6);
    } else {
      this.solid(lx, 0, lz - door - side / 2, sx, hh, side, 0xded4c6);
      this.solid(lx, 0, lz + door + side / 2, sx, hh, side, 0xded4c6);
    }
  }
  wallRun(lx, lz, sx, sz, hh, alongX) {
    this.wallBox(lx, lz, alongX ? sx : 0.12, alongX ? 0.12 : sz, hh, 0);
  }

  furnish(kind, ox, oz) {
    this._rx = ox; this._rz = oz;
    if (kind === 'lounge' || kind === 'hall' || kind === 'bedroom') this.couch();
    if (kind === 'kitchen' || kind === 'lounge' || kind === 'hall' || kind === 'bedroom') this.table();
    if (kind === 'kitchen' || kind === 'laundry') this.sink();
    if (kind === 'laundry') this.bath();
    if (kind === 'bedroom') this.bed();
    if (kind !== 'laundry' && kind !== 'bedroom') this.tank();
    if (kind === 'lounge' || kind === 'bedroom' || kind === 'hall') this.shelf();
    if (kind === 'kitchen' || kind === 'laundry') this.bowl();
    if (kind !== 'laundry') this.plant();
    this._rx = 0; this._rz = 0;
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
  bed() {
    const m = new THREE.Mesh(boxG(), this.mat(0xf4efe6));
    m.scale.set(1.5, 0.22, 0.9);
    m.position.set(this.wx(-0.7), 0.28, this.wz(0.55));
    this.addMesh(m);
    this.solid(-0.7, 0, 0.55, 1.35, 0.16, 0.75, 0xc4a574, false);
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
    const furH = cat ? 0xd98a43 : 0xc4a06a;
    const darkH = cat ? 0x8a4e22 : 0x5c3a22;
    const lightH = cat ? 0xf6d7b0 : 0xe7d3b4;
    const fur = this.mat(furH), dark = this.mat(darkH), light = this.mat(lightH);
    const pink = this.mat(cat ? 0xeea4a4 : 0xd9897a), black = this.mat(0x1a1a1a), eyeC = this.mat(0xc6e86a);
    const sph = (r, mat, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(ball(), mat);
      m.scale.set(r * 2 * sx, r * 2 * sy, r * 2 * sz);
      return m;
    };
    const legCyl = (r, h, mat) => {
      const m = new THREE.Mesh(cyl(), mat);
      m.scale.set(r * 2, h, r * 2);
      return m;
    };
    const belly = sph(0.46, fur, 0.82, 0.7, 1.25); belly.position.set(0, 0.62, 0.12); g.add(belly);
    const haunch = sph(0.38, fur, 0.9, 0.78, 0.95); haunch.position.set(0, 0.64, -0.36); g.add(haunch);
    const chest = sph(0.2, light, 1.05, 0.75, 0.8); chest.position.set(0, 0.5, 0.4); g.add(chest);
    const head = new THREE.Group(); head.position.set(0, cat ? 0.9 : 0.95, cat ? 0.6 : 0.72);
    head.add(sph(cat ? 0.3 : 0.32, fur, 1.05, 0.95, cat ? 0.98 : 1.05));
    const ears = [];
    for (const s of [-1, 1]) {
      const fluff = sph(0.11, light, 1.1, 0.7, 0.7); fluff.position.set(s * 0.16, -0.08, 0.12); head.add(fluff);
      const ear = new THREE.Group(); ear.position.set(s * 0.14, cat ? 0.2 : 0.12, -0.02);
      if (cat) {
        const flap = sph(0.08, fur, 0.5, 1.15, 0.32); flap.position.y = 0.07; ear.add(flap);
        const inner = sph(0.04, pink, 0.4, 0.7, 0.22); inner.position.set(0, 0.06, 0.02); ear.add(inner);
      } else {
        const flap = sph(0.1, dark, 0.45, 1.2, 0.7); flap.position.y = -0.02; flap.rotation.z = s * 0.5; ear.add(flap);
      }
      head.add(ear); ears.push(ear);
      const eye = sph(0.05, eyeC, 1, 1.15, 0.55); eye.position.set(s * 0.11, 0.04, 0.24); head.add(eye);
      const pupil = sph(0.02, black, 0.7, 1.3, 0.6); pupil.position.set(s * 0.11, 0.04, 0.28); head.add(pupil);
    }
    if (!cat) {
      const snout = sph(0.14, light, 1.1, 0.75, 1.3); snout.position.set(0, -0.06, 0.28); head.add(snout);
    }
    const nose = sph(0.035, pink, 0.9, 0.7, 0.8); nose.position.set(0, cat ? -0.02 : -0.04, 0.32); head.add(nose);
    g.add(head);
    const knees = [];
    for (const [x, z] of [[-0.18, 0.28], [0.18, 0.28], [-0.18, -0.26], [0.18, -0.26]]) {
      const hip = new THREE.Group(); hip.position.set(x, 0.46, z);
      const thigh = legCyl(0.07, 0.22, fur); thigh.position.y = -0.11; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.22; hip.add(knee);
      const shin = legCyl(0.045, 0.16, fur); shin.position.y = -0.08; knee.add(shin);
      const paw = sph(0.05, furH === 0x2a2a2c ? light : fur, 1.25, 0.45, 1.3); paw.position.set(0, -0.16, 0.02); knee.add(paw);
      g.add(hip); knees.push(knee);
    }
    const tail = new THREE.Group(); tail.position.set(0, 0.7, -0.62);
    tail.add(new THREE.Mesh(this.petTailGeo(), fur));
    const tailTip = new THREE.Group(); tailTip.position.set(Math.sin(1.1) * 0.08, 0.47, -0.72);
    tailTip.add(sph(0.035, fur, 1, 1, 1.2));
    tail.add(tailTip);
    g.add(tail);
    const sc = cat ? 0.8 : 1;
    g.scale.setScalar(sc);
    outline(g, this.outline);
    const x = this.wx(1.55), z = this.wz(0.35);
    g.position.set(x, 0.02, z);
    this.roomRoot.add(g);
    this.pet = { kind: home.pet, mesh: g, body: g, head, ears, knees, tail, tailTip, sc, x, z, state: 'nap', t: 0 };
  }

  petTailGeo() {
    if (this._tailGeo) return this._tailGeo;
    const curve = new THREE.CatmullRomCurve3([0, 1, 2, 3, 4, 5].map((i) => {
      const t = i / 5;
      return new THREE.Vector3(Math.sin(t * 1.1) * 0.08, 0.05 + t * 0.42, -t * 0.72);
    }));
    const geo = new THREE.TubeGeometry(curve, 8, 0.055, 6, false);
    geo.computeVertexNormals();
    this._tailGeo = geo;
    return geo;
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
    if (this.towerCool > 0) this.towerCool = Math.max(0, this.towerCool - dt);
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
    const pending = this.pending;
    if (pending?.kind === 'tower') { this.arriveTower(o, pending.plan); return; }
    const home = pending;
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
    for (const room of home.rooms || []) this.game.journal?.seeHow('place:' + room.kind);
    this.game.levels?.did('homevisit', home.id);
    this.game.camInit = false;
    this.phase = null;
    this.pending = null;
    this.locking = false;
    this.fade(0);
    o.group.scale.setScalar(o.sz);
    this.game.saveSoon?.('home');
  }

  arriveTower(o, plan) {
    this.outdoor = { x: o.x, z: o.z, heading: o.heading };
    this.tower = true;
    this.towerPlan = plan;
    this.indoor = { kind: 'tower', entry: plan.base, y: plan.base, door: { x: plan.gap.x, z: plan.gap.z } };
    this.buildTower(plan);
    this.roomRoot.visible = true;
    if (this.game.view) this.game.view.root.visible = true;
    const step = plan.steps[2] || plan.steps[0];
    o.x = step.x;
    o.z = step.z;
    o.y = step.y + 0.08;
    o.heading = Math.atan2(-Math.sin(step.a), Math.cos(step.a));
    o.hiddenIn = null;
    o.speed = 0;
    this.towerCool = FLAP_COOL;
    this.towerArmed = false;
    this.game.journal?.seeHow('place:light');
    this.game.levels?.did('poi', 'light');
    this.game.camInit = false;
    this.phase = null;
    this.pending = null;
    this.locking = false;
    this.fade(0);
    o.group.scale.setScalar(o.sz);
  }

  finishLeave(o) {
    if (this.tower) { this.finishLeaveTower(o); return; }
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

  finishLeaveTower(o) {
    const plan = this.towerPlan;
    const g = plan?.gap || this.outdoor || { x: o.x, z: o.z };
    const dx = g.x - (plan?.cx ?? g.x), dz = g.z - (plan?.cz ?? g.z);
    const d = Math.hypot(dx, dz) || 1;
    o.x = g.x + (dx / d) * 1.15;
    o.z = g.z + (dz / d) * 1.15;
    o.y = this.game.world.heightAt(o.x, o.z);
    o.heading = Math.atan2(dx, dz);
    o.speed = 0;
    this.clearRoom();
    this.tower = false;
    this.indoor = null;
    this.roomRoot.visible = false;
    if (this.game.view) this.game.view.root.visible = true;
    this.towerCool = FLAP_COOL;
    this.towerArmed = false;
    this.phase = null;
    this.locking = false;
    this.fade(0);
    o.group.scale.setScalar(o.sz);
    this.game.camInit = false;
  }

  leaveNow() {
    if (!this.indoor && this.phase !== 'in') { this.phase = null; this.locking = false; return; }
    const o = this.game.octopus;
    if (this.phase === 'in' && this.pending) {
      if (this.pending.kind === 'tower') {
        this.tower = true;
        this.towerPlan = this.pending.plan;
        this.indoor = { kind: 'tower', entry: this.pending.plan.base, y: this.pending.plan.base, door: { x: this.pending.plan.gap.x, z: this.pending.plan.gap.z } };
      } else this.indoor = this.pending;
    }
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

  tryEnterTower() {
    if (this.phase || this.indoor) return;
    const o = this.game.octopus;
    const plan = this.towerPlanOf();
    if (!o?.alive || o.tunnel || o.carried || !plan) return;
    this.phase = 'in';
    this.phaseT = 0;
    this.pending = { kind: 'tower', plan };
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
    const tw = this.towerPlanOf();
    if (tw && o.alive && !o.tunnel && !o.carried) {
      const g = tw.gap;
      const near = (o.x - g.x) ** 2 + (o.z - g.z) ** 2 < 0.62 * 0.62;
      if (!near) this.towerArmed = true;
      if (o.moving && this.towerArmed && this.towerCool <= 0 && near) { this.tryEnterTower(); return; }
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
        if (this.secret.userData.baseY == null) this.secret.userData.baseY = this.secret.position.y;
        this.secret.position.y = this.secret.userData.baseY + Math.sin((this._hop || 0) * 2.1) * 0.045;
        this.secret.rotation.y = (this._hop || 0) * 0.35;
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
    if (this.tower) { this.updateTower(dt, o); return; }
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

  updateTower(dt, o) {
    const plan = this.towerPlan;
    if (!plan) return;
    const s0 = plan.steps[0];
    const near = (o.x - s0.x) ** 2 + (o.z - s0.z) ** 2 < 0.72 * 0.72;
    if (!near) this.towerArmed = true;
    if (o.moving && this.towerArmed && this.towerCool <= 0 && near) { this.tryLeave(); return; }
    if (this.lamp) {
      const f = plan.find;
      this.lamp.position.y = f.y + 0.12 + Math.sin((this._hop || 0) * 3) * 0.04;
      if ((o.x - f.x) ** 2 + (o.z - f.z) ** 2 < 0.7 * 0.7) {
        this.game.journal?.seeHow('place:lampglass');
        this.roomRoot.remove(this.lamp);
        this.lamp = null;
      }
    }
    void dt;
  }

  updatePet(dt, o) {
    const p = this.pet;
    p.t += dt;
    const dx = o.x - p.x, dz = o.z - p.z, dist = Math.hypot(dx, dz) || 1;
    const camo = !!o.camoProtected;
    if (p.state !== 'pounce') {
      const next = nextPetIdle(p.state, p.t, dist, camo);
      if (next !== p.state) { p.state = next; p.t = 0; }
    }
    if (p.state === 'creep') {
      if (!o.moving) {
        const step = 0.5 * dt;
        p.x += (dx / dist) * step; p.z += (dz / dist) * step;
      }
      if (dist < 0.85) { p.state = 'pounce'; p.t = 0; p.toX = o.x; p.toZ = o.z; }
    } else if (p.state === 'pounce') {
      const k = Math.min(1, p.t / 0.28);
      p.x += (p.toX - p.x) * Math.min(1, dt * 8);
      p.z += (p.toZ - p.z) * Math.min(1, dt * 8);
      if (k >= 1) {
        if (Math.hypot(o.x - p.x, o.z - p.z) < 0.5) o.damage(7, p.kind);
        p.state = 'sit'; p.t = 0;
      }
    }
    if (dist < 0.32 && p.state !== 'pounce') { p.x -= (dx / dist) * 0.04; p.z -= (dz / dist) * 0.04; }
    this.clampPet(p);
    p.mesh.position.set(p.x, 0.02, p.z);
    p.mesh.rotation.y = Math.atan2(dx, dz);
    this.posePet(p, dist);
  }

  clampPet(p) {
    const b = this.petBox || { minX: -RW / 2 + 0.45, maxX: RW / 2 - 0.45, minZ: -RD / 2 + 0.45, maxZ: RD / 2 - 0.45 };
    p.x = Math.max(IX + b.minX, Math.min(IX + b.maxX, p.x));
    p.z = Math.max(IZ + b.minZ, Math.min(IZ + b.maxZ, p.z));
    if (b.north && b.east) {
      const x1 = IX + RW / 2 - 0.2, z1 = IZ + RD / 2 - 0.2;
      if (p.x > x1 && p.z > z1) { if (p.x - x1 < p.z - z1) p.x = x1; else p.z = z1; }
    }
  }

  posePet(p, dist) {
    const t = p.t, st = p.state, cat = p.kind === 'cat';
    const lock = st === 'notice' || st === 'creep' || st === 'pounce';
    const breathe = 1 + Math.sin(t * 2.2) * (st === 'nap' ? 0.04 : 0.015);
    if (p.ears) p.ears.forEach((e, i) => {
      const s = i ? 1 : -1;
      e.rotation.z = lock ? s * 0.22 : Math.sin(t * 1.4 + i) * 0.08;
      e.rotation.x = lock ? -0.28 : (st === 'nap' ? 0.35 : 0);
    });
    if (p.knees) p.knees.forEach((k, i) => {
      const bend = st === 'creep' || st === 'pounce' ? 0.85 : st === 'stretch' ? (i < 2 ? -0.4 : 0.9) : st === 'nap' ? 1.15 : 0.2;
      k.rotation.x = bend;
    });
    if (p.tail) p.tail.rotation.y = st === 'notice' ? Math.sin(t * 3) * 0.08 : st === 'creep' ? Math.sin(t * 2.4) * 0.35 : Math.sin(t * 1.6) * 0.22;
    if (p.tailTip) p.tailTip.rotation.y = st === 'notice' ? Math.sin(t * 14) * 0.7 : Math.sin(t * 3) * 0.25;
    if (p.head) {
      p.head.rotation.x = st === 'groom' ? 0.8 : st === 'nap' ? 0.35 : st === 'stretch' ? -0.25 : 0;
      p.head.rotation.y = st === 'groom' ? Math.sin(t * 6) * 0.35 : (lock ? 0 : Math.sin(t * 0.7) * 0.12);
      p.head.position.y = (cat ? 0.9 : 0.95) + (lock ? 0.04 : 0) - (st === 'nap' ? 0.08 : 0);
    }
    const sc = p.sc || (cat ? 0.8 : 1);
    const low = st === 'nap' || st === 'creep' ? 0.78 : st === 'pounce' ? 1.08 : st === 'stretch' ? 0.9 : 1;
    p.mesh.scale.set(sc, sc * low * breathe, sc * (st === 'stretch' ? 1.12 : 1));
    if (st === 'stretch') p.mesh.rotation.x = 0.18;
    else if (st === 'groom') p.mesh.rotation.x = 0.12;
    else p.mesh.rotation.x = 0;
    void dist;
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
