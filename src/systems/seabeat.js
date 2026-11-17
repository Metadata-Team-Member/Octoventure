// =====================================================================
//  The sea arrival moment (t241u): the first time the octopus reaches the open sea, a calm underwater beat - shafts of sunlight
//  slanting down through the water, a stream of bubbles rising around it, a soft swell of music - and then play simply goes on.
//  Built once and pooled (a few additive shafts + one Points cloud); nothing allocates per frame.
// =====================================================================
import * as THREE from 'three';
import { dotTexture } from '../world/worldView.js';

const NB = 70, NS = 6;
export class SeaBeat {
  constructor(scene) {
    this.t = -1; this.dur = 7;
    const cone = new THREE.CylinderGeometry(0.35, 1.3, 9, 10, 1, true); cone.translate(0, -4.5, 0);
    this.shaftMat = new THREE.MeshBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.shafts = [];
    for (let i = 0; i < NS; i++) { const m = new THREE.Mesh(cone, this.shaftMat); m.visible = false; m.renderOrder = 5; m.frustumCulled = false; scene.add(m); this.shafts.push(m); }
    this.bp = new Float32Array(NB * 3); this.bs = new Float32Array(NB * 3).map(() => Math.random());
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.bp, 3));
    this.bMat = new THREE.PointsMaterial({ color: 0xe8fbff, size: 5, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.bubbles = new THREE.Points(g, this.bMat); this.bubbles.frustumCulled = false; this.bubbles.visible = false; scene.add(this.bubbles);
  }
  start(o, seaLevel) {
    this.t = 0; this.x = o.x; this.z = o.z; this.top = seaLevel;
    for (let i = 0; i < NS; i++) { const s = this.shafts[i], a = i * 1.07 + Math.random() * 0.5, r = 1.5 + (i % 3) * 1.6; s.position.set(o.x + Math.cos(a) * r, seaLevel, o.z + Math.sin(a) * r); s.rotation.set(0.28 * Math.sin(a), 0, 0.28 * Math.cos(a)); s.visible = true; }
    this.bubbles.visible = true;
  }
  get active() { return this.t >= 0; }
  update(dt, o, seaLevel) {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / this.dur;
    if (k >= 1) { this.t = -1; for (const s of this.shafts) s.visible = false; this.bubbles.visible = false; this.shaftMat.opacity = 0; this.bMat.opacity = 0; return; }
    const bell = Math.sin(Math.PI * k);
    this.shaftMat.opacity = 0.16 * bell * (0.85 + 0.15 * Math.sin(this.t * 1.7));
    for (let i = 0; i < NS; i++) this.shafts[i].rotation.y = this.t * 0.05 + i;
    this.bMat.opacity = 0.75 * bell;
    const S = this.bs;
    for (let i = 0; i < NB; i++) {
      const f = (S[i * 3] + this.t * (0.25 + S[i * 3 + 1] * 0.3)) % 1, a = S[i * 3 + 2] * 6.28 + this.t * 0.6;
      const r = 0.15 + S[i * 3 + 1] * 1.4;
      this.bp[i * 3] = o.x + Math.cos(a) * r; this.bp[i * 3 + 1] = Math.min(seaLevel - 0.02, o.y + f * 3.5); this.bp[i * 3 + 2] = o.z + Math.sin(a) * r;
    }
    this.bubbles.geometry.attributes.position.needsUpdate = true;
  }
}
