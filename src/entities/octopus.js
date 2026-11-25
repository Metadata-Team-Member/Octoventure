// =====================================================================
//  Octopus - the player. Model, movement, drying, camouflage.
//  The body is the blue-ringed glb (real size, world scale 1). this.sz stays
//  0.42 for movement, camera and collision; the mesh is counter-scaled inside
//  the group so the real-scale test still sees group.scale === sz.
// =====================================================================
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { toonMat, outlineMat } from '../world/toon.js';
import { CONFIG, TERRAIN, diff } from '../config.js';
import { clamp, damp, dampAngle, lerp } from '../util/rng.js';
import { FX } from '../systems/items.js';
import { installOctopusFromUrl, octopusTemplate, OCTO_HEX } from '../world/octopusModel.js';
import octopusUrl from '../assets/models/octopus.glb?url';

await installOctopusFromUrl(octopusUrl);

const BIRD_CAUSES = new Set(['gull', 'eagle', 'magpie', 'kookaburra']);
const INK_TINT = new THREE.Color(0x3a3350), VENOM_TINT = new THREE.Color(0xffd23f), LETHAL_TINT = new THREE.Color(0xa45bff);
// scratch objects for animate() (no per-frame allocation)
const _ground = new THREE.Color(), _camoT = new THREE.Color(), _camoD = new THREE.Color(), _grey = new THREE.Color();
const _qN = new THREE.Quaternion(), _qY = new THREE.Quaternion(), _UP = new THREE.Vector3(0, 1, 0), _nV = new THREE.Vector3(), _tipV = new THREE.Vector3();

const ARMS = 8;
const SKIN = new THREE.Color(OCTO_HEX.body);
const BELLY = new THREE.Color(OCTO_HEX.belly);
const RING_BLUE = new THREE.Color(OCTO_HEX.rings);
const RING_EDGE = new THREE.Color(OCTO_HEX.ringEdge);
const PALE = new THREE.Color(0xeaf6ff);
const PALE_EDGE = new THREE.Color(0xb9c6d2);
const RING_FLASH = new THREE.Color(0x1a8cff);
const DEAD = new THREE.Color(0x8c8480);
const LOCO = new Set(['idle', 'walk', 'swim', 'swimIdle']);
const ONCE = new Set(['bite', 'venomBite', 'ink', 'scoop', 'celebrate', 'threat']);
const SCOOP_DUR = 0.5;
const FADE = 0.2;

/** inverted-hull outline that skins with the mesh (a plain Mesh child stays in the bind pose) */
function skinnedHull(mesh, mat) {
  const h = new THREE.SkinnedMesh(mesh.geometry, mat);
  h.bindMode = mesh.bindMode;
  h.bind(mesh.skeleton, mesh.bindMatrix);
  h.position.copy(mesh.position);
  h.quaternion.copy(mesh.quaternion);
  h.scale.copy(mesh.scale);
  h.frustumCulled = false;
  h.castShadow = false;
  h.receiveShadow = false;
  h.userData.isOutline = true;
  h.renderOrder = (mesh.renderOrder || 0) + 1;
  mesh.parent.add(h);
  return h;
}

export class Octopus {
  constructor(world, scene) {
    this.world = world;
    this.group = new THREE.Group();
    this.sz = CONFIG.octopus.size ?? 1;           // real-scale perspective: the octopus is small, the world is big
    this.group.scale.setScalar(this.sz);
    scene.add(this.group);
    const tpl = octopusTemplate();
    this.mat = tpl.mats.body;
    this.bellyMat = tpl.mats.belly;
    this.ringBlue = tpl.mats.rings;
    this.ringBlack = tpl.mats.ringEdge;
    this.ringBlue.emissive = RING_BLUE.clone();
    this.ringBlue.emissiveIntensity = 0.35;
    this.ringBlack.emissive = RING_EDGE.clone();
    this.ringBlack.emissiveIntensity = 0.2;
    this.alarm = 0;          // 0..1, set by the game when a predator has noticed us (rings flash)
    this.flashT = 0;
    this.build(tpl);
    this.reset(world);
  }

