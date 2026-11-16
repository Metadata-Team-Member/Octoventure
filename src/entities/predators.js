// =====================================================================
//  Predators - low-poly animals & people with simple AI.
//  States: wander -> alert -> chase -> attack ... and when the octopus
//  is fully camouflaged (and not too close) -> confused -> leave.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, damp, dampAngle, angleDiff, lerp } from '../util/rng.js';

const mat = (hex, extra = {}) => new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.85, ...extra });
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const sph = (r, m, sx = 1, sy = 1, sz = 1, seg = 8) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), m); o.scale.set(sx, sy, sz); return o; };
const cone = (r, h, m, seg = 6) => new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m);
const cyl = (r1, r2, h, m, seg = 6) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
function pivot(child, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); g.add(child); return g; }

// ---------------------------------------------------------------- species
export const SPECIES = {
  gull: {
    label: 'Seagull', speed: 8.5, walk: 2.4, notice: 26, attackRange: 1.6, damage: 12, cooldown: 1.0, pierce: 0, flying: false, hop: true,
    build() {
      const g = new THREE.Group(); const legs = [];
      const white = mat(0xf4f6f8), grey = mat(0x9aa3ad), orange = mat(0xf1a233), black = mat(0x222428);
      const body = sph(0.5, white, 0.75, 0.6, 1.2); body.position.y = 0.95; g.add(body);
      const wingL = box(0.12, 0.08, 1.1, grey), wingR = wingL.clone();
      wingL.position.set(0.4, 1.05, -0.1); wingR.position.set(-0.4, 1.05, -0.1); g.add(wingL, wingR);
      const tip = box(0.12, 0.09, 0.3, black); tip.position.set(0.4, 1.05, -0.75); const tip2 = tip.clone(); tip2.position.x = -0.4; g.add(tip, tip2);
      const head = new THREE.Group(); head.position.set(0, 1.3, 0.55);
      head.add(sph(0.26, white));
      const beak = cone(0.09, 0.4, orange, 5); beak.rotation.x = Math.PI / 2; beak.position.z = 0.32; head.add(beak);
      for (const s of [-1, 1]) { const eye = sph(0.05, black); eye.position.set(s * 0.14, 0.06, 0.18); head.add(eye); }
      g.add(head);
      for (const s of [-1, 1]) { const leg = pivot(cyl(0.03, 0.03, 0.7, orange, 4), s * 0.18, 0.7, 0.05); leg.children[0].position.y = -0.35; g.add(leg); legs.push(leg); }
      const tail = box(0.3, 0.06, 0.4, white); tail.position.set(0, 0.95, -0.7); g.add(tail);
      return { g, legs, head, wings: [wingL, wingR] };
    },
  },
  cat: {
    label: 'Cat', speed: 9.5, walk: 2.6, notice: 24, attackRange: 2.0, damage: 15, cooldown: 1.1, pierce: 2.5,
    build() {
      const g = new THREE.Group(); const legs = [];
      const fur = mat(0xd98a43), dark = mat(0x8c4f21), light = mat(0xf4e6cf), pink = mat(0xe9a4a4), black = mat(0x1d1d1d);
      const body = sph(0.55, fur, 0.75, 0.7, 1.55); body.position.y = 1.0; g.add(body);
      const stripe = box(0.82, 0.05, 0.12, dark); stripe.position.set(0, 1.5, 0.1); g.add(stripe);
      const head = new THREE.Group(); head.position.set(0, 1.25, 1.0);
      head.add(sph(0.42, fur, 1, 0.9, 0.95));
      for (const s of [-1, 1]) {
        const ear = cone(0.15, 0.3, fur, 4); ear.position.set(s * 0.26, 0.38, 0); head.add(ear);
        const eye = sph(0.07, mat(0x9be84a), 1, 1.2, 0.6); eye.position.set(s * 0.17, 0.08, 0.36); head.add(eye);
        const pupil = sph(0.03, black); pupil.position.set(s * 0.17, 0.08, 0.4); head.add(pupil);
      }
      const nose = sph(0.06, pink); nose.position.set(0, -0.04, 0.4); head.add(nose);
      const snout = sph(0.18, light, 1.1, 0.7, 0.8); snout.position.set(0, -0.1, 0.3); head.add(snout);
      g.add(head);
      for (const [x, z] of [[-0.28, 0.7], [0.28, 0.7], [-0.28, -0.7], [0.28, -0.7]]) { const leg = pivot(cyl(0.11, 0.09, 0.8, fur, 5), x, 0.8, z); leg.children[0].position.y = -0.4; g.add(leg); legs.push(leg); }
      const tail = new THREE.Group(); tail.position.set(0, 1.1, -1.4);
      for (let i = 0; i < 4; i++) { const s = sph(0.12 - i * 0.01, i % 2 ? dark : fur); s.position.set(0, 0.25 * i, -0.15 * i); tail.add(s); }
      g.add(tail);
      return { g, legs, head, tail };
    },
  },
  dog: {
    label: 'Dog', speed: 10.5, walk: 2.8, notice: 30, attackRange: 2.4, damage: 18, cooldown: 1.2, pierce: 5.5,
    build() {
      const g = new THREE.Group(); const legs = [];
      const fur = mat(0x8a5a35), dark = mat(0x4a2d18), light = mat(0xe7d3b4), black = mat(0x151515);
      const body = sph(0.7, fur, 0.8, 0.75, 1.5); body.position.y = 1.35; g.add(body);
      const head = new THREE.Group(); head.position.set(0, 1.75, 1.25);
      head.add(sph(0.5, fur, 1, 0.95, 1));
      const snout = box(0.38, 0.3, 0.6, light); snout.position.set(0, -0.12, 0.45); head.add(snout);
      const nose = sph(0.1, black); nose.position.set(0, 0.0, 0.78); head.add(nose);
      for (const s of [-1, 1]) {
        const ear = box(0.14, 0.5, 0.3, dark); ear.position.set(s * 0.42, 0.1, -0.05); ear.rotation.z = s * 0.4; head.add(ear);
        const eye = sph(0.07, black); eye.position.set(s * 0.2, 0.15, 0.42); head.add(eye);
      }
      g.add(head);
      for (const [x, z] of [[-0.35, 0.85], [0.35, 0.85], [-0.35, -0.85], [0.35, -0.85]]) { const leg = pivot(cyl(0.14, 0.11, 1.1, fur, 5), x, 1.1, z); leg.children[0].position.y = -0.55; g.add(leg); legs.push(leg); }
      const tail = new THREE.Group(); tail.position.set(0, 1.6, -1.35);
      const t1 = cone(0.12, 0.9, fur, 5); t1.position.y = 0.4; t1.rotation.x = -0.5; tail.add(t1); g.add(tail);
      return { g, legs, head, tail };
    },
  },
  fox: {
    label: 'Fox', speed: 10, walk: 2.7, notice: 32, attackRange: 2.1, damage: 20, cooldown: 1.1, pierce: 3.5,
    build() {
      const g = new THREE.Group(); const legs = [];
      const fur = mat(0xd9692b), white = mat(0xfaf3e6), black = mat(0x1e1a18);
      const body = sph(0.55, fur, 0.7, 0.65, 1.7); body.position.y = 1.15; g.add(body);
      const chest = sph(0.35, white, 0.9, 0.8, 0.8); chest.position.set(0, 1.0, 0.8); g.add(chest);
      const head = new THREE.Group(); head.position.set(0, 1.45, 1.15);
      head.add(sph(0.38, fur, 1, 0.9, 1));
      const snout = cone(0.2, 0.55, white, 4); snout.rotation.x = Math.PI / 2; snout.position.set(0, -0.08, 0.5); head.add(snout);
      const nose = sph(0.06, black); nose.position.set(0, -0.08, 0.8); head.add(nose);
      for (const s of [-1, 1]) {
        const ear = cone(0.16, 0.45, black, 4); ear.position.set(s * 0.22, 0.42, -0.05); head.add(ear);
        const eye = sph(0.05, black); eye.position.set(s * 0.17, 0.08, 0.32); head.add(eye);
      }
      g.add(head);
      for (const [x, z] of [[-0.25, 0.75], [0.25, 0.75], [-0.25, -0.75], [0.25, -0.75]]) { const leg = pivot(cyl(0.1, 0.08, 0.95, black, 5), x, 0.95, z); leg.children[0].position.y = -0.48; g.add(leg); legs.push(leg); }
      const tail = new THREE.Group(); tail.position.set(0, 1.15, -1.5);
      const tb = cone(0.3, 1.5, fur, 6); tb.rotation.x = -Math.PI / 2 - 0.3; tb.position.set(0, 0.1, -0.7); tail.add(tb);
      const tt = cone(0.18, 0.5, white, 6); tt.rotation.x = -Math.PI / 2 - 0.3; tt.position.set(0, 0.0, -1.45); tail.add(tt);
      g.add(tail);
      return { g, legs, head, tail };
    },
  },
  crab: {
    label: 'Crab', speed: 6.2, walk: 1.6, notice: 13, attackRange: 1.5, damage: 9, cooldown: 0.9, pierce: 1.5, side: true, shore: true,
    build() {
      const g = new THREE.Group(); const legs = []; const claws = [];
      const red = mat(0xd9462e), dark = mat(0xa8331f), black = mat(0x111111);
      const body = sph(0.55, red, 1.15, 0.45, 0.85); body.position.y = 0.45; g.add(body);
      for (const s of [-1, 1]) {
        const arm = box(0.12, 0.12, 0.6, red); arm.position.set(s * 0.55, 0.62, 0.45); arm.rotation.y = s * 0.4;
        const claw = sph(0.26, dark, 1, 0.6, 1.2); claw.position.set(s * 0.8, 0.7, 0.85);
        const cl = cone(0.1, 0.3, dark, 4); cl.rotation.x = Math.PI / 2; cl.position.set(s * 0.8, 0.7, 1.15);
        g.add(arm, claw, cl); claws.push(claw);
        const eye = cyl(0.04, 0.04, 0.3, dark, 4); eye.position.set(s * 0.2, 0.8, 0.35); const ball = sph(0.07, black); ball.position.set(s * 0.2, 0.97, 0.35); g.add(eye, ball);
        for (let k = 0; k < 3; k++) { const leg = pivot(box(0.5, 0.06, 0.08, dark), s * 0.5, 0.4, -0.15 + k * 0.28); leg.children[0].position.x = s * 0.25; leg.rotation.z = s * -0.3; g.add(leg); legs.push(leg); }
      }
      return { g, legs, head: body, claws };
    },
  },
  eagle: {
    label: 'Eagle', speed: 22, walk: 9, notice: 48, attackRange: 2.6, damage: 26, cooldown: 12, pierce: 0, flying: true,
    build() {
      const g = new THREE.Group();
      const brown = mat(0x5b3d24), white = mat(0xf5f1e8), yellow = mat(0xf2c230), dark = mat(0x35241a), black = mat(0x111111);
      const body = sph(0.7, brown, 0.7, 0.65, 1.7); g.add(body);
      const head = new THREE.Group(); head.position.set(0, 0.15, 1.2); head.add(sph(0.38, white));
      const beak = cone(0.14, 0.45, yellow, 5); beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.05, 0.4); head.add(beak);
      for (const s of [-1, 1]) { const eye = sph(0.06, black); eye.position.set(s * 0.2, 0.08, 0.2); head.add(eye); }
      g.add(head);
      const wings = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Group(); w.position.set(s * 0.5, 0.2, 0.1);
        const a = box(1.6, 0.1, 1.3, brown); a.position.x = s * 0.8; const b = box(1.5, 0.08, 0.9, dark); b.position.x = s * 2.2; b.position.z = -0.15;
        w.add(a, b); g.add(w); wings.push(w);
      }
      const tail = box(0.7, 0.07, 1.0, white); tail.position.set(0, 0.05, -1.5); g.add(tail);
      for (const s of [-1, 1]) { const f = box(0.1, 0.5, 0.1, yellow); f.position.set(s * 0.25, -0.5, 0.4); g.add(f); }
      return { g, legs: [], head, wings };
    },
  },
  human: {
    label: 'Person', speed: 6.2, walk: 2.2, notice: 22, attackRange: 3.0, damage: 24, cooldown: 1.6, pierce: 0, human: true,
    build() {
      const g = new THREE.Group(); const legs = [], arms = [];
      const shirt = mat([0xd04a4a, 0x3a78c9, 0x4aa86a, 0xe0b340, 0x8a55c4][Math.floor(Math.random() * 5)]);
      const pants = mat(0x2f3f5e), skin = mat([0xf0c4a0, 0xc68e63, 0x8d5a3c][Math.floor(Math.random() * 3)]), hair = mat(0x2b1d14), shoe = mat(0xf0f0f0);
      const torso = box(1.1, 1.4, 0.65, shirt); torso.position.y = 2.55; g.add(torso);
      const head = new THREE.Group(); head.position.set(0, 3.7, 0.05);
      head.add(sph(0.42, skin)); const h = sph(0.44, hair, 1, 0.7, 1); h.position.set(0, 0.12, -0.05); head.add(h);
      for (const s of [-1, 1]) { const eye = sph(0.05, mat(0x111111)); eye.position.set(s * 0.15, 0.04, 0.38); head.add(eye); }
      g.add(head);
      for (const s of [-1, 1]) {
        const leg = pivot(box(0.42, 1.8, 0.45, pants), s * 0.28, 1.8, 0); leg.children[0].position.y = -0.9; const foot = box(0.44, 0.22, 0.75, shoe); foot.position.set(0, -1.75, 0.15); leg.add(foot); g.add(leg); legs.push(leg);
        const arm = pivot(box(0.3, 1.3, 0.32, shirt), s * 0.72, 3.1, 0); arm.children[0].position.y = -0.6; const hand = sph(0.17, skin); hand.position.y = -1.35; arm.add(hand); g.add(arm); arms.push(arm);
      }
      return { g, legs, arms, head };
    },
  },
};

