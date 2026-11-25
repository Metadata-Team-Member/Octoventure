// =====================================================================
//  Ambient critters (t241u / t255u): harmless life going about its business near
//  the octopus, in the soft-toon style with outlines. Skinks bask and dart, ants
//  march, dragonflies hover and zip, ghost crabs sidle and burrow. New in t255u:
//  frogs hop at the water's edge, hermit crabs wander the sand, butterflies
//  flutter, and small fairy-wrens hop and flit. All of them may come a little
//  closer out of curiosity, then startle and flee; some tuck themselves away at
//  night or in the rain. None can be hurt. Each discovered kind is noted in the
//  field journal.
//
//  Performance: one InstancedMesh per kind (plus thin outline hulls except for
//  ants), small fixed pools recycled around the player, all scratch objects
//  preallocated. Ants and frogs are the soft-toon glbs: one shared skinned mesh
//  for the ones close enough to see move, and one instanced bind-pose stand-in
//  (same colours, far fewer triangles) for the rest. Mixers run only for that
//  nearby cap — never the whole pool.
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { toonMat, outlineMat, outline } from '../world/toon.js';
import { bakeToonSkinned, crossFadeGait } from '../world/toonGlb.js';
import { tint, merge, at } from '../world/models.js';
import { separate } from '../util/separate.js';
import antUrl from '../assets/models/ant.glb?url';
import frogUrl from '../assets/models/frog.glb?url';

const SKINK_B = new Set(['desert', 'bush', 'suburb', 'farm', 'headland', 'dunes', 'rainforest', 'riverbank', 'wasteland']);
const ANT_B = new Set(['desert', 'bush', 'suburb', 'farm', 'town', 'dunes', 'rainforest']);
const FLY_B = new Set(['wetland', 'riverbank', 'estuary', 'rainforest', 'farm', 'wasteland']);
const CRAB_B = new Set(['beach', 'dunes', 'estuary', 'headland', 'mudflat', 'wasteland']);
const FROG_B = new Set(['wetland', 'rainforest', 'riverbank', 'estuary', 'mudflat']);
const HERM_B = new Set(['beach', 'dunes', 'estuary']);
const BUTT_B = new Set(['bush', 'rainforest', 'wetland', 'farm', 'suburb', 'riverbank', 'dunes']);
const WREN_B = new Set(['bush', 'farm', 'suburb', 'wetland', 'rainforest', 'riverbank', 'mudflat']);
const NS = 10, NT = 6, PER = 22, NF = 8, NC = 8, NFR = 6, NH = 6, NB = 8, NW = 6, R_FAR = 46;
const ANT_N = NT * PER;
const ANT_NEAR = 4;                       // metres: skinned walk / idle. Trails spawn from 8 m, so a standing view does not pay for mixers.
const ANT_FADE = 0.15;
const ANT_TINT = { AntBody: 0xC2522D, AntBelly: 0xE8A070, AntEye: 0x1a1a1a, AntHighlight: 0xffffff };
const ANT_PART = { AntBody: 0, AntBelly: 1, AntEye: 2, AntHighlight: 3 };
// Far stand-in: keep the biggest triangles of each body part so the silhouette
// (and the belly / eyes) survive, at about the old procedural triangle budget.
const ANT_BUDGET = {
  head: 18, thorax: 10, abdomen: 16, ant_L: 4, ant_R: 4, root: 2,
  leg_LF: 6, leg_LM: 6, leg_LH: 6, leg_RF: 6, leg_RM: 6, leg_RH: 6,
  p1: 10, p2: 8, p3: 4,
};
const FROG_NEAR = 14;                     // metres: skinned idle / hop / croak / tongue
const FROG_HOP = 0.58;                    // air time, matched to the hop clip (was 1/2.6 ~ 0.38 s)
const FROG_CROAK_R = 22;                 // nearest frog within this of the camera takes the croak
const FROG_TINT = {
  back: 0xA8EC3C, flank: 0xE8C83A, blotch: 0x2A3214, belly: 0xF4E8C8, eyeRing: 0xE8B43A,
  eye: 0x141416, highlight: 0xffffff, mouth: 0x3A281C, pad: 0xF0C8B0, throat: 0xF6D8C0,
  tongue: 0xE87A7A, leg: 0xC8D43A,
};
const FROG_PART = {
  back: 0, flank: 0, blotch: 0, belly: 0, throat: 0, leg: 0, pad: 0, mouth: 0,
  eyeRing: 1, eye: 2, highlight: 3, tongue: 4,
};
const FROG_BUDGET = {
  root: 2, spine: 20, head: 16, throat: 6, tongue: 3,
  eye_L: 2, eye_R: 2,
  fl_thigh: 4, fl_shin: 3, fl_foot: 4, fr_thigh: 4, fr_shin: 3, fr_foot: 4,
  bl_thigh: 6, bl_shin: 4, bl_foot: 4, br_thigh: 6, br_shin: 4, br_foot: 4,
  p1: 8, p2: 12, p3: 6, p4: 4,
};
const FROG_CLIPS = ['idle', 'hop', 'croak', 'tongue'];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _zero = new THREE.Vector3(0, 0, 0), _c = new THREE.Color();

const sph = (r, s = 6, t = 5) => new THREE.SphereGeometry(r, s, t);
const eye = (x, y, z, r = 0.012) => at(tint(sph(r, 5, 4), 0x1a1a1a), x, y, z);

function skinkGeo() {
  return merge([
    at(tint(sph(1, 7, 5), 0x6b5a3e), 0, 0.05, 0, 0, 0, 0, 0.07, 0.045, 0.2),
    at(tint(sph(1, 7, 5), 0x7a6748), 0, 0.055, 0.2, 0, 0, 0, 0.05, 0.04, 0.07),
    at(tint(new THREE.ConeGeometry(0.032, 0.4, 5), 0x5c4c34), 0, 0.04, -0.35, -Math.PI / 2, 0, 0),
    at(tint(new THREE.BoxGeometry(0.2, 0.015, 0.03), 0x4e4030), 0, 0.02, 0.1),
    at(tint(new THREE.BoxGeometry(0.2, 0.015, 0.03), 0x4e4030), 0, 0.02, -0.1),
    at(tint(new THREE.BoxGeometry(0.03, 0.005, 0.28), 0xc9b98a), 0, 0.093, 0),
    eye(0.018, 0.072, 0.245, 0.013), eye(-0.018, 0.072, 0.245, 0.013),
  ]);
}