  build(tpl) {
    this.body = new THREE.Group();
    this.group.add(this.body);
    // group stays at sz (0.42) for the real-scale test. The glb is already 20 cm,
    // so a child undoes that scale and the world visual scale is 1. animate()
    // rewrites body.scale every frame for hide / death — the counter-scale must
    // not live there or it gets wiped.
    this.meshRoot = new THREE.Group();
    this.meshRoot.scale.setScalar(1 / this.sz);
    this.body.add(this.meshRoot);
    const model = SkeletonUtils.clone(tpl.scene);
    this.meshRoot.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of tpl.clips) {
      const a = this.mixer.clipAction(clip);
      if (LOCO.has(clip.name)) a.setLoop(THREE.LoopRepeat, Infinity);
      else if (ONCE.has(clip.name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[clip.name] = a;
    }
    this.loco = null;
    this.once = null;
    this.clip = 'idle';
    this._threatPlayed = false;
    this.mixer.addEventListener('finished', (e) => this._onClipFinished(e));
    const skinned = [];
    model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    for (const m of skinned) if (m.material === this.mat) m.castShadow = !!CONFIG.graphics.shadows;
    this.outlineMat = outlineMat(0x2a1a14);
    this.outlines = skinned.map((m) => skinnedHull(m, this.outlineMat));
    this.arm0Tip = model.getObjectByName('arm0_tip');
    this.armA = Array.from({ length: ARMS }, (_, i) => (i / ARMS) * Math.PI * 2);
    this.scoops = [
      { on: false, arm: 0, t: 0, dur: SCOOP_DUR, x: 0, y: 0, z: 0 },
      { on: false, arm: 4, t: 0, dur: SCOOP_DUR, x: 0, y: 0, z: 0 },
    ];
    const pollenGeo = new THREE.SphereGeometry(0.008, 5, 4);
    this.pollenMat = toonMat({ color: 0xffe066 });
    this.pollenDots = [];
    for (let i = 0; i < ARMS; i++) {
      const bone = model.getObjectByName(`arm${i}_tip`);
      if (!bone) continue;
      const dot = new THREE.Mesh(pollenGeo, this.pollenMat);
      dot.visible = false; dot.castShadow = false; dot.userData.noOutline = true; dot.frustumCulled = false;
      bone.add(dot); this.pollenDots.push(dot);
    }
    this.pollenT = 0; this.pollenCol = new THREE.Color(0xffe066); this._tipOn = false;
    if (!CONFIG.graphics.shadows) {      // phones / ?shadows=0: a soft blob shadow under the octopus instead of the shadow map
      this.blob = new THREE.Mesh(new THREE.CircleGeometry(1.05, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      this.blob.position.y = 0.04; this.blob.renderOrder = 3; this.group.add(this.blob);
    }
    this.playLoco('idle');
    this.mixer.update(0);
  }

  /** front-arm tip in the glb's own space (world scale 1), so a walk does not count as a scoop */
  tipSample() {
    const b = this.arm0Tip; if (!b) return { x: 0, y: 0, z: 0 };
    this.group.updateMatrixWorld(true);
    _tipV.setFromMatrixPosition(b.matrixWorld);
    this.meshRoot.worldToLocal(_tipV);
    return { x: _tipV.x, y: _tipV.y, z: _tipV.z };
  }

  playLoco(name) {
    if (this.once || !this.actions[name] || this.loco === name) { this.clip = this.once || this.loco || name; return; }
    const next = this.actions[name], prev = this.loco ? this.actions[this.loco] : null;
    next.enabled = true; next.reset().fadeIn(FADE).play();
    if (prev && prev !== next) prev.fadeOut(FADE);
    this.loco = name; this.clip = name;
  }

  /** one-shot, then the locomotion clip returns. Restarting the same one does not stack fades. */
  playOnce(name) {
    const next = this.actions[name]; if (!next) return;
    if (this.once === name) { next.reset().play(); this.clip = name; return; }
    const prev = this.once ? this.actions[this.once] : (this.loco ? this.actions[this.loco] : null);
    next.enabled = true; next.reset(); next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true;
    next.fadeIn(0.12).play();
    if (prev && prev !== next) prev.fadeOut(0.12);
    this.once = name; this.clip = name;
  }

  _onClipFinished(e) {
    if (!this.once || e.action !== this.actions[this.once]) return;
    const prev = e.action;
    this.once = null;
    const name = this.pickLoco();
    const next = this.actions[name];
    if (next) { next.enabled = true; next.reset().fadeIn(FADE).play(); }
    prev.fadeOut(FADE);
    this.loco = name; this.clip = name;
  }

  pickLoco() {
    if (!this.alive) return 'idle';
    if (this.swim > 0.3) return this.moving ? 'swim' : 'swimIdle';
    return this.moving ? 'walk' : 'idle';
  }

  reset(world) {
    this.world = world;
    this.x = world.start.x; this.z = world.start.z;
    this.y = world.heightAt(this.x, this.z);
    this.heading = Math.random() * Math.PI * 2;
    this.health = CONFIG.octopus.maxHealth;
    this.energy = CONFIG.camo.maxEnergy;
    this.pollenT = 0;
    if (this.scoops) { this.scoops[0].on = false; this.scoops[1].on = false; }
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

  /**
   * One nearby arm reaches for a pickup (~0.5 s, the scoop clip; arm0 is the front arm in the glb).
   * Two scoops can overlap. The walk is not frozen.
   */
  scoopToward(x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const dx = x - this.x, dz = z - this.z;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const ang = Math.atan2(dx * c - dz * s, dx * s + dz * c);
    const a0 = this.scoops[0], a1 = this.scoops[1];
    let best = 0, bd = 99, free = -1, fd = 99;
    for (let i = 0; i < ARMS; i++) {
      const da = Math.atan2(Math.sin(this.armA[i] - ang), Math.cos(this.armA[i] - ang));
      const ad = da < 0 ? -da : da;
      if (ad < bd) { bd = ad; best = i; }
      const busy = (a0.on && a0.arm === i) || (a1.on && a1.arm === i);
      if (!busy && ad < fd) { fd = ad; free = i; }
    }
    const arm = free >= 0 ? free : best;
    let slot = null;
    if (a0.on && a0.arm === arm) slot = a0;
    else if (a1.on && a1.arm === arm) slot = a1;
    else if (!a0.on) slot = a0;
    else if (!a1.on) slot = a1;
    else slot = a0.t >= a1.t ? a0 : a1;
    slot.on = true; slot.arm = arm; slot.t = 0; slot.dur = SCOOP_DUR;
    slot.x = x; slot.y = Number.isFinite(y) ? y : this.y; slot.z = z;
    this.playOnce('scoop');
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
    if (!sea && this.swim < 0.01) this.swim = 0;   // the ease never reaches 0 by itself, and `!o.swim` gates squelch, flowers and scent
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
    const dry = 1 - clamp(this.health / CONFIG.octopus.maxHealth, 0, 1);
    const camo = Math.max(this.camoBlend, 0.5 * this.mimicF);
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
    // the cream underside takes the same tint, from its own authored colour
    const belly = this.bellyMat.color;
    belly.copy(BELLY).lerp(this.greyOf(BELLY, _grey), dry * 0.95).lerp(DEAD, died);
    belly.lerp(camoTarget, camo * 0.96);
    if (this.inkCharges > 0) belly.lerp(INK_TINT, 0.18 * Math.min(1, this.inkCharges / 2));
    this.bellyMat.roughness = this.mat.roughness;

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
    this.ringBlue.color.multiplyScalar(0.45).lerp(DEAD, died * 0.8);
    this.mat.transparent = false;
    // the navy rim flashes with the rings and fades when camouflaged; the centres, eyes, beak, suckers and catchlights stay put
    this.ringBlack.color.copy(RING_EDGE).lerp(_camoD.copy(camoTarget).multiplyScalar(0.55), camo * 0.9).lerp(PALE_EDGE, warn * 0.65);
    this.ringBlack.emissive.copy(this.ringBlue.emissive);
    this.ringBlack.emissiveIntensity = this.ringBlue.emissiveIntensity;

    // the clips own the squash and the lunge. body.scale is only the tuck into a shell, and a slump when dead.
    this.nipT = Math.max(0, this.nipT - dt * 4);
    const hb = this.hideBlend;
    const shrink = 1 - 0.35 * hb;
    this.body.scale.set(shrink, shrink * (1 - died * 0.4), shrink);
    this.body.position.set(0, -0.04 * hb, 0);
    this.body.rotation.set(0, 0, 0);

    // the predator threat display: one pose, then back to whatever the octopus was doing
    if (alarm > 0.6 && !this._threatPlayed && !this.once) { this._threatPlayed = true; this.playOnce('threat'); }
    if (alarm < 0.15) this._threatPlayed = false;
    this.playLoco(this.pickLoco());
    if (!this.once && this.loco === 'walk') {
      const pace = CONFIG.octopus.walkSpeed * this.sz;
      this.actions.walk.timeScale = clamp(this.speed / Math.max(0.05, pace), 0.4, 1.8);
    } else if (!this.once && this.loco === 'swim') {
      const pace = CONFIG.octopus.walkSpeed * CONFIG.octopus.waterSpeedMult * CONFIG.abilities.swimSpeedMult * this.sz;
      this.actions.swim.timeScale = clamp(this.speed / Math.max(0.05, pace), 0.45, 1.7);
    }

    world.normalAt(this.x, this.z, this.tmpN);
    if (this.swim > 0.3 || this.carried) { this.tmpN.x = 0; this.tmpN.y = 1; this.tmpN.z = 0; }
    const n = this.tmpN;
    this.group.position.set(this.x, this.y, this.z);
    const q = _qN.setFromUnitVectors(_UP, _nV.set(n.x, n.y, n.z));
    const yaw = _qY.setFromAxisAngle(_UP, this.heading);
    this.group.quaternion.copy(q.multiply(yaw));

    const s0 = this.scoops[0], s1 = this.scoops[1];
    if (s0.on) { s0.t += dt; if (s0.t >= s0.dur) s0.on = false; }
    if (s1.on) { s1.t += dt; if (s1.t >= s1.dur) s1.on = false; }
    if (this.pollenT > 0) {
      this.pollenT = Math.max(0, this.pollenT - dt);
      this.pollenMat.color.copy(this.pollenCol);
      const on = this.pollenT > 0;
      for (const d of this.pollenDots) d.visible = on;
      this._tipOn = on;
    } else if (this._tipOn) {
      for (const d of this.pollenDots) d.visible = false;
      this._tipOn = false;
    }
    this.mixer.update(dt);
    // outlines fade with camouflage (an outline would give the hiding octopus away)
    const showLine = camo < 0.45 && this.hideBlend < 0.5;
    for (const h of this.outlines) h.visible = showLine;

    // invisible inside a pipe; the shrink above tucks the whole body into a shell
    this.group.visible = !this.tunnel;
  }
}
