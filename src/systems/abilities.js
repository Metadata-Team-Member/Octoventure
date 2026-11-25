// =====================================================================
//  What the made things do (t236u). Pure effects on the octopus + the little meshes that show them (no HUD, ever):
//    shield     two shell halves hinged on the back: carried while you move, they close around you when you keep still (full protection)
//    den        a shell roof over a ring of pebbles; rest inside to recover slowly. Up to three are kept (also a save point)
//    inksac     a full ink sac darkens the skin; ink can be squirted anywhere, no cooldown, until it is spent
//    wrap       kelp draped over the body; slows drying on land
//    feast      the blue rings glow brighter; health comes back at once
//    gland      amber rings: the next bite reaches further and scares for much longer
//    dose       violet flicker in the rings: the next venomous bite is lethal to any predator (single use)
//    hideaway   you tuck inside a glass jar; birds can't get at you; slow going
//    tonic      urchin + mangrove seed: camouflage energy refilled, then it drains slowly for a while
//    meal       worm + frog spawn: full health and long-glowing rings
//    mimic      sponge + coral on the back, skin half-matched to the ground; cheaper camouflage, harder to notice
//  Nothing is spelled out in the game itself: the pictures in the satchel and what you see on the octopus are the whole interface.
// =====================================================================
import * as THREE from 'three';
import { toonMat } from '../world/toon.js';
import { seat } from '../world/placement.js';
import { USABLE, FX, DYE_COLOR } from './items.js';
import { lerp } from '../util/rng.js';

const _m = new THREE.Matrix4();
const flip = (g) => { const c = g.clone(); c.rotateX(Math.PI); c.computeBoundingBox(); c.translate(0, -c.boundingBox.min.y, 0); return c; };

