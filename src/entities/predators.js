// =====================================================================
//  Predators - low-poly animals & people with simple AI.
//  States: wander -> alert -> chase -> attack ... and when the octopus
//  is fully camouflaged (and not too close) -> confused -> leave.
// =====================================================================
import * as THREE from 'three';
import { CONFIG, diff } from '../config.js';
import { clamp, damp, dampAngle, angleDiff, lerp } from '../util/rng.js';

let RND = Math.random;
const _up = new THREE.Vector3(0, 1, 0), _sv = new THREE.Vector3(), _sn = { x: 0, y: 1, z: 0 };
/** the manager points this at world.rnd so a seed (or the daily seed) fully decides who is where and how they spawn */
export function setPredatorRng(f) { RND = f; }
const mat = (hex, extra = {}) => new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.85, ...extra });
const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const sph = (r, m, sx = 1, sy = 1, sz = 1, seg = 8) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), m); o.scale.set(sx, sy, sz); return o; };
const cone = (r, h, m, seg = 6) => new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m);
const cyl = (r1, r2, h, m, seg = 6) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
function pivot(child, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); g.add(child); return g; }

/**
 * Real-scale perspective: how much each animal's model is enlarged. The octopus is drawn at 0.42 (CONFIG.octopus.size), so the
 * models below (~1.3-2 u) tower over it: person ~8-9x its body length, dog ~3.5x, gull/magpie/kookaburra ~2.5x, cat/fox ~2.5-3x (measured by features.mjs). Not full
 * real scale (people would be off-screen), so these are compressed a little. Reach / hit radii scale with them.
 */
const THUMP = { human: 1.0, dog: 0.5, fox: 0.28, cat: 0.28 };     // how hard each walker's steps hit the ground
const FLYERS = new Set(['eagle', 'gull', 'magpie', 'kookaburra']);
export const SIZE = { gull: 1.15, cat: 0.8, dog: 1.05, fox: 0.95, crab: 0.7, eagle: 1.3, human: 1.8, magpie: 1.0, kookaburra: 1.05 };

