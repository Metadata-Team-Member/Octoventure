// =====================================================================
//  Atmosphere - turns the Environment into light, sky, fog, stars, moon,
//  rain, lightning, heat shimmer and the underwater look.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, lerp, smoothstep as ss } from '../util/rng.js';
import { dotTexture, haloTexture, FOG_COLOR } from '../world/worldView.js';
import { BIOMES, BIOME_INFO } from '../world/biomes.js';

const C = (h) => new THREE.Color(h);
const PAL = {
  day:   { top: C(0x4d9de0), mid: C(0x9fd0f0), hor: C(FOG_COLOR) },
  dusk:  { top: C(0x4a6fb0), mid: C(0xf0a874), hor: C(0xf7cf9c) },
  night: { top: C(0x040a1c), mid: C(0x0a1736), hor: C(0x142548) },
  storm: { top: C(0x4d555f), mid: C(0x6f7882), hor: C(0x848c95) },
  heat:  { top: C(0x5aa0d8), mid: C(0xb6d6e6), hor: C(0xf0e2bf) },
};
const SUN_DAY = C(0xfff1d6), SUN_LOW = C(0xff9a55), MOON = C(0x8fa8ff);
const HEMI_SKY_DAY = C(0xcfe8ff), HEMI_SKY_NIGHT = C(0x3a4a86), HEMI_GR_DAY = C(0x8d8466), HEMI_GR_NIGHT = C(0x1a2030);
const UNDER = C(0x1b6f8f), UNDER_DEEP = C(0x0b3550);

const HAZE = new THREE.Color(0xd9ad7c);
export class Atmosphere {
  constructor(game) {
    this.g = game;
    this.top = new THREE.Color(); this.mid = new THREE.Color(); this.hor = new THREE.Color();
    this.sunDir = new THREE.Vector3(0.6, 0.9, 0.4).normalize();
    this.lightDir = this.sunDir.clone();
    this.under = 0;                 // 0..1 smoothed "camera is under the sea"
    this.flash = 0;
    this.build();
  }

