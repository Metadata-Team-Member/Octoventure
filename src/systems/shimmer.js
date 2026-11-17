// =====================================================================
//  Shimmer (t242u): the only sign of a level-up or a new badge. A spiral of sparkles rising around the octopus, a soft halo and a
//  ripple of light spreading over the ground. Pooled (one Points cloud, one ring, one halo sprite), created once, zero per-frame
//  allocation; it follows the octopus while it plays. The octopus itself never changes size or colour.
// =====================================================================
import * as THREE from 'three';
import { dotTexture } from '../world/worldView.js';

const N = 120;
export class Shimmer {
  constructor(scene) {
    this.p = new Float32Array(N * 3); this.c = new Float32Array(N * 3);
    this.seed = new Float32Array(N * 4); this.life = new Float32Array(N).fill(-1); this.i = 0;
    for (let k = 0; k < N; k++) this.p[k * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
    this.mat = new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, map: dotTexture(), vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 6;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48, 1), this.ringMat); this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false; this.ring.renderOrder = 6;
    this.haloMat = new THREE.SpriteMaterial({ map: dotTexture(), color: 0xbfeaff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.halo = new THREE.Sprite(this.haloMat); this.halo.visible = false; this.halo.renderOrder = 6;
    scene.add(this.pts, this.ring, this.halo);
    this.ringT = -1; this.ringStrong = 1; this.active = 0;
  }
  /** kind 'level' (blue-white, big) or 'badge' (warm gold, smaller) */
  burst(kind = 'level') {
    const lv = kind === 'level', n = lv ? 70 : 32;
    for (let j = 0; j < n; j++) {
      const k = this.i++ % N, s = k * 4;
      this.seed[s] = Math.random() * 6.283; this.seed[s + 1] = 0.35 + Math.random() * 0.75; this.seed[s + 2] = 0.6 + Math.random() * 0.9; this.seed[s + 3] = Math.random() * 0.5;
      this.life[k] = 0;
      const warm = !lv || Math.random() < 0.25;
      this.c[k * 3] = warm ? 1 : 0.62 + Math.random() * 0.3; this.c[k * 3 + 1] = warm ? 0.85 : 0.9; this.c[k * 3 + 2] = warm ? 0.45 : 1;
    }
    this.pts.geometry.attributes.color.needsUpdate = true;
    if (lv) { this.ringT = 0; this.ringStrong = 1; } else if (this.ringT < 0) { this.ringT = 0; this.ringStrong = 0.45; }
    this.haloColor = lv ? 0xbfeaff : 0xffe2a0; this.haloMat.color.setHex(this.haloColor);
    this.haloT = 0; this.haloStrong = lv ? 1 : 0.55;
    this.active = 3;
  }
  update(dt, o) {
    if (this.active <= 0) return;
    this.active -= dt;
    const sz = o.sz || 0.42, x = o.x, y = o.y, z = o.z;
    let alive = 0;
    for (let k = 0; k < N; k++) {
      let L = this.life[k]; if (L < 0) continue;
      L += dt; const s = k * 4, d = this.seed[s + 2] + 0.6;
      if (L > d) { this.life[k] = -1; this.p[k * 3 + 1] = -999; continue; }
      this.life[k] = L; alive++;
      const f = Math.max(0, L - this.seed[s + 3]) / d, a = this.seed[s] + f * 5.5, r = (0.6 + f * 1.4) * this.seed[s + 1] * sz * 2.2;
      this.p[k * 3] = x + Math.cos(a) * r; this.p[k * 3 + 1] = y + (0.15 + f * 2.6) * sz * 1.6; this.p[k * 3 + 2] = z + Math.sin(a) * r;
      const tw = (1 - f) * (0.6 + 0.4 * Math.sin(L * 30 + k));
      if (tw <= 0.02) this.p[k * 3 + 1] = -999;
    }
    this.pts.geometry.attributes.position.needsUpdate = true;
    this.mat.opacity = alive ? 0.95 : 0;
    // ripple of light over the ground
    if (this.ringT >= 0) {
      this.ringT += dt; const f = this.ringT / 1.4;
      if (f >= 1) { this.ringT = -1; this.ring.visible = false; }
      else { this.ring.visible = true; const R = (0.3 + f * 2.2) * sz * 1.8; this.ring.scale.set(R, R, R); this.ring.position.set(x, y + 0.04, z); this.ringMat.opacity = (1 - f) * (1 - f) * 0.55 * this.ringStrong; }
    }
    // soft halo
    if (this.haloT >= 0) {
      this.haloT += dt; const f = this.haloT / 1.6;
      if (f >= 1) { this.haloT = -1; this.halo.visible = false; }
      else { const b = Math.sin(Math.PI * Math.min(1, f * 1.3)) * this.haloStrong; this.halo.visible = true; this.halo.position.set(x, y + 0.45 * sz, z); const S = (0.9 + f * 0.7) * sz * 2.2; this.halo.scale.set(S, S, 1); this.haloMat.opacity = b * 0.4; }
    }
  }
}