// ---------------------------------------------------------------- species
export const SPECIES = {
  gull: {
    label: 'Seagull', caller: true, speed: 8.5, walk: 2.4, notice: 26, attackRange: 1.6, damage: 12, cooldown: 1.0, flying: false, hop: true,
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
    label: 'Cat', nocturnal: true, stalker: true, speed: 9.5, walk: 2.6, notice: 24, attackRange: 2.0, damage: 15, cooldown: 1.1,
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
    label: 'Dog', tracker: true, speed: 10.5, walk: 2.8, notice: 30, attackRange: 2.4, damage: 18, cooldown: 1.2,
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
    label: 'Fox', nocturnal: true, speed: 10, walk: 2.7, notice: 32, attackRange: 2.1, damage: 20, cooldown: 1.1,
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
    label: 'Crab', speed: 6.2, walk: 1.6, notice: 13, attackRange: 1.5, damage: 9, cooldown: 0.9, side: true, shore: true,
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
    label: 'Eagle', speed: 22, walk: 9, notice: 48, attackRange: 2.6, damage: 26, cooldown: 12, flying: true,
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
    label: 'Person', speed: 6.2, walk: 2.2, notice: 22, attackRange: 3.0, damage: 24, cooldown: 1.6, human: true,
    build() {
      const g = new THREE.Group(); const legs = [], arms = [];
      const shirt = mat([0xd04a4a, 0x3a78c9, 0x4aa86a, 0xe0b340, 0x8a55c4][Math.floor(RND() * 5)]);
      const pants = mat(0x2f3f5e), skin = mat([0xf0c4a0, 0xc68e63, 0x8d5a3c][Math.floor(RND() * 3)]), hair = mat(0x2b1d14), shoe = mat(0xf0f0f0);
      const torso = box(1.1, 1.4, 0.65, shirt); torso.position.y = 2.55; g.add(torso);
      const head = new THREE.Group(); head.position.set(0, 3.7, 0.05);
      head.add(sph(0.42, skin)); const h = sph(0.44, hair, 1, 0.7, 1); h.position.set(0, 0.12, -0.05); head.add(h);
      for (const s of [-1, 1]) { const eye = sph(0.05, mat(0x111111)); eye.position.set(s * 0.15, 0.04, 0.38); head.add(eye); }
      g.add(head);
      for (const s of [-1, 1]) {
        const leg = pivot(box(0.42, 1.8, 0.45, pants), s * 0.28, 1.8, 0); leg.children[0].position.y = -0.9; const foot = box(0.44, 0.22, 0.75, shoe); foot.position.set(0, -1.75, 0.15); leg.add(foot); g.add(leg); legs.push(leg);
        const arm = pivot(box(0.3, 1.3, 0.32, shirt), s * 0.72, 3.1, 0); arm.children[0].position.y = -0.6; const hand = sph(0.17, skin); hand.position.y = -1.35; arm.add(hand); g.add(arm); arms.push(arm);
      }
      const bucket = new THREE.Group();
      const bm = mat(0x2f86d9), rim = mat(0xcfe3f6);
      const bc = cyl(0.33, 0.25, 0.5, bm, 8); bc.position.y = 0; const br = cyl(0.36, 0.36, 0.06, rim, 8); br.position.y = 0.26; bucket.add(bc, br);
      bucket.position.set(0, -1.5, 0.28); arms[1].add(bucket); bucket.visible = false;
      return { g, legs, arms, head, bucket };
    },
  },
  magpie: {
    label: 'Magpie', swoop: true, speed: 16, walk: 5, notice: 17, attackRange: 1.8, damage: 9, cooldown: 3.2, flying: true, call: 'magpie',
    build() {
      const g = new THREE.Group(); const black = mat(0x15171c), white = mat(0xf2f2f0), beak = mat(0x8d9aa5), eye = mat(0xb23a2a);
      const body = sph(0.3, black, 0.8, 0.7, 1.3); g.add(body);
      const back = sph(0.28, white, 0.85, 0.5, 1.0); back.position.set(0, 0.12, -0.05); g.add(back);
      const head = new THREE.Group(); head.position.set(0, 0.12, 0.42); head.add(sph(0.17, black));
      const bk = cone(0.06, 0.28, beak, 4); bk.rotation.x = Math.PI / 2; bk.position.z = 0.22; head.add(bk);
      for (const sx of [-1, 1]) { const e = sph(0.03, eye); e.position.set(sx * 0.1, 0.04, 0.12); head.add(e); }
      g.add(head);
      const wings = [];
      for (const sx of [-1, 1]) { const w = new THREE.Group(); w.position.set(sx * 0.22, 0.08, 0); const a = box(0.9, 0.05, 0.5, black); a.position.x = sx * 0.45; const b = box(0.5, 0.04, 0.3, white); b.position.set(sx * 0.4, 0.01, -0.05); w.add(a, b); g.add(w); wings.push(w); }
      const tail = box(0.22, 0.04, 0.5, black); tail.position.set(0, 0.0, -0.62); g.add(tail);
      g.scale.setScalar(1.35);
      return { g, legs: [], head, wings };
    },
  },
  kookaburra: {
    label: 'Kookaburra', swoop: true, speed: 15, walk: 5, notice: 16, attackRange: 1.9, damage: 12, cooldown: 3.6, flying: true, call: 'kookaburra',
    build() {
      const g = new THREE.Group(); const brown = mat(0x7a5a3c), cream = mat(0xf0e6d2), dark = mat(0x3b2a1e), beak = mat(0x2a2522), blue = mat(0x4f8fb8);
      const body = sph(0.34, cream, 0.85, 0.8, 1.25); g.add(body);
      const back = sph(0.32, brown, 0.88, 0.55, 1.1); back.position.set(0, 0.14, -0.04); g.add(back);
      const head = new THREE.Group(); head.position.set(0, 0.2, 0.45); head.add(sph(0.24, cream));
      const cap = sph(0.25, brown, 1, 0.5, 1); cap.position.y = 0.1; head.add(cap);
      const bk = box(0.14, 0.12, 0.5, beak); bk.position.z = 0.34; head.add(bk);
      for (const sx of [-1, 1]) { const e = sph(0.035, dark); e.position.set(sx * 0.14, 0.05, 0.16); head.add(e); }
      g.add(head);
      const wings = [];
      for (const sx of [-1, 1]) { const w = new THREE.Group(); w.position.set(sx * 0.26, 0.1, 0); const a = box(0.9, 0.06, 0.55, brown); a.position.x = sx * 0.45; const b = box(0.4, 0.05, 0.3, blue); b.position.set(sx * 0.35, 0.02, 0.0); w.add(a, b); g.add(w); wings.push(w); }
      const tail = box(0.26, 0.05, 0.6, brown); tail.position.set(0, 0.0, -0.7); g.add(tail);
      g.scale.setScalar(1.4);
      return { g, legs: [], head, wings };
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
    this.heading = RND() * Math.PI * 2;
    this.state = 'wander'; this.timer = RND() * 3; this.ignore = 0; this.cool = 0;
    this.target = null; this.phase = RND() * 10; this.speed = 0;
    this.alt = this.spec.flying ? 24 : 0;
    this.circleA = RND() * 6.28; this.circleC = { x, z }; this.diveFrom = null; this.diveT = 0; this.diveTo = null;
    this.lunge = 0; this.lungeHit = false; this.headTurn = 0; this.alertT = 0;
    this.blind = 0; this.fleeT = 0; this.lastSeen = null; this.searchT = 0; this.lift = 0; this.crouch = 0; this.events = []; this.carrying = false;
    this.hasBucket = kind === 'human' && RND() < 0.65; if (m.bucket) m.bucket.visible = this.hasBucket;
    this.swoops = 0; this.perchAlt = 5.5 + RND() * 3; this.mgr = null; this.pounceT = 0; this.trackPt = null; this.act = 1;
    if (this.spec.swoop) { this.state = 'perch'; this.alt = this.perchAlt; }
    this.scale = SIZE[kind] ?? 1;
    this.group.scale.setScalar(this.scale);
    this.reach = this.spec.attackRange * this.scale;       // bigger animals reach further
    this.aware = 0; this.awareV = 0; this.toPlayer = this.heading;     // body-language level: 0 calm, ~0.45 wary / searching, 1 has noticed you
    if (FLYERS.has(kind)) {          // a shadow that slides over the ground (and over the octopus) when a bird passes overhead
      this.shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      this.shadowDisc.renderOrder = 3; this.shadowDisc.visible = false; scene.add(this.shadowDisc);
    }
    this.sync();
  }
  /**
   * Awareness is shown ONLY through the animal's body (no icons, sprites or text above heads): the head turns to look at the
   * octopus, the body freezes / crouches, ears and wings come up, the pace quickens (see sync()).
   */
  cue(level) { this.aware = level; }

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
      const r = this.world.resolve(nx, nz, 0.9 * this.scale * (this.kind === 'human' ? 1.0 : 1)); nx = r.x; nz = r.z;
    }
    this.x = nx; this.z = nz;
    return d;
  }

  pickWanderTarget() {
    const a = RND() * 6.28, r = 6 + RND() * 22;
    this.target = { x: this.home.x + Math.cos(a) * r, z: this.home.z + Math.sin(a) * r };
  }

  /** venom bite: scared off for a good while */
  scare(sec) {
    this.state = this.spec.flying ? 'climb' : 'flee'; this.fleeT = sec; this.timer = Math.min(sec, 4); this.ignore = sec + 6; this.lastSeen = null; this.alertT = 0;
    this.blind = 0; if (this.carrying) this.release();
    this.cue(0.45);
  }
  release() { this.carrying = false; this.state = 'leave'; this.timer = 5; this.ignore = 10; this.target = null; }

  /** magpies & kookaburras: wait in a tree, swoop at the octopus when it passes underneath, fly back up */
  updateSwooper(dt, player, dist) {
    const s = this.spec, w = this.world;
    const alive = player.alive && !player.won, fooled = player.camoProtected;
    const gy = w.heightAt(this.x, this.z);
    const noticeR = s.notice * (player.moving ? 1 : 0.6) * this.act * (player.visibility ?? 1) * diff().notice;
    let dmg = 0;
    const flapSpeed = this.state === 'perch' ? 0 : 1;
    this.speed = this.state === 'perch' ? 0 : this.speed;
    switch (this.state) {
      case 'perch': {
        this.cue(0);
        this.alt = damp(this.alt, this.perchAlt, 3, dt);
        const face = dist < 45 ? Math.atan2(player.x - this.x, player.z - this.z) : this.heading;
        this.heading = dampAngle(this.heading, face, 2, dt);
        this.x = lerp(this.x, this.home.x, 1 - Math.exp(-3 * dt)); this.z = lerp(this.z, this.home.z, 1 - Math.exp(-3 * dt));
        if (alive && !fooled && this.ignore <= 0 && this.cool <= 0 && dist < noticeR) {
          this.state = 'alert'; this.alertT = 0.55; this.events.push({ type: 'call', kind: s.call, x: this.x, z: this.z });
        }
        break;
      }
      case 'alert': {
        this.cue(1);
        this.alertT -= dt;
        this.heading = dampAngle(this.heading, Math.atan2(player.x - this.x, player.z - this.z), 8, dt);
        if (fooled || !alive) { this.state = 'home'; this.ignore = 8; break; }
        if (this.alertT <= 0) { this.state = 'swoop'; this.diveT = 0; this.diveFrom = { x: this.x, z: this.z, a: this.alt }; this.swoops++; this.hit = false; }
        break;
      }
      case 'swoop': {
        this.cue(1);
        this.diveT += dt / clamp(dist / 24 + 0.3, 0.45, 1.0);
        const f = Math.min(1, this.diveT);
        this.x = lerp(this.diveFrom.x, player.x, f * f); this.z = lerp(this.diveFrom.z, player.z, f * f);
        this.alt = lerp(this.diveFrom.a, 0.7, f * f);
        this.heading = Math.atan2(player.x - this.x, player.z - this.z);
        this.speed = 16;
        if (fooled) { this.state = 'climb'; this.timer = 2; this.cool = 4; break; }
        if (f >= 1) {
          const d = Math.hypot(player.x - this.x, player.z - this.z);
          if (alive && d < this.reach + 0.8 && !fooled) { dmg = s.damage; player.damage(s.damage, this.kind); }
          this.cool = s.cooldown; this.state = 'climb'; this.timer = 2.2;
        }
        break;
      }
      case 'climb': {
        this.cue(0);
        this.timer -= dt;
        this.alt = damp(this.alt, 11, 2.2, dt);
        const away = Math.atan2(this.x - player.x, this.z - player.z);
        this.heading = dampAngle(this.heading, away + 0.4, 4, dt);
        this.speed = 11; this.x += Math.sin(this.heading) * this.speed * dt; this.z += Math.cos(this.heading) * this.speed * dt;
        if (this.timer <= 0) { this.state = 'home'; if (this.swoops >= 3) { this.swoops = 0; this.ignore = 22; } }
        break;
      }
      case 'home': {
        this.cue(0);
        const d = Math.hypot(this.home.x - this.x, this.home.z - this.z);
        this.heading = dampAngle(this.heading, Math.atan2(this.home.x - this.x, this.home.z - this.z), 4, dt);
        this.speed = Math.min(12, 3 + d * 0.5);
        this.x += Math.sin(this.heading) * this.speed * dt; this.z += Math.cos(this.heading) * this.speed * dt;
        this.alt = damp(this.alt, this.perchAlt, 1.5, dt);
        if (d < 1.8) this.state = 'perch';
        break;
      }
      case 'climbaway': break;
    }
    if (this.state === 'climb' && this.fleeT > 0) this.fleeT -= dt;
    void flapSpeed;
    this.y = gy + this.alt;
    this.groundY = gy;
    this.sync(dt);
    return dmg;
  }

  /** returns damage dealt this frame (0 if none) */
  update(dt, player, world) {
    const s = this.spec;
    const dx = player.x - this.x, dz = player.z - this.z;
    const dist = Math.hypot(dx, dz);
    this.cool = Math.max(0, this.cool - dt); this.ignore = Math.max(0, this.ignore - dt);
    this.phase += dt * (1 + this.speed * 0.9);
    this.toPlayer = Math.atan2(dx, dz);
    if (player.camoProtected && dist < s.notice * 1.5) this.ignore = Math.max(this.ignore, 7);   // once fooled, it stays uninterested for a while
    // daily rhythm: foxes and cats prowl at night, everything else is sleepy in the dark
    const night = world.night ?? 0;
    this.act = s.nocturnal ? lerp(0.7, 1.45, night) : lerp(1, s.swoop ? 0.15 : 0.5, night);
    // ink clouds blind whoever walks into them
    for (const c of world.ink || []) if ((this.x - c.x) ** 2 + (this.z - c.z) ** 2 < (c.r * c.k) ** 2) { this.blind = Math.max(this.blind, 3.5); this.inkFrom = c; }
    this.blind = Math.max(0, this.blind - dt);
    if (s.swoop) return this.updateSwooper(dt, player, dist);
    if (s.flying) return this.updateEagle(dt, player, dist);
    if (this.blind > 0 && this.state !== 'carry' && this.state !== 'blind') { this.state = 'blind'; this.lift = 0; if (this.carrying) this.release(); }

    const fooled = player.camoProtected;      // hidden: nobody can see, track or hurt you (no close-range exception)
    const alive = player.alive && !player.won;
    const sprintBoost = player.sprinting ? 1.25 : 1;
    const noticeR = s.notice * (player.moving ? sprintBoost : 0.65) * this.act * (player.visibility ?? 1) * diff().notice;
    let dmg = 0;
    if (!fooled && alive && (this.state === 'alert' || this.state === 'chase' || this.state === 'stalk')) this.lastSeen = { x: player.x, z: player.z };

    switch (this.state) {
      case 'wander': {
        this.cue(0);
        this.timer -= dt;
        if (!this.target || this.pickTargetSoon || (this.timer <= 0)) {
          this.pickTargetSoon = false;
          if (RND() < 0.4) { this.target = null; this.timer = 1.5 + RND() * 3; } else { this.pickWanderTarget(); this.timer = 4 + RND() * 5; }
        }
        if (this.target) { if (this.walkToward(this.target.x, this.target.z, s.walk, dt) < 1.2) { this.target = null; } } else this.speed = damp(this.speed, 0, 6, dt);
        if (alive && this.ignore <= 0 && !fooled && dist < noticeR) {
          this.state = 'alert'; this.alertT = this.kind === 'cat' ? 0.9 : 0.55;
        } else if (s.tracker && alive && !fooled && this.ignore <= 0) {
          // dogs follow scent trails: pick up the freshest point of the trail that is close by
          const sc = world.scent;
          if (sc && sc.length > 3) {
            let best = null, bd = 26 * this.act;
            for (const q of sc) { const d = Math.hypot(q.x - this.x, q.z - this.z); if (d < bd) { bd = d; best = q; } }
            if (best) { this.state = 'track'; this.trackPt = best; this.cue(0.45); }
          }
        }
        break;
      }
      case 'track': {
        const sc = world.scent || [];
        this.cue(0.45);
        if (!alive || fooled || !this.trackPt) { this.state = 'search'; this.searchT = 3; break; }
        const pt = this.trackPt;
        if (this.walkToward(pt.x, pt.z, s.walk * 2.4, dt) < 2.2) {
          const i = sc.indexOf(pt);
          const nxt = i >= 0 ? sc[Math.min(sc.length - 1, i + 3)] : null;
          if (nxt && nxt !== pt) this.trackPt = nxt; else { this.lastSeen = { x: pt.x, z: pt.z }; this.state = 'search'; this.searchT = 4; }
        }
        if (this.ignore <= 0 && dist < noticeR) { this.state = 'alert'; this.alertT = 0.45; }
        break;
      }
      case 'blind': {
        this.cue(0.45);
        const c = this.inkFrom || { x: player.x, z: player.z };
        this.headTurn = Math.sin(this.phase * 2.5) * 1.1;
        this.walkToward(this.x + (this.x - c.x) * 4 + Math.sin(this.phase) * 6, this.z + (this.z - c.z) * 4 + Math.cos(this.phase) * 6, s.walk * 2, dt);
        if (this.blind <= 0) { this.state = 'leave'; this.timer = 4; this.ignore = 10; this.headTurn = 0; this.lastSeen = null; }
        break;
      }
      case 'flee': {
        this.cue(0.45);
        this.fleeT -= dt;
        const away = Math.atan2(this.x - player.x, this.z - player.z);
        this.walkToward(this.x + Math.sin(away) * 25, this.z + Math.cos(away) * 25, s.speed * 0.9, dt);
        if (this.fleeT <= 0) { this.state = 'leave'; this.timer = 4; this.ignore = 16; this.lastSeen = null; }
        break;
      }
      case 'search': {
        // lost the octopus: go back to where it was last seen and look around
        this.cue(0.45);
        if (!this.lastSeen) { this.state = 'leave'; this.timer = 3; break; }
        const d = this.walkToward(this.lastSeen.x, this.lastSeen.z, s.walk * 2.2, dt);
        if (d < 2.6) { this.speed = damp(this.speed, 0, 8, dt); this.searchT -= dt; this.headTurn = Math.sin(this.phase * 1.3) * 1.2; }
        if (alive && !fooled && this.ignore <= 0 && dist < noticeR * 0.8) { this.state = 'alert'; this.alertT = 0.45; this.headTurn = 0; break; }
        if (this.searchT <= 0) { this.state = 'leave'; this.timer = 5; this.ignore = 6; this.headTurn = 0; this.lastSeen = null; }
        break;
      }
      case 'circle': {
        // gulls: take off, circle overhead and call the others in
        this.cue(1);
        this.timer -= dt; this.circleA += dt * 1.7;
        const tx = player.x + Math.cos(this.circleA) * 8, tz = player.z + Math.sin(this.circleA) * 8;
        this.heading = dampAngle(this.heading, Math.atan2(tx - this.x, tz - this.z), 6, dt);
        this.speed = 10; this.x += Math.sin(this.heading) * this.speed * dt; this.z += Math.cos(this.heading) * this.speed * dt;
        this.lift = damp(this.lift, 7, 3, dt);
        if (fooled || !alive) { this.state = 'confused'; this.timer = 1.5; break; }
        if (this.timer <= 0) { this.state = 'chase'; this.chaseT = 0; }
        break;
      }
      case 'stalk': {
        // cats: crouch low, creep closer, then pounce
        this.cue(0);
        this.crouch = damp(this.crouch, 1, 6, dt);
        if (!alive) { this.state = 'wander'; break; }
        if (fooled) { this.state = 'confused'; this.timer = 1.6; break; }
        if (dist > s.notice * 1.9) { this.state = 'leave'; this.timer = 4; this.ignore = 6; break; }
        this.walkToward(player.x, player.z, s.walk * 1.25, dt);
        if (dist < 6.2 && this.cool <= 0) { this.state = 'pounce'; this.pounceT = 0; this.pounceDir = Math.atan2(dx, dz); this.pounceHit = false; }
        break;
      }
      case 'pounce': {
        this.cue(1);
        this.pounceT += dt / 0.55;
        const k = Math.min(1, this.pounceT);
        this.heading = this.pounceDir;
        this.speed = 17;
        const nx = this.x + Math.sin(this.pounceDir) * 17 * dt, nz = this.z + Math.cos(this.pounceDir) * 17 * dt;
        const r = world.resolve(nx, nz, 0.9); if (this.canWalk(r.x, r.z)) { this.x = r.x; this.z = r.z; }
        this.lift = Math.sin(Math.PI * k) * 1.1;
        this.lunge = k * 0.7;
        if (fooled) { this.state = 'confused'; this.timer = 1.4; this.lift = 0; this.lunge = 0; this.cool = s.cooldown; break; }
        if (!this.pounceHit && alive && dist < this.reach + 0.4) { this.pounceHit = true; dmg = s.damage * 1.3; player.damage(dmg, this.kind); }
        if (k >= 1) { this.state = 'stalk'; this.cool = s.cooldown * 2.2; this.lift = 0; this.lunge = 0; this.crouch = 0.6; }
        break;
      }
      case 'carry': {
        // the person with the bucket walks off with the octopus for a few seconds
        this.cue(1);
        if (!player.carried || player.carried.by !== this) { this.state = 'leave'; this.timer = 5; this.ignore = 10; this.carrying = false; break; }
        if (!this.target || this.pickTargetSoon) { this.pickWanderTarget(); this.pickTargetSoon = false; }
        if (this.walkToward(this.target.x, this.target.z, s.walk * 1.6, dt) < 1.5) this.target = null;
        break;
      }
      case 'alert': {
        this.cue(1);
        this.speed = damp(this.speed, 0, 10, dt);
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 9, dt);
        this.alertT -= dt;
        if (fooled) { this.state = 'confused'; this.timer = 1.4; break; }
        if (this.alertT <= 0) {
          if (fooled) { this.state = 'confused'; this.timer = 1.7; }
          else if (s.stalker) { this.state = 'stalk'; this.crouch = 0; }
          else if (s.caller && this.lift < 0.5 && !this.circled) {
            this.state = 'circle'; this.timer = 3.2; this.circled = true; this.circleA = Math.atan2(this.z - player.z, this.x - player.x);
            this.events.push({ type: 'call', kind: 'gull' });
            if (this.mgr) for (const q of this.mgr.list) if (q !== this && q.kind === 'gull' && q.state === 'wander' && Math.hypot(q.x - this.x, q.z - this.z) < 85) { q.state = 'alert'; q.alertT = 0.4 + RND() * 0.9; q.circled = false; q.ignore = 0; }
          }
          else { this.state = 'chase'; this.chaseT = 0; }
        }
        if (!alive) this.state = 'wander';
        break;
      }
      case 'chase': {
        this.cue(1);
        this.chaseT = (this.chaseT || 0) + dt;
        if (!alive) { this.state = 'leave'; this.timer = 3; break; }
        if (fooled) { this.state = 'confused'; this.timer = 1.7; break; }
        if (dist > s.notice * 1.9 || this.chaseT > 14) { this.state = 'leave'; this.timer = 4; this.ignore = 6; break; }
        this.lift = damp(this.lift, 0, 5, dt);
        this.walkToward(player.x, player.z, s.speed, dt);
        if (dist < this.reach && this.cool <= 0) { this.state = 'attack'; this.lunge = 0.0; this.lungeHit = false; }
        break;
      }
      case 'attack': {
        this.cue(1);
        this.speed = damp(this.speed, 0, 10, dt);
        this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 12, dt);
        if (fooled) { this.lunge = 0; this.state = 'confused'; this.timer = 1.4; this.cool = s.cooldown; break; }
        this.lunge += dt / 0.4;
        if (this.lunge > 0.5 && !this.lungeHit) {
          this.lungeHit = true;
          if (alive && dist < this.reach + 1.0 && !fooled) {
            if (this.hasBucket && !player.carried && !player.tunnel) {
              // scooped up in the bucket: carried for a few seconds (health loss), then dropped
              player.carried = { by: this, t: 0 }; this.carrying = true; this.state = 'carry'; this.lunge = 0; this.cool = s.cooldown;
              this.events.push({ type: 'grab' }); player.shake = Math.max(player.shake, 0.5); break;
            }
            dmg = s.damage; player.damage(s.damage, this.kind);
          }
        }
        if (this.lunge >= 1) {
          this.lunge = 0; this.cool = s.cooldown;
          this.state = fooled ? 'confused' : alive ? 'chase' : 'leave'; this.timer = 1.6;
          this.chaseT = Math.max(0, (this.chaseT || 0) - 3);
        }
        break;
      }
      case 'confused': {
        this.cue(0.45);
        this.speed = damp(this.speed, 0, 8, dt);
        this.timer -= dt;
        this.headTurn = Math.sin(this.timer * 6) * 0.9;
        // if the camo drops while it is still looking, it may spot you again
        if (!fooled && player.alive && dist < noticeR * 0.8) { this.state = 'alert'; this.alertT = 0.5; break; }
        if (this.timer <= 0) {
          this.headTurn = 0;
          if (this.lastSeen && s.tracker !== false && !s.crab) { this.state = 'search'; this.searchT = 4.5; this.ignore = 0; }
          else { this.state = 'leave'; this.timer = 5 + RND() * 3; this.ignore = 8; }
        }
        break;
      }
      case 'leave': {
        this.cue(0);
        this.timer -= dt;
        const away = Math.atan2(-dx, -dz) + Math.sin(this.phase * 0.2) * 0.4;
        this.walkToward(this.x + Math.sin(away) * 20, this.z + Math.cos(away) * 20, s.walk * 1.5, dt);
        this.lift = damp(this.lift, 0, 4, dt); this.circled = false;
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
    const fooled = player.camoProtected;
    let dmg = 0;
    const gy = w.heightAt(this.x, this.z);
    switch (this.state) {
      case 'wander': {          // soar in big circles
        this.cue(0);
        this.circleA += dt * 0.28;
        const R = 38;
        const tx = this.circleC.x + Math.cos(this.circleA) * R, tz = this.circleC.z + Math.sin(this.circleA) * R;
        this.heading = dampAngle(this.heading, Math.atan2(tx - this.x, tz - this.z), 2, dt);
        this.speed = 9;
        this.x += Math.sin(this.heading) * this.speed * dt; this.z += Math.cos(this.heading) * this.speed * dt;
        this.alt = damp(this.alt, 24 + Math.sin(this.phase * 0.05) * 3, 1.5, dt);
        const noticeR = s.notice * (player.moving ? (player.sprinting ? 1.2 : 1) : 0.45) * this.act * (player.visibility ?? 1) * diff().notice;
        if (alive && this.ignore <= 0 && !fooled && this.cool <= 0 && dist < noticeR) { this.state = 'alert'; this.alertT = 0.7; }
        break;
      }
      case 'alert': {
        this.cue(1);
        this.alertT -= dt;
        this.heading = dampAngle(this.heading, Math.atan2(player.x - this.x, player.z - this.z), 5, dt);
        this.x += Math.sin(this.heading) * 7 * dt; this.z += Math.cos(this.heading) * 7 * dt;
        if (fooled || !alive) { this.state = 'climb'; this.timer = 3; this.cue(0.45); break; }
        if (this.alertT <= 0) { this.state = 'dive'; this.diveT = 0; this.diveFrom = { x: this.x, z: this.z, a: this.alt }; this.hit = false; }
        break;
      }
      case 'dive': {
        this.cue(1);
        this.diveT += dt / Math.max(0.6, Math.min(1.5, dist / 30 + 0.55));
        const f = Math.min(1, this.diveT);
        const px = player.x, pz = player.z;                         // keeps tracking the player
        this.x = lerp(this.diveFrom.x, px, f * f); this.z = lerp(this.diveFrom.z, pz, f * f);
        this.alt = lerp(this.diveFrom.a, 0.7, f * f);
        this.heading = Math.atan2(px - this.x, pz - this.z);
        this.speed = 24;
        if (fooled) { this.state = 'climb'; this.timer = 3.5; this.cue(0.45); this.cool = 7; break; }
        if (f >= 1) {
          const d = Math.hypot(player.x - this.x, player.z - this.z);
          if (alive && d < this.reach + 0.6 && !fooled) { dmg = s.damage; player.damage(s.damage, 'eagle'); }
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
        if (this.timer <= 0) { this.state = 'wander'; this.circleC = { x: this.x + Math.cos(this.heading + 1.5) * 38, z: this.z + Math.sin(this.heading + 1.5) * 38 }; this.circleA = this.heading + Math.PI; this.ignore = 6; this.cue(0); }
        break;
      }
    }
    this.y = gy + this.alt;
    this.groundY = gy;
    this.sync(dt);
    return dmg;
  }

  /** ground shadow of a bird in the air: sharper and darker the lower it flies, gone when it is on the ground */
  updateShadow() {
    const d = this.shadowDisc; if (!d) return;
    const h = this.alt + (this.lift || 0);
    const on = h > 0.9 && this.state !== 'perch';
    d.visible = on;
    if (!on) return;
    const w = this.world;
    d.position.set(this.x, w.heightAt(this.x, this.z) + 0.06, this.z);
    const n = w.faceNormal(this.x, this.z, _sn); d.quaternion.setFromUnitVectors(_up, _sv.set(n.x, n.y, n.z));
    const r = (this.kind === 'eagle' ? 2.6 : 1.2) * this.scale * clamp(1.3 - h / 40, 0.55, 1.2);
    d.scale.set(r, r * 1.5, r);
    d.material.opacity = clamp(0.38 - h / 70, 0.08, 0.34);
  }

  sync(dt = 0) {
    this.updateShadow();
    const s = this.spec, p = this.parts, t = this.phase;
    this.group.position.set(this.x, this.y + (this.lift || 0), this.z);
    const faceOffset = s.side ? Math.PI / 2 : 0;
    this.group.rotation.y = this.heading + faceOffset;
    const mv = clamp(this.speed / (s.speed * 0.6 + 0.001), 0, 1.4);
    const swing = Math.sin(t * 3.2) * 0.7 * mv;
    if (s.flying) {
      this.awareV = damp(this.awareV, this.aware, 6, dt || 0.016);
      if (p.head) p.head.rotation.y = clamp(angleDiff(this.toPlayer, this.heading), -1.1, 1.1) * Math.min(1, this.awareV * 1.4);   // looks down at you before it commits
      const flap = this.state === 'dive' ? 0.15 : Math.sin(t * 0.9) * 0.15;
      if (s.swoop) p.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (this.state === 'perch' ? -0.9 : this.state === 'swoop' ? 0.6 : Math.sin(this.phase * 16) * 0.7); });
      else p.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (this.state === 'dive' ? 0.7 : flap + 0.08); });
      this.group.rotation.z = Math.sin(t * 0.2) * 0.15; this.group.rotation.x = this.state === 'dive' || this.state === 'swoop' ? 0.6 : this.state === 'climb' ? -0.35 : 0;
      return;
    }
    if (p.legs) p.legs.forEach((l, i) => { l.rotation.x = s.side ? 0 : swing * (i % 2 ? 1 : -1) * (this.kind === 'human' ? 0.9 : 1); if (s.side) l.rotation.z = (i % 2 ? 1 : -1) * Math.sin(t * 6 + i) * 0.25 * mv - (i < 3 ? -0.3 : 0.3) * 0; });
    if (p.arms) p.arms.forEach((a, i) => { a.rotation.x = -swing * (i ? 1 : -1) * 0.8 + (this.state === 'attack' ? -1.6 * Math.sin(this.lunge * Math.PI) : 0); });
    // ---- body language: awareness is read from the animal itself (no markers above heads)
    this.awareV = damp(this.awareV, this.state === 'blind' || this.state === 'leave' || this.state === 'home' ? 0 : this.aware, 6, dt || 0.016);
    const av = this.awareV;
    if (p.head) {
      // the head swings round to look at the octopus (more the more it has noticed), then tracks it
      const look = clamp(angleDiff(this.toPlayer, this.heading), -1.1, 1.1);
      p.head.rotation.y = lerp(this.headTurn, look, Math.min(1, av * 1.4) * (Math.abs(this.headTurn) < 0.05 ? 1 : 0.3));
      p.head.userData.y0 ??= p.head.position.y;
      p.head.position.y = p.head.userData.y0 + 0.1 * av;           // head up: ears up, eyes on you
      if (s.hop) p.head.position.z = 0.55 + Math.sin(t * 6.4) * 0.12 * mv;
    }
    if (p.tail) p.tail.rotation.y = Math.sin(t * 2.2) * 0.4 * (1 - 0.7 * av);        // tail goes stiff when it has seen you
    if (p.claws) p.claws.forEach((c, i) => { c.position.y = 0.7 + (this.state === 'attack' ? Math.sin(this.lunge * Math.PI) * 0.4 : Math.sin(t * 2 + i) * 0.04); });
    const lowSlung = this.kind === 'cat' || this.kind === 'fox' || this.kind === 'dog';
    if (this.crouch) { p.g.scale.y = 1 - 0.3 * this.crouch; if (this.state !== 'stalk' && this.state !== 'pounce') this.crouch = Math.max(0, this.crouch - dt * 3); } else p.g.scale.y = lowSlung ? 1 - 0.1 * av : 1;     // a quick crouch before they commit
    if (p.wings && !s.flying) p.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (this.lift > 0.4 ? Math.sin(this.phase * 14) * 0.7 : 0.55 * av); });     // wings half-raised when alarmed
    // body bob / lunge
    const lungeOff = this.state === 'attack' ? Math.sin(this.lunge * Math.PI) * 0.9 : 0;
    p.g.position.set(0, (s.hop ? Math.abs(Math.sin(t * 3.2)) * 0.18 * mv : Math.abs(Math.sin(t * 3.2)) * 0.06 * mv), lungeOff);
    p.g.rotation.x = this.state === 'attack' ? -Math.sin(this.lunge * Math.PI) * 0.25 : 0;
  }

  dispose(scene) {
    scene.remove(this.group);
    if (this.shadowDisc) { scene.remove(this.shadowDisc); this.shadowDisc.geometry.dispose(); this.shadowDisc.material.dispose(); }
    this.group.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); const m = o.material; if (m) { m.map?.dispose?.(); m.dispose(); } } });
  }
}