/** Largest triangles per bone / material, so the far stand-in keeps legs, belly and eyes. Load time only. */
let _antTpl = null, _antTplP = null;
function antTemplate() {
  if (_antTpl) return Promise.resolve(_antTpl);
  if (!_antTplP) {
    _antTplP = new GLTFLoader().loadAsync(antUrl).then((gltf) => {
      _antTpl = bakeToonSkinned(gltf, { tint: ANT_TINT, part: ANT_PART, budget: ANT_BUDGET, fallback: 0xC2522D });
      return _antTpl;
    });
  }
  return _antTplP;
}
let _frogTpl = null, _frogTplP = null;
function frogTemplate() {
  if (_frogTpl) return Promise.resolve(_frogTpl);
  if (!_frogTplP) {
    _frogTplP = new GLTFLoader().loadAsync(frogUrl).then((gltf) => {
      _frogTpl = bakeToonSkinned(gltf, {
        tint: FROG_TINT, part: FROG_PART, budget: FROG_BUDGET, fallback: 0xA8EC3C,
        keepLow: true, clipNames: FROG_CLIPS,
      });
      return _frogTpl;
    });
  }
  return _frogTplP;
}
function flyGeo() {
  return merge([
    at(tint(new THREE.CylinderGeometry(0.012, 0.007, 0.28, 5), 0x2a7fb8), 0, 0, 0, Math.PI / 2, 0, 0),
    at(tint(sph(0.026, 6, 5), 0x1f5f8a), 0, 0, 0.14),
    at(tint(sph(0.012, 5, 4), 0x143048), -0.016, 0.008, 0.15),
    at(tint(sph(0.012, 5, 4), 0x143048), 0.016, 0.008, 0.15),
    at(tint(new THREE.BoxGeometry(0.36, 0.003, 0.055), 0xd8eef8), 0, 0.012, 0.07),
    at(tint(new THREE.BoxGeometry(0.3, 0.003, 0.045), 0xd8eef8), 0, 0.008, 0.0),
  ]);
}
function crabGeo() {
  const legs = [];
  for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) legs.push(at(tint(sph(0.05, 5, 4), 0xd9c9a3), sd * 0.09, 0.028, -0.04 + i * 0.027, 0, 0, sd * -0.55, 1.5, 0.32, 0.38));
  return merge([
    at(tint(sph(1, 7, 5), 0xe6d6b0), 0, 0.045, 0, 0, 0, 0, 0.075, 0.032, 0.06),
    at(tint(sph(0.02, 5, 4), 0xcbb98f), -0.03, 0.078, 0.04, 0.4, 0, 0, 0.45, 1.3, 0.45),
    at(tint(sph(0.02, 5, 4), 0xcbb98f), 0.03, 0.078, 0.04, 0.4, 0, 0, 0.45, 1.3, 0.45),
    eye(-0.03, 0.1, 0.048, 0.011), eye(0.03, 0.1, 0.048, 0.011),
    at(tint(sph(0.04, 5, 4), 0xf0e2c0), -0.07, 0.04, 0.07, 0, 0.4, 0, 1.1, 0.7, 1.2),
    at(tint(sph(0.03, 5, 4), 0xf0e2c0), 0.06, 0.04, 0.07, 0, -0.4, 0, 1.05, 0.65, 1.1),
    ...legs,
  ]);
}
function hermitGeo() {
  return merge([
    at(tint(sph(1, 7, 5), 0xc47a4a), 0, 0.055, -0.01, 0, 0, 0, 0.07, 0.06, 0.08),           // borrowed shell
    at(tint(new THREE.ConeGeometry(0.03, 0.08, 5), 0xb86b3c), 0, 0.11, -0.02, 0.4, 0, 0),
    at(tint(sph(1, 6, 5), 0xd9c9a3), 0, 0.04, 0.07, 0, 0, 0, 0.04, 0.03, 0.05),             // face
    eye(-0.016, 0.055, 0.1, 0.01), eye(0.016, 0.055, 0.1, 0.01),
    at(tint(new THREE.BoxGeometry(0.08, 0.012, 0.014), 0xd9c9a3), -0.05, 0.025, 0.04, 0, 0, 0.5),
    at(tint(new THREE.BoxGeometry(0.08, 0.012, 0.014), 0xd9c9a3), 0.05, 0.025, 0.04, 0, 0, -0.5),
  ]);
}
function butterflyGeo() {
  return merge([
    at(tint(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 5), 0x2a2218), 0, 0, 0, Math.PI / 2, 0, 0),
    at(tint(sph(0.014, 5, 4), 0x1a140e), 0, 0, 0.05),
    at(tint(new THREE.CircleGeometry(0.085, 6), 0xe07a3a), -0.07, 0.01, 0, -0.2, 0, 0.4),
    at(tint(new THREE.CircleGeometry(0.085, 6), 0xe8b84a), 0.07, 0.01, 0, -0.2, 0, -0.4),
    at(tint(new THREE.CircleGeometry(0.05, 6), 0xf2d48a), -0.05, 0.005, -0.05, -0.2, 0, 0.5),
    at(tint(new THREE.CircleGeometry(0.05, 6), 0xf2d48a), 0.05, 0.005, -0.05, -0.2, 0, -0.5),
  ]);
}
function wrenGeo() {
  return merge([
    at(tint(sph(1, 7, 5), 0x3a6fbf), 0, 0.05, 0, 0, 0, 0, 0.045, 0.04, 0.07),              // splendid blue
    at(tint(sph(1, 6, 5), 0x2a4f8a), 0, 0.055, 0.07, 0, 0, 0, 0.032, 0.03, 0.035),
    at(tint(new THREE.ConeGeometry(0.01, 0.04, 4), 0xc9a06a), 0, 0.05, 0.11, Math.PI / 2, 0, 0),
    at(tint(new THREE.BoxGeometry(0.02, 0.04, 0.07), 0x1f3f6a), 0, 0.07, -0.08, 0.6, 0, 0),  // cocked tail
    eye(-0.012, 0.068, 0.09, 0.008), eye(0.012, 0.068, 0.09, 0.008),
    at(tint(new THREE.BoxGeometry(0.01, 0.03, 0.01), 0x1a1a1a), -0.015, 0.015, 0.01),
    at(tint(new THREE.BoxGeometry(0.01, 0.03, 0.01), 0x1a1a1a), 0.015, 0.015, 0.01),
  ]);
}

function hide(mesh, i) { _m.compose(_p.set(0, -999, 0), _q.identity(), _zero); mesh.setMatrixAt(i, _m); }
function pose(mesh, i, x, y, z, yaw, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
  _q.setFromEuler(_e.set(pitch, yaw, roll)); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); mesh.setMatrixAt(i, _m);
}

