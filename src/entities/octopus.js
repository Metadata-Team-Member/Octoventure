// =====================================================================
//  Octopus - the player. Model, movement, drying, camouflage.
// =====================================================================
import * as THREE from 'three';
import { CONFIG, TERRAIN } from '../config.js';
import { clamp, damp, dampAngle, lerp } from '../util/rng.js';

const TENT = 8, SEG = 12;
// Australian blue-ringed octopus (Hapalochlaena): small, ochre-yellow/brown body with electric-blue rings.
const SKIN = new THREE.Color(0xd9a63f);
const DRY = new THREE.Color(0xc2b085);
const RING_BLUE = new THREE.Color(0x0a52ff);
const RING_FLASH = new THREE.Color(0x1a8cff);
const DEAD = new THREE.Color(0x8c8480);

export class Octopus {
  constructor(world, scene) {
    this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ color: SKIN.clone(), roughness: 0.35, metalness: 0.0, vertexColors: true });
    // iridescent blue rings (emissive so they can glow / flash) with a black outline
    this.ringBlue = new THREE.MeshStandardMaterial({ color: RING_BLUE.clone(), emissive: RING_BLUE.clone(), emissiveIntensity: 0.5, roughness: 0.12, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.ringBlack = new THREE.MeshStandardMaterial({ color: 0x07070a, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.alarm = 0;          // 0..1, set by the game when a predator has noticed us (rings flash)
    this.flashT = 0;
    this.build();
    this.reset(world);
  }

  build() {
    const mat = this.mat;
    this.body = new THREE.Group();
    this.group.add(this.body);
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 14), mat);
    mantle.scale.set(0.95, 1.2, 1.0); mantle.position.set(0, 0.95, -0.2); mantle.rotation.x = -0.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), mat);
    head.scale.set(1.15, 0.9, 1.1); head.position.set(0, 0.62, 0.12);
    this.mantle = mantle; this.head = head;
    this.body.add(mantle, head);
    const white = new THREE.MeshStandardMaterial({ color: 0xfff8e8, roughness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15100e, roughness: 0.2 });
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), white);
      eye.position.set(s * 0.36, 0.78, 0.52);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.05), black);
      pupil.position.set(0, 0, 0.13);
      eye.add(pupil);
      this.body.add(eye);
      this.eyes.push({ eye, pupil });
    }
    this.tentacles = [];
    this.mottle(mantle.geometry, 1.3); this.mottle(head.geometry, 4.1);
    const sg = new THREE.SphereGeometry(1, 10, 8);
    this.mottle(sg, 2.2);
    for (let i = 0; i < TENT; i++) {
      const segs = [];
      for (let j = 0; j < SEG; j++) {
        const m = new THREE.Mesh(sg, mat);
        const r = lerp(0.24, 0.05, Math.pow(j / (SEG - 1), 0.8));
        m.scale.set(r, r * 0.85, r);
        m.castShadow = true;
        this.group.add(m);
        segs.push(m);
      }
      this.tentacles.push({ segs, a: (i / TENT) * Math.PI * 2 + 0.2, phase: i * 0.9 });
    }
    for (const o of [mantle, head]) o.castShadow = true;
    this.buildRings(mantle, head);
  }

  /** mottled ochre/brown skin pattern as vertex colours (greyscale multiplier on the skin colour) */
  mottle(geo, seed) {
    const p = geo.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 0.5 + 0.5 * Math.sin(x * 9 + seed) * Math.sin(y * 8 + z * 6 + seed * 2) + 0.25 * Math.sin(z * 17 + x * 11);
      const v = 0.74 + 0.26 * Math.min(1, Math.max(0, n));
      c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }

  buildRings(mantle, head) {
    const outline = new THREE.RingGeometry(0.7, 1.0, 20); outline.rotateX(-Math.PI / 2);
    const blue = new THREE.RingGeometry(0.38, 0.78, 20); blue.rotateX(-Math.PI / 2);
    this.ringGeos = [outline, blue];
    const up = new THREE.Vector3(0, 1, 0);
    const addRing = (parent, pos, normal, size) => {
      const g = new THREE.Group();
      g.position.copy(pos); g.quaternion.setFromUnitVectors(up, normal); g.scale.setScalar(size);
      const a = new THREE.Mesh(outline, this.ringBlack), b = new THREE.Mesh(blue, this.ringBlue);
      b.position.y = 0.004 / Math.max(size, 0.02);
      g.add(a, b); parent.add(g);
    };
    // spots on an ellipsoid (mantle / head): golden-spiral layout
    const onEllipsoid = (mesh, count, yMin, yMax, size, skip) => {
      mesh.updateMatrix();
      const m = mesh.matrix, q = mesh.quaternion, sc = mesh.scale, r = mesh.geometry.parameters.radius;
      for (let i = 0; i < count; i++) {
        const y = yMin + (yMax - yMin) * (i + 0.5) / count, ang = i * 2.39996;
        const rr = Math.sqrt(1 - y * y);
        const u = new THREE.Vector3(rr * Math.cos(ang), y, rr * Math.sin(ang));
        if (skip && skip(u)) continue;
        const pos = u.clone().multiplyScalar(r).applyMatrix4(m);
        const n = new THREE.Vector3(u.x / (sc.x * sc.x), u.y / (sc.y * sc.y), u.z / (sc.z * sc.z)).normalize().applyQuaternion(q);
        pos.addScaledVector(n, 0.012);
        addRing(this.body, pos, n, size);
      }
    };
    onEllipsoid(mantle, 20, -0.05, 0.98, 0.095, (u) => u.z > 0.55 && u.y < 0.5);
    // a few on the sides of the head, below / behind the eyes
    onEllipsoid(head, 12, -0.1, 0.55, 0.075, (u) => u.z > 0.15 || Math.abs(u.x) < 0.35);
    // rings along the arms
    const rs = this.tentacles;
    for (const T of rs) {
      for (let j = 1; j < SEG - 1; j += 2) {
        const seg = T.segs[j];
        const sz = 0.78;
        const g = new THREE.Group(); g.position.set(0, 0.97, 0); g.scale.setScalar(sz);
        const a = new THREE.Mesh(outline, this.ringBlack), b = new THREE.Mesh(blue, this.ringBlue);
        b.position.y = 0.01;
        g.add(a, b); seg.add(g);
      }
    }
  }

  reset(world) {
    this.world = world;
    this.x = world.start.x; this.z = world.start.z;
    this.y = world.heightAt(this.x, this.z);
    this.heading = Math.random() * Math.PI * 2;
    this.health = CONFIG.octopus.maxHealth;
    this.energy = CONFIG.camo.maxEnergy;
    this.camoWanted = false;
    this.camoBlend = 0;
    this.camoLocked = false;       // true after the energy ran out, until it recovers
    this.speed = 0;
    this.moving = false;
    this.sprinting = false;
    this.alive = true;
    this.won = false;
    this.terrain = 'lawn';
    this.waterKind = null;
    this.lastDamage = 'dry';
    this.walkPhase = 0;
    this.deadT = 0;
    this.camoColor = new THREE.Color(TERRAIN.lawn.color);
    this.distance = 0;
    this.hurtFlash = 0;
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(0, this.heading, 0);
    this.tmpN = { x: 0, y: 1, z: 0 };
    this.wetness = 0.5;
    this.splashT = 0;
  }

  get camoActive() { return this.camoBlend > 0.85; }     // fully blended = predators are fooled
  get hiding() { return this.camoWanted && this.alive; }

  damage(amount, cause) {
    if (!this.alive || this.won) return;
    this.health = Math.max(0, this.health - amount * CONFIG.predators.damageMult);
    this.lastDamage = cause;
    this.hurtFlash = 1;
  }

  /** input: {mx, mz (world-space move vector, length<=1), sprint, camo} */
  update(dt, input, world) {
    const O = CONFIG.octopus, C = CONFIG.camo;
    this.terrain = world.typeAt(this.x, this.z);
    const T = TERRAIN[this.terrain];
    const water = this.alive && !this.won ? world.waterAt(this.x, this.z) : null;
    this.waterKind = water ? water.kind : null;

    if (this.alive && !this.won) {
      // ---- camouflage energy -------------------------------------------------
      if (this.camoLocked && this.energy >= C.minToStart) this.camoLocked = false;
      const wantCamo = input.camo && !this.camoLocked && this.energy > 0.5;
      this.camoWanted = wantCamo;
      if (wantCamo) {
        this.energy = Math.max(0, this.energy - C.drainPerSec * dt);
        if (this.energy <= 0.01) { this.camoLocked = true; this.camoWanted = false; }
      } else {
        this.energy = Math.min(C.maxEnergy, this.energy + C.regenPerSec * dt);
      }
      this.camoBlend = clamp(this.camoBlend + (this.camoWanted ? dt / C.fadeTime : -dt / (C.fadeTime * 0.6)), 0, 1);

      // ---- movement ---------------------------------------------------------------
      let mx = input.mx, mz = input.mz;
      const mag = Math.hypot(mx, mz);
      if (mag > 1) { mx /= mag; mz /= mag; }
      const canMove = !this.camoWanted || C.moveSpeedMult > 0;
      const sprint = input.sprint && mag > 0.1 && canMove;
      const base = (sprint ? O.sprintSpeed : O.walkSpeed) * T.speed * (this.camoWanted ? C.moveSpeedMult : 1) * (water ? 0.9 : 1);
      const targetSpeed = canMove ? Math.min(1, mag) * base : 0;
      this.speed = damp(this.speed, targetSpeed, 12, dt);
      this.moving = this.speed > 0.5;
      this.sprinting = sprint && this.moving;
      if (mag > 0.1 && canMove) this.heading = dampAngle(this.heading, Math.atan2(mx, mz), O.turnRate, dt);
      const dist = this.speed * dt;
      if (dist > 0) {
        const dx = Math.sin(this.heading) * dist, dz = Math.cos(this.heading) * dist;
        let nx = this.x + dx, nz = this.z + dz;
        const r = world.resolve(nx, nz, 0.7);
        nx = r.x; nz = r.z;
        this.distance += Math.hypot(nx - this.x, nz - this.z);
        this.x = nx; this.z = nz;
      }

      // ---- drying / water -----------------------------------------------------------
      if (water) {
        const gain = CONFIG.water[water.kind] ?? 20;
        this.health = Math.min(O.maxHealth, this.health + gain * dt);
        this.wetness = Math.min(1, this.wetness + dt * 1.5);
      } else {
        let rate = O.baseDryRate * T.dry;
        if (this.sprinting) rate *= O.sprintDryMult;
        if (this.camoWanted) rate *= C.dryMult;
        this.health = Math.max(0, this.health - rate * dt);
        this.wetness = Math.max(0, this.wetness - dt * 0.03 * T.dry);
        if (this.health <= 0) { this.lastDamage = 'dry'; }
      }
      if (this.health <= 0) { this.alive = false; this.camoWanted = false; this.speed = 0; }
    } else {
      this.speed = damp(this.speed, 0, 8, dt);
      this.camoBlend = clamp(this.camoBlend - dt * 2, 0, 1);
    }

    this.y = world.heightAt(this.x, this.z);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    if (!this.alive) this.deadT += dt;
    this.animate(dt);
  }

  animate(dt) {
    const world = this.world;
    this.walkPhase += dt * (this.speed * 1.1 + (this.alive ? 1.2 : 0));
    const t = this.walkPhase;
    const move = clamp(this.speed / 7, 0, 1.4);
    const dry = 1 - clamp(this.health / CONFIG.octopus.maxHealth, 0, 1);
    const camo = this.camoBlend;
    const died = this.alive ? 0 : clamp(this.deadT / 1.2, 0, 1);

    // colour: skin -> dry & pale -> grey when dead; camo blends toward the ground colour
    const ground = new THREE.Color(TERRAIN[this.terrain].color);
    this.camoColor.lerp(ground, 1 - Math.exp(-6 * dt));
    const col = this.mat.color;
    col.copy(SKIN).lerp(DRY, Math.pow(dry, 1.4) * 0.65).lerp(DEAD, died);
    // camouflage: blend toward ground colour (a touch darker, like a shadow-pattern)
    const camoTarget = this.camoColor.clone().multiplyScalar(0.92);
    col.lerp(camoTarget, camo * 0.96);
    this.mat.roughness = lerp(0.3, 0.85, Math.max(dry * 0.8, camo));

    // ---- blue rings: calm glow -> flashing warning display when threatened -> hidden when camouflaged ----
    this.flashT += dt * (6 + this.alarm * 10);
    const pulse = 0.5 + 0.5 * Math.sin(this.flashT * 2.2);
    const shimmer = 0.5 + 0.5 * Math.sin(this.walkPhase * 1.7 + 1.0);       // slow iridescent drift
    const alarm = this.alive ? this.alarm : 0;
    const vis = (1 - camo) * (1 - died);
    const ringColor = this.ringBlue.color;
    ringColor.copy(RING_BLUE).lerp(RING_FLASH, Math.max(shimmer * 0.25, alarm * pulse * 0.8));
    this.ringBlue.emissive.copy(ringColor);
    this.ringBlue.emissiveIntensity = (0.2 + 0.08 * shimmer + alarm * (0.05 + 0.5 * pulse)) * vis + 0.02;
    // when camouflaged the rings fade into the ground colour
    ringColor.lerp(camoTarget, camo * 0.9);
    this.ringBlue.emissive.lerp(camoTarget, camo * 0.9);
    this.ringBlack.color.set(0x07070a).lerp(camoTarget.clone().multiplyScalar(0.7), camo * 0.9);
    this.ringBlue.color.multiplyScalar(0.45).lerp(DEAD, died * 0.8);
    this.mat.transparent = false;

    // body pose
    const squash = 1 - dry * 0.18 - died * 0.45 - camo * 0.22 + Math.sin(t * 1.2) * 0.02 * (1 - died);
    this.body.scale.set(1 + camo * 0.12 + died * 0.2, squash, 1 + camo * 0.12 + died * 0.2);
    this.body.position.y = 0.0 - died * 0.05 + Math.abs(Math.sin(t * 2.2)) * 0.04 * move;
    this.body.rotation.z = Math.sin(t * 1.1) * 0.03 * move;
    for (const e of this.eyes) {
      e.eye.scale.setScalar(this.alive ? (camo > 0.5 ? 0.75 : 1) : 0.6);
      e.pupil.scale.y = this.alive ? 1 : 0.2;
    }

    // tentacles
    for (let i = 0; i < TENT; i++) {
      const T = this.tentacles[i];
      const side = Math.cos(T.a);   // x-side
      for (let j = 0; j < SEG; j++) {
        const s = j / (SEG - 1);
        const m = T.segs[j];
        let reach = 0.36 + s * (1.12 - died * 0.6 - camo * 0.22);
        let ang = T.a + Math.sin(t * 2.0 + T.phase - s * 3) * 0.16 * (0.3 + move) + (1 - died) * 0 + died * s * 0.5;
        const stride = Math.sin(t * 2.4 + T.phase + i * 0.3 - s * 1.5);
        let lift = move * 0.34 * Math.max(0, stride) * Math.sin(Math.PI * Math.min(1, s * 1.3));
        const curl = (this.alive ? 0.1 : 0.0) + (1 - move) * 0.12 * Math.sin(t * 0.8 + T.phase) * s;
        let y = 0.17 - s * 0.1 + lift + curl * 0.5 + (camo > 0.1 ? 0 : 0);
        // tips curl up when idle, flatten out when camouflaged (looks like a pile of kelp)
        y += (1 - move) * s * s * 0.12 * (1 - camo) * (1 - died);
        y = Math.max(0.07 + (1 - s) * 0.06, y);
        const fwd = Math.cos(ang) * reach, side2 = Math.sin(ang) * reach;
        // sample ground at the tentacle so it sits on slopes instead of floating
        const rotated = this.heading;
        const wx = this.x + Math.sin(rotated) * (side2 * 0 + fwd * 0);
        m.position.set(side2, y, fwd);
      }
    }

    // tilt to terrain
    world.normalAt(this.x, this.z, this.tmpN);
    const n = this.tmpN;
    const tiltX = Math.atan2(n.z, n.y) * 0.0, tiltZ = 0;
    this.group.position.set(this.x, this.y + 0.02, this.z);
    this.group.rotation.set(0, this.heading, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z));
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    this.group.quaternion.copy(q.multiply(yaw));
    void tiltX; void tiltZ;
  }
}