// ---------------------------------------------------------------- spawning / manager
// where each species lives: weighted lists of biomes (the world is split into 11 distinct biomes)
const HABITAT = {
  gull:  [{ b: ['beach', 'estuary', 'headland', 'dunes'], share: 0.65 }, { b: ['town'], share: 0.2 }, { b: ['wetland', 'suburb'], share: 0.15 }],
  cat:   [{ b: ['suburb'], share: 0.8 }, { b: ['town'], share: 0.2 }],
  dog:   [{ b: ['suburb'], share: 0.55 }, { b: ['farm'], share: 0.3 }, { b: ['town'], share: 0.15 }],
  fox:   [{ b: ['bush'], share: 0.45 }, { b: ['farm', 'riverbank'], share: 0.35 }, { b: ['dunes'], share: 0.2 }],
  crab:  [{ b: ['beach', 'headland'], share: 0.5 }, { b: ['wetland', 'estuary'], share: 0.5 }],
  eagle: [{ b: ['bush', 'farm', 'riverbank', 'headland'], share: 1 }],
  human: [{ b: ['suburb', 'town'], share: 0.5 }, { b: ['beach', 'estuary'], share: 0.5 }],
  magpie:     [{ b: ['suburb', 'farm', 'bush'], share: 1, tree: true }],
  kookaburra: [{ b: ['bush', 'riverbank', 'farm'], share: 1, tree: true }],
};
const PERCH_TREES = new Set(['gum', 'oak', 'paperbark', 'willow']);

