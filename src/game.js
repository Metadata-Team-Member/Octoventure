// =====================================================================
//  Game - ties world, octopus, predators, camera, HUD and audio together.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { WorldData } from './world/worldData.js';
import { WorldView, FOG_COLOR } from './world/worldView.js';
import { setFade } from './world/fade.js';
import { Octopus } from './entities/octopus.js';
import { PredatorManager } from './entities/predators.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { Music } from './systems/music.js';
import { Progress } from './systems/progress.js';
import { Environment } from './systems/environment.js';
import { Atmosphere } from './systems/atmosphere.js';
import { dailySeed } from './util/daily.js';
import { CarManager } from './entities/cars.js';
import { Collectibles } from './systems/collect.js';
import { Flowers } from './systems/flowers.js';
import { Effects } from './systems/effects.js';
import { Gatherer } from './systems/gather.js';
import { Abilities } from './systems/abilities.js';
import { Inventory, FX } from './systems/items.js';
import { Satchel } from './ui/satchel.js';
import { Clock } from './ui/clock.js';
import { Journal } from './systems/journal.js';
import { Plankton } from './systems/plankton.js';
import { Levels } from './systems/levels.js';
import { Shimmer } from './systems/shimmer.js';
import { SeaBeat } from './systems/seabeat.js';
import { Critters } from './systems/critters.js';
import { TOON } from './world/toon.js';
import { TIER, PEOPLE, BITE, killTier, nipsFor, killXP, lethal } from './systems/combat.js';
import { BIOMES } from './world/biomes.js';
import { snapshot, applySave, writeSave, clearSave, encodeCode, decodeCode, exploreCell } from './systems/save.js';
import { clamp, damp, lerp, mulberry32 } from './util/rng.js';
const _fadeT = new THREE.Vector3(), _camOff = new THREE.Vector3(), _camWant = new THREE.Vector3();   // (t241u: camera scratch, no per-frame allocation)

const TRAIL_MAX = 1200;
const CAUSE = { dry: 'The octopus dried out', gull: 'Pecked by a seagull', cat: 'Caught by a cat', dog: 'Chased down by a dog', fox: 'Caught by a fox', crab: 'Pinched by a crab', eagle: 'Snatched by an eagle', human: 'Picked up by a person', car: 'Hit by a car', magpie: 'Swooped by a magpie', kookaburra: 'Swooped by a kookaburra' };