// ---------------------------------------------------------------- predator instance
export class Predator {
  constructor(kind, x, z, world, scene) {
    this.kind = kind; this.spec = SPECIES[kind]; this.world = world;
    const m = this.spec.build();
    this.parts = m;
    this.group = new THREE.Group(); this.group.add(m.g);
    m.g.traverse((o) => { if (o.isMesh) o.castShadow = CONFIG.graphics.shadows; });
    scene.add(this.group);
    this.x = x; this.z = z; this.home = { x, z };
    this.y = world.heightAt(x, z);
    this.heading = Math.random() * Math.PI * 2;
    this.state = 'wander'; this.timer = Math.random() * 3; this.ignore = 0; this.cool = 0;
    this.target = null; this.phase = Math.random() * 10; this.speed = 0;
    this.alt = this.spec.flying ? 24 : 0;
    this.circleA = Math.random() * 6.28; this.circleC = { x, z }; this.diveFrom = null; this.diveT = 0; this.diveTo = null;
    this.lunge = 0; this.lungeHit = false; this.headTurn = 0; this.alertT = 0;
    this.scale = this.spec.scale ?? 1;
    this.mark = this.makeMark();
    this.group.add(this.mark);
    this.mark.position.y = kind === 'human' ? 5.2 : kind === 'eagle' ? 2.2 : kind === 'dog' ? 3.0 : 2.4;
    this.mark.visible = false;
    if (kind === 'eagle') { this.shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(2.2, 14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })); this.shadowDisc.rotation.x = -Math.PI / 2; scene.add(this.shadowDisc); }
    this.sync();
  }
  makeMark() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    this.markCtx = cv.getContext('2d'); this.markTex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markTex, depthTest: false, transparent: true, fog: false }));
    sp.scale.set(1.5, 1.5, 1); sp.renderOrder = 10; this.markShown = '';
    return sp;
  }
  setMark(ch, color) {
    if (this.markShown === ch) return;
    this.markShown = ch;
    if (!ch) { this.mark.visible = false; return; }
    const c = this.markCtx; c.clearRect(0, 0, 64, 64);
    c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 7; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(ch, 32, 34); c.fillStyle = color; c.fillText(ch, 32, 34);
    this.markTex.needsUpdate = true; this.mark.visible = true;
  }

  canWalk(nx, nz) {
    const h = this.world.heightAt(nx, nz);
    return this.spec.shore ? h > 0.03 : h > 0.35;
  }

  walkToward(tx, tz, speed, dt) {
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) { this.speed = damp(this.speed, 0, 8, dt); return d; }
    const want = Math.atan2(dx, dz);
    this.heading = dampAngle(this.heading, want, this.spec.flying ? 2.5 : 7, dt);
    // only move when roughly facing the target
    const facing = Math.max(0, Math.cos(angleDiff(this.heading, want)));
    const sp = speed * (0.25 + 0.75 * facing);
    this.speed = damp(this.speed, sp, 6, dt);
    const step = Math.min(this.speed * dt, d);
    let nx = this.x + Math.sin(this.heading) * step, nz = this.z + Math.cos(this.heading) * step;
    if (!this.spec.flying) {
      if (!this.canWalk(nx, nz)) { this.heading += 1.2; this.speed *= 0.5; this.pickTargetSoon = true; return d; }
      const r = this.world.resolve(nx, nz, 0.9 * (this.kind === 'human' ? 1.0 : 1)); nx = r.x; nz = r.z;
    }
    this.x = nx; this.z = nz;
    return d;
  }

  pickWanderTarget() {
    const a = Math.random() * 6.28, r = 6 + Math.random() * 22;
    this.target = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
  }

  /** returns damage dealt this frame (0 if none) */
  update(dt, player, world) {
    const s = this.spec;
    const dx = player.x - this.x, dz = player.z - this.z;
    const dist = Math.hypot(dx, dz);
    this.cool = Math.max(0, this.cool - dt); this.ignore = Math.max(0, this.ignore - dt);
    this.phase += dt * (1 + this.speed * 0.9);
    if (s.flying) return this.updateEagle(dt, player, dist);

    const fooled = player.camoActive && dist > s.pierce;      // camo fully on and the predator isn't nose-to-nose
    const alive = player.alive && !player.won;
    const sprintBoost = player.sprinting ? 1.25 : 1;
    const noticeR = s.notice * (player.moving ? sprintBoost : 0.65);
    let dmg = 0;

    switch (this.state) {
      case 'wander': {
        this.setMark('');
        this.timer -= dt;
        if (!this.target || this.pickTargetSoon || (this.timer <= 0)) {
          this.pickTargetSoon = false;
          if (Math.random() < 0.4) { this.target = null; this.timer = 1.5 + Math.random() * 3; } else { this.pickWanderTarget(); this.timer = 4 + Math.random() * 5; }
        }
        if (this.target) { if (this.walkToward(this.target.x, this.target.z, s.walk, dt) < 1.2) { this.target = null; } } else this.speed = damp(this.speed, 0, 6, dt);
        if (alive && this.ignore <= 0 && !fooled && (dist < noticeR || (dist < noticeR * 0.7 && !player.camoActive))) {
          if (!(player.camoWanted && dist > s.pierce)) { this.state = 'alert'; this.alertT = this.kind === 'cat' ? 0.9 : 0.55; }
        }
        break;
      }
      case 'alert': {
        this.setMark('!', '#ff4d3d');
        this.speed = damp(this.speed, 0, 10, dt);
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 9, dt);
        this.alertT -= dt;
        if (this.alertT <= 0) {
          if (fooled) { this.state = 'confused'; this.timer = 1.7; } else { this.state = 'chase'; this.chaseT = 0; }
        }
        if (!alive) this.state = 'wander';
        break;
      }
      case 'chase': {
        this.setMark('!', '#ff4d3d');
        this.chaseT = (this.chaseT || 0) + dt;
        if (!alive) { this.state = 'leave'; this.timer = 3; break; }
        if (fooled) { this.state = 'confused'; this.timer = 1.7; break; }
        if (dist > s.notice * 1.9 || this.chaseT > 14) { this.state = 'leave'; this.timer = 4; this.ignore = 6; break; }
        this.walkToward(player.x, player.z, s.speed, dt);
        if (dist < s.attackRange && this.cool <= 0) { this.state = 'attack'; this.lunge = 0.0; this.lungeHit = false; }
        break;
      }
      case 'attack': {
        this.setMark('!', '#ff4d3d');
        this.speed = damp(this.speed, 0, 10, dt);
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 12, dt);
        this.lunge += dt / 0.4;
        if (this.lunge > 0.5 && !this.lungeHit) {
          this.lungeHit = true;
          if (alive && dist < s.attackRange + 1.0 && !(player.camoActive && dist > s.pierce)) { dmg = s.damage; player.damage(s.damage, this.kind); }
        }
        if (this.lunge >= 1) {
          this.lunge = 0; this.cool = s.cooldown;
          this.state = fooled ? 'confused' : alive ? 'chase' : 'leave'; this.timer = 1.6;
          this.chaseT = Math.max(0, (this.chaseT || 0) - 3);
        }
        break;
      }
      case 'confused': {
        this.setMark('?', '#ffe14d');
        this.speed = damp(this.speed, 0, 8, dt);
        this.timer -= dt;
        this.headTurn = Math.sin(this.timer * 6) * 0.9;
        // if the camo drops while it is still looking, it may spot you again
        if (!fooled && player.alive && dist < noticeR * 0.8) { this.state = 'alert'; this.alertT = 0.5; break; }
        if (this.timer <= 0) { this.state = 'leave'; this.timer = 5 + Math.random() * 3; this.ignore = 8; this.headTurn = 0; }
        break;
      }
      case 'leave': {
        this.setMark('');
        this.timer -= dt;
        const away = Math.atan2(-dx, -dz) + Math.sin(this.phase * 0.2) * 0.4;
        this.walkToward(this.x + Math.sin(away) * 20, this.z + Math.cos(away) * 20, s.walk * 1.5, dt);
        if (this.timer <= 0 || dist > 40) { this.state = 'wander'; this.home = { x: this.x, z: this.z }; this.target = null; this.ignore = Math.max(this.ignore, 3); }
        break;
      }
    }
    this.y = world.heightAt(this.x, this.z);
    this.sync(dt);
    return dmg;
  }

  updateEagle(dt, player, dist) {
    const s = this.spec, w = this.world;
    const alive = player.alive && !player.won;
    const fooled = player.camoActive;
    let dmg = 0;
    const gy = w.heightAt(this.x, this.z);
    switch (this.state) {
      case 'wander': {          // soar in big circles
        this.setMark('');
        this.circleA += dt * 0.28;
        const R = 38;
        const tx = this.circleC.x + Math.cos(this.circleA) * R, tz = this.circleC.z + Math.sin(this.circleA) * R;
        this.heading = dampAngle(this.heading, Math.atan2(tx - this.x, tz - this.z), 2, dt);
        this.speed = 9;
        this.x += Math.sin(this.heading) * this.speed * dt; this.z += Math.cos(this.heading) * this.speed * dt;
        this.alt = damp(this.alt, 24 + Math.sin(this.phase * 0.05) * 3, 1.5, dt);
        const noticeR = s.notice * (player.moving ? (player.sprinting ? 1.2 : 1) : 0.45);
        if (alive && this.ignore <= 0 && !fooled && this.cool <= 0 && dist < noticeR) { this.state = 'alert'; this.alertT = 0.7; }
        break;
      }
      case 'alert': {
        this.setMark('!', '#ff4d3d');
        this.alertT -= dt;
        this.heading = dampAngle(this.heading, Math.atan2(player.x - this.x, player.z - this.z), 5, dt);
        this.x += Math.sin(this.heading) * 7 * dt; this.z += Math.cos(this.heading) * 7 * dt;
        if (fooled || !alive) { this.state = 'climb'; this.timer = 3; this.setMark('?', '#ffe14d'); break; }
        if (this.alertT <= 0) { this.state = 'dive'; this.diveT = 0; this.diveFrom = { x: this.x, z: this.z, a: this.alt }; this.hit = false; }
        break;
      }
      case 'dive': {
        this.setMark('!', '#ff4d3d');
        this.diveT += dt / Math.max(0.6, Math.min(1.5, dist / 30 + 0.55));
        const f = Math.min(1, this.diveT);
        const px = player.x, pz = player.z;                         // keeps tracking the player
        this.x = lerp(this.diveFrom.x, px, f * f); this.z = lerp(this.diveFrom.z, pz, f * f);
        this.alt = lerp(this.diveFrom.a, 0.7, f * f);
        this.heading = Math.atan2(px - this.x, pz - this.z);
        this.speed = 24;
        if (player.camoActive && f > 0.15) { this.state = 'climb'; this.timer = 3.5; this.setMark('?', '#ffe14d'); this.cool = 7; break; }
        if (f >= 1) {
          const d = Math.hypot(player.x - this.x, player.z - this.z);
          if (alive && d < s.attackRange + 0.6 && !player.camoActive) { dmg = s.damage; player.damage(s.damage, 'eagle'); }
          this.cool = s.cooldown; this.state = 'climb'; this.timer = 3.5;
        }
        break;
      }
      case 'climb': {
        this.timer -= dt;
        this.alt = damp(this.alt, 26, 1.1, dt);
        const away = Math.atan2(this.x - player.x, this.z - player.z);
        this.heading = dampAngle(this.heading, away + 0.3, 2.5, dt);
        this.speed = 14;
        this.x += Math.sin(this.heading) * this.speed * dt; this.z += Math.cos(this.heading) * this.speed * dt;
        if (this.timer <= 0) { this.state = 'wander'; this.circleC = { x: this.x + Math.cos(this.heading + 1.5) * 38, z: this.z + Math.sin(this.heading + 1.5) * 38 }; this.circleA = this.heading + Math.PI; this.ignore = 6; this.setMark(''); }
        break;
      }
    }
    const lim = w.half - 20;
    this.x = clamp(this.x, -lim, lim); this.z = clamp(this.z, -lim, lim);
    this.y = gy + this.alt;
    this.groundY = gy;
    this.sync(dt);
    return dmg;
  }

  sync(dt = 0) {
    const s = this.spec, p = this.parts, t = this.phase;
    this.group.position.set(this.x, this.y, this.z);
    const faceOffset = s.side ? Math.PI / 2 : 0;
    this.group.rotation.y = this.heading + faceOffset;
    const mv = clamp(this.speed / (s.speed * 0.6 + 0.001), 0, 1.4);
    const swing = Math.sin(t * 3.2) * 0.7 * mv;
    if (s.flying) {
      const flap = this.state === 'dive' ? 0.15 : Math.sin(t * 0.9) * 0.15;
      p.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (this.state === 'dive' ? 0.7 : flap + 0.08); });
      this.group.rotation.z = Math.sin(t * 0.2) * 0.15; this.group.rotation.x = this.state === 'dive' ? 0.6 : this.state === 'climb' ? -0.35 : 0;
      if (this.shadowDisc) { this.shadowDisc.position.set(this.x, (this.groundY ?? this.y) + 0.08, this.z); const sc = clamp(1.6 - this.alt / 20, 0.6, 1.5); this.shadowDisc.scale.set(sc, sc, sc); }
      return;
    }
    if (p.legs) p.legs.forEach((l, i) => { l.rotation.x = s.side ? 0 : swing * (i % 2 ? 1 : -1) * (this.kind === 'human' ? 0.9 : 1); if (s.side) l.rotation.z = (i % 2 ? 1 : -1) * Math.sin(t * 6 + i) * 0.25 * mv - (i < 3 ? -0.3 : 0.3) * 0; });
    if (p.arms) p.arms.forEach((a, i) => { a.rotation.x = -swing * (i ? 1 : -1) * 0.8 + (this.state === 'attack' ? -1.6 * Math.sin(this.lunge * Math.PI) : 0); });
    if (p.head) {
      p.head.rotation.y = this.headTurn;
      if (s.hop) p.head.position.z = 0.55 + Math.sin(t * 6.4) * 0.12 * mv;
    }
    if (p.tail) p.tail.rotation.y = Math.sin(t * 2.2) * 0.4;
    if (p.claws) p.claws.forEach((c, i) => { c.position.y = 0.7 + (this.state === 'attack' ? Math.sin(this.lunge * Math.PI) * 0.4 : Math.sin(t * 2 + i) * 0.04); });
    // body bob / lunge
    const lungeOff = this.state === 'attack' ? Math.sin(this.lunge * Math.PI) * 0.9 : 0;
    p.g.position.set(0, (s.hop ? Math.abs(Math.sin(t * 3.2)) * 0.18 * mv : Math.abs(Math.sin(t * 3.2)) * 0.06 * mv), lungeOff);
    p.g.rotation.x = this.state === 'attack' ? -Math.sin(this.lunge * Math.PI) * 0.25 : 0;
  }

  dispose(scene) {
    scene.remove(this.group);
    if (this.shadowDisc) { scene.remove(this.shadowDisc); this.shadowDisc.geometry.dispose(); this.shadowDisc.material.dispose(); }
    this.group.traverse((o) => { if (o.isMesh || o.isSprite) { o.geometry?.dispose?.(); const m = o.material; if (m) { m.map?.dispose?.(); m.dispose(); } } });
  }
}