export class PredatorManager {
  constructor(world, scene) {
    this.world = world; this.scene = scene; this.list = []; this.stormBirds = 0;
    setPredatorRng(world.rnd);
    if (!CONFIG.predators.enabled) return;
    const K = world.areaScale;                // counts in the config are per 800x800 m
    for (const [kind, per] of Object.entries(CONFIG.predators.counts)) {
      const hab = HABITAT[kind];
      const count = Math.round(per * K);
      for (let i = 0; i < count; i++) {
        let h = hab[0];
        if (hab.length > 1) { let r = world.rnd(), acc = 0; for (const q of hab) { acc += q.share; if (r <= acc) { h = q; break; } } }
        let spot = null;
        if (h.tree) spot = this.treeSpot(h.b);
        else spot = world.habitatSpot(h.b, h.types, CONFIG.predators.safeRadiusAtStart);
        if (spot) this.add(new Predator(kind, spot.x, spot.z, world, scene));
      }
    }
  }
  add(p) { p.mgr = this; this.list.push(p); return p; }
  /** a perch: a real tree (the bird sits in it) inside one of the biomes */
  treeSpot(biomes) {
    const w = this.world, trees = w.decor.trees;
    for (let i = 0; i < 300; i++) {
      const t = trees[Math.floor(w.rnd() * trees.length)];
      if (!t || !PERCH_TREES.has(t.kind)) continue;
      if (Math.hypot(t.x - w.start.x, t.z - w.start.z) < CONFIG.predators.safeRadiusAtStart + 10) continue;
      if (!biomes.includes(w.biomeAt(t.x, t.z))) continue;
      return { x: t.x, z: t.z };
    }
    return null;
  }
  /** Beyond the original map the land is endless and nobody lives out there: a few wanderers are spawned around the octopus
   *  (and despawned behind it). The further inland, the harsher: more eagles circle overhead. */
  farLife(dt, player) {
    const w = this.world;
    this._farT = (this._farT ?? 0) - dt; if (this._farT > 0 || !CONFIG.predators.enabled) return;
    this._farT = 2.5;
    if (Math.max(Math.abs(player.x), Math.abs(player.z)) < w.half + 20) return;
    const H = w.harshAt(player.x, player.z);
    let eagles = 0, ground = 0;
    for (const p of this.list) if (p.far) (p.kind === 'eagle' ? eagles++ : ground++);
    const wantE = Math.round(1 + 4 * H), wantG = Math.round(4 * (1 - 0.6 * H) * Math.min(1, w.areaScale / 2 + 0.5));
    for (let tries = 0; tries < 6 && (eagles < wantE || ground < wantG); tries++) {
      const a = w.rnd() * 6.28, d = 80 + w.rnd() * 90;
      const x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
      const hh = w.heightAt(x, z);
      let kind;
      if (eagles < wantE && (ground >= wantG || w.rnd() < 0.5)) kind = 'eagle';
      else if (w.tAt(x, z) > 0.86) { if (hh < 0.5 || w.tAt(x, z) > 1.0) continue; kind = w.rnd() < 0.5 ? 'gull' : 'crab'; }
      else { if (hh < 1.0 || w.waterAt(x, z)) continue; const r = w.rnd(); kind = r < 0.3 ? 'fox' : r < 0.55 ? 'dog' : r < 0.75 ? 'cat' : r < 0.9 ? 'magpie' : 'kookaburra'; }
      const p = this.spawn(kind, x, z); p.far = true;
      if (kind === 'eagle') eagles++; else ground++;
    }
  }
  spawn(kind, x, z) { return this.add(new Predator(kind, x, z, this.world, this.scene)); }
  /** venom bite: scare off the closest predator within reach (returns it, or null) */
  bite(player, range, sec) {
    let best = null, bd = range;
    for (const p of this.list) {
      const d = Math.hypot(p.x - player.x, p.z - player.z) - (p.spec.flying ? 0 : 0);
      if (d < bd && (!p.spec.flying || p.alt < 3)) { bd = d; best = p; }
    }
    if (best) best.scare(sec);
    return best;
  }
  update(dt, player) {
    let threat = 0; let hurt = 0; const R = CONFIG.predators.activeRadius;
    const events = [];
    const w = this.world;
    // storms bring more birds
    if (w.weatherKind === 'storm' && this.list.filter((p) => p.storm).length < Math.round(4 * w.areaScale)) {
      const a = w.rnd() * 6.28, d = 60 + w.rnd() * 40;
      const x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
      if (w.heightAt(x, z) > 0.4) { const g = this.spawn('gull', x, z); g.storm = true; }
    }
    this.farLife(dt, player);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.far && Math.hypot(p.x - player.x, p.z - player.z) > 300) { p.dispose(this.scene); this.list.splice(i, 1); continue; }
      if (p.storm && w.weatherKind !== 'storm' && Math.hypot(p.x - player.x, p.z - player.z) > 60) { p.dispose(this.scene); this.list.splice(i, 1); continue; }
    }
    for (const p of this.list) {
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      const near = d < R;
      p.group.visible = d < CONFIG.graphics.fogFar + 20;
      if (p.shadowDisc && !p.group.visible) p.shadowDisc.visible = false;
      if (!near) continue;
      hurt += p.update(dt, player, this.world);
      // ground-thump: every footfall of a heavy walker shakes the ground under the octopus (felt through the camera + a low thud)
      const wt = THUMP[p.kind];
      if (wt && p.speed > 0.8 && p.state !== 'perch') {
        const sg = Math.sign(Math.sin(p.phase * 3.2));
        if (p._sg !== undefined && sg !== p._sg) {
          const f = clamp(1 - d / (28 * p.scale), 0, 1);
          const amp = wt * clamp(p.speed / 5, 0.45, 1.3) * f * f;
          if (amp > 0.02) { player.thump = Math.max(player.thump || 0, amp); events.push({ type: 'thump', amp, x: p.x, y: p.y, z: p.z }); }
        }
        p._sg = sg;
      }
      if (p.events.length) { for (const e of p.events) events.push({ ...e, x: p.x, z: p.z, y: p.y + (p.lift || 0) + (p.alt || 0) }); p.events.length = 0; }
      if (p.state !== p._prev) {
        if (p.state === 'alert' && d < 70) events.push({ type: 'alert', who: p.spec.label, kind: p.kind, x: p.x, z: p.z, y: p.y + 1.5 });
        if (p.state === 'confused') events.push({ type: 'fooled', who: p.spec.label });
        p._prev = p.state;
      }
      if (p.state === 'chase' || p.state === 'attack' || p.state === 'dive' || p.state === 'alert' || p.state === 'swoop' || p.state === 'pounce' || p.state === 'stalk' || p.state === 'carry') threat = Math.max(threat, 1 - clamp(d / 45, 0, 1));
    }
    return { threat, hurt, events };
  }
  dispose() { for (const p of this.list) p.dispose(this.scene); this.list = []; }
}
