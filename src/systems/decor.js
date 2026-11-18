// Decorations around a shell den. No prompts: drag an item off the satchel to carry it,
// stand still beside a den to set it down, walk into it to pick it up, camouflage to turn it.
// Pieces are saved. A den with enough of them is a home.
import * as THREE from 'three';
import { toonMat, outlineMat, outline } from '../world/toon.js';
import { seat } from '../world/placement.js';
import { ALL_ITEMS } from './items.js';

export const DECOR_NEAR = 3.4;
export const DECOR_MAX = 8;
export const HOME_NEED = 4;
const MAX_ALL = 24;
const _m = new THREE.Matrix4();

/** nearest den within r, or null */
export function denNear(dens, x, z, r = DECOR_NEAR) {
  let best = null, bd = r;
  if (!dens) return null;
  for (let i = 0; i < dens.length; i++) {
    const d = dens[i];
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best;
}

export function countAt(list, x, z) {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (Math.hypot(list[i].denx - x, list[i].denz - z) < 0.45) n++;
  return n;
}

/** a free spot on the ring around a den, or null when the ring is full */
export function planSpot(list, den, heading) {
  if (countAt(list, den.x, den.z) >= DECOR_MAX) return null;
  for (let k = 0; k < 8; k++) {
    const a = heading + k * 0.55;
    const x = den.x + Math.sin(a) * 1.55;
    const z = den.z + Math.cos(a) * 1.55;
    let hit = false;
    for (let i = 0; i < list.length; i++) if (Math.hypot(list[i].x - x, list[i].z - z) < 0.42) { hit = true; break; }
    if (!hit) return { x, z, rot: a };
  }
  return null;
}

export function pieceNear(list, x, z, r) {
  let best = -1, bd = r;
  for (let i = 0; i < list.length; i++) {
    const d = Math.hypot(list[i].x - x, list[i].z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export class Decor {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.carry = null;
    this.still = 0;
    this.visitT = 0;
    this.root = new THREE.Group();
    game.scene.add(this.root);
    this.mat = toonMat({ vertexColors: true, roughness: 0.7 });
    this.bead = new THREE.SphereGeometry(1, 6, 5);
    this.beadMat = toonMat({ color: 0xe7c98a });
    this.carryMesh = null;
    this.visitor = null;
  }

  clear() {
    for (let i = 0; i < this.list.length; i++) this.detach(this.list[i]);
    this.list.length = 0;
    this.carry = null;
    this.still = 0;
    if (this.carryMesh) this.carryMesh.visible = false;
    if (this.visitor) this.visitor.visible = false;
  }

  beginCarry(id) {
    const inv = this.game.inv;
    if (!ALL_ITEMS.includes(id) || !inv || inv.count(id) < 1) return false;
    if (this.carry) this.stow();
    if (!inv.take(id)) return false;
    this.carry = id;
    this.still = 0;
    this.syncCarryMesh();
    this.game.saveSoon?.('decor');
    return true;
  }

  /** put the carried thing back in the bag */
  stow() {
    if (!this.carry) return false;
    this.game.inv?.add(this.carry);
    this.carry = null;
    this.syncCarryMesh();
    return true;
  }

  dropHere() {
    const o = this.game.octopus;
    if (!o) return false;
    const den = denNear(this.game.abilities?.dens, o.x, o.z, 8);
    return den ? this.tryPlace(den) : false;
  }

  tryPlace(den) {
    if (!this.carry || !den) return false;
    const w = this.game.world, o = this.game.octopus;
    if (!w || !o || o.carried || o.tunnel) return false;
    const spot = planSpot(this.list, den, o.heading || 0);
    if (!spot) return false;
    if (w.waterAt(spot.x, spot.z) || w.heightAt(spot.x, spot.z) < 0.05) return false;
    if (this.list.length >= MAX_ALL) return false;
    const piece = { id: this.carry, x: spot.x, z: spot.z, rot: spot.rot, denx: den.x, denz: den.z, cool: 0 };
    this.carry = null;
    this.list.push(piece);
    this.attach(piece);
    this.syncCarryMesh();
    if (countAt(this.list, den.x, den.z) >= HOME_NEED) this.game.levels?.did('home');
    this.game.saveSoon?.('decor');
    return true;
  }

  nudge(i) {
    const p = this.list[i];
    if (!p || p.cool > 0) return false;
    p.rot += Math.PI / 4;
    p.cool = 0.55;
    this.seatPiece(p);
    return true;
  }

  pickup(i) {
    const p = this.list[i];
    if (!p) return false;
    if (this.carry) this.stow();
    this.detach(p);
    this.list.splice(i, 1);
    this.carry = p.id;
    this.still = 0;
    this.syncCarryMesh();
    return true;
  }

  releaseDen(x, z, giveBack) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (Math.hypot(p.denx - x, p.denz - z) > 0.45) continue;
      this.detach(p);
      this.list.splice(i, 1);
      if (giveBack) this.game.inv?.add(p.id);
    }
  }

  attach(p) {
    const geos = this.game.gather?.geos;
    const geo = geos?.[p.id] || this.bead;
    const mesh = new THREE.Mesh(geo, geo === this.bead ? this.beadMat : this.mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = true;
    this.root.add(mesh);
    p.mesh = mesh;
    this.seatPiece(p);
  }

  seatPiece(p) {
    if (!p.mesh || !this.game.world) return;
    const bead = p.mesh.geometry === this.bead;
    const s = bead ? 0.16 : 1.65;
    seat(this.game.world, p.mesh.geometry, { x: p.x, z: p.z, rot: p.rot, sx: s, sy: s, sz: s, tilt: 0.55, bury: 0.01 }, _m);
    p.mesh.matrix.copy(_m);
  }

  detach(p) {
    if (!p.mesh) return;
    this.root.remove(p.mesh);
    p.mesh = null;
  }

  syncCarryMesh() {
    const o = this.game.octopus;
    if (!o?.group) return;
    if (!this.carry) { if (this.carryMesh) this.carryMesh.visible = false; return; }
    const geos = this.game.gather?.geos;
    const geo = geos?.[this.carry] || this.bead;
    if (!this.carryMesh) {
      this.carryMesh = new THREE.Mesh(geo, this.mat);
      this.carryMesh.position.set(0, 0.72, -0.3);
      this.carryMesh.castShadow = false;
      o.group.add(this.carryMesh);
    } else if (this.carryMesh.parent !== o.group) {
      o.group.add(this.carryMesh);
    }
    if (this.carryMesh.geometry !== geo) this.carryMesh.geometry = geo;
    this.carryMesh.material = geo === this.bead ? this.beadMat : this.mat;
    this.carryMesh.scale.setScalar(geo === this.bead ? 0.2 : 1.45);
    this.carryMesh.visible = true;
  }

  ensureVisitor() {
    if (this.visitor) return;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 7, 6), toonMat({ color: 0xe3b04a }));
    body.scale.set(1, 0.75, 1.15);
    body.position.y = 0.12;
    g.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), toonMat({ color: 0x1a1a1a }));
    eye.position.set(0.05, 0.16, 0.1);
    const eye2 = eye.clone();
    eye2.position.x = -0.05;
    g.add(eye, eye2);
    outline(g, outlineMat());
    g.visible = false;
    this.root.add(g);
    this.visitor = g;
  }

  update(dt) {
    const o = this.game.octopus, w = this.game.world;
    if (!o || !w || !o.alive) return;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].cool > 0) this.list[i].cool -= dt;
    if (this.carry && !o.carried && !o.tunnel && !o.waterKind) {
      const den = denNear(this.game.abilities?.dens, o.x, o.z);
      if (den && !o.moving) this.still += dt; else this.still = 0;
      if (this.still > 0.45) { this.still = 0; this.tryPlace(den); }
    } else this.still = 0;
    const idx = pieceNear(this.list, o.x, o.z, o.camoActive ? 0.8 : 0.58);
    if (idx >= 0 && o.camoActive) this.nudge(idx);
    else if (idx >= 0 && o.moving && !o.camoActive) this.pickup(idx);
    this.visit(dt);
  }

  visit(dt) {
    this.visitT += dt;
    const dens = this.game.abilities?.dens;
    const o = this.game.octopus;
    if (!dens || !(this.game.progress?.babies > 0) || !o) {
      if (this.visitor) this.visitor.visible = false;
      return;
    }
    let den = null;
    for (let i = 0; i < dens.length; i++) {
      const d = dens[i];
      if (countAt(this.list, d.x, d.z) < 3) continue;
      if (Math.hypot(o.x - d.x, o.z - d.z) < 36) { den = d; break; }
    }
    if (!den) { if (this.visitor) this.visitor.visible = false; return; }
    this.ensureVisitor();
    const a = this.visitT * 0.65;
    const x = den.x + Math.cos(a) * 1.05;
    const z = den.z + Math.sin(a) * 1.05;
    this.visitor.visible = true;
    this.visitor.position.set(x, this.game.world.heightAt(x, z) + 0.02, z);
    this.visitor.rotation.y = -a + Math.PI / 2;
  }

  toJSON() {
    const out = [];
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      out.push({ id: p.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), rot: +p.rot.toFixed(3), denx: +p.denx.toFixed(2), denz: +p.denz.toFixed(2) });
    }
    return out;
  }

  load(arr) {
    this.clear();
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length && this.list.length < MAX_ALL; i++) {
      const p = arr[i];
      if (!p || !ALL_ITEMS.includes(p.id)) continue;
      const piece = { id: p.id, x: p.x, z: p.z, rot: p.rot || 0, denx: p.denx, denz: p.denz, cool: 0 };
      this.list.push(piece);
      if (this.game.world && this.game.gather) this.attach(piece);
    }
  }
}
