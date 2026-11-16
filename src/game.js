// =====================================================================
//  Game - ties world, octopus, predators, camera, HUD and audio together.
// =====================================================================
import * as THREE from 'three';
import { CONFIG, TERRAIN } from './config.js';
import { WorldData } from './world/worldData.js';
import { WorldView, FOG_COLOR } from './world/worldView.js';
import { Octopus } from './entities/octopus.js';
import { PredatorManager } from './entities/predators.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { clamp, damp, lerp } from './util/rng.js';

const CAUSE = { dry: 'The octopus dried out', gull: 'Pecked by a seagull', cat: 'Caught by a cat', dog: 'Chased down by a dog', fox: 'Caught by a fox', crab: 'Pinched by a crab', eagle: 'Snatched by an eagle', human: 'Picked up by a person' };

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
    this.shadows = params.get('shadows') !== '0' && CONFIG.graphics.shadows;
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG_COLOR, CONFIG.graphics.fogNear, CONFIG.graphics.fogFar);
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.2, 1400);
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
    this.camPos = new THREE.Vector3();
    this.camInit = false;
    this.clock = new THREE.Clock();
    this.deadShown = false;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.input.onKey = (e) => {
      if (e.code === 'KeyM') this.audio.toggleMute();
      // press any (real) key to start
      if (this.state === 'menu' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(F\d+|Tab|Escape|Shift.*|Control.*|Alt.*|Meta.*|CapsLock)$/.test(e.code)) this.begin();
      if (e.code === 'KeyR' && this.state !== 'playing' && this.state !== 'menu') this.restart();
    };
    this.hud.el.play.addEventListener('click', () => this.begin());
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

  // ------------------------------------------------------------------ worlds
  newWorld(seed) {
    if (this.view) { this.view.dispose(); this.predators.dispose(); }
    // ?seed= / CONFIG.seed only fix the FIRST world; every restart rolls a new world (and a new sea direction)
    const fixed = this.params.get('seed') ? Number(this.params.get('seed')) : CONFIG.seed;
    const s = seed ?? (!this.hadWorld && fixed != null ? fixed : Math.floor(Math.random() * 1e9));
    this.hadWorld = true;
    this.world = new WorldData(s);
    this.view = new WorldView(this.world, this.scene, { shadows: this.shadows });
    if (!this.octopus) this.octopus = new Octopus(this.world, this.scene); else this.octopus.reset(this.world);
    this.predators = new PredatorManager(this.world, this.scene);
    this.runTime = 0; this.deadShown = false; this.threat = 0;
    this.camInit = false;
    this.input.yaw = Math.random() * Math.PI * 2; this.input.pitch = CONFIG.camera.pitch; this.input.zoom = 0;
    this.updateCamera(0.016, true);
  }

  begin() {
    if (this.state !== 'menu') return;
    this.audio.start(); this.audio.resume();
    this.state = 'playing';
    this.hud.setStartVisible(false);
  }

  restart(seed) {
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
    const inp = this.input.read();
    const o = this.octopus, world = this.world;
    const playing = this.state === 'playing';

    // camera-relative movement
    const yaw = this.input.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const control = { mx: fx * inp.f + rx * inp.r, mz: fz * inp.f + rz * inp.r, sprint: inp.sprint, camo: inp.camo };
    if (!playing) { control.mx = control.mz = 0; control.camo = false; control.sprint = false; }

    const wasCamo = o.camoWanted, wasLocked = o.camoLocked, wasHealth = o.health, wasWater = o.waterKind;
    if (this.state === 'menu') { o.update(dt, control, world); }
    else o.update(dt, control, world);

    if (playing) {
      this.runTime += dt;
      const ev = this.predators.update(dt, o);
      this.threat = damp(this.threat ?? 0, ev.threat, 4, dt);
      // warning display: the blue rings flash while a predator is on to us
      if (!this.forceAlarm) o.alarm = damp(o.alarm, this.threat > 0.04 ? 1 : 0, 9, dt);
      for (const e of ev.events) {
        if (e.type === 'alert') this.audio.alert();
      }
      if (o.health < wasHealth - 4 && wasHealth - o.health > dt * 30) this.audio.hurt();
      if (o.camoWanted && !wasCamo) { this.audio.camo(true); }
      if (!o.camoWanted && wasCamo) { this.audio.camo(false); }
      if (o.waterKind && o.waterKind !== wasWater) this.audio.splash();
      if (!o.alive) this.onDeath();
      else if (world.isSea(o.x, o.z) && o.y < -0.2) this.onWin();
    } else {
      this.threat = damp(this.threat ?? 0, 0, 4, dt);
      o.alarm = damp(o.alarm, 0, 6, dt);
    }
    if (this.state === 'dead' && !this.deadShown && o.deadT > 1.4) {
      this.deadShown = true;
      this.hud.setEndVisible(true);
    }

    this.view.update(dt, { x: o.x, y: o.y, z: o.z }, this.camera);
    this.updateCamera(dt);
    this.updateAtmosphere(dt);
    this.hud.update(o);
    const coast = clamp(1 + world.distToSea(o.x, o.z) / 420, 0, 1);
    this.audio.update(dt, coast, o.sprinting);
    if (this.params.get('debug') === '1') {
      this.hud.setDebug(`fps ${this.fps.toFixed(0)}  state ${this.state}\npos ${o.x.toFixed(0)},${o.z.toFixed(0)}  h ${o.y.toFixed(1)}\nseed ${world.seed}  sea-dir ${(world.angle * 57.3).toFixed(0)}°  to-sea ${(-world.distToSea(o.x, o.z)).toFixed(0)}m\nterrain ${o.terrain}  water ${o.waterKind}\npredators ${this.predators.list.length}`);
    }
  }

  onDeath() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    const o = this.octopus;
    this.audio.die();
    this.hud.el.endTitle.textContent = CAUSE[o.lastDamage] || 'The octopus dried out';
    this.hud.el.restart.textContent = 'Restart game';
  }

  onWin() {
    if (this.state !== 'playing') return;
    this.state = 'won'; this.octopus.won = true;
    this.audio.win();
    this.hud.el.endTitle.textContent = 'You made it to the sea!';
    this.hud.el.restart.textContent = 'Play again';
    this.hud.setEndVisible(true);
  }

  fmt(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }

  updateCamera(dt, snap = false) {
    const o = this.octopus, C = CONFIG.camera;
    const dist = clamp(C.distance + this.input.zoom, C.minDistance, C.maxDistance);
    const yaw = this.input.yaw, pitch = this.input.pitch;
    const tx = o.x, ty = o.y + 0.9, tz = o.z;
    const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    const want = new THREE.Vector3(tx + off.x, ty + C.height * 0.4 + off.y, tz + off.z);
    const gy = this.world.heightAt(want.x, want.z);
    if (want.y < gy + 0.9) want.y = gy + 0.9;
    if (!this.camInit || snap) { this.camPos.copy(want); this.camInit = true; }
    else this.camPos.lerp(want, 1 - Math.exp(-14 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(tx, ty + 0.2, tz);
    this.sky.position.copy(this.camera.position);
    // sun & shadow follow the octopus
    this.sun.position.set(tx + 60, ty + 90, tz + 40);
    this.sun.target.position.set(tx, ty, tz);
    this.sun.target.updateMatrixWorld();
  }

  updateAtmosphere(dt) {
    const o = this.octopus, w = this.world;
    if (!CONFIG.hints.saltHaze) return;
    const prox = clamp(1 + w.distToSea(o.x, o.z) / 380, 0, 1);       // 0 far inland ... 1 at shore
    const f = this.scene.fog.color;
    f.set(FOG_COLOR).lerp(new THREE.Color(0xc4f0f4), prox * prox * 0.7);
    this.skyMat.uniforms.horizon.value.copy(f);
  }

  // ------------------------------------------------------------------ loop
  render() { this.renderer.render(this.scene, this.camera); }
  tick = () => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.fps = lerp(this.fps, 1 / Math.max(dt, 1e-4), 0.05);
    this.update(dt);
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
