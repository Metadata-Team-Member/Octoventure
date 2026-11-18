// =====================================================================
//  Octopus - the player. Model, movement, drying, camouflage.
// =====================================================================
import * as THREE from 'three';
import { toonMat, outlineMat, outline } from '../world/toon.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG, TERRAIN, diff } from '../config.js';
import { clamp, damp, dampAngle, lerp } from '../util/rng.js';
import { FX } from '../systems/items.js';
const BIRD_CAUSES = new Set(['gull', 'eagle', 'magpie', 'kookaburra']);
const INK_TINT = new THREE.Color(0x3a3350), VENOM_TINT = new THREE.Color(0xffd23f), LETHAL_TINT = new THREE.Color(0xa45bff);
// scratch objects for animate() (no per-frame allocation)
const _ground = new THREE.Color(), _camoT = new THREE.Color(), _camoD = new THREE.Color(), _grey = new THREE.Color();
const _mS = new THREE.Matrix4(), _mR = new THREE.Matrix4(), _qI = new THREE.Quaternion();
const RING_L1 = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.97, 0), new THREE.Quaternion(), new THREE.Vector3(0.78, 0.78, 0.78));
const RING_L2 = RING_L1.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.01, 0));
const _qN = new THREE.Quaternion(), _qY = new THREE.Quaternion(), _UP = new THREE.Vector3(0, 1, 0), _nV = new THREE.Vector3();

const TENT = 8, SEG = 12;
// Australian blue-ringed octopus (Hapalochlaena): small, ochre-yellow/brown body with electric-blue rings.
const SKIN = new THREE.Color(0xd9a63f);
const RING_BLUE = new THREE.Color(0x0a52ff);
const PALE = new THREE.Color(0xeaf6ff);
const PALE_EDGE = new THREE.Color(0xb9c6d2);
const RING_FLASH = new THREE.Color(0x1a8cff);
const DEAD = new THREE.Color(0x8c8480);

