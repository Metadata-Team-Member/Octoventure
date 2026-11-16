// =====================================================================
//  Game - ties world, octopus, predators, camera, HUD and audio together.
// =====================================================================
import * as THREE from 'three';
import { CONFIG, TERRAIN } from './config.js';
import { WorldData } from './world/worldData.js';
import { WorldView, FOG_COLOR } from './world/worldView.js';
import { setFade } from './world/fade.js';
import { Octopus } from './entities/octopus.js';
import { PredatorManager } from './entities/predators.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { Progress } from './systems/progress.js';
import { Environment } from './systems/environment.js';
import { Atmosphere } from './systems/atmosphere.js';
import { dailySeed } from './util/daily.js';
import { CarManager } from './entities/cars.js';
import { Collectibles } from './systems/collect.js';
import { Flowers } from './systems/flowers.js';
import { Effects } from './systems/effects.js';
import { clamp, damp, lerp } from './util/rng.js';
const _fadeT = new THREE.Vector3();

const CAUSE = { dry: 'The octopus dried out', gull: 'Pecked by a seagull', cat: 'Caught by a cat', dog: 'Chased down by a dog', fox: 'Caught by a fox', crab: 'Pinched by a crab', eagle: 'Snatched by an eagle', human: 'Picked up by a person', car: 'Hit by a car', magpie: 'Swooped by a magpie', kookaburra: 'Swooped by a kookaburra' };