export class Critters {
  constructor(world, scene, mobile = false) {
    this.world = world; this.scene = scene; this.mobile = !!mobile; this.disposed = false;
    this.mat = toonMat({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    const mk = (geo, n) => {
      const m = new THREE.InstancedMesh(geo, this.mat, n);
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      for (let i = 0; i < n; i++) hide(m, i);
      scene.add(m); return m;
    };
    this.skMesh = mk(skinkGeo(), NS);
    this.flyMesh = mk(flyGeo(), NF); this.crMesh = mk(crabGeo(), NC);
    this.hmMesh = mk(hermitGeo(), NH);
    this.buMesh = mk(butterflyGeo(), NB); this.wrMesh = mk(wrenGeo(), NW);
    this.lineMat = this.mobile ? null : outlineMat(0x231a12);
    this.hulls = this.lineMat ? [this.skMesh, this.flyMesh, this.crMesh, this.hmMesh, this.buMesh, this.wrMesh].flatMap((m) => outline(m, this.lineMat)) : [];
    this.sk = Array.from({ length: NS }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, run: 0, walk: 0, bask: 0, t: Math.random() * 5, cur: 0 }));
    this.tr = Array.from({ length: NT }, () => ({ on: false, x: 0, z: 0, a: 0, len: 3, hs: new Float32Array(9), ph: Math.random() }));
    this.fl = Array.from({ length: NF }, () => ({ on: false, x: 0, z: 0, y: 0, ax: 0, az: 0, tx: 0, tz: 0, ty: 0, g: 0, t: 0, h: 0 }));
    this.cr = Array.from({ length: NC }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, dir: 1, t: 0, run: 0, dig: 0, cur: 0 }));
    this.fr = Array.from({ length: NFR }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, hop: 0, air: 0, t: Math.random() * 3, wet: 0, croak: 0, flick: 0, launched: 0 }));
    this.hm = Array.from({ length: NH }, () => ({ on: false, x: 0, z: 0, y: 0, h: 0, dir: 1, t: 0, run: 0, hide: 0 }));
    this.bu = Array.from({ length: NB }, () => ({ on: false, x: 0, z: 0, y: 0, ax: 0, az: 0, tx: 0, tz: 0, ty: 0, t: 0, h: 0, land: 0 }));
    this.wr = Array.from({ length: NW }, () => ({ on: false, x: 0, z: 0, y: 0, g: 0, h: 0, hop: 0, fly: 0, t: 0, tx: 0, tz: 0, ty: 0 }));
    this.slot = 0; this.T = 0;
    this.antPace = 1; this.antReady = false; this.antError = ''; this.antClips = []; this.antDur = {};
    this.antCap = mobile ? 8 : 16; this.antSlots = []; this._antSim = 0; this._march = 0;
    this.antTris = 0; this.antFarTris = 0;
    this.frogReady = false; this.frogError = ''; this.frogClips = []; this.frogDur = {};
    this.frogCap = mobile ? 4 : 6; this.frogSlots = []; this._frogSim = 0;
    this.frogTris = 0; this.frogFarTris = 0; this.frogMinY = 0; this.frMesh = null; this.frogHull = null;
    this._fpick = new Int16Array(6); this._fpickD = new Float32Array(6); this._fnear = new Uint8Array(NFR); this._fslotUsed = new Uint8Array(6);
    this._ax = new Float32Array(ANT_N); this._ay = new Float32Array(ANT_N); this._az = new Float32Array(ANT_N);
    this._ayaw = new Float32Array(ANT_N); this._aon = new Uint8Array(ANT_N); this._anear = new Uint8Array(ANT_N);
    this._ad2 = new Float32Array(ANT_N); this._pick = new Int16Array(16); this._pickD = new Float32Array(16);
    this._slotUsed = new Uint8Array(16);
    const mount = (tpl) => { if (!this.disposed) this._mountAnts(tpl); };
    if (_antTpl) mount(_antTpl); else antTemplate().then(mount).catch((err) => { this.antError = String(err && err.message || err); });
    const mountFrog = (tpl) => { if (!this.disposed) this._mountFrogs(tpl); };
    if (_frogTpl) mountFrog(_frogTpl); else frogTemplate().then(mountFrog).catch((err) => { this.frogError = String(err && err.message || err); });
  }

  /** One shared skeleton template, cloned per nearby ant. Far ants share one instanced bind pose. */
  _mountAnts(tpl) {
    const mat = this.antMat = toonMat({ vertexColors: true });
    const inst = this.antInst = new THREE.InstancedMesh(tpl.farGeo, mat, ANT_N);
    inst.frustumCulled = false; inst.castShadow = false; inst.receiveShadow = false; inst.count = 0;
    this.scene.add(inst);
    const walkClip = tpl.clips.find((a) => a.name === 'walk');
    const idleClip = tpl.clips.find((a) => a.name === 'idle');
    this.antClips = tpl.clips.map((a) => a.name);
    this.antDur = { walk: walkClip?.duration || 0, idle: idleClip?.duration || 0 };
    this.antTris = tpl.geo.index ? tpl.geo.index.count / 3 : 0;
    this.antFarTris = tpl.farGeo.attributes.position.count / 3;
    for (let i = 0; i < this.antCap; i++) {
      const root = SkeletonUtils.clone(tpl.scene);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.material = mat; o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
        o.userData.noOutline = true;
      });
      root.visible = false; root.scale.set(1, 1, 1); root.position.y = -999;
      this.scene.add(root);
      const mixer = new THREE.AnimationMixer(root);
      const walk = mixer.clipAction(walkClip), idle = mixer.clipAction(idleClip);
      for (const a of [walk, idle]) a.setLoop(THREE.LoopRepeat, Infinity);
      this.antSlots.push({ root, mixer, walk, idle, id: -1, live: false, moving: null, phase: 0 });
    }
    this.antReady = true;
  }

  _setGait(slot, moving) { crossFadeGait(slot, moving, ANT_FADE); }

  /** inverted-hull outline that skins. A plain Mesh child would stay in the bind pose. */
  _skinnedHull(mesh, mat) {
    const h = new THREE.SkinnedMesh(mesh.geometry, mat);
    h.bindMode = mesh.bindMode;
    h.bind(mesh.skeleton, mesh.bindMatrix);
    h.frustumCulled = false; h.castShadow = false; h.receiveShadow = false;
    h.userData.isOutline = true; h.renderOrder = (mesh.renderOrder || 0) + 1;
    mesh.parent.add(h);
    return h;
  }

  /** One shared skeleton, cloned per nearby frog. Far frogs share one instanced bind pose. */
  _mountFrogs(tpl) {
    const mat = this.frogMat = toonMat({ vertexColors: true });
    const inst = this.frMesh = new THREE.InstancedMesh(tpl.farGeo, mat, NFR);
    inst.frustumCulled = false; inst.castShadow = false; inst.receiveShadow = false; inst.count = 0;
    this.scene.add(inst);
    if (this.lineMat) {
      this.frogHull = outline(inst, this.lineMat)[0] || null;
      if (this.frogHull) this.frogHull.count = 0;
    }
    const byName = {};
    for (const c of tpl.clips) byName[c.name] = c;
    this.frogClips = FROG_CLIPS.filter((n) => byName[n]);
    this.frogDur = {};
    for (const n of this.frogClips) this.frogDur[n] = byName[n].duration;
    this.frogTris = tpl.geo.index ? tpl.geo.index.count / 3 : tpl.geo.attributes.position.count / 3;
    this.frogFarTris = tpl.farGeo.attributes.position.count / 3;
    tpl.geo.computeBoundingBox();
    this.frogMinY = tpl.geo.boundingBox.min.y;
    const hopScale = (byName.hop?.duration || FROG_HOP) / FROG_HOP;
    this.frogLine = this.mobile ? null : outlineMat(0x2a3214);
    for (let i = 0; i < this.frogCap; i++) {
      const root = SkeletonUtils.clone(tpl.scene);
      let skinned = null;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.material = mat; o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
        if (o.isSkinnedMesh) skinned = o;
      });
      root.visible = false; root.scale.set(1, 1, 1); root.position.y = -999;
      this.scene.add(root);
      const hull = skinned && this.frogLine ? this._skinnedHull(skinned, this.frogLine) : null;
      const mixer = new THREE.AnimationMixer(root);
      const actions = {};
      for (const n of this.frogClips) {
        const a = mixer.clipAction(byName[n]);
        if (n === 'idle') a.setLoop(THREE.LoopRepeat, Infinity);
        else { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        actions[n] = a;
      }
      const slot = { root, mixer, actions, hull, id: -1, live: false, clip: null, hopScale };
      mixer.addEventListener('finished', (e) => {
        const name = e.action?.getClip?.()?.name;
        if (name !== 'croak' && name !== 'tongue') return;
        if (slot.clip !== name) return;
        slot.clip = null;
        const c = slot.id >= 0 ? this.fr[slot.id] : null;
        if (c && name === 'croak') c.croak = 0;
        if (c && name === 'tongue') c.flick = 0;
      });
      this.frogSlots.push(slot);
    }
    this.frogReady = true;
  }

  _playFrog(slot, name, restart) {
    if (!restart && slot.clip === name) return;
    const next = slot.actions[name];
    if (!next) return;
    const prev = slot.clip && slot.clip !== name ? slot.actions[slot.clip] : null;
    next.timeScale = name === 'hop' ? slot.hopScale : 1;
    if (!prev) {
      for (const k of this.frogClips) if (k !== name) slot.actions[k].stop();
      next.reset().setEffectiveWeight(1).play();
    } else {
      next.reset().play();
      prev.crossFadeTo(next, restart ? 0.08 : 0.16, false);
    }
    slot.clip = name;
  }

  /** the croak beat in audio.js: the nearest on-screen frog puffs its throat. A hop still wins until it lands. */
  croakNear(pos) {
    if (!pos) return false;
    let best = null, bd = FROG_CROAK_R * FROG_CROAK_R;
    for (let i = 0; i < NFR; i++) {
      const c = this.fr[i];
      if (!c.on) continue;
      const d = (c.x - pos.x) ** 2 + (c.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return false;
    best.croak = 1;
    best.flick = 0;
    return true;
  }

  /** a random ground spot 8..34 m from the player whose biome allows `set` (null if none on this try) */
  spot(o, set, { wet = false, nearWater = false } = {}) {
    const w = this.world, a = Math.random() * 6.2832, d = 8 + Math.random() * 26;
    const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
    if (!set.has(w.biomeAt(x, z))) return null;
    const inWater = !!w.waterAt?.(x, z);
    if (wet) { if (!inWater && w.heightAt(x, z) < 0.15) return [x, z]; if (inWater) return [x, z]; return null; }
    if (inWater || w.heightAt(x, z) < 0.4 || w._blocked?.(x, z, 0.4)) return null;
    if (nearWater) {
      let ok = false;
      for (let i = 0; i < 6; i++) {
        const ang = i * 1.05, wx = x + Math.cos(ang) * 1.6, wz = z + Math.sin(ang) * 1.6;
        if (w.waterAt?.(wx, wz)) { ok = true; break; }
      }
      if (!ok) return null;
    }
    return [x, z];
  }

  respawn(o, night, rain) {
    const total = NS + NT + NF + NC + NFR + NH + NB + NW;
    const k = this.slot++ % total, w = this.world;
    const far = (c) => !c.on || Math.abs(c.x - o.x) > R_FAR || Math.abs(c.z - o.z) > R_FAR;
    const place = (c, set, extra = {}) => {
      c.on = false; const s = this.spot(o, set, extra); if (!s) return false;
      c.on = true; c.x = s[0]; c.z = s[1]; c.y = w.heightAt(c.x, c.z); return true;
    };
    if (k < NS) {
      const c = this.sk[k]; if (!far(c) && !(night > 0.6) && !(rain > 0.65)) return;
      c.on = false; if (night > 0.6 || rain > 0.65) return;
      if (place(c, SKINK_B)) { c.h = Math.random() * 6.28; c.run = 0; c.walk = 0; c.bask = 1 + Math.random() * 3; c.cur = 0; c.as = w.biomeAt(c.x, c.z) === 'wasteland' ? 'rat' : 'skink'; }
    } else if (k < NS + NT) {
      const c = this.tr[k - NS]; if (!far(c) && !(rain > 0.7)) return;
      c.on = false; if (rain > 0.7) return;
      const s = this.spot(o, ANT_B); if (!s) return;
      c.on = true; c.x = s[0]; c.z = s[1]; c.a = Math.random() * 6.28; c.len = 2.5 + Math.random() * 2.5;
      for (let i = 0; i < 9; i++) { const f = i / 8 - 0.5; c.hs[i] = w.heightAt(c.x + Math.cos(c.a) * f * c.len, c.z + Math.sin(c.a) * f * c.len); }
    } else if (k < NS + NT + NF) {
      const c = this.fl[k - NS - NT]; if (!far(c) && !(night > 0.6) && !(rain > 0.7)) return;
      c.on = false; if (night > 0.6 || rain > 0.7) return;
      if (place(c, FLY_B)) { c.ax = c.x; c.az = c.z; c.g = c.y; c.y = c.g + 1; c.t = 0; c.tx = c.x; c.tz = c.z; c.ty = c.y; c.as = w.biomeAt(c.x, c.z) === 'wasteland' ? 'fly' : 'dragonfly'; }
    } else if (k < NS + NT + NF + NC) {
      const c = this.cr[k - NS - NT - NF]; if (!far(c) && c.dig < 1) return;
      c.on = false;
      const mud = w.biomeAt(o.x, o.z) === 'mudflat';
      if (!place(c, CRAB_B, mud ? { nearWater: true } : {}) && mud) place(c, CRAB_B);
      if (!c.on) return;
      c.h = Math.random() * 6.28; c.dir = Math.random() < 0.5 ? -1 : 1; c.t = 0; c.run = 0; c.dig = 0; c.cur = 0;
      c.as = w.biomeAt(c.x, c.z) === 'wasteland' ? 'cockroach' : 'ghostcrab';
    } else if (k < NS + NT + NF + NC + NFR) {
      const c = this.fr[k - NS - NT - NF - NC]; if (!far(c)) return;
      const s = this.spot(o, FROG_B, { nearWater: Math.random() < 0.7 }) || this.spot(o, FROG_B, { wet: true }) || this.spot(o, FROG_B);
      c.on = false; if (!s) return;
      c.on = true; c.x = s[0]; c.z = s[1]; c.y = w.heightAt(c.x, c.z); c.h = Math.random() * 6.28; c.hop = 0; c.air = 0; c.t = Math.random() * 2; c.wet = w.waterAt?.(c.x, c.z) ? 1 : 0; c.croak = 0; c.flick = 0; c.launched = 0;
    } else if (k < NS + NT + NF + NC + NFR + NH) {
      const c = this.hm[k - NS - NT - NF - NC - NFR]; if (!far(c) && c.hide < 1) return;
      if (!place(c, HERM_B)) return;
      c.h = Math.random() * 6.28; c.dir = Math.random() < 0.5 ? -1 : 1; c.t = 0; c.run = 0; c.hide = 0;
    } else if (k < NS + NT + NF + NC + NFR + NH + NB) {
      const c = this.bu[k - NS - NT - NF - NC - NFR - NH]; if (!far(c) && !(night > 0.55) && !(rain > 0.5)) return;
      c.on = false; if (night > 0.55 || rain > 0.5) return;
      if (place(c, BUTT_B)) { c.ax = c.x; c.az = c.z; c.y = c.y + 0.4; c.tx = c.x; c.tz = c.z; c.ty = c.y; c.t = 0; c.land = 0; }
    } else {
      const c = this.wr[k - NS - NT - NF - NC - NFR - NH - NB]; if (!far(c) && !(night > 0.6) && !(rain > 0.8)) return;
      c.on = false; if (night > 0.6) return;
      const mudW = w.biomeAt(o.x, o.z) === 'mudflat';
      if (!place(c, WREN_B, mudW ? { nearWater: true } : {}) && mudW) place(c, WREN_B);
      if (!c.on) return;
      c.as = w.biomeAt(c.x, c.z) === 'mudflat' ? 'wader' : 'wren';
      c.g = c.y; c.h = Math.random() * 6.28; c.hop = 0; c.fly = 0; c.t = Math.random() * 2; c.tx = c.x; c.tz = c.z; c.ty = c.y;
    }
  }

  /** t257u: critters never overlap each other (same kind too) or a predator: spatial-hash separation on last frame's spots,
   *  so this frame's poses already use the corrected positions. Predators (this.preds, set by the game) are immovable here. */
  spread() {
    const A = this._agents ??= [], w = this.world; A.length = 0;
    const add = (arr, r, kind) => { for (const c of arr) if (c.on && !(c.dig >= 1) && !(c.hide >= 1)) { const a = c._sep ??= { c, x: 0, z: 0, y: 0, r, w: 1, kind }; a.x = c.x; a.z = c.z; a.y = c.y ?? 0; A.push(a); } };
    add(this.sk, 0.24, 'g'); add(this.cr, 0.2, 'g'); add(this.fr, 0.17, 'g'); add(this.hm, 0.15, 'g'); add(this.wr, 0.15, 'g'); add(this.fl, 0.12, 'f'); add(this.bu, 0.12, 'f');
    if (this.preds) for (const p of this.preds) if (!p.dead) { const a = p._csep ??= { c: null, x: 0, z: 0, y: 0, r: 0, w: 0 }; a.x = p.x; a.z = p.z; a.y = p.y + (p.lift || 0) + (p.alt || 0) + 0.3; a.r = 0.6 * p.scale; A.push(a); }
    if (A.length < 2) return 0;
    return separate(A, { cell: 1.5, passes: 2, apply: (a, dx, dz, dy) => {
      const c = a.c; if (!c) return;
      const nx = c.x + dx, nz = c.z + dz;
      if (a.kind === 'f') { c.x = nx; c.z = nz; c.y += dy; if (c.tx !== undefined) { c.tx += dx; c.tz += dz; } }
      else if (!w.waterAt?.(nx, nz)) { c.x = nx; c.z = nz; if (c.y !== undefined && !(c.fly > 0) && !(c.air > 0)) c.y = w.heightAt(nx, nz); }
      a.x = c.x; a.z = c.z;
    } });
  }
  update(dt, o, night = 0, rain = 0) {
    const w = this.world; this.T += dt;
    this.spread();
    for (let i = 0; i < 3; i++) this.respawn(o, night, rain);
    const scare = (c, r2, heading) => {
      const dx = c.x - o.x, dz = c.z - o.z, d2 = dx * dx + dz * dz;
      return { dx, dz, d2, close: d2 < r2, heading: heading ?? Math.atan2(dx, dz) };
    };

    // ---- skinks: bask in the sun, potter, maybe wander closer, then dart away
    for (let i = 0; i < NS; i++) {
      const c = this.sk[i];
      if (!c.on) { hide(this.skMesh, i); continue; }
      const s = scare(c, 6);
      if (s.close && c.run <= 0) { c.run = 0.9 + Math.random() * 0.5; c.h = s.heading + (Math.random() - 0.5) * 0.8; c.bask = 0; c.cur = 0; }
      else if (c.run <= 0 && s.d2 > 16 && s.d2 < 80 && c.cur <= 0 && Math.random() < dt * 0.25) { c.cur = 0.8 + Math.random() * 0.8; c.h = Math.atan2(-s.dx, -s.dz); c.bask = 0; }
      c.t -= dt; if (c.t <= 0) { c.t = 2 + Math.random() * 5; if (c.run <= 0 && Math.random() < 0.45) { c.walk = 0.6 + Math.random(); c.h += (Math.random() - 0.5) * 2; c.bask = 0; } else if (c.run <= 0) c.bask = 1.5 + Math.random() * 3; }
      let sp = 0; if (c.run > 0) { c.run -= dt; sp = 3.2; } else if (c.cur > 0) { c.cur -= dt; sp = 0.35; } else if (c.walk > 0) { c.walk -= dt; sp = 0.5; } else if (c.bask > 0) c.bask -= dt;
      if (sp > 0) {
        const nx = c.x + Math.sin(c.h) * sp * dt, nz = c.z + Math.cos(c.h) * sp * dt;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.2)) { c.x = nx; c.z = nz; c.y = w.heightAt(nx, nz); } else c.h += 2.2;
      }
      const wig = sp > 0 ? Math.sin(this.T * 30) * 0.25 : 0;
      const flat = c.bask > 0 && sp === 0 ? 0.72 : 1;
      const rat = c.as === 'rat';
      pose(this.skMesh, i, c.x, c.y, c.z, c.h + wig, rat ? 0.85 : 1, (rat ? 0.62 : 1) * flat, rat ? 1.25 : 1);
      this.skMesh.setColorAt(i, _c.set(rat ? 0x6b5346 : 0xffffff));
    }
    this.skMesh.instanceMatrix.needsUpdate = true;
    if (this.skMesh.instanceColor) this.skMesh.instanceColor.needsUpdate = true;

    // ---- ant trails: nest-to-food march; they pack up in heavy rain.
    // Scale is 1: the glb is already 1.2 cm. +Z is forward. Nearby ants play
    // walk while the line moves and idle when it is held (antPace 0); the rest
    // are one instanced bind-pose stand-in and do not run a mixer.
    const pace = this.antPace > 0 ? this.antPace : 0;
    const antSp = pace * (rain > 0.35 ? 0.12 : 0.06);
    const moving = antSp > 1e-6;
    this._march = (this._march + dt * antSp) % 1;
    const near2 = ANT_NEAR * ANT_NEAR;
    for (let t = 0; t < NT; t++) {
      const c = this.tr[t], ca = Math.cos(c.a), sa = Math.sin(c.a);
      for (let j = 0; j < PER; j++) {
        const id = t * PER + j;
        if (!c.on) { this._aon[id] = 0; continue; }
        const f = ((j / PER + this._march + c.ph) % 1 + 1) % 1, back = j % 2 === 1;
        const u = back ? 1 - f : f, wob = moving ? Math.sin(j * 7.3 + this.T * 3) * 0.05 : 0;
        const x = c.x + ca * (u - 0.5) * c.len - sa * wob, z = c.z + sa * (u - 0.5) * c.len + ca * wob;
        this._aon[id] = 1; this._ax[id] = x; this._ay[id] = w.heightAt(x, z); this._az[id] = z;
        this._ayaw[id] = Math.atan2(ca, sa) + (back ? Math.PI : 0);
        const dx = x - o.x, dz = z - o.z; this._ad2[id] = dx * dx + dz * dz;
      }
    }
    const cap = this.antCap, pick = this._pick, pickD = this._pickD;
    for (let i = 0; i < cap; i++) { pick[i] = -1; pickD[i] = Infinity; }
    if (this.antReady) {
      for (let id = 0; id < ANT_N; id++) {
        if (!this._aon[id] || this._ad2[id] > near2) continue;
        let worst = 0;
        for (let k = 1; k < cap; k++) if (pickD[k] > pickD[worst]) worst = k;
        if (this._ad2[id] < pickD[worst]) { pickD[worst] = this._ad2[id]; pick[worst] = id; }
      }
    }
    this._anear.fill(0);
    for (let k = 0; k < cap; k++) if (pick[k] >= 0) this._anear[pick[k]] = 1;
    const slots = this.antSlots, used = this._slotUsed;
    used.fill(0);
    let sim = 0;
    if (this.antReady) {
      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s];
        if (!slot.live) continue;
        let keep = -1;
        for (let k = 0; k < cap; k++) if (pick[k] === slot.id) { keep = k; break; }
        if (keep < 0) { slot.live = false; slot.id = -1; slot.moving = null; slot.root.visible = false; slot.root.position.y = -999; }
        else used[keep] = 1;
      }
      for (let k = 0; k < cap; k++) {
        if (pick[k] < 0 || used[k]) continue;
        let slot = null;
        for (let s = 0; s < slots.length; s++) if (!slots[s].live) { slot = slots[s]; break; }
        if (!slot) break;
        slot.live = true; slot.id = pick[k]; slot.moving = null; slot.phase = (pick[k] * 0.173) % 0.5;
        used[k] = 1;
      }
      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s];
        if (!slot.live) continue;
        const id = slot.id;
        slot.root.position.set(this._ax[id], this._ay[id], this._az[id]);
        slot.root.rotation.set(0, this._ayaw[id], 0);
        slot.root.scale.set(1, 1, 1);
        slot.root.visible = true;
        this._setGait(slot, moving);
        slot.mixer.update(dt);
        sim++;
      }
    }
    this._antSim = sim;
    const inst = this.antInst;
    if (inst) {
      let n = 0;
      for (let id = 0; id < ANT_N; id++) {
        if (!this._aon[id] || this._anear[id]) continue;
        pose(inst, n++, this._ax[id], this._ay[id], this._az[id], this._ayaw[id], 1, 1, 1);
      }
      inst.count = n; inst.instanceMatrix.needsUpdate = true;
    }

    // ---- dragonflies: hover, zip, startle further off
    for (let i = 0; i < NF; i++) {
      const c = this.fl[i];
      if (!c.on) { hide(this.flyMesh, i); continue; }
      const s = scare(c, 9);
      c.t -= dt;
      if (s.close && c.t < 2) { c.t = 0.6; const a = s.heading; c.tx = c.x + Math.cos(a) * 5; c.tz = c.z + Math.sin(a) * 5; c.ty = w.heightAt(c.tx, c.tz) + 1.4 + Math.random(); }
      else if (c.t <= 0) { c.t = 1.5 + Math.random() * 3; const a = Math.random() * 6.28, r = Math.random() * 4; c.tx = c.ax + Math.cos(a) * r; c.tz = c.az + Math.sin(a) * r; c.ty = w.heightAt(c.tx, c.tz) + 0.6 + Math.random() * 1.0; }
      const k = 1 - Math.exp(-(s.close ? 7 : 4) * dt), px = c.x, pz = c.z;
      c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.y += (c.ty - c.y) * k;
      if (Math.abs(c.x - px) + Math.abs(c.z - pz) > 1e-3) c.h = Math.atan2(c.x - px, c.z - pz);
      const fly = c.as === 'fly';
      pose(this.flyMesh, i, c.x, c.y + Math.sin(this.T * 3 + i) * 0.04, c.z, c.h, fly ? 0.45 : 1, fly ? 0.45 : 1, fly ? 0.45 : 1, 0, Math.sin(this.T * 48 + i) * 0.12);
      this.flyMesh.setColorAt(i, _c.set(fly ? 0x3a332c : 0xffffff));
    }
    this.flyMesh.instanceMatrix.needsUpdate = true;
    if (this.flyMesh.instanceColor) this.flyMesh.instanceColor.needsUpdate = true;

    // ---- ghost crabs: sideways scuttles, a curious sidle, then a dash and down a burrow
    for (let i = 0; i < NC; i++) {
      const c = this.cr[i];
      if (!c.on) { hide(this.crMesh, i); continue; }
      const s = scare(c, 7);
      if (s.close && c.run <= 0 && c.dig === 0) { c.run = 0.7; c.h = s.heading - c.dir * Math.PI / 2; c.cur = 0; }
      else if (c.dig === 0 && c.run <= 0 && s.d2 > 16 && s.d2 < 90 && Math.random() < dt * 0.2) { c.cur = 0.7; c.h = Math.atan2(-s.dx, -s.dz) - c.dir * Math.PI / 2; }
      let sp = 0;
      if (c.run > 0) { c.run -= dt; sp = 3.6; if (c.run <= 0) c.dig = 0.001; }
      else if (c.dig > 0) { c.dig = Math.min(1, c.dig + dt * 2.5); }
      else if (c.cur > 0) { c.cur -= dt; sp = 0.5; }
      else { c.t -= dt; if (c.t <= 0) { c.t = 0.6 + Math.random() * 2.4; if (Math.random() < 0.3) c.dir = -c.dir; if (Math.random() < 0.3) c.h += (Math.random() - 0.5) * 1.5; } if (c.t > 1.2) sp = 0.9; }
      if (sp > 0) {
        const mx = Math.cos(c.h) * c.dir, mz = -Math.sin(c.h) * c.dir;
        const nx = c.x + mx * sp * dt, nz = c.z + mz * sp * dt;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.15)) { c.x = nx; c.z = nz; c.y = w.heightAt(nx, nz); } else c.dir = -c.dir;
      }
      const bob = sp > 0 ? Math.abs(Math.sin(this.T * 38 + i)) * 0.012 : 0, sink = c.dig * 0.14;
      const roach = c.as === 'cockroach';
      pose(this.crMesh, i, c.x, c.y + bob - sink, c.z, c.h, roach ? 0.7 : 1, roach ? 0.32 : 1, roach ? 1.25 : 1);
      this.crMesh.setColorAt(i, _c.set(roach ? 0x4a3828 : 0xffffff));
    }
    this.crMesh.instanceMatrix.needsUpdate = true;
    if (this.crMesh.instanceColor) this.crMesh.instanceColor.needsUpdate = true;

    // ---- frogs: sit at the water's edge, hop along +Z, plop in when startled.
    // The glb is already ~6 cm. Scale stays 1. The hop arc is code (no root motion);
    // air lasts the hop clip. Croak comes from the audio beat; tongue is an idle flick.
    const frogEager = (rain > 0.25 || night > 0.45) ? 1.6 : 1;
    const hopRate = 1 / FROG_HOP;
    for (let i = 0; i < NFR; i++) {
      const c = this.fr[i];
      if (!c.on) continue;
      const s = scare(c, 5.5);
      if (c.air <= 0) {
        if (s.close) { c.hop = 1; c.h = s.heading; c.flick = 0; }
        else {
          c.t -= dt * frogEager;
          if (c.t <= 0) {
            c.t = 1.2 + Math.random() * 3;
            if (Math.random() < 0.55) { c.hop = 1; c.h += (Math.random() - 0.5) * 1.2; }
            else if (!c.croak && Math.random() < 0.45) c.flick = 1;
          }
        }
      }
      if (c.hop && c.air <= 0) { c.air = 1; c.hop = 0; c.launched = 1; }
      if (c.air > 0) {
        c.air -= dt * hopRate;
        const u = 1 - Math.max(0, c.air), lift = Math.sin(u * Math.PI) * 0.28;
        const nx = c.x + Math.sin(c.h) * 1.3 * dt * hopRate, nz = c.z + Math.cos(c.h) * 1.3 * dt * hopRate;
        if (!w._blocked?.(nx, nz, 0.15)) { c.x = nx; c.z = nz; }
        c.y = w.heightAt(c.x, c.z) + lift;
        c.wet = w.waterAt?.(c.x, c.z) ? 1 : 0;
        if (c.air <= 0) { c.air = 0; c.y = w.heightAt(c.x, c.z); }
      } else c.y = w.heightAt(c.x, c.z);
    }
    const frogNear = FROG_NEAR * FROG_NEAR, frogCap = this.frogCap;
    const fpick = this._fpick, fpickD = this._fpickD;
    for (let k = 0; k < frogCap; k++) { fpick[k] = -1; fpickD[k] = Infinity; }
    if (this.frogReady) {
      for (let i = 0; i < NFR; i++) {
        const c = this.fr[i];
        if (!c.on) continue;
        const dx = c.x - o.x, dz = c.z - o.z, d2 = dx * dx + dz * dz;
        if (d2 > frogNear) continue;
        let worst = 0;
        for (let k = 1; k < frogCap; k++) if (fpickD[k] > fpickD[worst]) worst = k;
        if (d2 < fpickD[worst]) { fpickD[worst] = d2; fpick[worst] = i; }
      }
    }
    this._fnear.fill(0);
    for (let k = 0; k < frogCap; k++) if (fpick[k] >= 0) this._fnear[fpick[k]] = 1;
    const fslots = this.frogSlots, fused = this._fslotUsed;
    fused.fill(0);
    let fsim = 0;
    if (this.frogReady) {
      for (let s = 0; s < fslots.length; s++) {
        const slot = fslots[s];
        if (!slot.live) continue;
        let keep = -1;
        for (let k = 0; k < frogCap; k++) if (fpick[k] === slot.id) { keep = k; break; }
        if (keep < 0) {
          slot.live = false; slot.id = -1; slot.clip = null; slot.mixer.stopAllAction();
          slot.root.visible = false; slot.root.position.y = -999;
        } else fused[keep] = 1;
      }
      for (let k = 0; k < frogCap; k++) {
        if (fpick[k] < 0 || fused[k]) continue;
        let slot = null;
        for (let s = 0; s < fslots.length; s++) if (!fslots[s].live) { slot = fslots[s]; break; }
        if (!slot) break;
        slot.live = true; slot.id = fpick[k]; slot.clip = null; fused[k] = 1;
      }
      for (let s = 0; s < fslots.length; s++) {
        const slot = fslots[s];
        if (!slot.live) continue;
        const c = this.fr[slot.id];
        const sink = c.wet && c.air <= 0 ? -0.02 : 0;
        slot.root.position.set(c.x, c.y + sink, c.z);
        slot.root.rotation.set(0, c.h, 0);
        slot.root.scale.set(1, 1, 1);
        slot.root.visible = true;
        let want = 'idle';
        if (c.air > 0) want = 'hop';
        else if (c.croak) want = 'croak';
        else if (c.flick) want = 'tongue';
        const restart = want === 'hop' && c.launched;
        if (restart) c.launched = 0;
        this._playFrog(slot, want, restart);
        slot.mixer.update(dt);
        if (want === 'hop' && slot.actions.hop) {
          const u = 1 - Math.max(0, Math.min(1, c.air));
          slot.actions.hop.time = u * slot.actions.hop.getClip().duration;
        }
        fsim++;
      }
    }
    this._frogSim = fsim;
    const mesh = this.frMesh;
    if (mesh) {
      let n = 0;
      for (let i = 0; i < NFR; i++) {
        if (!this.fr[i].on || this._fnear[i]) continue;
        const c = this.fr[i];
        const sink = c.wet && c.air <= 0 ? -0.02 : 0;
        pose(mesh, n++, c.x, c.y + sink, c.z, c.h, 1, 1, 1);
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
      if (this.frogHull) this.frogHull.count = n;
    }

    // ---- hermit crabs: sidle with a borrowed shell, tuck in when startled
    for (let i = 0; i < NH; i++) {
      const c = this.hm[i];
      if (!c.on) { hide(this.hmMesh, i); continue; }
      const s = scare(c, 6);
      if (s.close && c.hide <= 0 && c.run <= 0) { c.run = 0.45; c.h = s.heading - c.dir * Math.PI / 2; }
      let sp = 0, tucked = c.hide;
      if (c.run > 0) { c.run -= dt; sp = 1.8; if (c.run <= 0) c.hide = 0.001; }
      else if (c.hide > 0) { c.hide = Math.min(1, c.hide + dt * 3); if (c.hide >= 1 && s.d2 > 16) c.hide = Math.max(0, c.hide - dt * 0.8); }
      else { c.t -= dt; if (c.t <= 0) { c.t = 0.8 + Math.random() * 2.2; if (Math.random() < 0.35) c.dir = -c.dir; if (Math.random() < 0.3) c.h += (Math.random() - 0.5) * 1.2; } if (c.t > 1) sp = 0.45; }
      if (sp > 0) {
        const mx = Math.cos(c.h) * c.dir, mz = -Math.sin(c.h) * c.dir;
        const nx = c.x + mx * sp * dt, nz = c.z + mz * sp * dt;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.15)) { c.x = nx; c.z = nz; c.y = w.heightAt(nx, nz); } else c.dir = -c.dir;
      }
      const bob = sp > 0 ? Math.abs(Math.sin(this.T * 28 + i)) * 0.01 : 0;
      const sy = 1 - tucked * 0.25, y = c.y + bob - tucked * 0.03;
      pose(this.hmMesh, i, c.x, y, c.z, c.h, 1, sy, 1);
    }
    this.hmMesh.instanceMatrix.needsUpdate = true;

    // ---- butterflies: flutter between resting spots, fold in the rain / at night (despawned), startle up
    for (let i = 0; i < NB; i++) {
      const c = this.bu[i];
      if (!c.on) { hide(this.buMesh, i); continue; }
      const s = scare(c, 8);
      c.t -= dt;
      if (s.close) { c.land = 0; c.t = 0.8; const a = s.heading; c.tx = c.x + Math.cos(a) * 4; c.tz = c.z + Math.sin(a) * 4; c.ty = w.heightAt(c.tx, c.tz) + 1.2; }
      else if (c.t <= 0) {
        if (c.land > 0) { c.land = 0; c.t = 1.2 + Math.random() * 2; const a = Math.random() * 6.28, r = 1 + Math.random() * 5; c.tx = c.ax + Math.cos(a) * r; c.tz = c.az + Math.sin(a) * r; c.ty = w.heightAt(c.tx, c.tz) + 0.5 + Math.random() * 0.9; }
        else { c.land = 1; c.t = 2 + Math.random() * 4; c.ty = w.heightAt(c.x, c.z) + 0.12; c.tx = c.x; c.tz = c.z; }
      }
      const k = 1 - Math.exp(-3.2 * dt), px = c.x, pz = c.z;
      c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.y += (c.ty - c.y) * k;
      if (Math.abs(c.x - px) + Math.abs(c.z - pz) > 1e-3) c.h = Math.atan2(c.x - px, c.z - pz);
      const flap = c.land && Math.abs(c.y - c.ty) < 0.05 ? 0.15 : Math.sin(this.T * 22 + i) * 0.55;
      pose(this.buMesh, i, c.x, c.y, c.z, c.h, 1, 0.65 + Math.abs(flap) * 0.5, 1, 0, flap * 0.15);
    }
    this.buMesh.instanceMatrix.needsUpdate = true;

    // ---- fairy-wrens: hop and peck on the ground, short flits, fly up when startled
    for (let i = 0; i < NW; i++) {
      const c = this.wr[i];
      if (!c.on) { hide(this.wrMesh, i); continue; }
      const s = scare(c, 7);
      if (c.fly <= 0) {
        if (s.close) { c.fly = 1; c.h = s.heading; c.tx = c.x + Math.sin(c.h) * 5; c.tz = c.z + Math.cos(c.h) * 5; c.ty = w.heightAt(c.tx, c.tz) + 1.6; }
        else { c.t -= dt; if (c.t <= 0) { c.t = 0.6 + Math.random() * 2; if (Math.random() < 0.7) { c.hop = 1; c.h += (Math.random() - 0.5) * 1.8; } else { c.fly = 1; c.tx = c.x + Math.sin(c.h) * (1 + Math.random() * 2); c.tz = c.z + Math.cos(c.h) * (1 + Math.random() * 2); c.ty = w.heightAt(c.x, c.z) + 0.5 + Math.random() * 0.5; } } }
      }
      if (c.hop && c.fly <= 0) {
        c.hop -= dt * 3.2; if (c.hop <= 0) c.hop = 0;
        const nx = c.x + Math.sin(c.h) * 0.9 * dt * 3.2, nz = c.z + Math.cos(c.h) * 0.9 * dt * 3.2;
        if (!w.waterAt?.(nx, nz) && !w._blocked?.(nx, nz, 0.12)) { c.x = nx; c.z = nz; }
        c.g = w.heightAt(c.x, c.z); c.y = c.g + Math.sin(Math.max(0, c.hop) * Math.PI) * 0.12;
      } else if (c.fly > 0) {
        const k = 1 - Math.exp(-4 * dt);
        c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k; c.y += (c.ty - c.y) * k;
        c.g = w.heightAt(c.x, c.z);
        if (Math.hypot(c.x - c.tx, c.z - c.tz) < 0.25) { c.fly = 0; c.y = c.g; c.t = 0.4 + Math.random(); }
      } else { c.g = w.heightAt(c.x, c.z); c.y = c.g; }
      const bob = c.fly > 0 ? Math.sin(this.T * 28 + i) * 0.02 : 0;
      const wade = c.as === 'wader';
      pose(this.wrMesh, i, c.x, c.y + bob, c.z, c.h, wade ? 0.9 : 1, wade ? 1.45 : 1, wade ? 0.85 : 1);
      this.wrMesh.setColorAt(i, _c.set(wade ? 0xd5d0c4 : 0xffffff));
    }
    this.wrMesh.instanceMatrix.needsUpdate = true;
    if (this.wrMesh.instanceColor) this.wrMesh.instanceColor.needsUpdate = true;
  }

  /** how many of each are out right now (tests) */
  counts() {
    return {
      skinks: this.sk.filter((c) => c.on).length, trails: this.tr.filter((c) => c.on).length,
      flies: this.fl.filter((c) => c.on).length, crabs: this.cr.filter((c) => c.on && c.dig < 1).length,
      frogs: this.fr.filter((c) => c.on).length, hermits: this.hm.filter((c) => c.on && c.hide < 1).length,
      butterflies: this.bu.filter((c) => c.on).length, wrens: this.wr.filter((c) => c.on).length,
    };
  }
  /** kinds of harmless critters currently visible within r metres of the octopus (for the field journal) */
  kindsNear(o, r = 16) {
    const out = new Set(), hit = (arr, id, ok) => { for (const c of arr || []) if (c.on && (!ok || ok(c)) && Math.hypot(c.x - o.x, c.z - o.z) < r) out.add(c.as || id); };
    hit(this.sk, 'skink'); hit(this.tr, 'ant'); hit(this.fl, 'dragonfly'); hit(this.cr, 'ghostcrab', (c) => c.dig < 1);
    hit(this.fr, 'frog'); hit(this.hm, 'hermit', (c) => c.hide < 1); hit(this.bu, 'butterfly'); hit(this.wr, 'wren');
    return out;
  }
  /** model hookup, for tests: clips, who is simulating, and a few ants on the ground facing the trail */
  antProbe() {
    const samples = [];
    const ang = (a, b) => { const d = a - b; return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); };
    for (let t = 0; t < NT && samples.length < 8; t++) {
      const c = this.tr[t];
      if (!c.on) continue;
      const ca = Math.cos(c.a), sa = Math.sin(c.a);
      for (let j = 0; j < PER && samples.length < 8; j += 3) {
        const id = t * PER + j;
        if (!this._aon[id]) continue;
        const back = j % 2 === 1, want = Math.atan2(ca, sa) + (back ? Math.PI : 0);
        let meshYaw = this._ayaw[id], scale = 1, skinned = false;
        for (let s = 0; s < this.antSlots.length; s++) {
          const slot = this.antSlots[s];
          if (slot.live && slot.id === id) { meshYaw = slot.root.rotation.y; scale = slot.root.scale.x; skinned = true; break; }
        }
        samples.push({
          y: this._ay[id], ground: this.world.heightAt(this._ax[id], this._az[id]),
          face: ang(meshYaw, want), scale, skinned, near: this._anear[id] === 1,
        });
      }
    }
    let walk = 0, idle = 0, instScale = 0;
    for (let s = 0; s < this.antSlots.length; s++) {
      const slot = this.antSlots[s];
      if (!slot.live) continue;
      if (slot.walk.getEffectiveWeight() >= slot.idle.getEffectiveWeight()) walk++; else idle++;
    }
    const inst = this.antInst;
    if (inst && inst.count > 0) { inst.getMatrixAt(0, _m); _m.decompose(_p, _q, _s); instScale = _s.x; }
    return {
      ready: this.antReady, error: this.antError, clips: this.antClips.slice(), dur: { ...this.antDur },
      scale: 1, tris: this.antTris, farTris: this.antFarTris, cap: this.antCap,
      simulating: this._antSim, instanced: inst ? inst.count : 0, instScale,
      walk, idle, samples,
    };
  }
  /** model hookup, for tests: clips, who is simulating, and whether a hop is in the air */
  frogProbe() {
    const samples = [];
    for (let i = 0; i < NFR; i++) {
      const c = this.fr[i];
      if (!c.on) continue;
      let clip = null, scale = 1, skinned = false, meshY = c.y + (c.wet && c.air <= 0 ? -0.02 : 0);
      for (let s = 0; s < this.frogSlots.length; s++) {
        const slot = this.frogSlots[s];
        if (slot.live && slot.id === i) {
          skinned = true; clip = slot.clip; scale = slot.root.scale.x; meshY = slot.root.position.y;
          break;
        }
      }
      samples.push({
        i, x: c.x, z: c.z, y: c.y, meshY, ground: this.world.heightAt(c.x, c.z),
        air: c.air, wet: c.wet, croak: c.croak || 0, flick: c.flick || 0,
        heading: c.h, clip, scale, skinned,
      });
    }
    let idle = 0, hop = 0, croak = 0, tongue = 0;
    for (let s = 0; s < this.frogSlots.length; s++) {
      const slot = this.frogSlots[s];
      if (!slot.live) continue;
      if (slot.clip === 'hop') hop++;
      else if (slot.clip === 'croak') croak++;
      else if (slot.clip === 'tongue') tongue++;
      else idle++;
    }
    return {
      ready: this.frogReady, error: this.frogError, clips: this.frogClips.slice(), dur: { ...this.frogDur },
      scale: 1, tris: this.frogTris, farTris: this.frogFarTris, minY: this.frogMinY, cap: this.frogCap,
      simulating: this._frogSim, instanced: this.frMesh ? this.frMesh.count : 0,
      idle, hop, croak, tongue, samples,
    };
  }
  dispose() {
    this.disposed = true;
    for (const m of [this.skMesh, this.flyMesh, this.crMesh, this.hmMesh, this.buMesh, this.wrMesh]) {
      m.geometry.dispose(); this.scene.remove(m);
    }
    if (this.antInst) this.scene.remove(this.antInst);
    for (const s of this.antSlots) { s.mixer.stopAllAction(); this.scene.remove(s.root); }
    this.antMat?.dispose();
    if (this.frMesh) this.scene.remove(this.frMesh);
    for (const s of this.frogSlots) { s.mixer.stopAllAction(); this.scene.remove(s.root); }
    this.frogMat?.dispose(); this.frogLine?.dispose();
    this.mat.dispose(); this.lineMat?.dispose();
  }
}
