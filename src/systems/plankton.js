// =====================================================================
//  Bioluminescent plankton (t254u): a cheap pooled point cloud in the sea and
//  estuary at night. Specks drift with a slow swirl, and brighten and spin
//  faster when the octopus swims through them. No lights (additive points only).
// =====================================================================
import * as THREE from 'three';
import { dotTexture } from '../world/worldView.js';
import { clamp } from '../util/rng.js';

const N = 280;
const R = 18;                 // radius of the field around the octopus (m)

export class Plankton {
  constructor(scene) {
    this.scene = scene;
    this.pos = new Float32Array(N * 3);
    this.seed = new Float32Array(N * 4);     // ox, oz, phase, size
    for (let i = 0; i < N; i++) {
      this.seed[i * 4] = Math.random();
      this.seed[i * 4 + 1] = Math.random();
      this.seed[i * 4 + 2] = Math.random() * 6.2832;
      this.seed[i * 4 + 3] = 0.6 + Math.random() * 1.4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: 0xb8ffe6, size: 4.6, sizeAttenuation: false, map: dotTexture(),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.pts = new THREE.Points(g, this.mat);
    this.pts.frustumCulled = false; this.pts.visible = false; this.pts.renderOrder = 6;
    scene.add(this.pts);
    this.glow = 0; this.spin = 0; this.T = 0;
    this._px = 0; this._pz = 0;
  }
  /**
   * @param night 0..1  @param biome current biome name  @param o octopus  @param seaLevel
   */
  update(dt, { night, biome, o, seaLevel }) {
    const wet = biome === 'sea' || biome === 'estuary';
    const under = wet && (o.waterKind || (o.y < (seaLevel ?? 0) + 0.4));
    const want = under ? clamp(night * 1.15, 0, 1) : 0;
    this.glow += (want - this.glow) * (1 - Math.exp(-2.4 * dt));
    const on = this.glow > 0.02;
    this.pts.visible = on;
    this.mat.opacity = this.glow * (0.82 + 0.35 * Math.min(1, this.spin));
    if (!on) { this.spin = Math.max(0, this.spin - dt * 0.8); return; }
    this.T += dt;
    // swimming through the field swirls and brightens it
    const dx = o.x - this._px, dz = o.z - this._pz;
    const spd = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
    this._px = o.x; this._pz = o.z;
    if (spd > 0.8 && under) this.spin = Math.min(1.6, this.spin + dt * 1.8 * Math.min(1, spd / 5));
    else this.spin = Math.max(0, this.spin - dt * 0.55);
    const a = this.T * (0.15 + this.spin * 0.9);
    const seed = this.seed, pos = this.pos, y0 = (seaLevel ?? 0) - 0.2;
    for (let i = 0; i < N; i++) {
      const ox = seed[i * 4], oz = seed[i * 4 + 1], ph = seed[i * 4 + 2], sz = seed[i * 4 + 3];
      const ang = ox * 6.2832 + a * (0.6 + oz);
      const rad = 1.2 + oz * (R - 1.2);
      const wobble = Math.sin(this.T * 1.4 * sz + ph) * 0.35 * (0.5 + this.spin);
      pos[i * 3] = o.x + Math.cos(ang) * rad + Math.cos(ph + a) * wobble;
      pos[i * 3 + 1] = y0 - 0.15 - oz * 1.8 + Math.sin(this.T * 0.9 + ph) * 0.25;
      pos[i * 3 + 2] = o.z + Math.sin(ang) * rad + Math.sin(ph + a) * wobble;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.mat.size = 4.6 + this.spin * 2.4;
  }
  get active() { return this.pts.visible; }
  dispose() {
    this.scene.remove(this.pts);
    this.pts.geometry.dispose(); this.mat.dispose();
  }
}