export class Game {
  constructor(canvas, params) {
    this.canvas = canvas;
    this.params = params;
    this.frame = 0;
    this.state = 'menu';
    this.runTime = 0;
    this.fps = 60;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.graphics.pixelRatioCap));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    if (params.get('size')) CONFIG.worldSize = Math.max(800, Math.min(4800, Math.round(Number(params.get('size')) / 100) * 100 || CONFIG.worldSize));
    this.shadows = params.get('shadows') !== '0' && CONFIG.graphics.shadows;
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG_COLOR, CONFIG.graphics.fogNear, CONFIG.graphics.fogFar);
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.08, 1400);
    this.hud = new Hud();
    this.input = new Input(canvas);
    this.audio = new GameAudio();
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8d8466, 1.35);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.position.set(60, 90, 40);
    if (this.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 260;
      this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.4;
    }
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.buildSky();
    this.atmo = new Atmosphere(this);
    this.camPos = new THREE.Vector3();
    this.camInit = false;
    this.clock = new THREE.Clock();
    this.deadShown = false;
    this.progress = new Progress();
    this.seaMoment = null;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.paused = false;
    this.initSettings();
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.hud.el.pause.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#keys')) return; this.input.requestLock(); });   // the controls list is for reading, not clicking
    this.input.onKey = (e) => {
      if (e.code === 'KeyM') this.audio.toggleMute();
      // press any (real) key to start
      if (this.state === 'menu' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(F\d+|Tab|Escape|Shift.*|Control.*|Alt.*|Meta.*|CapsLock)$/.test(e.code)) this.begin();
      if (e.code === 'KeyR' && this.state !== 'playing' && this.state !== 'menu') this.restart();
    };
    this.hud.el.play.addEventListener('click', (e) => { this.begin(); if (e.shiftKey && !this.daily) { this.daily = true; this.saveSettings(); this.restart(dailySeed()); } });
    this.hud.el.opts.addEventListener('click', (e) => {
      e.stopPropagation();                                    // chips must not count as "click to resume"
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.diff) this.setDifficulty(b.dataset.diff);
      else if (b === this.hud.el.daily) { this.daily = !this.daily; this.saveSettings(); this.newRun(); }
      else if (b === this.hud.el.newWorld) this.newRun();
    });
    this.hud.el.restart.addEventListener('click', () => this.restart());
    this.hud.el.start.addEventListener('click', () => this.begin());
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(900, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x4d9de0) }, mid: { value: new THREE.Color(0x9fd0f0) }, horizon: { value: new THREE.Color(FOG_COLOR) } },
      vertexShader: `varying vec3 vP;
void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vP;
void main(){
  float h = normalize(vP).y;
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
  c = mix(c, top, smoothstep(0.15, 0.75, h));
  if (h < 0.0) c = horizon;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ settings (difficulty / daily seed)
  initSettings() {
    let st = {}; try { st = JSON.parse(localStorage.getItem('octo.settings') || '{}'); } catch { /* storage unavailable */ }
    const d = (this.params.get('difficulty') || st.difficulty || CONFIG.difficulty || 'normal').toLowerCase();
    CONFIG.difficulty = CONFIG.difficulties[d] ? d : 'normal';
    this.daily = this.params.has('daily') ? this.params.get('daily') !== '0' : !!st.daily;
    this.hud.setOptions({ difficulty: CONFIG.difficulty, daily: this.daily });
  }
  saveSettings() {
    this.hud.setOptions({ difficulty: CONFIG.difficulty, daily: this.daily });
    try { localStorage.setItem('octo.settings', JSON.stringify({ difficulty: CONFIG.difficulty, daily: this.daily })); } catch { /* ignore */ }
  }
  setDifficulty(d) { if (!CONFIG.difficulties[d]) return; CONFIG.difficulty = d; this.saveSettings(); }
  /** pause-menu: leave the pause overlay and start a fresh world (the daily world when Daily is on) */
  newRun() { this.setPaused(false); this.restart(this.daily ? dailySeed() : undefined); }

  // ------------------------------------------------------------------ worlds
  newWorld(seed) {
    if (this.view) { this.view.dispose(); this.predators.dispose(); this.cars?.dispose(); this.collect?.dispose(); this.fx?.dispose(); this.flowers?.dispose(); }
    // ?seed= / CONFIG.seed only fix the FIRST world; every restart rolls a new world (and a new sea direction)
    const fixed = this.params.get('seed') ? Number(this.params.get('seed')) : CONFIG.seed;
    const s = seed ?? (!this.hadWorld && fixed != null ? fixed : this.daily ? dailySeed() : Math.floor(Math.random() * 1e9));
    this.hadWorld = true;
    const g0 = performance.now();
    this.world = new WorldData(s);
    this.genMs = performance.now() - g0;
    this.view = new WorldView(this.world, this.scene, { shadows: this.shadows });
    if (!this.octopus) this.octopus = new Octopus(this.world, this.scene); else this.octopus.reset(this.world);
    this.env = new Environment(this.world);
    this.atmo.attachGlow(this.octopus.group);
    this.predators = new PredatorManager(this.world, this.scene);
    this.cars = new CarManager(this.world, this.scene);
    this.fx = new Effects(this.world, this.scene);
    this.progress.reset();
    this.collect = new Collectibles(this.world, this.scene, this.progress, this.audio);
    this.flowers = new Flowers(this.world, this.scene, this.audio);
    this.world.scent = []; this.lastScent = null;
    this.runTime = 0; this.deadShown = false; this.threat = 0;
    this.progress.reset(); this.seaMoment = null; this.panYaw = 0;
    this.camInit = false;
    this.input.yaw = Math.random() * Math.PI * 2; this.input.pitch = CONFIG.camera.pitch; this.input.zoom = 0;
    this.updateCamera(0.016, true);
  }

  /** pointer lock gained / lost: losing it mid-game pauses; regaining it resumes */
  onLockChange(locked) {
    this.canvas.classList.toggle('locked', locked);
    if (locked) { this.setPaused(false); return; }
    if (this.state === 'playing' && this.input.everLocked) this.setPaused(true);
  }
  setPaused(on) {
    if (this.paused === on) return;
    this.paused = on;
    this.hud.setPauseVisible(on);
    if (on) { this.input.keys.clear(); this.audio.ctx?.suspend?.(); } else { this.audio.resume(); this.clock.getDelta(); }
  }

  begin() {
    if (this.state !== 'menu') return;
    this.input.requestLock();
    this.audio.start(); this.audio.resume();
    this.state = 'playing';
    this.hud.setStartVisible(false);
  }

  restart(seed) {
    this.input.requestLock();
    this.audio.resume();
    this.hud.setEndVisible(false);
    this.hud.setLoading(true);
    // let the browser paint the "building" card before the (short) synchronous generation
    requestAnimationFrame(() => setTimeout(() => {
      this.newWorld(seed);
      this.state = 'playing';
      this.hud.setLoading(false);
    }, 30));
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const inp = this.input.read(dt);
    if (inp.pause && this.state === 'playing') { this.setPaused(true); return; }
    const o = this.octopus, world = this.world;
    const playing = this.state === 'playing';

    // camera-relative movement
    const yaw = this.input.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const control = { mx: fx * inp.f + rx * inp.r, mz: fz * inp.f + rz * inp.r, sprint: inp.sprint, camo: inp.camo, climbKey: inp.climb, pitch: this.input.pitch };
    if (!playing) { control.mx = control.mz = 0; control.camo = false; control.sprint = false; }

    const wasCamo = o.camoWanted, wasLocked = o.camoLocked, wasHealth = o.health, wasWater = o.waterKind;
    if (this.state === 'menu') { o.update(dt, control, world); }
    else o.update(dt, control, world);

    if (playing) {
      this.runTime += dt;
      this.env.update(dt);
      this.env.updatePuddles(dt, o);
      // abilities: ink (water only) and the venom bite (last resort)
      if (o.alive) { if (inp.ink) this.tryInk(); if (inp.bite) this.tryBite(); }
      this.leaveScent(o);
      const ev = this.predators.update(dt, o);
      const carInfo = this.cars.update(dt, o);
      this.carInfo = carInfo;
      if (o.hitByCar) { o.hitByCar = false; this.audio.carHit(); }
      this.fx.update(dt, o, { step: (wet, spd) => this.audio.step(wet, spd) });
      this.collect.update(dt, o, this.runTime);
      this.flowers.update(dt, o, this.runTime);
      if (o.tunnelEvent) { o.tunnelEvent = null; this.audio.squeeze(); }
      if (o.climbEvent) { o.climbEvent = null; this.audio.climb(); }
      if (o.hideEvent) o.hideEvent = null;
      this.threat = damp(this.threat ?? 0, ev.threat, 4, dt);
      // warning display: the blue rings flash while a predator is on to us
      if (!this.forceAlarm) o.alarm = damp(o.alarm, this.threat > 0.04 ? 1 : 0, 9, dt);
      for (const e of ev.events) {
        if (e.type === 'alert') this.audio.creature(e.kind, e.x, e.y ?? 1.5, e.z);
        else if (e.type === 'call') this.audio.creature(e.kind, e.x, e.y ?? 2, e.z);
        else if (e.type === 'grab') this.audio.grab();
        else if (e.type === 'thump') this.audio.thump(e.amp, e.x, e.y, e.z);
      }
      if (o.health < wasHealth - 4 && wasHealth - o.health > dt * 30) this.audio.hurt();
      if (o.camoWanted && !wasCamo) { this.audio.camo(true); }
      if (!o.camoWanted && wasCamo) { this.audio.camo(false); }
      if (o.waterKind && o.waterKind !== wasWater) this.audio.splash();
      if (!o.alive) this.onDeath();
      else if (world.isSea(o.x, o.z) && o.y < world.seaLevel - 0.2 && this.progress.markSea(this.runTime)) this.onSeaReached();
    } else {
      this.threat = damp(this.threat ?? 0, 0, 4, dt);
      o.alarm = damp(o.alarm, 0, 6, dt);
    }
    if (this.state === 'dead' && !this.deadShown && o.deadT > 1.4) {
      this.deadShown = true;
      this.hud.setEndVisible(true);
      this.input.releaseLock();       // free the cursor so the Restart button can be clicked
    }

    this.updateSeaMoment(dt);
    this.view.update(dt, { x: o.x, y: o.y, z: o.z }, this.camera);
    this.updateCamera(dt);
    this.updateAtmosphere(dt);
    this.hud.update(o);
    const coast = clamp(1 + world.distToSea(o.x, o.z) / 420, 0, 1);
    this.audio.update(dt, {
      coast, ambient: this.atmo.ambient, cam: this.camera, health: o.health, moving: o.moving, swim: o.swim, night: world.night,
      car: this.carInfo ? { dist: this.carInfo.dist, x: this.carInfo.x, y: world.heightAt(this.carInfo.x, this.carInfo.z) + 1, z: this.carInfo.z, horn: this.carInfo.horn, speed: this.carInfo.speed } : null,
    });
    if (this.params.get('debug') === '1') {
      this.hud.setDebug(`fps ${this.fps.toFixed(0)}  state ${this.state}\npos ${o.x.toFixed(0)},${o.z.toFixed(0)}  h ${o.y.toFixed(1)}\nseed ${world.seed}  sea-dir ${(world.angle * 57.3).toFixed(0)}°  to-sea ${(-world.distToSea(o.x, o.z)).toFixed(0)}m\nterrain ${o.terrain}  water ${o.waterKind}\npredators ${this.predators.list.length}`);
    }
  }

  // ------------------------------------------------------------------ abilities
  /** ink cloud: only works in water. Blinds anything that walks into it. */
  tryInk() {
    const o = this.octopus, w = this.world, A = CONFIG.abilities;
    if (o.inkCool > 0 || o.tunnel || o.carried || !(o.waterKind || w.isShallow(o.x, o.z))) return false;
    o.inkCool = A.inkCooldown;
    this.fx.ink(o.x, o.y + 0.3, o.z);
    this.audio.ink();
    return true;
  }
  /** venom bite: scares off an adjacent predator; long cooldown, so it really is a last resort */
  tryBite() {
    const o = this.octopus, A = CONFIG.abilities;
    if (o.biteCool > 0 || o.tunnel || o.carried) return false;
    const p = this.predators.bite(o, A.biteRange, A.biteScare);
    if (!p) return false;
    o.biteCool = A.biteCooldown; o.biteFlash = 1; o.shake = Math.max(o.shake, 0.55);
    this.fx.venom(o.x, o.y, o.z, p.x - o.x, p.z - o.z);
    this.audio.bite();
    return true;
  }
  /** the dogs' trail: a breadcrumb of scent points that fade after half a minute (water washes it away) */
  leaveScent(o) {
    const w = this.world, sc = w.scent;
    w.scentNow = this.runTime;
    if (o.moving && !o.waterKind && !o.tunnel && !o.swim && (!this.lastScent || Math.hypot(o.x - this.lastScent.x, o.z - this.lastScent.z) > 1.6)) {
      sc.push({ x: o.x, z: o.z, t: this.runTime }); this.lastScent = { x: o.x, z: o.z };
    }
    if (o.waterKind) sc.length = 0;
    while (sc.length && this.runTime - sc[0].t > 32) sc.shift();
    if (sc.length > 80) sc.shift();
  }

  onDeath() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    const o = this.octopus;
    this.audio.die();
    this.hud.el.endTitle.textContent = CAUSE[o.lastDamage] || 'The octopus dried out';
    this.hud.el.restart.textContent = 'Restart game';
  }

  /** first arrival in the open sea: a quiet moment (camera drifts out to sea, surf swells, gentle fade) - and play simply continues */
  onSeaReached() {
    this.seaMoment = { t: 0, dur: 7 };
    this.audio.seaArrival();
  }
  updateSeaMoment(dt) {
    const m = this.seaMoment;
    const fade = document.getElementById('fade');
    if (!m) { this.panYaw = 0; return; }
    m.t += dt;
    const k = m.t / m.dur;
    if (k >= 1) { this.seaMoment = null; this.panYaw = 0; if (fade) fade.style.opacity = '0'; return; }
    const bell = Math.sin(Math.PI * k);
    // look out over the water, then drift back to wherever the player was looking
    const w = this.world, want = Math.atan2(-w.dir.x, -w.dir.z);   // yaw whose camera forward points at the sea
    let d = want - this.input.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.panYaw = d * bell * 0.8;
    if (fade) fade.style.opacity = (bell * 0.4).toFixed(3);
  }

  fmt(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }

  updateCamera(dt, snap = false) {
    const o = this.octopus, C = CONFIG.camera;
    const k = o.sz ?? 1;                                          // the camera scales with the octopus: close and low, so the world towers
    const dist = clamp(C.distance + this.input.zoom, C.minDistance, C.maxDistance) * k;
    const yaw = this.input.yaw + (this.panYaw || 0), pitch = this.input.pitch;
    const tx = o.x, ty = o.y + 0.9 * k, tz = o.z;
    const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    // swimming at depth: the camera drops down beside the octopus so the water is visible around it
    const dv = o.dive || 0;
    const want = new THREE.Vector3(tx + off.x, ty + C.height * 0.4 * k + off.y * (1 - dv * 0.8) - dv * 0.5 * k, tz + off.z);
    const gy = this.world.heightAt(want.x, want.z);
    if (want.y < gy + 0.9 * k) want.y = gy + 0.9 * k;
    if (!this.camInit || snap) { this.camPos.copy(want); this.camInit = true; }
    else this.camPos.lerp(want, 1 - Math.exp(-14 * dt));
    this.camera.position.copy(this.camPos);
    if (o.shake > 0.01) { const sk = o.shake * o.shake * 0.5 * k; this.camera.position.x += (Math.random() - 0.5) * sk; this.camera.position.y += (Math.random() - 0.5) * sk; this.camera.position.z += (Math.random() - 0.5) * sk; }
    setFade(this.camera.position, _fadeT.set(tx, ty, tz), k);
    if (o.thump > 0.01) this.camera.position.y -= o.thump * 0.35 * k * (Math.sin(performance.now() * 0.06) > 0 ? 1 : 0.4);   // footsteps of something big nearby jolt the view
    this.camera.lookAt(tx, ty + 0.2 * k, tz);
    this.sky.position.copy(this.camera.position);
    // sun & shadow follow the octopus
    const L = this.atmo.lightDir; this.sun.position.set(tx + L.x * 120, ty + L.y * 120, tz + L.z * 120);
    this.sun.target.position.set(tx, ty, tz);
    this.sun.target.updateMatrixWorld();
  }

  updateAtmosphere(dt) {
    const o = this.octopus, w = this.world;
    const prox = clamp(1 + w.distToSea(o.x, o.z) / 380, 0, 1);       // 0 far inland ... 1 at shore
    this.atmo.update(dt, this.env, this.camera, o, prox, this.view.time);
  }

  // ------------------------------------------------------------------ loop
  render() { this.renderer.render(this.scene, this.camera); }
  tick = () => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.fps = lerp(this.fps, 1 / Math.max(dt, 1e-4), 0.05);
    if (!this.paused) this.update(dt);
    else { const gp = this.input.pad.poll(dt); if (gp?.pause && this.state === 'playing') this.setPaused(false); }
    this.render();
    this.frame++;
    this.raf = requestAnimationFrame(this.tick);
  };
  run() { this.clock.start(); this.raf = requestAnimationFrame(this.tick); }

  /** advance the simulation without rendering (used by tests / debug) */
  advance(seconds, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.update(step);
  }
}