export class Abilities {
  /** @param game  the Game (for world / octopus / inventory / audio / fx) */
  constructor(game, gatherer) {
    this.game = game; this.gatherer = gatherer;
    const o = game.octopus, geos = gatherer.geos;
    this.group = new THREE.Group(); o.group.add(this.group);
    this.mat = gatherer.mat;
    this.glass = toonMat({ vertexColors: true, roughness: 0.1, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    // ---- shield: top shell (convex up) and bottom shell (convex down), a hinge at the back
    this.shield = new THREE.Group(); this.shield.visible = false; this.group.add(this.shield);
    this.shTop = new THREE.Group(); this.shBot = new THREE.Group();
    this.topMesh = new THREE.Mesh(flip(geos.shellhalf), this.mat); this.topMesh.scale.set(4.2, 3.2, 4.2); this.shTop.add(this.topMesh);
    this.botMesh = new THREE.Mesh(geos.shellhalf, this.mat); this.botMesh.scale.set(4.2, 1.6, 4.2); this.shBot.add(this.botMesh);
    this.shield.add(this.shTop, this.shBot);
    // ---- jar
    this.jar = new THREE.Mesh(geos.jar, this.glass); this.jar.visible = false; this.jar.rotation.y = Math.PI / 2; this.group.add(this.jar);
    // ---- kelp wrap: fronds draped around the body + a lettuce collar
    this.kelp = new THREE.Group(); this.kelp.visible = false; this.group.add(this.kelp);
    this.fronds = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3, pv = new THREE.Group(), f = new THREE.Mesh(geos.kelp, this.mat);
      pv.position.set(Math.cos(a) * 0.22, 0.28, Math.sin(a) * 0.22 - 0.04); pv.rotation.y = -a; f.scale.set(0.55, 0.32, 0.55); f.userData.a = a; pv.add(f);
      this.kelp.add(pv); this.fronds.push(f);
    }
    const lc = new THREE.Mesh(geos.lettuce, this.mat); lc.position.set(0, 0.22, -0.04); lc.scale.setScalar(1.15); this.kelp.add(lc);
    // ---- mimic: sponge and coral growing from the back
    this.mimic = new THREE.Group(); this.mimic.visible = false; this.group.add(this.mimic);
    const sp = new THREE.Mesh(geos.sponge, this.mat); sp.position.set(0.1, 0.16, -0.1); sp.scale.setScalar(0.7);
    const co = new THREE.Mesh(geos.coral, this.mat); co.position.set(-0.08, 0.16, -0.08); co.scale.setScalar(0.75);
    this.mimic.add(sp, co);
    // ---- dens: ring of pebbles + shell roof (world objects)
    this.denRoot = new THREE.Group(); game.scene.add(this.denRoot);
    this.dens = [];      // {x, z, group, hide}
    this.clock = 0;
  }

  // ------------------------------------------------------------------ using things
  /** use an item from the satchel; returns true if it was used up */
  use(id) {
    const g = this.game, o = g.octopus, inv = g.inv, A = g.audio;
    if (!USABLE.has(id) || inv.count(id) < 1 || !o.alive || o.tunnel || o.carried) return false;
    let ok = true;
    switch (id) {
      case 'shield': if (o.buff.shield > 0 || o.buff.jar > 0) return false; o.buff.shield = FX.shield; break;
      case 'hideaway': if (o.buff.jar > 0 || o.buff.shield > 0) return false; o.buff.jar = FX.jar; break;
      case 'den': ok = this.placeDen(); break;
      case 'inksac': o.inkCharges += FX.inkCharges; break;
      case 'wrap': if (o.buff.kelp > 0) return false; o.buff.kelp = FX.kelp; break;
      case 'feast': o.health = Math.min(100, o.health + FX.feastHeal); o.buff.feast = FX.feast; o.glowBoost = 1; break;
      case 'gland': if (o.venomReady) return false; o.venomReady = true; break;
      case 'dose': if (o.lethalDose) return false; o.lethalDose = true; o.glowBoost = 0.4; break;      // t250u: the next venomous bite kills any predator
      case 'mimic': o.buff.mimic = FX.mimic; break;
      case 'tonic': if (o.energy > 96 && o.buff.tonic > 0) return false; o.energy = 100; o.buff.tonic = FX.tonic; o.glowBoost = 0.6; break;
      case 'meal': if (o.health > 98) return false; o.health = Math.min(100, o.health + FX.mealHeal); o.buff.feast = FX.mealGlow; o.glowBoost = 1; break;
      case 'glow': if (o.buff.feast > 20) return false; o.buff.feast = FX.glow; o.glowBoost = 1; break;
      case 'bait': {
        const w = g.world;
        w.bait = { x: o.x + Math.sin(o.heading) * 1.2, z: o.z + Math.cos(o.heading) * 1.2, t: FX.bait };
        break;
      }
      case 'glowmix': {
        const den = this.dens[this.dens.length - 1];
        if (!den) return false;
        if (!this.denGlow) {
          this.denGlow = { mesh: new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.55, depthWrite: false })), until: 0 };
          this.denGlow.mesh.userData.noOutline = true;
          this.denRoot.add(this.denGlow.mesh);
        }
        const y = g.world.heightAt(den.x, den.z) || 0;
        this.denGlow.mesh.position.set(den.x, y + 0.45, den.z);
        this.denGlow.mesh.visible = true;
        this.denGlow.until = this.clock + FX.glowmix;
        break;
      }
      case 'rainbow': o.buff.feast = Math.max(o.buff.feast, 8); o.glowBoost = 1; this.game.levels?.did('rainbow'); break;
      case 'mussel': if (o.health > 98) return false; o.health = Math.min(100, o.health + FX.mussel); o.glowBoost = 0.5; break;
      case 'moss': if (o.health > 98) return false; o.health = Math.min(100, o.health + FX.moss); o.glowBoost = 0.3; break;
      default: ok = DYE_COLOR[id] ? this.placeDye(id) : false;
    }
    if (!ok) return false;
    inv.take(id); A.use?.(id);
    return true;
  }
  /** the quick key: a sensible helper for the moment (G: shield / jar, H: restore / boost, V: den) */
  quickShelter() { return this.use(this.game.inv.count('shield') ? 'shield' : 'hideaway'); }
  quickBoost() {
    const o = this.game.octopus, n = (k) => this.game.inv.count(k);
    if (n('meal') && o.health < 55) return this.use('meal');
    if (n('feast') && o.health < 92) return this.use('feast');
    if (n('tonic') && o.energy < 35 && !o.buff.tonic) return this.use('tonic');
    if (n('wrap') && !o.buff.kelp && !o.inWater) return this.use('wrap');
    if (n('gland') && !o.venomReady) return this.use('gland');
    if (n('mimic') && !o.buff.mimic) return this.use('mimic');
    if (n('inksac') && o.inkCharges < 1) return this.use('inksac');
    if (n('mussel') && o.health < 88) return this.use('mussel');
    if (n('moss') && o.health < 90) return this.use('moss');
    return false;
  }
  /** a dye only works beside a den: it becomes a coloured bead in the ring */
  placeDye(id) {
    const decor = this.game.decor, o = this.game.octopus;
    if (!decor || decor.carry || !o) return false;
    let den = null, bd = 8;
    for (const d of this.dens) {
      const dist = Math.hypot(d.x - o.x, d.z - o.z);
      if (dist < bd) { bd = dist; den = d; }
    }
    if (!den) return false;
    decor.carry = id;
    const placed = decor.tryPlace(den);
    if (!placed) decor.carry = null;
    decor.syncCarryMesh();
    return placed;
  }
  placeDen(x, z) {
    const g = this.game, w = g.world, o = g.octopus;
    x ??= o.x; z ??= o.z;
    if (w.waterAt(x, z) || o.inWater || w.isRoad(x, z, 0.5) || w.heightAt(x, z) < 0.1) return false;
    for (const d of this.dens) if (Math.hypot(d.x - x, d.z - z) < 2.4) return false;
    this.addDen(x, z, true);
    return true;
  }
  addDen(x, z, enter) {
    const w = this.game.world, geos = this.gatherer.geos, grp = new THREE.Group();
    const roof = new THREE.Mesh(flip(geos.shellhalf), this.mat);
    seat(w, roof.geometry, { x, z, rot: Math.random() * 6.28, sx: 6.2, sy: 6.2, sz: 6.2, tilt: 1, bury: 0.01 }, _m);
    roof.matrixAutoUpdate = false; roof.matrix.copy(_m); grp.add(roof);
    const N = 7;
    for (let i = 0; i < N; i++) {
      if (i === 0) continue;                                    // the doorway
      const a = (i / N) * Math.PI * 2, px = x + Math.cos(a) * 1.25, pz = z + Math.sin(a) * 1.25;
      const p = new THREE.Mesh(geos.pebble, this.mat);
      seat(w, p.geometry, { x: px, z: pz, rot: a * 3, sx: 2.6, sy: 2.2, sz: 2.6, tilt: 1, bury: 0.01 }, _m);
      p.matrixAutoUpdate = false; p.matrix.copy(_m); grp.add(p);
    }
    this.denRoot.add(grp);
    const hide = { x, z, r: 1.15, kind: 'den' };
    w.hides.push(hide);
    this.dens.push({ x, z, group: grp, hide });
    while (this.dens.length > FX.denMax) this.removeDen(this.dens[0], true);
    if (enter) { this.game.octopus.hiddenIn = hide; this.game.octopus.hideEvent = hide; }
    return hide;
  }
  removeDen(d, giveBack = false) {
    const i = this.dens.indexOf(d); if (i >= 0) this.dens.splice(i, 1);
    this.game.decor?.releaseDen(d.x, d.z, giveBack);
    this.denRoot.remove(d.group); d.group.traverse((m) => { /* geometries are shared per den (flip clones): */ if (m.isMesh && m.geometry !== this.gatherer.geos.pebble) m.geometry.dispose?.(); });
    const w = this.game.world, j = w.hides.indexOf(d.hide); if (j >= 0) w.hides.splice(j, 1);
    const o = this.game.octopus; if (o.hiddenIn === d.hide) o.hiddenIn = null;
  }

  // ------------------------------------------------------------------ the little pictures on the octopus
  update(dt) {
    this.clock += dt;
    const o = this.game.octopus, B = o.buff, t = this.clock;
    // shield
    const sOn = B.shield > 0, blink = sOn && B.shield < 3 ? 0.55 + 0.45 * Math.sin(t * 14) : 1;
    this.shield.visible = sOn;
    if (sOn) {
      const c = o.shieldClosed, open = 1 - c;
      // closed: the top half rests on the bottom half (rim to rim) around the body; carried: a small half on the back
      this.shTop.position.set(0, lerp(0.42, 0.16, c), lerp(-0.18, 0, c));
      this.shTop.rotation.x = -open * 0.8; this.shTop.scale.setScalar(lerp(0.42, 1, c) * blink);
      this.shBot.position.set(0, -0.01, 0); this.shBot.scale.setScalar(Math.max(0.001, c * blink));
      this.shield.position.y = 0;
    }
    // jar
    const jOn = B.jar > 0 || o.jarF > 0.02;
    this.jar.visible = jOn;
    if (jOn) { const k = o.jarF * (B.jar > 0 && B.jar < 3 ? 0.6 + 0.4 * Math.sin(t * 14) : 1); this.jar.scale.setScalar(Math.max(0.001, 2.3 * k)); this.jar.position.y = 0.02; }
    // kelp
    const kOn = o.kelpF > 0.02;
    this.kelp.visible = kOn;
    if (kOn) {
      const k = o.kelpF * (B.kelp > 0 && B.kelp < 6 ? 0.5 + 0.5 * Math.min(1, B.kelp / 6) : 1);
      this.kelp.scale.setScalar(Math.max(0.001, k));
      for (const f of this.fronds) {
        f.rotation.z = -1.3 + Math.sin(t * 1.6 + f.userData.a * 2) * 0.1;      // drapes outward and down over the body
      }
    }
    // mimic
    this.mimic.visible = o.mimicF > 0.02;
    if (this.mimic.visible) this.mimic.scale.setScalar(Math.max(0.001, o.mimicF));
    if (this.denGlow) this.denGlow.mesh.visible = this.clock < this.denGlow.until;
  }
  /** a den's position may be asked for (save) */
  denList() { return this.dens.map((d) => ({ x: +d.x.toFixed(2), z: +d.z.toFixed(2) })); }
  reset() { for (const d of [...this.dens]) this.removeDen(d); }
  dispose() {
    this.reset(); this.game.octopus.group.remove(this.group); this.game.scene.remove(this.denRoot);
    this.topMesh.geometry.dispose(); this.glass.dispose();
  }
}