  build() {
    const g = this.g, sky = g.sky;
    // stars
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.95 + 0.05;
      pos[i * 3] = Math.cos(a) * r * 850; pos[i * 3 + 1] = y * 850; pos[i * 3 + 2] = Math.sin(a) * r * 850;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -9;
    sky.add(this.stars);
    // sun and moon discs
    const mk = (hex, size, op) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color: hex, fog: false, transparent: true, opacity: op, depthWrite: false }));
      m.scale.set(size, size, 1); m.renderOrder = -8; sky.add(m); return m;
    };
    this.sunSprite = mk(0xfff2c8, 120, 0.95);
    this.sunGlow = mk(0xffd9a0, 380, 0.25);
    this.moonSprite = mk(0xe8eeff, 70, 0.95);
    // rain near the camera
    this.rainN = 650;
    const rp = new Float32Array(this.rainN * 3);
    this.rainSeed = new Float32Array(this.rainN * 3).map(() => Math.random());
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rainMat = new THREE.PointsMaterial({ color: 0xcfe6ff, size: 3.4, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0, depthWrite: false });
    this.rainPts = new THREE.Points(rg, this.rainMat); this.rainPts.frustumCulled = false; this.rainPts.visible = false;
    g.scene.add(this.rainPts);
    // heat shimmer motes
    this.heatN = 260;
    const hp = new Float32Array(this.heatN * 3);
    this.heatSeed = new Float32Array(this.heatN * 3).map(() => Math.random());
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    this.heatMat = new THREE.PointsMaterial({ color: 0xfff4d8, size: 5, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0, depthWrite: false });
    this.heatPts = new THREE.Points(hg, this.heatMat); this.heatPts.frustumCulled = false; this.heatPts.visible = false;
    g.scene.add(this.heatPts);
    // floating specks under the sea
    this.snowN = 220;
    const np = new Float32Array(this.snowN * 3);
    this.snowSeed = new Float32Array(this.snowN * 3).map(() => Math.random());
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.BufferAttribute(np, 3));
    this.snowMat = new THREE.PointsMaterial({ color: 0xbfeaf0, size: 3, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0, depthWrite: false });
    this.snowPts = new THREE.Points(ng, this.snowMat); this.snowPts.frustumCulled = false; this.snowPts.visible = false;
    g.scene.add(this.snowPts);
    // fireflies / glow-bugs (t241u): drift low over the ground at night, thickest in damp, green places
    this.flyN = 90;
    const fp = new Float32Array(this.flyN * 3);
    this.flySeed = new Float32Array(this.flyN * 3).map(() => Math.random());
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    this.flyMat = new THREE.PointsMaterial({ color: 0xd8ff7a, size: 4, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.fireflies = new THREE.Points(fg, this.flyMat); this.fireflies.frustumCulled = false; this.fireflies.visible = false;
    g.scene.add(this.fireflies);
    // the octopus's own faint glow, only noticeable in the dark
    // t248u: a soft additive halo sprite instead of a PointLight (a point light costs a lighting term on every lit pixel of every
    // material, all day long, even at intensity 0)
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0x5a8cff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    this.glow.position.set(0, 0.6, 0); this.glow.scale.setScalar(4.5); this.glow.renderOrder = 5;
  }
  attachGlow(octoGroup) { octoGroup.add(this.glow); }

  /** blend the per-biome lighting tint, fog thickness and ambient-sound mix at the player (smoothed) */
  _biome(dt, o) {
    const w = this.g.world, q = w.biomes.weights(o.x, o.z);
    if (!this.bTint) { this.bTint = new THREE.Color(0xffffff); this.bFog = 1; this.ambient = {}; }
    const tc = this._tmpC ??= new THREE.Color(), want = this._wantC ??= new THREE.Color();
    want.setRGB(0, 0, 0); let fog = 0;
    const amb = {};
    for (let i = 0; i < BIOMES.length; i++) {
      const wt = q[i]; if (wt < 0.001) continue;
      const info = BIOME_INFO[BIOMES[i]];
      want.r += tc.set(info.tint).r * wt; want.g += tc.g * wt; want.b += tc.b * wt;
      fog += info.fog * wt;
      for (const k in info.amb) amb[k] = (amb[k] || 0) + info.amb[k] * wt;
    }
    const k = 1 - Math.exp(-1.2 * dt);
    this.harsh = (this.harsh ?? 0) + (w.harshAt(o.x, o.z) - (this.harsh ?? 0)) * (1 - Math.exp(-0.5 * dt));   // far inland: a dry, warm haze
    this.bTint.lerp(want, k); this.bFog += (fog - this.bFog) * k;
    for (const key of ['hum', 'birds', 'wind', 'cows', 'babble', 'frogs', 'surf', 'gulls']) this.ambient[key] = (this.ambient[key] || 0) + ((amb[key] || 0) - (this.ambient[key] || 0)) * k;
  }

  update(dt, env, camera, o, prox, t) {
    const g = this.g, w = g.world;
    this._biome(dt, o);
    const day = env.daylight, night = env.night;
    // ---- sky palette -------------------------------------------------------------------
    const dusk = clamp(1 - Math.abs(env.sunElev) / 0.32, 0, 1) * (1 - env.dark * 0.6);   // golden hour around sunrise / sunset
    // (t241u optimisation: no Color allocations per frame - two scratch colours reused)
    const st = this._stC ??= new THREE.Color();
    const set = (k, c) => {
      c.copy(PAL.day[k]).lerp(PAL.heat[k], env.heat * 0.85).lerp(PAL.dusk[k], dusk * 0.9).lerp(PAL.night[k], night);
      c.lerp(st.copy(PAL.storm[k]).multiplyScalar(0.35 + 0.65 * day), env.dark * 0.9);
    };
    set('top', this.top); set('mid', this.mid); set('hor', this.hor);
    // salt haze when near the coast (the old hint)
    if (CONFIG.hints.saltHaze) this.hor.lerp(st.set(0xc4f0f4).multiplyScalar(0.25 + 0.75 * day), prox * prox * 0.7 * (1 - night * 0.6));
    // lightning
    this.flash = env.lightning;
    if (this.flash > 0) { this.top.lerp(st.set(0xdfe8ff), this.flash * 0.5); this.mid.lerp(st.set(0xeef2ff), this.flash * 0.6); this.hor.lerp(st.set(0xffffff), this.flash * 0.6); }
    // underwater: the camera is below the (moving) sea surface
    const wantUnder = camera.position.y < w.seaLevel - 0.05 && w.tAt(camera.position.x, camera.position.z) > 0.9 ? 1 : 0;
    this.under += (wantUnder - this.under) * (1 - Math.exp(-8 * dt));
    const u = this.under;
    const fogCol = (this._fogC ??= new THREE.Color()).copy(this.hor);
    if (u > 0.01) fogCol.lerp(st.copy(UNDER).lerp(UNDER_DEEP, clamp(-(camera.position.y - w.seaLevel) / 8 + 0.2, 0, 0.8)).multiplyScalar(0.4 + 0.6 * day), u);
    fogCol.lerp(this.bTint, 0.07 * day);
    if (this.harsh > 0.01 && u < 0.5) fogCol.lerp(HAZE, 0.3 * this.harsh * day * (1 - u));
    g.scene.fog.color.copy(fogCol);
    g.skyMat.uniforms.top.value.copy(this.top).lerp(fogCol, u);
    g.skyMat.uniforms.mid.value.copy(this.mid).lerp(fogCol, u);
    g.skyMat.uniforms.horizon.value.copy(fogCol);
    const far = lerp(CONFIG.graphics.fogFar, 150, env.dark) * lerp(1, 0.75, night) * lerp(1, 0.9, env.heat) * this.bFog * (1 - 0.12 * (this.harsh ?? 0));
    g.scene.fog.near = lerp(lerp(CONFIG.graphics.fogNear, 30, env.dark), 1.5, u);
    g.scene.fog.far = lerp(far, 55, u);

    // ---- sun / moon / lights -------------------------------------------------------------
    const a = (env.t - 0.25) * Math.PI * 2;
    const sx = Math.cos(a) * 0.85, sy = Math.sin(a), sz = 0.38;
    this.sunDir.set(sx, sy, sz).normalize();
    const moonDir = (this._moonDir ??= new THREE.Vector3()).set(-sx, -sy, -sz).normalize();
    const above = env.sunElev > -0.04;
    const lightDir = (this._lightDir ??= new THREE.Vector3()).copy(above ? this.sunDir : moonDir);
    lightDir.y = Math.max(lightDir.y, 0.28);                 // keep shadows sane near the horizon
    this.lightDir = lightDir.normalize();
    const sunCol = (this._sunC ??= new THREE.Color()).copy(SUN_DAY).lerp(SUN_LOW, dusk);
    const sunI = 2.6 * day * (1 - env.dark * 0.85) * (1 + env.heat * 0.15);
    const moonI = 0.9 * night * (1 - env.dark * 0.6);
    g.sun.color.copy(sunCol.lerp(MOON, night));
    g.sun.intensity = (sunI + moonI) * (1 - u * 0.55) + this.flash * 2.5;
    g.hemi.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, night).lerp(st.set(0xe8a070), dusk * 0.35);
    g.hemi.color.multiply(this.bTint);
    g.sun.color.lerp(this.bTint, 0.35 * day);
    g.hemi.groundColor.copy(HEMI_GR_DAY).lerp(HEMI_GR_NIGHT, night);
    g.hemi.intensity = (0.3 + 1.05 * day) * (1 - env.dark * 0.5) * (1 - u * 0.3) + 0.4 * night + this.flash * 1.6;
    g.renderer.toneMappingExposure = 0.86 + env.heat * 0.08 + night * 0.3;      // toon bands read brighter than PBR: base exposure trimmed (t248u)
    // glow of the rings, visible mostly in the dark and under water
    this.glow.material.opacity = Math.min(0.55, (night * 0.5 + u * 0.25)) * (o.alive ? 1 : 0) * (1 - (o.camoBlend || 0) * 0.8);

    // sky furniture (children of the sky dome, which follows the camera)
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(820);
    this.sunGlow.position.copy(this.sunDir).multiplyScalar(815);
    this.moonSprite.position.copy(moonDir).multiplyScalar(820);
    const vis = clamp(1 - env.dark * 1.2, 0, 1) * (1 - u);
    this.sunSprite.material.opacity = ss(-0.05, 0.1, env.sunElev) * vis;
    this.sunGlow.material.opacity = ss(-0.1, 0.2, env.sunElev) * 0.3 * vis * (1 + dusk);
    this.sunSprite.material.color.set(0xfff2c8).lerp(SUN_LOW, dusk);
    this.moonSprite.material.opacity = ss(0.0, 0.25, -env.sunElev) * vis;
    this.starMat.opacity = ss(0.05, 0.8, night) * (1 - env.dark) * (1 - u);

    // ---- rain / heat / specks follow the camera -------------------------------------------
    const cp = camera.position;
    const R = env.rain;
    this.rainPts.visible = R > 0.04 && u < 0.5;
    if (this.rainPts.visible) {
      this.rainMat.opacity = 0.2 + 0.55 * R;
      const arr = this.rainPts.geometry.attributes.position.array, S = this.rainSeed;
      const n = Math.floor(this.rainN * clamp(R * 1.1, 0.1, 1));
      this.rainPts.geometry.setDrawRange(0, n);
      for (let i = 0; i < n; i++) {
        const f = (S[i * 3] + t * (1.4 + S[i * 3 + 1] * 0.5)) % 1;
        arr[i * 3] = cp.x + (S[i * 3 + 1] - 0.5) * 46; arr[i * 3 + 1] = cp.y + 18 - f * 22; arr[i * 3 + 2] = cp.z + (S[i * 3 + 2] - 0.5) * 46;
      }
      this.rainPts.geometry.attributes.position.needsUpdate = true;
    }
    this.heatPts.visible = env.heat > 0.05 && u < 0.5;
    if (this.heatPts.visible) {
      this.heatMat.opacity = 0.2 * env.heat;
      const arr = this.heatPts.geometry.attributes.position.array, S = this.heatSeed;
      for (let i = 0; i < this.heatN; i++) {
        const f = (S[i * 3] + t * (0.12 + S[i * 3 + 1] * 0.1)) % 1;
        const x = cp.x + (S[i * 3 + 1] - 0.5) * 70 + Math.sin(t * 1.3 + i) * 0.6, z = cp.z + (S[i * 3 + 2] - 0.5) * 70;
        arr[i * 3] = x; arr[i * 3 + 1] = w.heightAt(x, z) + 0.3 + f * 3.2; arr[i * 3 + 2] = z;
      }
      this.heatPts.geometry.attributes.position.needsUpdate = true;
    }
    this.snowPts.visible = u > 0.2;
    if (this.snowPts.visible) {
      this.snowMat.opacity = 0.5 * u;
      const arr = this.snowPts.geometry.attributes.position.array, S = this.snowSeed;
      for (let i = 0; i < this.snowN; i++) {
        arr[i * 3] = cp.x + ((S[i * 3] * 30 + Math.sin(t * 0.3 + i) * 1.5 + t * 0.4 * S[i * 3 + 1]) % 30) - 15;
        arr[i * 3 + 1] = cp.y + (S[i * 3 + 1] - 0.5) * 14 - ((t * 0.3 * S[i * 3 + 2]) % 1) * 0.5;
        arr[i * 3 + 2] = cp.z + (S[i * 3 + 2] * 30 % 30) - 15;
      }
      this.snowPts.geometry.attributes.position.needsUpdate = true;
    }
    // fireflies at night (most over bush, creeks, wetlands and rainforest; none in the open desert or town)
    const q = w.biomes.weights(o.x, o.z), BI = this._bi ??= Object.fromEntries(BIOMES.map((n, i) => [n, i]));
    const green = clamp((q[BI.bush] ?? 0) + (q[BI.riverbank] ?? 0) + (q[BI.wetland] ?? 0) + (q[BI.rainforest] ?? 0) * 1.4 + (q[BI.farm] ?? 0) * 0.5 + (q[BI.suburb] ?? 0) * 0.3, 0, 1);
    const fly = night * (1 - R * 0.8) * (0.25 + 0.75 * green) * (1 - u);
    this.fireflies.visible = fly > 0.03;
    this.flyMat.opacity = fly;
    if (this.fireflies.visible) {
      const arr = this.fireflies.geometry.attributes.position.array, S = this.flySeed;
      for (let i = 0; i < this.flyN; i++) {
        const x = cp.x + (S[i * 3] - 0.5) * 50 + Math.sin(t * 0.35 + i * 1.7) * 2.2, z = cp.z + (S[i * 3 + 2] - 0.5) * 50 + Math.cos(t * 0.3 + i) * 2.2;
        const blink = Math.sin(t * (1.2 + S[i * 3 + 1]) + i * 2.1) > -0.2;
        arr[i * 3] = x; arr[i * 3 + 1] = blink ? w.heightAt(x, z) + 0.4 + S[i * 3 + 1] * 1.6 + Math.sin(t * 0.8 + i) * 0.25 : -999; arr[i * 3 + 2] = z;
      }
      this.fireflies.geometry.attributes.position.needsUpdate = true;
    }
    // heat haze: the camera "breathes" very slightly
    camera.fov = CONFIG.camera.fov + env.heat * 0.8 * Math.sin(t * 1.7);
    camera.updateProjectionMatrix();
  }

  dispose() {
    for (const o of [this.stars, this.rainPts, this.heatPts, this.snowPts, this.fireflies]) { o.geometry.dispose(); o.material.dispose(); o.parent?.remove(o); }
  }
}