export class Octopus {
  constructor(world, scene) {
    this.world = world;
    this.group = new THREE.Group();
    this.sz = CONFIG.octopus.size ?? 1;           // real-scale perspective: the octopus is small, the world is big
    this.group.scale.setScalar(this.sz);
    scene.add(this.group);
    this.mat = toonMat({ color: SKIN.clone(), roughness: 0.35, metalness: 0.0, vertexColors: true });
    // iridescent blue rings (emissive so they can glow / flash) with a black outline
    this.ringBlue = toonMat({ color: RING_BLUE.clone(), emissive: RING_BLUE.clone(), emissiveIntensity: 0.5, roughness: 0.12, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.ringBlack = toonMat({ color: 0x07070a, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
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
    const white = toonMat({ color: 0xfff8e8, roughness: 0.3 });
    const black = toonMat({ color: 0x15100e, roughness: 0.2 });
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
    // t248u optimisation: the 96 tentacle segments are ONE instanced mesh (was 96 meshes = 96 draw calls + 96 shadow draws)
    this.tentInst = new THREE.InstancedMesh(sg, mat, TENT * SEG);
    this.tentInst.castShadow = true; this.tentInst.frustumCulled = false;
    this.group.add(this.tentInst);
    this.pollenT = 0; this.pollenCol = new THREE.Color(0xffe066); this._tipOn = false;
    this.tipCol = new THREE.InstancedBufferAttribute(new Float32Array(TENT * SEG * 3).fill(1), 3);
    this.tentInst.instanceColor = this.tipCol;
    for (let i = 0; i < TENT; i++) {
      const segs = [];
      for (let j = 0; j < SEG; j++) {
        const r = lerp(0.24, 0.05, Math.pow(j / (SEG - 1), 0.8));
        segs.push({ position: new THREE.Vector3(), scale: new THREE.Vector3(r, r * 0.85, r) });
      }
      this.tentacles.push({ segs, a: (i / TENT) * Math.PI * 2 + 0.2, phase: i * 0.9 });
    }
    for (const o of [mantle, head]) o.castShadow = true;
    this.buildRings(mantle, head);
    // thin dark outline (inverted hull) on the body, eyes and arms only; it fades out with camouflage
    this.outlineMat = outlineMat(0x2a1a14);
    this.outlines = [...outline(mantle, this.outlineMat), ...outline(head, this.outlineMat), ...this.eyes.flatMap((e) => { e.pupil.userData.noOutline = true; return outline(e.eye, this.outlineMat); }), ...outline(this.tentInst, this.outlineMat)];
    if (!CONFIG.graphics.shadows) {      // phones / ?shadows=0: a soft blob shadow under the octopus instead of the shadow map
      this.blob = new THREE.Mesh(new THREE.CircleGeometry(1.35, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      this.blob.position.y = 0.03; this.blob.renderOrder = 3; this.group.add(this.blob);
    }
    this.updateTentacles();
  }
  /** write the arm segments (and the rings riding on them) into their instanced meshes */
  updateTentacles() {
    let k = 0, r = 0;
    for (let i = 0; i < TENT; i++) {
      const segs = this.tentacles[i].segs;
      for (let j = 0; j < SEG; j++) {
        const m = segs[j];
        _mS.compose(m.position, _qI, m.scale); this.tentInst.setMatrixAt(k++, _mS);
        if (j % 2 === 1 && j < SEG - 1) {
          this.armRingBlack.setMatrixAt(r, _mR.multiplyMatrices(_mS, RING_L1));
          this.armRingBlue.setMatrixAt(r, _mR.multiplyMatrices(_mS, RING_L2)); r++;
        }
      }
    }
    this.tentInst.instanceMatrix.needsUpdate = true; this.armRingBlack.instanceMatrix.needsUpdate = true; this.armRingBlue.instanceMatrix.needsUpdate = true;
    if (this.pollenT > 0) {
      const c = this.pollenCol; let k = 0;
      for (let i = 0; i < TENT; i++) for (let j = 0; j < SEG; j++) {
        const tip = j >= SEG - 3;
        this.tipCol.setXYZ(k++, tip ? c.r : 1, tip ? c.g : 1, tip ? c.b : 1);
      }
      this.tipCol.needsUpdate = true; this._tipOn = true;
    } else if (this._tipOn) {
      for (let i = 0; i < TENT * SEG; i++) this.tipCol.setXYZ(i, 1, 1, 1);
      this.tipCol.needsUpdate = true; this._tipOn = false;
    }
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
    const edge = new THREE.RingGeometry(0.7, 1.0, 20); edge.rotateX(-Math.PI / 2);
    const blue = new THREE.RingGeometry(0.38, 0.78, 20); blue.rotateX(-Math.PI / 2);
    this.ringGeos = [edge, blue];
    const up = new THREE.Vector3(0, 1, 0);
    // t248u optimisation: all body rings are baked into two merged meshes (black edges, blue centres) instead of ~50 meshes
    const blacks = [], blues = [], _g = new THREE.Matrix4(), _q = new THREE.Quaternion(), _sc = new THREE.Vector3();
    const addRing = (parent, pos, normal, size) => {
      _g.compose(pos, _q.setFromUnitVectors(up, normal), _sc.setScalar(size));
      blacks.push(edge.clone().applyMatrix4(_g));
      blues.push(blue.clone().translate(0, 0.004 / Math.max(size, 0.02), 0).applyMatrix4(_g));
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
    const bodyBlack = new THREE.Mesh(mergeGeometries(blacks), this.ringBlack), bodyBlue = new THREE.Mesh(mergeGeometries(blues), this.ringBlue);
    for (const g of [...blacks, ...blues]) g.dispose();
    this.body.add(bodyBlack, bodyBlue);
    // rings along the arms: two instanced meshes that ride on the arm segments (see updateTentacles)
    const n = TENT * Math.floor((SEG - 1) / 2);
    this.armRingBlack = new THREE.InstancedMesh(edge, this.ringBlack, n); this.armRingBlue = new THREE.InstancedMesh(blue, this.ringBlue, n);
    for (const m of [this.armRingBlack, this.armRingBlue]) { m.frustumCulled = false; this.group.add(m); }
  }

  reset(world) {
    this.world = world;
    this.x = world.start.x; this.z = world.start.z;
    this.y = world.heightAt(this.x, this.z);
    this.heading = Math.random() * Math.PI * 2;
    this.health = CONFIG.octopus.maxHealth;
    this.energy = CONFIG.camo.maxEnergy;
    this.pollenT = 0;
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
    this.inkCool = 0; this.biteCool = 0; this.nipCool = 0; this.nipT = 0; this.nipHard = 0; this.lethalDose = false; this.biteReady = 1; this.hiddenIn = null; this.hideBlend = 0;
    this.tunnel = null; this.climb = null; this.pushT = 0; this.carried = null; this.swim = 0; this.dive = 0; this.invuln = 0;
    this.shake = 0; this.thump = 0; this.group.visible = true; this.pendingBabyGlow = 0;
    this.armor = 0;                // hidden: fraction of damage absorbed (set by the game from collected shells)
    // satchel effects (t236u): seconds left of each buff, plus smoothed 0..1 blends for the visuals
    this.buff = { shield: 0, jar: 0, kelp: 0, mimic: 0, feast: 0, tonic: 0 };
    this.shieldClosed = 0; this.jarF = 0; this.kelpF = 0; this.mimicF = 0; this.feastF = 0; this.restF = 0; this.restT = 0; this.restEvent = false;
    this.inkCharges = 0; this.venomReady = false; this.moveMult = 1;
  }

  greyOf(c, out = new THREE.Color()) { const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; return out.setRGB(l * 0.95 + 0.06, l * 0.95 + 0.06, l * 0.95 + 0.06); }
  get camoActive() { return this.camoBlend > 0.85; }     // fully blended
  /** hidden: predators can't hurt or track you. Immediate while the key is held (and energy lasts), brief grace while fading out. */
  get camoProtected() { return this.alive && (this.camoWanted || this.camoBlend > 0.5 || !!this.tunnel || this.invuln > 0 || this.shieldClosed > 0.75); }
  /** how easily predators spot us (1 = normal): tucked inside a shell / tin / under a rock hides us even without camo */
  get visibility() { return (1 - this.hideBlend * (1 - CONFIG.abilities.hideNoticeMult)) * (1 - 0.7 * this.shieldClosed) * (this.buff.mimic > 0 ? FX.mimicNotice : 1); }
  /** the glass jar hides you from birds only (it is see-through to everything else) */
  get birdHidden() { return this.alive && this.buff.jar > 0 && this.jarF > 0.6; }
  /** drying multiplier from the satchel: kelp wrap on land, resting in a den, a closed shell */
  get dryScale() { return (this.perkDry ?? 1) * (this.buff.kelp > 0 ? FX.kelpDry : 1) * (this.restF > 0.5 ? FX.denDry : 1) * (this.shieldClosed > 0.75 ? 0.85 : 1); }
  get inWater() { return !!this.waterKind; }
  get hiding() { return this.camoWanted && this.alive; }

  /** opts.ignoreCamo: cars are the one hazard that doesn't care that we're camouflaged (they can't "see" us anyway) */
  damage(amount, cause, opts = {}) {
    if (!this.alive || this.won) return;
    if (this.camoProtected && !opts.ignoreCamo) return;            // camouflaged = untouchable
    if (this.birdHidden && BIRD_CAUSES.has(cause) && !opts.ignoreCamo) return;   // inside the jar: birds can't get at you
    if (this.tunnel && !opts.ignoreCamo) return;
    this.shake = Math.min(1, this.shake + amount / 28);
    this.health = Math.max(0, this.health - amount * CONFIG.predators.damageMult * diff().damage * (1 - this.armor));
    this.lastDamage = cause;
    this.hurtFlash = 1;
  }

  /** input: {mx, mz (world-space move vector, length<=1), sprint, camo} */
  update(dt, input, world) {
    const O = CONFIG.octopus, C = CONFIG.camo;
    this.terrain = world.typeAt(this.x, this.z);
    const T = TERRAIN[this.terrain];
    let water = this.alive && !this.won ? world.waterAt(this.x, this.z) : null;
    if (!water && this.alive && !this.won && world.isShallow(this.x, this.z)) water = { kind: 'sea' };
    this.waterKind = water ? water.kind : null;

    for (const k in this.buff) this.buff[k] = Math.max(0, this.buff[k] - dt);
    this.inkCool = Math.max(0, this.inkCool - dt); this.biteCool = Math.max(0, this.biteCool - dt); this.nipCool = Math.max(0, this.nipCool - dt); this.invuln = Math.max(0, this.invuln - dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.thump = Math.max(0, (this.thump || 0) - dt * 5);
    if (this.alive && !this.won && (this.tunnel || this.climb || this.carried)) {
      this.updateSpecial(dt, input, world, water);
    } else if (this.alive && !this.won) {
      // ---- camouflage energy -------------------------------------------------
      if (this.camoLocked && this.energy >= C.minToStart) this.camoLocked = false;
      const wantCamo = input.camo && !this.camoLocked && this.energy > 0.5;
      this.camoWanted = wantCamo;
      if (wantCamo) {
        // tucked into a shell, tin or log, camouflage costs nothing
        if (!this.hiddenIn) this.energy = Math.max(0, this.energy - C.drainPerSec * diff().camoDrain * (this.buff.mimic > 0 ? FX.mimicDrain : 1) * (this.buff.tonic > 0 ? FX.tonicDrain : 1) * (this.perkCamo ?? 1) * dt);
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
      const base = this.sz * (sprint ? O.sprintSpeed : O.walkSpeed) * (water ? O.waterSpeedMult * (this.swim > 0.3 ? CONFIG.abilities.swimSpeedMult : 1) : T.speed) * (this.camoWanted ? C.moveSpeedMult : 1) * (this.hiddenIn ? 0.6 : 1);
      this.moveMult = (this.buff.jar > 0 ? 0.45 : 1) * (this.buff.shield > 0 && this.shieldClosed < 0.5 ? 0.88 : 1);
      const targetSpeed = canMove ? Math.min(1, mag) * base * this.moveMult : 0;
      this.speed = damp(this.speed, targetSpeed, 12, dt);
      this.moving = this.speed > 0.5 * this.sz;
      this.sprinting = sprint && this.moving;
      if (mag > 0.1 && canMove) this.heading = dampAngle(this.heading, Math.atan2(mx, mz), O.turnRate, dt);
      const dist = this.speed * dt;
      if (dist > 0) {
        const dx = Math.sin(this.heading) * dist, dz = Math.cos(this.heading) * dist;
        let nx = this.x + dx, nz = this.z + dz;
        const r = world.resolve(nx, nz, 0.7 * this.sz);
        nx = r.x; nz = r.z;
        // pushing into a fence / wall / bale: climb over it (instantly with the climb key, otherwise after a short push)
        if (r.hit && r.col?.climb && mag > 0.1) {
          this.pushT += dt;
          if (input.climbKey || this.pushT > CONFIG.abilities.climbPush) this.startClimb(r.col, world);
        } else this.pushT = 0;
        this.distance += Math.hypot(nx - this.x, nz - this.z);
        this.x = nx; this.z = nz;
      }

      this.updateHideAndTunnels(dt, mag, world);
      this.updateSatchelState(dt, mag);
      // ---- drying / water -----------------------------------------------------------
      if (water) {
        const gain = CONFIG.water[water.kind] ?? 20;
        this.health = Math.min(O.maxHealth, this.health + gain * dt);
        this.wetness = Math.min(1, this.wetness + dt * 1.5);
      } else if (world.raining && !this.tunnel && !this.hiddenIn) {
        // a rain shower (t241u): out in the open the octopus soaks it up instead of drying
        this.health = Math.min(O.maxHealth, this.health + (CONFIG.env.rainGain ?? 2.5) * (world.gates?.wet ?? 0.5) * dt);
        this.wetness = Math.min(1, this.wetness + dt * 0.4);
      } else {
        let rate = O.baseDryRate * T.dry * (world.dryMult ?? 1) * (1 + 0.9 * (world.harshAt?.(this.x, this.z) ?? 0)) * diff().dry;   // far inland the air is drier
        rate *= this.dryScale;
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

    this.updateVertical(dt, input, world);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    if (!this.alive) this.deadT += dt;
    this.animate(dt);
  }

  // ------------------------------------------------------------ satchel effects (t236u)
  /** blends for the visuals + resting inside a den (still for a couple of seconds: slow recovery, little drying) */
  updateSatchelState(dt, mag) {
    const still = mag < 0.1 && this.speed < 0.6 * this.sz;
    this.shieldClosed = damp(this.shieldClosed, this.buff.shield > 0 && still && !this.carried ? 1 : 0, 5, dt);
    this.jarF = damp(this.jarF, this.buff.jar > 0 ? 1 : 0, 6, dt);
    this.kelpF = damp(this.kelpF, this.buff.kelp > 0 ? 1 : 0, 2.5, dt);
    this.mimicF = damp(this.mimicF, this.buff.mimic > 0 ? 1 : 0, 2.5, dt);
    this.feastF = damp(this.feastF, this.buff.feast > 0 ? 1 : 0, 2.5, dt);
    const inDen = this.hiddenIn?.kind === 'den' && still && !this.waterKind;
    this.restT = inDen ? this.restT + dt : 0;
    const resting = inDen && this.restT > 2;
    this.restF = damp(this.restF, resting ? 1 : 0, 3, dt);
    if (resting) {
      this.health = Math.min(CONFIG.octopus.maxHealth, this.health + FX.denRest * dt);
      this._restSave = (this._restSave ?? 0) - dt;
      if (this._restSave <= 0) { this._restSave = 10; this.restEvent = true; }      // the game saves here (the den is a save point)
    } else this._restSave = 0;
  }

  // ------------------------------------------------------------ abilities
  /** hiding places (tins, shells, logs, under slabs) and tunnel mouths (pipes, culverts, fence holes, drains) */
  updateHideAndTunnels(dt, mag, world) {
    // hide: walk into the middle of a hiding place; leave by walking out
    if (this.hiddenIn) {
      const h = this.hiddenIn;
      if (Math.hypot(this.x - h.x, this.z - h.z) > h.r + 0.5 * this.sz) this.hiddenIn = null;
    } else {
      for (const h of world.hides) {
        const dx = h.x - this.x, dz = h.z - this.z;
        if (Math.abs(dx) < 1 && Math.abs(dz) < 1 && dx * dx + dz * dz < (0.75 * this.sz * 1.4) ** 2) { this.hiddenIn = h; this.hideEvent = h; break; }
      }
    }
    this.hideBlend = damp(this.hideBlend, this.hiddenIn ? 1 : 0, 7, dt);
    // tunnels: walking into a mouth squeezes through to the other end
    if (!this.tunnel && mag > 0.1) {
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      for (const t of world.tunnels) {
        for (let e = 0; e < 2; e++) {
          const m = e ? t.b : t.a, o = e ? t.a : t.b;
          const dx = m.x - this.x, dz = m.z - this.z;
          if (dx * dx + dz * dz > (1.5 * this.sz * 1.3) ** 2) continue;
          const ex = o.x - m.x, ez = o.z - m.z, el = Math.hypot(ex, ez) || 1;
          if ((fx * ex + fz * ez) / el < -0.2) continue;             // must be heading into the mouth, not away from it
          this.tunnel = { t, from: m, to: o, k: 0, len: el, wet: t.wet };
          this.tunnelEvent = t; this.hiddenIn = null;
          return;
        }
      }
    }
  }
  startClimb(col, world) {
    const dx = Math.sin(this.heading), dz = Math.cos(this.heading);
    let ex = this.x, ez = this.z, ok = false;
    for (let d = 0.6 * this.sz; d < 14; d += 0.5 * this.sz) {
      const x = this.x + dx * d, z = this.z + dz * d;
      let inside;
      if (col.r !== undefined) inside = Math.hypot(x - col.x, z - col.z) < col.r + 0.1;
      else inside = Math.abs(x - col.x) < col.hw + 0.1 && Math.abs(z - col.z) < col.hd + 0.1;
      if (!inside) { ex = x + dx * 0.9 * this.sz; ez = z + dz * 0.9 * this.sz; ok = true; break; }
    }
    if (!ok) { this.pushT = 0; return; }
    const r = world.resolve(ex, ez, 0.7 * this.sz);
    if (r.hit) { this.pushT = -0.8; return; }                   // something solid on the far side: not a way across
    const h = col.h || 1.2;
    this.climb = { from: { x: this.x, z: this.z }, to: { x: ex, z: ez }, k: 0, dur: 0.8 + h * 0.35, h };
    this.climbEvent = col; this.pushT = 0;
  }
  updateSpecial(dt, input, world, water) {
    const A = CONFIG.abilities;
    this.speed = damp(this.speed, 0, 10, dt);
    if (this.carried) {
      const c = this.carried, by = c.by;
      c.t += dt;
      this.x = by.x + Math.sin(by.heading) * 0.7 * (by.scale || 1); this.z = by.z + Math.cos(by.heading) * 0.7 * (by.scale || 1);
      this.carryY = by.y + 2.5 * (by.scale || 1);
      this.health = Math.max(0, this.health - (A.carryDamage / A.carryTime) * diff().damage * (1 - this.armor) * dt);
      this.lastDamage = 'human';
      this.hurtFlash = Math.max(this.hurtFlash, 0.4);
      this.camoWanted = !!input.camo && this.energy > 0.5;
      if (c.t >= A.carryTime || this.camoWanted || by.dead) {
        // dropped a few metres away
        const a = Math.random() * 6.28;
        const r = world.resolve(this.x + Math.cos(a) * 7, this.z + Math.sin(a) * 7, 0.7 * this.sz);
        this.x = r.x; this.z = r.z; this.carried = null; this.invuln = 1.6; this.carryY = null; this.shake = 0.6;
        if (by.release) by.release();
      }
    } else if (this.tunnel) {
      const T = this.tunnel;
      T.k += (A.tunnelSpeed * (T.wet ? 1.2 : 1) * dt) / Math.max(1, T.len);
      const k = Math.min(1, T.k);
      this.x = lerp(T.from.x, T.to.x, k); this.z = lerp(T.from.z, T.to.z, k);
      this.heading = dampAngle(this.heading, Math.atan2(T.to.x - T.from.x, T.to.z - T.from.z), 14, dt);
      if (T.wet) this.health = Math.min(CONFIG.octopus.maxHealth, this.health + A.tunnelWetGain * dt);
      else this.health = Math.max(0, this.health - CONFIG.octopus.baseDryRate * 0.5 * dt);
      this.wetness = T.wet ? 1 : this.wetness;
      if (T.k >= 1) {
        this.tunnel = null; this.invuln = 0.6;
        const dx = T.to.x - T.from.x, dz = T.to.z - T.from.z, l = Math.hypot(dx, dz) || 1;
        this.x = T.to.x + dx / l * 1.4 * this.sz; this.z = T.to.z + dz / l * 1.4 * this.sz;
      }
    } else if (this.climb) {
      const C = this.climb;
      C.k += dt / C.dur;
      const k = Math.min(1, C.k), e = k * k * (3 - 2 * k);
      this.x = lerp(C.from.x, C.to.x, e); this.z = lerp(C.from.z, C.to.z, e);
      this.climbLift = Math.sin(Math.PI * k) * (C.h + 0.7 * this.sz);
      if (C.k >= 1) { this.climb = null; this.climbLift = 0; }
    }
    // dry out slowly while being handled / climbing (tunnels handled above)
    if (!this.tunnel && !this.carried) this.health = Math.max(0, this.health - CONFIG.octopus.baseDryRate * (world.dryMult ?? 1) * (1 + 0.9 * (world.harshAt?.(this.x, this.z) ?? 0)) * diff().dry * dt);
    if (this.health <= 0) { this.alive = false; this.camoWanted = false; this.tunnel = null; this.climb = null; this.carried = null; this.speed = 0; }
    this.camoBlend = clamp(this.camoBlend + (this.camoWanted ? dt / CONFIG.camo.fadeTime : -dt / (CONFIG.camo.fadeTime * 0.6)), 0, 1);
    this.moving = false; this.sprinting = false;
  }
  /** height: ground, or free swimming (depth follows the camera pitch) in deep sea water; lifted while climbing / carried */
  updateVertical(dt, input, world) {
    const floor = world.heightAt(this.x, this.z);
    const depth = world.seaLevel - floor;
    const sea = this.alive && world.isSea(this.x, this.z) && depth > 0.9;
    this.swim = damp(this.swim, sea ? 1 : 0, 6, dt);
    let target = floor;
    if (sea) {
      const dive = clamp(((input.pitch ?? 0.42) - 0.4) / 0.6, 0, 1);
      const surfaceY = world.seaLevel - 0.35 * this.sz;
      const deepY = Math.max(floor + 0.35 * this.sz, world.seaLevel - Math.min(depth - 0.3, 6));
      this.dive = damp(this.dive, dive, 3, dt);
      target = lerp(surfaceY, deepY, this.dive);
    } else this.dive = damp(this.dive, 0, 5, dt);
    if (this.carryY != null && this.carried) target = this.carryY;
    this.y = this.swim > 0.02 || this.carried ? damp(this.y, target, this.carried ? 20 : 5, dt) : target;
    if (this.climb) this.y = floor + (this.climbLift || 0);
    if (this.tunnel) this.y = floor - 0.2;
  }

  animate(dt) {
    const world = this.world;
    this.walkPhase += dt * (this.speed / this.sz * 1.1 + (this.alive ? 1.2 : 0));
    const t = this.walkPhase;
    const move = clamp(this.speed / (7 * this.sz), 0, 1.4);
    const dry = 1 - clamp(this.health / CONFIG.octopus.maxHealth, 0, 1);
    const camo = Math.max(this.camoBlend, 0.5 * this.mimicF);
    const tuck = Math.max(this.shieldClosed, this.jarF);
    const died = this.alive ? 0 : clamp(this.deadT / 1.2, 0, 1);

    // colour: skin -> dry & pale -> grey when dead; camo blends toward the ground colour
    const ground = _ground.set(TERRAIN[this.terrain].color);
    this.camoColor.lerp(ground, 1 - Math.exp(-6 * dt));
    const col = this.mat.color;
    // colour drains toward grey as health falls: full colour at 100, grey near 0
    col.copy(SKIN).lerp(this.greyOf(SKIN, _grey), dry * 0.95).lerp(DEAD, died);
    // camouflage: blend toward ground colour (a touch darker, like a shadow-pattern)
    const camoTarget = _camoT.copy(this.camoColor).multiplyScalar(0.92);
    col.lerp(camoTarget, camo * 0.96);
    if (this.inkCharges > 0) col.lerp(INK_TINT, 0.18 * Math.min(1, this.inkCharges / 2));   // a full ink sac shows through the skin
    this.mat.roughness = lerp(0.3, 0.85, Math.max(dry * 0.8, camo));

    // ---- blue rings: calm glow -> flashing warning display when threatened -> hidden when camouflaged ----
    this.flashT += dt * (6 + this.alarm * 10);
    const pulse = 0.5 + 0.5 * Math.sin(this.flashT * 2.2);
    const shimmer = 0.5 + 0.5 * Math.sin(this.walkPhase * 1.7 + 1.0);       // slow iridescent drift
    const alarm = this.alive ? this.alarm : 0;
    const vis = (1 - camo) * (1 - died);
    const ringColor = this.ringBlue.color;
    ringColor.copy(RING_BLUE).lerp(RING_FLASH, Math.max(shimmer * 0.25, alarm * pulse * 0.8)).lerp(this.greyOf(RING_BLUE, _grey), dry * 0.85);
    this.ringBlue.emissive.copy(ringColor);
    this.ringBlue.emissiveIntensity = (0.2 + 0.08 * shimmer + alarm * (0.05 + 0.5 * pulse)) * vis + 0.02;
    // when camouflaged the rings fade into the ground colour
    ringColor.lerp(camoTarget, camo * 0.9);
    this.ringBlue.emissive.lerp(camoTarget, camo * 0.9);
    this.ringBlack.color.set(0x07070a).lerp(_camoD.copy(camoTarget).multiplyScalar(0.7), camo * 0.9);
    // camouflage energy cue: while hidden the (dark) rings get lighter and lighter as the camo runs out
    const warn = camo * Math.pow(1 - clamp(this.energy / CONFIG.camo.maxEnergy, 0, 1), 1.15);
    ringColor.lerp(PALE, warn);
    this.ringBlue.emissive.lerp(PALE, warn);
    this.ringBlue.emissiveIntensity += warn * 0.9;
    // the venom bite is ready (and something is after us): the rings pulse; a flash when it comes back; a bright bloom when a baby is found
    const ready = this.biteCool <= 0 && this.alive;
    if (ready && this.wasCooling) this.readyFlash = 1;
    this.wasCooling = this.biteCool > 0;
    this.readyFlash = Math.max(0, (this.readyFlash || 0) - dt * 1.2); this.biteFlash = Math.max(0, (this.biteFlash || 0) - dt * 2.5); this.glowBoost = Math.max(0, (this.glowBoost || 0) - dt * 0.35);
    const readyPulse = ready && this.alarm > 0.25 ? 0.55 * (0.5 + 0.5 * Math.sin(this.flashT * 3.4)) * (1 - camo) : 0;
    if (this.lethalDose) { const k = 0.55 * (0.6 + 0.4 * Math.sin(this.flashT * 2.7)); ringColor.lerp(LETHAL_TINT, k); this.ringBlue.emissive.lerp(LETHAL_TINT, k); }   // t250u: a violet flicker = a lethal dose is ready
    if (this.venomReady) { ringColor.lerp(VENOM_TINT, 0.6 * (0.7 + 0.3 * Math.sin(this.flashT * 1.6))); this.ringBlue.emissive.lerp(VENOM_TINT, 0.6); }
    this.ringBlue.emissiveIntensity += this.feastF * (0.75 + 0.25 * Math.sin(this.flashT * 1.3)) * vis;
    this.ringBlue.emissiveIntensity += (readyPulse + this.readyFlash * 0.8 + this.biteFlash * 1.2 + this.glowBoost * 1.4) * (1 - died);
    this.ringBlack.color.lerp(PALE_EDGE, warn);
    this.ringBlue.color.multiplyScalar(0.45).lerp(DEAD, died * 0.8);
    this.mat.transparent = false;

    // body pose
    const squash = 1 - dry * 0.18 - died * 0.45 - camo * 0.22 + Math.sin(t * 1.2) * 0.02 * (1 - died);
    this.body.scale.set(1 + camo * 0.12 + died * 0.2, squash, 1 + camo * 0.12 + died * 0.2);
    this.body.position.y = 0.0 - died * 0.05 + Math.abs(Math.sin(t * 2.2)) * 0.04 * move;
    this.body.rotation.z = Math.sin(t * 1.1) * 0.03 * move;
    // t250u bite lunge: the mantle darts forward and dips (harder for the venomous bite), then settles back
    this.nipT = Math.max(0, this.nipT - dt * 4);
    const lunge = Math.sin(this.nipT * Math.PI) * (1 + this.nipHard);
    this.body.position.z = lunge * 0.12; this.body.rotation.x = lunge * 0.22;
    for (const e of this.eyes) {
      e.eye.scale.setScalar(this.alive ? (camo > 0.5 ? 0.75 : 1) : 0.6);
      e.pupil.scale.y = this.alive ? 1 : 0.2;
    }

    // tentacles
    for (let i = 0; i < TENT; i++) {
      const T = this.tentacles[i];
      for (let j = 0; j < SEG; j++) {
        const s = j / (SEG - 1);
        const m = T.segs[j];
        let reach = (0.36 + s * (1.12 - died * 0.6 - camo * 0.22)) * (1 - 0.5 * tuck);
        let ang = T.a + Math.sin(t * 2.0 + T.phase - s * 3) * 0.16 * (0.3 + move) + (1 - died) * 0 + died * s * 0.5;
        const stride = Math.sin(t * 2.4 + T.phase + i * 0.3 - s * 1.5);
        let lift = move * 0.34 * Math.max(0, stride) * Math.sin(Math.PI * Math.min(1, s * 1.3));
        const curl = (this.alive ? 0.1 : 0.0) + (1 - move) * 0.12 * Math.sin(t * 0.8 + T.phase) * s;
        let y = 0.17 - s * 0.1 + lift + curl * 0.5 + (camo > 0.1 ? 0 : 0);
        // tips curl up when idle, flatten out when camouflaged (looks like a pile of kelp)
        y += (1 - move) * s * s * 0.12 * (1 - camo) * (1 - died);
        y = Math.max(0.07 + (1 - s) * 0.06, y);
        const fwd = Math.cos(ang) * reach, side2 = Math.sin(ang) * reach;
        m.position.set(side2, y, fwd);
      }
    }
    if (this.pollenT > 0) this.pollenT = Math.max(0, this.pollenT - dt);
    this.updateTentacles();
    // outlines fade with camouflage (an outline would give the hiding octopus away)
    const showLine = camo < 0.45 && this.hideBlend < 0.5;
    for (const h of this.outlines) h.visible = showLine;

    // tucked away: shrink down into the shell / tin / under the rock; invisible inside a pipe
    const hb = this.hideBlend;
    this.group.visible = !this.tunnel;
    this.body.scale.multiplyScalar(1 - 0.35 * hb);
    this.body.position.y -= 0.12 * hb;
    // tilt to terrain
    world.normalAt(this.x, this.z, this.tmpN);
    if (this.swim > 0.3 || this.carried) { this.tmpN.x = 0; this.tmpN.y = 1; this.tmpN.z = 0; }
    const n = this.tmpN;
    const tiltX = Math.atan2(n.z, n.y) * 0.0, tiltZ = 0;
    this.group.position.set(this.x, this.y + 0.02, this.z);
    this.group.rotation.set(0, this.heading, 0);
    const q = _qN.setFromUnitVectors(_UP, _nV.set(n.x, n.y, n.z));
    const yaw = _qY.setFromAxisAngle(_UP, this.heading);
    this.group.quaternion.copy(q.multiply(yaw));
    void tiltX; void tiltZ;
  }
}