// ---------------------------------------------------------------- spawning / manager
const HABITAT = {
  gull: [{ t: [0.82, 1.0], types: ['sand', 'wet', 'dune'], share: 0.7 }, { t: [0.0, 0.25], types: ['lawn', 'road', 'grass'], share: 0.3 }],
  cat: [{ t: [0.0, 0.45], types: ['lawn', 'grass', 'road'] }],
  dog: [{ t: [0.0, 0.5], types: ['lawn', 'grass', 'road', 'forest'] }],
  fox: [{ t: [0.2, 0.75], types: ['forest', 'grass', 'scrub', 'mud'] }],
  crab: [{ t: [0.9, 1.0], types: ['sand', 'wet', 'rock'] }],
  eagle: [{ t: [0.3, 0.85], types: null }],
  human: [{ t: [0.0, 0.2], types: ['lawn', 'road', 'grass'] }],
};

export class PredatorManager {
  constructor(world, scene) {
    this.world = world; this.scene = scene; this.list = [];
    if (!CONFIG.predators.enabled) return;
    for (const [kind, count] of Object.entries(CONFIG.predators.counts)) {
      const hab = HABITAT[kind];
      for (let i = 0; i < count; i++) {
        let h = hab[0];
        if (hab.length > 1) { let r = Math.random(), acc = 0; for (const q of hab) { acc += q.share; if (r <= acc) { h = q; break; } } }
        const spot = world.habitatSpot(h.t[0], h.t[1], h.types, CONFIG.predators.safeRadiusAtStart);
        if (spot) this.list.push(new Predator(kind, spot.x, spot.z, world, scene));
      }
    }
  }
  spawn(kind, x, z) { const p = new Predator(kind, x, z, this.world, this.scene); this.list.push(p); return p; }
  update(dt, player) {
    let threat = 0; let hurt = 0; const R = CONFIG.predators.activeRadius;
    const events = [];
    for (const p of this.list) {
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      const near = d < R;
      p.group.visible = d < CONFIG.graphics.fogFar + 20;
      if (p.shadowDisc) p.shadowDisc.visible = p.group.visible;
      if (!near) continue;
      hurt += p.update(dt, player, this.world);
      if (p.state !== p._prev) {
        if (p.state === 'alert' && d < 70) events.push({ type: 'alert', who: p.spec.label });
        if (p.state === 'confused') events.push({ type: 'fooled', who: p.spec.label });
        p._prev = p.state;
      }
      if (p.state === 'chase' || p.state === 'attack' || p.state === 'dive' || p.state === 'alert') threat = Math.max(threat, 1 - clamp(d / 45, 0, 1));
    }
    return { threat, hurt, events };
  }
  dispose() { for (const p of this.list) p.dispose(this.scene); this.list = []; }
}