export class Game {
  /** the map's dotted wander-trail: a point every 8 m, thinned (every other point dropped) when it grows past the cap */
  recordTrail(x, z) {
    const t = this.trail, n = t.length;
    if (n && (x - t[n - 2]) ** 2 + (z - t[n - 1]) ** 2 < 64) return;
    t.push(Math.round(x), Math.round(z));
    if (t.length > TRAIL_MAX * 2) { const k = []; for (let i = 0; i < t.length; i += 4) k.push(t[i], t[i + 1]); this.trail = k; }
  }
  constructor(canvas, params) {
    this.canvas = canvas;
    this.params = params;
    this.frame = 0;
    this.state = 'menu';
    this.runTime = 0;
    this.fps = 60;
    // t248u soft toon look: phones / tablets (touch only) get a lighter setup - no shadow map (blob shadows instead) and a lower
    // pixel-ratio cap; everyone gets toon materials and a hue-preserving tone curve (ACES greyed the saturated palette).
    this.mobile = params.get('mobile') === '1' || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile || (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? CONFIG.graphics.mobilePixelRatioCap : CONFIG.graphics.pixelRatioCap));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    if (params.get('size')) CONFIG.worldSize = Math.max(800, Math.min(4800, Math.round(Number(params.get('size')) / 100) * 100 || CONFIG.worldSize));
    this.shadows = params.get('shadows') === '1' || (params.get('shadows') !== '0' && CONFIG.graphics.shadows && !this.mobile);
    CONFIG.graphics.shadows = this.shadows;             // read by the world view / predators / cars when they decide who casts
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;  // (was PCFSoft: soft toon bands do the softening, a 4-tap PCF is enough)
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG_COLOR, CONFIG.graphics.fogNear, CONFIG.graphics.fogFar);
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.08, 1400);
    this.hud = new Hud();
    this.input = new Input(canvas);
    this.audio = new GameAudio();
    this.music = new Music();
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8d8466, 1.35);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.position.set(60, 90, 40);
    if (this.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(CONFIG.graphics.shadowMapSize, CONFIG.graphics.shadowMapSize);
      const R = CONFIG.graphics.shadowRange, sc = this.sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 10; sc.far = 260;
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
    this.inv = new Inventory();
    this.inv.onCraft = (r, all) => { this.levels.did('craft', { all }); this.journal.seeItem(r.out); };
    this.levels = new Levels(); this.levels.allBiomes = BIOMES.length; this.freshBadges = new Set();
    this.journal = new Journal();
    this.shimmer = new Shimmer(this.scene);
    this.seaBeat = new SeaBeat(this.scene);
    this.explored = new Set(); this.trail = []; this.saveT = 0; this.pendingSave = null;
    // saves are for the real game: a fixed ?seed= / ?daily world (tests, sharing a link) never reads or overwrites the one in the browser
    this.saveEnabled = !params.has('seed') && !params.has('daily') && !params.has('nosave');
    this.satchelOpen = false; this._suspendTick = false;
    this.satchel = new Satchel(this.hud.el.satchel, this);
    this.tideClock = new Clock(this.hud.el.clock);
    this.plankton = new Plankton(this.scene);
    this.seaMoment = null;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.paused = false;
    this.initSettings();
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.hud.el.pause.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#keys')) return; this.input.requestLock(); });   // the controls list is for reading, not clicking
    this.input.onKey = (e) => {
      if (e.code === 'KeyM' && !e.repeat && this.state !== 'menu') this.music.toggle();
      if (this.satchelOpen) { this.satchelKey(e); return; }
      if (e.code === 'Tab' && !e.repeat && this.state === 'playing') { this.openSatchel(); return; }
      // press any (real) key to start
      if (this.state === 'menu' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(F\d+|Tab|Escape|Shift.*|Control.*|Alt.*|Meta.*|CapsLock)$/.test(e.code)) this.begin();
      if (e.code === 'KeyR' && this.state !== 'playing' && this.state !== 'menu') this.restart();
    };
    this.hud.el.play.addEventListener('click', (e) => { this.begin(); if (e.shiftKey && !this.daily) { this.daily = true; this.saveSettings(); this.restart(); } });
    this.hud.el.opts.addEventListener('click', (e) => {
      e.stopPropagation();                                    // chips must not count as "click to resume"
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.diff) this.setDifficulty(b.dataset.diff);
      else if (b === this.hud.el.daily) { this.daily = !this.daily; this.saveSettings(); this.newRun(); }
      else if (b === this.hud.el.newWorld) this.newRun();
      else if (b === this.hud.el.copy) this.copyCode();
      else if (b === this.hud.el.paste) this.togglePaste();
    });
    this.hud.el.restart.addEventListener('click', () => this.restart());
    const ci = this.hud.el.codeIn;
    ci.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.applyCode(ci.value); });
    ci.addEventListener('keyup', (e) => e.stopPropagation());
    ci.addEventListener('paste', () => setTimeout(() => { if (/^\s*OCTO[01]-/.test(ci.value)) this.applyCode(ci.value); }, 0));
    // keep the save fresh when the page is hidden or closed
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.saveNow('hidden'); });
    window.addEventListener('pagehide', () => this.saveNow('hide'));
    window.addEventListener('beforeunload', () => this.saveNow('unload'));
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
    this.renderer.getDrawingBufferSize(TOON.uRes.value);
    TOON.uOutlinePx.value = 1.4 * this.renderer.getPixelRatio();
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
  /** pause-menu: leave the pause overlay and begin again somewhere else in the (one) world; Daily gives the day's shared start */
  newRun() { this.setPaused(false); this.restart(); }

  // ------------------------------------------------------------------ worlds
  newWorld(seed, save = null) {
    const hadWorld = this.hadWorld;
    if (this.view) { this.view.dispose(); this.predators.dispose(); this.cars?.dispose(); this.collect?.dispose(); this.fx?.dispose(); this.flowers?.dispose(); this.abilities?.dispose(); this.gather?.dispose(); this.critters?.dispose(); }
    // ONE fixed world for everyone (CONFIG.worldSeed); ?seed= is a dev/debug override only. Each new game starts somewhere else in it.
    const dbg = this.params.get('seed') ? Number(this.params.get('seed')) : CONFIG.seed;
    const s = seed ?? dbg ?? CONFIG.worldSeed;
    this.hadWorld = true;
    const g0 = performance.now();
    this.world = new WorldData(s);
    this.genMs = performance.now() - g0;
    // where this game begins: a saved position, or a fresh random start (the daily start is the same for everybody that day)
    if (save?.octo && !save.fresh) this.world.setSpawn(save.octo.x, save.octo.z);
    else this.world.pickSpawn(this.daily ? mulberry32(dailySeed()) : mulberry32((Math.random() * 4294967296) >>> 0));
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
    this.inv.reset();
    this.gather = new Gatherer(this.world, this.scene, this.audio);
    this.gather.onPick = (g) => { this.inv.add(g.kind); this.audio.gather(g.x, g.y, g.z); this.levels.did('gather'); this.journal.seeItem(g.kind); };
    this.abilities = new Abilities(this, this.gather);
    this.critters = new Critters(this.world, this.scene);
    this.world.scent = []; this.lastScent = null;
    this.runTime = 0; this.deadShown = false; this.threat = 0;
    this.progress.reset(); this.seaMoment = null; this.panYaw = 0;
    this.levels.reset(); this.levels.allBiomes = BIOMES.length; this.freshBadges.clear(); this.lv = { babies: 0, shells: 0, biomeT: 0, rain: 0, chased: false, calmT: 0 };
    this.journal.reset();
    this.camInit = false;
    this.input.yaw = Math.random() * Math.PI * 2; this.input.pitch = CONFIG.camera.pitch; this.input.zoom = 0;
    this.explored = new Set(); this.trail = []; this.saveT = 0; this.pendingSave = null;
    if (save) { applySave(this, save); this.pendingSave = save; }
    else if (hadWorld && this.saveEnabled) clearSave();          // a brand new world replaces whatever was saved
    this.lv.babies = this.progress.babies; this.lv.shells = this.progress.shells; this.applyPerks();
    this.updateCamera(0.016, true);
  }
  // ------------------------------------------------------------------ saving (no login: this browser's localStorage)
  saveNow(why = '') {
    if (!this.saveEnabled || this.state !== 'playing' || !this.octopus?.alive || !this.world || this.hud.el.loading.hidden === false) return false;
    return writeSave(snapshot(this));
  }
  saveSoon(why) { return this.saveNow(why); }
  /** "Copy code": the whole save as one short text */
  async copyCode() {
    if (this.state !== 'playing' || !this.octopus.alive) return false;
    const code = await encodeCode(snapshot(this)), chip = this.hud.el.copy;
    this.hud.el.codeIn.value = code;
    try { await navigator.clipboard.writeText(code); chip.classList.add('on'); setTimeout(() => chip.classList.remove('on'), 1100); return true; }
    catch { this.hud.el.codeIn.hidden = false; this.hud.el.codeIn.focus(); this.hud.el.codeIn.select(); return false; }      // no clipboard access: show the code to copy by hand
  }
  togglePaste() { const i = this.hud.el.codeIn; i.hidden = !i.hidden; if (!i.hidden) { i.value = ''; i.focus(); } }
  /** "Paste code": rebuild that world and carry on. A bad code just shakes the box. */
  async applyCode(text) {
    const i = this.hud.el.codeIn, s = await decodeCode(text);
    if (!s) { i.classList.remove('shake'); void i.offsetWidth; i.classList.add('shake'); return false; }
    i.hidden = true; i.value = '';
    this.hud.setLoading(true);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    this.newWorld(s.seed, s);
    this.state = 'playing'; this.hud.setLoading(false);
    this.setPaused(false); this.input.requestLock(); this.audio.resume();
    this.saveNow('code');
    return true;
  }

  /** pointer lock gained / lost: losing it mid-game pauses; regaining it resumes */
  onLockChange(locked) {
    this.canvas.classList.toggle('locked', locked);
    if (locked) { if (this._reLock) { clearTimeout(this._reLock); this._reLock = null; } if (this.satchelOpen) this.closeSatchel(); this.setPaused(false); return; }
    if (this.state === 'playing' && this.input.everLocked) this.setPaused(true);
  }
  setPaused(on) {
    if (this.paused === on) {
      // Tab can open the satchel while already paused: keep its bed, and hush the score.
      if (on && this.satchelOpen) { this.music?.setSatchel(true); this.audio.resume(); }
      return;
    }
    this.paused = on;
    if (on) this.saveNow('pause');
    this.hud.setPauseVisible(on && !this.satchelOpen);
    this.input.pressed.clear();
    if (on) {
      this.input.keys.clear();
      if (this.satchelOpen) { this.music?.setSatchel(true); this.audio.resume(); }
      else this.audio.ctx?.suspend?.();
    } else {
      this.music?.setSatchel(false);
      this.audio.resume();
      this.clock.getDelta();
    }
  }

  // ------------------------------------------------------------------ the satchel (Tab)
  /** Tab: the game stops completely (nothing dries, nothing moves) while the satchel is open */
  openSatchel() {
    if (this.state !== 'playing' || this.satchelOpen) return false;
    this.satchelOpen = true; this._reLock = null;
    this.hud.setPauseVisible(false);
    this.satchel.open(); this.hud.setSatchelVisible(true);
    this.tideClock?.update(this.env, true);
    this.setPaused(true);
    this.input.releaseLock();
    this.saveSoon?.('satchel');
    return true;
  }
  closeSatchel() {
    if (!this.satchelOpen) return false;
    this.satchelOpen = false; this._suspendTick = false; this.satchel.close(); this.hud.setSatchelVisible(false);
    const i = this.input;
    const needLock = i.lockSupported && i.everLocked && i._mock == null && !i.lockFailed;
    if (needLock) {
      // back to a real pause until the pointer returns: the satchel bed stops, the score stays quiet
      this.audio.ctx?.suspend?.();
      i.requestLock();
      this._reLock = setTimeout(() => { this._reLock = null; if (this.paused && !this.satchelOpen) this.hud.setPauseVisible(true); }, 450);
    } else this.setPaused(false);
    return true;
  }
  toggleSatchel() { return this.satchelOpen ? this.closeSatchel() : this.openSatchel(); }
  satchelKey(e) {
    const c = e.code;
    if (c === 'Tab' || c === 'Escape') { if (!e.repeat) this.closeSatchel(); return; }
    const dir = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] }[c];
    if (dir) { e.preventDefault(); this.satchel.nav(dir[0], dir[1]); }
    else if (c === 'Enter' || c === 'Space' || c === 'NumpadEnter') { e.preventDefault(); if (!e.repeat) this.satchel.activate(); }
    else if (!e.repeat && (c === 'KeyQ' || c === 'BracketLeft' || c === 'PageUp')) { e.preventDefault(); this.satchel.prevTab(); }
    else if (!e.repeat && (c === 'KeyE' || c === 'BracketRight' || c === 'PageDown')) { e.preventDefault(); this.satchel.nextTab(); }
    else if (!e.repeat && /^Digit[1-4]$/.test(c)) { e.preventDefault(); this.satchel.setTab(['bag','journal','map','collection'][+c.slice(-1) - 1]); }
  }

  begin() {
    if (this.state !== 'menu') return;
    if (this.pendingSave) { const s = this.pendingSave, o = this.octopus; this.pendingSave = null; o.health = s.octo.health; o.energy = s.octo.energy; for (const k in s.fx.buff) o.buff[k] = s.fx.buff[k]; o.inkCharges = s.fx.ink; o.venomReady = s.fx.venom; o.lethalDose = !!s.fx.lethal; }
    this.input.requestLock();
    this.audio.start(); this.audio.resume();
    this.music.attach(this.audio); this.music.start();
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
    if (inp.satchel && this.state === 'playing') { this.openSatchel(); return; }
    const o = this.octopus, world = this.world;
    const playing = this.state === 'playing';

    // camera-relative movement
    const yaw = this.input.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const control = { mx: fx * inp.f + rx * inp.r, mz: fz * inp.f + rz * inp.r, sprint: inp.sprint, camo: inp.camo, climbKey: inp.climb, pitch: this.input.pitch };
    if (!playing) { control.mx = control.mz = 0; control.camo = false; control.sprint = false; }

    const wasCamo = o.camoWanted, wasHealth = o.health, wasWater = o.waterKind;
    if (this.state === 'menu') { o.update(dt, control, world); }
    else o.update(dt, control, world);

    if (playing) {
      this.runTime += dt;
      const cell = exploreCell(o.x, o.z);
      if (!this.explored.has(cell)) { this.explored.add(cell); this.levels.did('cell'); }
      this.recordTrail(o.x, o.z);
      this.saveT += dt; if (this.saveT >= 30) { this.saveT = 0; this.saveNow('timer'); }
      this.env.update(dt);
      this.env.updatePuddles(dt, o);
      // abilities: ink (water only) and the venom bite (last resort)
      if (o.alive) {
        if (inp.ink) this.tryInk(); if (inp.bite) this.tryBite(); if (inp.nip) this.tryNip();
        if (inp.shelter) this.abilities.quickShelter(); if (inp.boost) this.abilities.quickBoost(); if (inp.den) this.abilities.use('den');
      }
      this.leaveScent(o);
      const ev = this.predators.update(dt, o);
      const carInfo = this.cars.update(dt, o);
      this.carInfo = carInfo;
      if (o.hitByCar) { o.hitByCar = false; this.audio.carHit(); }
      this.fx.update(dt, o, { step: (wet, spd) => this.audio.step(wet, spd) });
      this.collect.update(dt, o, this.runTime);
      const flowerTouches = this.flowers.touches;
      this.flowers.update(dt, o, this.runTime);
      if (this.flowers.touches > flowerTouches) this.journal.seeHow('flower');
      this.gather.update(dt, o);
      this.abilities.update(dt);
      if (o.restEvent) { o.restEvent = false; this.saveSoon?.('den'); }
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
      if (o.waterKind && !wasWater) this.audio.splash(o.waterKind, o.speed);       // only when coming in from dry land (not puddle -> stream hand-overs)
      this.updateLevels(dt);
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
    this.shimmer.update(dt, o);
    this.seaBeat.update(dt, o, world.seaLevel);
    if (playing) { this.critters.preds = this.predators.list; this.critters.update(dt, o, world.night, world.raining ? (this.env?.rain || 1) : 0); }
    if (playing) this.updateJournal();
    this.plankton?.update(dt, { night: world.night, biome: world.biomeAt(o.x, o.z), o, seaLevel: world.seaLevel });
    this.view.update(dt, { x: o.x, y: o.y, z: o.z }, this.camera);
    this.updateCamera(dt);
    this.updateAtmosphere(dt);
    this.hud.update(o);
    this.tideClock?.update(this.env, this.clockHidden());
    const coast = clamp(1 + world.distToSea(o.x, o.z) / 420, 0, 1);
    this.audio.update(dt, {
      coast, ambient: this.atmo.ambient, cam: this.camera, health: o.health, moving: o.moving, swim: o.swim, night: world.night,
      car: this.carInfo ? { dist: this.carInfo.dist, x: this.carInfo.x, y: world.heightAt(this.carInfo.x, this.carInfo.z) + 1, z: this.carInfo.z, horn: this.carInfo.horn, speed: this.carInfo.speed } : null,
    });
    this.music.update(dt, this);
    if (this.params.get('debug') === '1') {
      this.hud.setDebug(`fps ${this.fps.toFixed(0)}  state ${this.state}\npos ${o.x.toFixed(0)},${o.z.toFixed(0)}  h ${o.y.toFixed(1)}\nseed ${world.seed}  sea-dir ${(world.angle * 57.3).toFixed(0)}°  to-sea ${(-world.distToSea(o.x, o.z)).toFixed(0)}m\nterrain ${o.terrain}  water ${o.waterKind}\npredators ${this.predators.list.length}`);
    }
  }

  // ------------------------------------------------------------------ levels & badges (t241u / t242u): felt, never shown as numbers
  applyPerks() { const P = this.levels.perks, o = this.octopus; if (o) { o.perkDry = P.dry; o.perkCamo = P.camo; } }
  updateLevels(dt) {
    const o = this.octopus, w = this.world, L = this.levels, S = this.lv, p = this.progress;
    if (p.babies > S.babies) { for (let i = S.babies; i < p.babies; i++) L.did('baby'); S.babies = p.babies; this.journal.seeHow('baby'); }
    if (p.shells > S.shells) { for (let i = S.shells; i < p.shells; i++) L.did('shell'); S.shells = p.shells; }
    S.biomeT -= dt;
    if (S.biomeT <= 0) { S.biomeT = 0.5; L.did('biome', w.biomeAt(o.x, o.z)); }
    if (o.waterKind && w.night > 0.7) L.did('night');
    if (w.raining && !o.waterKind && o.moving) { S.rain += dt; if (S.rain >= 1) { S.rain -= 1; L.did('rain'); } }
    if (this.env.boltEvent && o.alive) L.did('storm');
    // getting away: something was really on to us, and then everything stayed calm for a few seconds
    if (this.threat > 0.5) { S.chased = true; S.calmT = 0; }
    else if (S.chased && this.threat < 0.04) { S.calmT += dt; if (S.calmT > 3) { S.chased = false; S.calmT = 0; L.did('escape'); } }
    for (const e of L.drain()) {
      if (e.type === 'level') { this.shimmer.burst('level'); this.audio.levelUp(); this.applyPerks(); }
      else if (e.type === 'badge') { this.freshBadges.add(e.id); this.shimmer.burst('badge'); this.audio.badge(); }
    }
  }

  // ------------------------------------------------------------------ abilities
  /** ink cloud: only works in water (or from a crafted ink sac). Predators in or near it lose the octopus and back off; birds lose sight if the octopus is under the cloud. */
  tryInk() {
    const o = this.octopus, w = this.world, A = CONFIG.abilities;
    if (o.tunnel || o.carried) return false;
    const charge = o.inkCharges > 0;                                   // a full ink sac: squirt anywhere, as often as it holds
    if (!charge && (o.inkCool > 0 || !(o.waterKind || w.isShallow(o.x, o.z)))) return false;
    if (charge) o.inkCharges--; else o.inkCool = A.inkCooldown;
    this.fx.ink(o.x, o.y + 0.3, o.z);
    this.audio.ink();
    return true;
  }
  /**
   * Beak bite (t250u, left click / X / pad X): a quick nip at whatever is right in front. The octopus lunges either way (a snap of
   * the beak at the air if nothing is there). A nipped animal flinches; small ones (up to one tier above what the octopus can kill)
   * back off for a moment; enough nips finish something the octopus's level can kill, otherwise it just bolts.
   */
  tryNip() {
    const o = this.octopus;
    if (o.nipCool > 0 || o.tunnel || o.carried || !o.alive) return false;
    o.nipCool = BITE.nipCooldown; o.nipT = 1; o.nipHard = 0;
    const p = this.predators.nearest(o, BITE.nipRange * (o.sz / 0.42));
    this.audio.snap(!!p);
    if (!p) return false;
    const tier = TIER[p.kind] ?? 2, kt = killTier(this.levels.level);
    o.shake = Math.max(o.shake, 0.2);
    if (p.nip() <= 0) {
      if (tier <= kt) this.killPredator(p, false);
      else { p.scare(CONFIG.abilities.biteScare * 0.6); p.hp = nipsFor(tier); }
    } else if (tier <= kt + 1) p.scare(BITE.nipScare);
    return true;
  }
  /**
   * Venomous bite (t250u / t251u, right click / B / pad RT): tetrodotoxin from the bacteria in its saliva goes in with the bite.
   * At low levels it is a deterrent (the predator bolts for a good while); from level 3 it kills small predators, then bigger ones
   * as the octopus levels up (systems/combat.js). A crafted lethal dose makes the next one lethal to any predator (never people).
   * The venom gland (amber rings) still makes it reach further and frighten for longer.
   */
  tryBite() {
    const o = this.octopus, A = CONFIG.abilities;
    if (o.biteCool > 0 || o.tunnel || o.carried || !o.alive) return false;
    const V = o.venomReady;
    const p = this.predators.nearest(o, A.biteRange * (V ? FX.venomRange : 1));
    if (!p) { if (o.nipT <= 0) { o.nipT = 1; o.nipHard = 0.3; this.audio.snap(false); } return false; }     // nothing in reach: a snap at the air, venom kept
    const dose = o.lethalDose && (TIER[p.kind] ?? 2) < PEOPLE;
    o.venomReady = false;
    o.biteCool = BITE.venomCooldown; o.biteFlash = 1; o.nipT = 1; o.nipHard = 0.6; o.shake = Math.max(o.shake, 0.55);
    this.fx.venom(o.x, o.y, o.z, p.x - o.x, p.z - o.z);
    this.audio.bite();
    if (lethal(p.kind, this.levels.level, dose)) { if (dose) o.lethalDose = false; this.killPredator(p, true); }
    else p.scare(A.biteScare * (V ? FX.venomScare : 1));
    return true;
  }
  killPredator(p, venom) {
    const tier = Math.min(4, TIER[p.kind] ?? 2);
    p.die();
    this.audio.kill(p.x, p.y + 0.5, p.z, tier);
    this.levels.did('kill', { tier, venom, xp: killXP(tier, venom) });
    this.kills = (this.kills || 0) + 1;
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
    if (this.saveEnabled) clearSave();                           // the run is over: nothing to continue
    const o = this.octopus;
    this.audio.die();
    this.hud.el.endTitle.textContent = CAUSE[o.lastDamage] || 'The octopus dried out';
    this.hud.el.restart.textContent = 'Restart game';
  }

  /** first arrival in the open sea: a quiet moment (camera drifts out to sea, surf swells, gentle fade) - and play simply continues */
  onSeaReached() {
    this.levels.did('sea');
    this.seaMoment = { t: 0, dur: 7 };
    this.seaBeat.start(this.octopus, this.world.seaLevel);
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
    const off = _camOff.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    // swimming at depth: the camera drops down beside the octopus so the water is visible around it
    const dv = o.dive || 0;
    const want = _camWant.set(tx + off.x, ty + C.height * 0.4 * k + off.y * (1 - dv * 0.8) - dv * 0.5 * k, tz + off.z);
    const gy = this.world.heightAt(want.x, want.z);
    if (want.y < gy + 0.9 * k) want.y = gy + 0.9 * k;
    if (!this.camInit || snap) { this.camPos.copy(want); this.camInit = true; }
    else this.camPos.lerp(want, 1 - Math.exp(-14 * dt));
    this.camera.position.copy(this.camPos);
    if (o.shake > 0.01) { const sk = o.shake * o.shake * 0.5 * k; this.camera.position.x += (Math.random() - 0.5) * sk; this.camera.position.y += (Math.random() - 0.5) * sk; this.camera.position.z += (Math.random() - 0.5) * sk; }
    setFade(this.camera.position, _fadeT.set(tx, ty, tz), k);
    if (o.thump > 0.01) this.camera.position.y -= o.thump * 0.35 * k * (Math.sin(performance.now() * 0.06) > 0 ? 1 : 0.4);   // footsteps of something big nearby jolt the view
    if (this.debugCam) { const d = this.debugCam; this.camera.position.set(d.x, d.y, d.z); this.camera.lookAt(d.lx, d.ly, d.lz); }       // dev screenshots only (G.setDebugCam)
    else this.camera.lookAt(tx, ty + 0.2 * k, tz);
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

  clockHidden() {
    return this.state !== 'playing' || this.paused || this.satchelOpen || !!this.seaBeat?.active || this.hud.el.start?.hidden === false;
  }
  updateJournal() {
    const J = this.journal, o = this.octopus;
    for (const p of this.predators.list) {
      if (!p.dead && p.group.visible && Math.hypot(p.x - o.x, p.z - o.z) < 22) J.seePred(p.kind);
    }
    for (const id of this.critters.kindsNear(o, 16)) J.seeCritter(id);
  }

  // ------------------------------------------------------------------ loop
  render() { this.renderer.render(this.scene, this.camera); }
  tick = () => {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.fps = lerp(this.fps, 1 / Math.max(dt, 1e-4), 0.05);
    if (this._suspendTick) { this.render(); this.frame++; this.raf = requestAnimationFrame(this.tick); return; }
    if (!this.paused) this.update(dt);
    else {
      const gp = this.input.pad.poll(dt);
      if (gp && this.state === 'playing') {
        if (this.satchelOpen) {
          if (gp.back || gp.ink || gp.pause) this.closeSatchel();
          else {
            if (gp.navX || gp.navY) this.satchel.nav(gp.navX, gp.navY);
            if (gp.a) this.satchel.activate();
            if (gp.shelter) this.satchel.prevTab();
            if (gp.boost) this.satchel.nextTab();
          }
        } else if (gp.back) this.openSatchel();
        else if (gp.pause) this.setPaused(false);
      }
      if (this.satchelOpen) this.satchel.tick(dt);
      this.tideClock?.update(this.env, this.clockHidden());
    }
    this.render();
    this.frame++;
    this.raf = requestAnimationFrame(this.tick);
  };
  run() { this.clock.start(); this.raf = requestAnimationFrame(this.tick); }

  /** advance the simulation without rendering (used by tests / debug) */
  advance(seconds, step = 1 / 30) {
    this._suspendTick = true;
    try { for (let t = 0; t < seconds; t += step) this.update(step); }
    finally { this._suspendTick = false; this.clock.getDelta(); }   // drop wall time so the next tick does not also apply it
  }
}
