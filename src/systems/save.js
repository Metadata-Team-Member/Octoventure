// =====================================================================
//  Saving progress (t238u). No login, no server: the game keeps one small save in this browser's localStorage and carries on from it
//  next time (Play simply continues). A short "code" (compressed, base64) can move the same save to another browser.
//
//  The save holds nothing personal: the world seed, where the octopus is and how it is, what it carries and has made, which
//  things were taken from the world, which babies were found, and the time of day / weather. See DESIGN.md for the schema.
//
//  Everything read back is validated and clamped, so a damaged, hand-edited or foreign save can never break the game: at worst it is ignored.
//  Versioned: every format change adds a step to MIGRATIONS (older saves are carried forward; saves from a newer game are ignored).
// =====================================================================
import { Inventory, ALL_ITEMS } from './items.js';
import { CONFIG } from '../config.js';
import { Levels } from './levels.js';
import { Journal } from './journal.js';

export const SAVE_KEY = 'octo.save.v2';
export const LEGACY_KEYS = ['octo.save.v1'];          // older games kept their save here; it is carried forward on first load, then removed
export const SAVE_VERSION = 10;
const WEATHER_KINDS = ['clear', 'heatwave', 'rain', 'storm'];
const BUFFS = ['shield', 'jar', 'kelp', 'mimic', 'feast', 'tonic'];
const MAX_TRAIL = 1200;
/** optional wander-trail (flat [x, z, ...] whole metres; older saves simply have none) */
const trail = (a) => { if (!Array.isArray(a)) return []; const t = a.slice(-MAX_TRAIL * 2); const ok = t.every((n) => Number.isInteger(n) && Math.abs(n) < 1e6); return ok && t.length % 2 === 0 ? t : []; };
const MAX_IDS = 6000, MAX_CELLS = 6000, MAX_DENS = 3;

/** old formats -> the next one. Each takes a plain object at version N and returns it at N + 1. */
export const MIGRATIONS = {
  // v0 was an early prototype shape: { v:0, seed, pos:{x,z}, hp }  ->  the v1 layout
  0: (o) => ({ v: 1, seed: o.seed, octo: { x: o.pos?.x, z: o.pos?.z, heading: o.heading ?? 0, health: o.hp ?? 100, energy: o.energy ?? 100 }, run: o.run ?? 0 }),
  // v1 saves belonged to a per-seed random world. v2 has ONE fixed world, so the old map no longer exists: keep what the octopus
  // IS (satchel, effects, health, the armour and baby tally, the clock and weather) and drop everything tied to the old map
  // (position, which things were picked up, den spots, explored cells). `fresh` = "begin at a new start point in the one world".
  1: (o) => {
    const p = o.octo, okN = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6;
    if (!p || typeof p !== 'object' || !okN(p.x) || !okN(p.z) || typeof o.seed !== 'number' || !Number.isInteger(o.seed) || o.seed < 0 || o.seed > 4294967295) throw new Error('not a v1 save');   // damaged v1 saves stay refused
    return {
    v: 2, seed: CONFIG.worldSeed, fresh: true, saved: o.saved,
    octo: { heading: o.octo?.heading, health: o.octo?.health, energy: o.octo?.energy },
    run: o.run, sea: o.sea,
    shells: { n: o.shells?.n, o: [], r: [] },
    babies: (Array.isArray(o.babies) ? o.babies : []).slice(0, 2000).map((_, i) => 'm' + i),
    inv: o.inv, fx: o.fx, dens: [], got: [], explored: [], env: o.env,
    };
  },
  // v3 (t241u) adds levels & badges. Older saves start at level 1, with what they already did counted towards the badges.
  // v4 (t250u) adds the crafted lethal venom dose (fx.lethal) and kill tallies (lv.st.kills / bigKill); older saves have neither.
  3: (o) => ({ ...o, v: 4, fx: { ...(o.fx && typeof o.fx === 'object' ? o.fx : {}), lethal: false } }),
  // v5 (t254u) adds the field journal (discovered ids) and the last satchel tab.
  4: (o) => ({ ...o, v: 5, journal: { seen: [], tab: 'bag' } }),
  // v6 adds the quiet-cave flag on the level stats (missing means not found).
  5: (o) => ({ ...o, v: 6 }),
  // v7 adds den decorations and anything the octopus is carrying home.
  6: (o) => ({ ...o, v: 7, decor: Array.isArray(o.decor) ? o.decor : [], carry: null }),
  // v8 records which rare finds have been met (lv.st.rare). Older saves simply have none; load treats a missing list as empty.
  7: (o) => ({ ...o, v: 8 }),
  // v9 records which pollen colours have been gathered (lv.st.pollen). Older saves have none.
  8: (o) => {
    const st0 = o.lv && o.lv.st && typeof o.lv.st === 'object' ? o.lv.st : {};
    const st = {
      ...st0,
      pollen: Array.isArray(st0.pollen) ? st0.pollen : [],
      homes: Array.isArray(st0.homes) ? st0.homes : [],
      pois: Array.isArray(st0.pois) ? st0.pois : [],
      maze: !!st0.maze, mazewet: !!st0.mazewet, rainbow: !!st0.rainbow, secret: !!st0.secret,
    };
    const lv = o.lv && typeof o.lv === 'object' ? { ...o.lv, st } : o.lv;
    return { ...o, v: 9, lv };
  },
  // v10: the world was rebuilt as bands from the sea (south) to the ranges (north), so the old map is gone again. Keep what the
  // octopus IS and has earned (satchel, effects, health, levels, badges, journal, shell and baby tallies, clock and weather) and
  // drop what was tied to the old map (position, picked-up spots, dens, explored cells, trail). Den decorations and anything
  // being carried go back into the satchel. `fresh` = begin by the big shell in the sea.
  9: (o) => {
    const p = o.octo, okN = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6;
    if (!o.fresh && (!p || typeof p !== 'object' || !okN(p.x) || !okN(p.z))) throw new Error('not a v9 save');   // a damaged save stays refused
    const inv0 = o.inv && typeof o.inv === 'object' ? o.inv : {};
    const counts = { ...(inv0.counts && typeof inv0.counts === 'object' ? inv0.counts : {}) };
    const back = [...(Array.isArray(o.decor) ? o.decor.map((d) => d && d.id) : []), o.carry];
    for (const id of back) if (typeof id === 'string' && ALL_ITEMS.includes(id)) counts[id] = Math.min(999, (Number(counts[id]) || 0) + 1);
    return {
      ...o, v: 10, fresh: true,
      octo: { heading: o.octo?.heading, health: o.octo?.health, energy: o.octo?.energy },
      shells: { n: o.shells?.n, o: [], r: [] },
      babies: (Array.isArray(o.babies) ? o.babies : []).slice(0, 2000).map((_, i) => 'm' + i),
      inv: { ...inv0, counts }, dens: [], decor: [], carry: null, got: [], explored: [], trail: [],
    };
  },
  2: (o) => ({ ...o, v: 3, lv: { xp: 0, b: [], st: { cells: Array.isArray(o.explored) ? o.explored.length : 0, babies: Array.isArray(o.babies) ? o.babies.length : 0, sea: !!o.sea, shells: Number(o.shells?.n) || 0 } } }),
};

const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const ids = (a, re, max = MAX_IDS) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string' && s.length <= 40 && re.test(s)).slice(0, max) : []);
const ID_RE = /^[A-Za-z0-9_]+$/;
function cleanDecor(a) {
  if (!Array.isArray(a)) return [];
  const out = [];
  for (const p of a) {
    if (!p || typeof p.id !== 'string' || !ALL_ITEMS.includes(p.id)) continue;
    if (![p.x, p.z, p.denx, p.denz].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6)) continue;
    out.push({ id: p.id, x: p.x, z: p.z, rot: num(p.rot, -100, 100, 0), denx: p.denx, denz: p.denz });
    if (out.length >= 24) break;
  }
  return out;
}

/** carry an old save forward to `target`; null if it is from the future / unreadable. `table` lets tests plug in their own steps. */
export function migrate(o, target = SAVE_VERSION, table = MIGRATIONS) {
  if (!o || typeof o !== 'object' || !Number.isInteger(o.v) || o.v < 0 || o.v > target) return null;
  let cur = o;
  while (cur.v < target) {
    const step = table[cur.v];
    if (typeof step !== 'function') return null;
    let nx; try { nx = step(cur); } catch { return null; }
    if (!nx || nx.v !== cur.v + 1) return null;
    cur = nx;
  }
  return cur;
}

/** check + clamp a save of the current version; returns a clean copy or null */
export function validateSave(o) {
  if (!o || typeof o !== 'object' || o.v !== SAVE_VERSION) return null;
  const seed = o.seed;
  if (typeof seed !== 'number' || !Number.isFinite(seed) || seed < 0 || seed > 4294967295 || Math.floor(seed) !== seed) return null;
  const p = o.octo || {};
  const fresh = !!o.fresh;                                  // migrated from an older world: no position, begin at a new start
  if (!fresh && (typeof p.x !== 'number' || typeof p.z !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) > 1e6 || Math.abs(p.z) > 1e6)) return null;
  const e = o.env || {};
  const fx = o.fx || {}, buff = {};
  for (const k of BUFFS) buff[k] = num(fx.buff?.[k], 0, 600, 0);
  const dens = Array.isArray(o.dens) ? o.dens.filter((d) => d && Number.isFinite(d.x) && Number.isFinite(d.z) && Math.abs(d.x) < 1e6 && Math.abs(d.z) < 1e6).slice(-MAX_DENS).map((d) => ({ x: d.x, z: d.z })) : [];
  const sh = o.shells || {};
  const inv = new Inventory().load(o.inv).toJSON();
  const cells = Array.isArray(o.explored) ? o.explored.filter((n) => Number.isInteger(n) && n >= 0 && n < 1e9).slice(0, MAX_CELLS) : [];
  return {
    v: SAVE_VERSION, seed, fresh, saved: num(o.saved, 0, 4e12, 0),
    octo: { x: fresh ? null : p.x, z: fresh ? null : p.z, heading: num(p.heading, -1000, 1000, 0), health: num(p.health, 1, 100, 100), energy: num(p.energy, 0, 100, 100) },
    run: num(o.run, 0, 1e9, 0),
    sea: !!o.sea,
    shells: { n: Math.floor(num(sh.n, 0, 100000, 0)), o: (Array.isArray(sh.o) ? sh.o.filter((n) => Number.isInteger(n) && n >= 0 && n < 100000).slice(0, MAX_IDS) : []), r: ids(sh.r, ID_RE) },
    babies: ids(o.babies, ID_RE, 2000),
    inv,
    fx: { buff, ink: Math.floor(num(fx.ink, 0, 20, 0)), venom: !!fx.venom, lethal: !!fx.lethal },
    dens,
    decor: cleanDecor(o.decor),
    carry: (typeof o.carry === 'string' && ALL_ITEMS.includes(o.carry)) ? o.carry : null,
    got: ids(o.got, ID_RE),
    explored: cells,
    ...(Array.isArray(o.trail) ? { trail: trail(o.trail) } : {}),      // optional (older saves have none)
    env: { t: num(e.t, 0, 1, 0.35), abs: num(e.abs, 0, 1e9, 0), kind: WEATHER_KINDS.includes(e.kind) ? e.kind : 'clear', target: WEATHER_KINDS.includes(e.target) ? e.target : 'clear', timer: num(e.timer, 0, 1e6, 60), heat: num(e.heat, 0, 1, 0), rain: num(e.rain, 0, 1, 0), dark: num(e.dark, 0, 1, 0) },
    lv: new Levels().load(o.lv).toJSON(),
    journal: new Journal().load(o.journal).toJSON(),
  };
}
/** parse -> migrate -> validate (null when anything is wrong) */
export function readSaveText(text) {
  let o; try { o = JSON.parse(text); } catch { return null; }
  return validateSave(migrate(o));
}

// ---------------------------------------------------------------- reading the live game
const cellKey = (x, z) => (Math.floor(x / 100) + 5000) * 10000 + (Math.floor(z / 100) + 5000);
export const exploreCell = cellKey;
export const unpackCell = (n) => ({ ix: Math.floor(n / 10000) - 5000, iz: (n % 10000) - 5000 });
export function snapshot(game) {
  const o = game.octopus, w = game.world, env = game.env, inv = game.inv;
  const indoors = game.places?.indoor && game.places.outdoor;
  const px = indoors ? game.places.outdoor.x : o.x, pz = indoors ? game.places.outdoor.z : o.z;
  const got = []; for (const g of game.gather.collected) got.push(g);
  const shellO = [], shellR = [];
  w.shells.forEach((s, i) => { if (!s.got) return; if (s.reg) { if (s.id) shellR.push(s.id); } else shellO.push(i); });
  for (const r of w.regions.list) for (const s of r.shells) if (s.got && s.id && !shellR.includes(s.id)) shellR.push(s.id);
  const buff = {}; for (const k of BUFFS) buff[k] = +o.buff[k].toFixed(1);
  return {
    v: SAVE_VERSION, seed: w.seed, saved: Date.now(),
    octo: { x: +px.toFixed(2), z: +pz.toFixed(2), heading: +o.heading.toFixed(3), health: +o.health.toFixed(1), energy: +o.energy.toFixed(1) },
    run: +game.runTime.toFixed(1), sea: !!game.progress.seaReached,
    shells: { n: game.progress.shells, o: shellO, r: shellR },
    babies: [...game.progress.rescued].map(String),
    inv: inv.toJSON(),
    fx: { buff, ink: o.inkCharges, venom: o.venomReady, lethal: !!o.lethalDose },
    dens: game.abilities.denList(),
    decor: game.decor?.toJSON() || [],
    carry: game.decor?.carry || null,
    got, explored: [...game.explored].slice(-MAX_CELLS), trail: (game.trail || []).slice(-MAX_TRAIL * 2),
    lv: game.levels.toJSON(),
    journal: game.journal.toJSON(),
    env: { t: +env.t.toFixed(4), abs: +env.abs.toFixed(1), kind: env.kind, target: env.target, timer: +env.timer.toFixed(1), heat: +env.heat.toFixed(3), rain: +env.rain.toFixed(3), dark: +env.dark.toFixed(3) },
  };
}

/** put a (validated) save into a game whose world was just built from save.seed */
export function applySave(game, s) {
  const o = game.octopus, w = game.world;
  if (!s.fresh) {
    o.x = s.octo.x; o.z = s.octo.z;
    if (w.banded) { const c = w.resolve(o.x, o.z, 0.3); if (c.x !== o.x || c.z !== o.z) { o.x = c.x; o.z = c.z; } }   // never outside the ranges or the sea edge
    o.y = w.heightAt(o.x, o.z); o.heading = s.octo.heading; game.input.yaw = s.octo.heading + Math.PI;
  }
  o.health = s.octo.health; o.energy = s.octo.energy;
  game.runTime = s.run;
  game.progress.shells = s.shells.n; game.progress.rescued = new Set(s.babies); game.progress.seaReached = s.sea;
  o.armor = game.progress.armor;
  game.collect.restore(s.shells.o, s.shells.r, s.babies);
  game.inv.load(s.inv);
  for (const k of BUFFS) o.buff[k] = s.fx.buff[k];
  o.inkCharges = s.fx.ink; o.venomReady = s.fx.venom; o.lethalDose = !!s.fx.lethal;
  o.kelpF = o.buff.kelp > 0 ? 1 : 0; o.mimicF = o.buff.mimic > 0 ? 1 : 0; o.feastF = o.buff.feast > 0 ? 1 : 0; o.jarF = o.buff.jar > 0 ? 1 : 0;
  for (const d of s.dens) game.abilities.addDen(d.x, d.z, false);
  game.decor?.load(s.decor);
  if (s.carry && ALL_ITEMS.includes(s.carry)) { game.decor.carry = s.carry; game.decor.syncCarryMesh(); }
  game.gather.markCollected(s.got);
  game.explored = new Set(s.explored); game.trail = (s.trail || []).slice();
  game.levels.load(s.lv); game.levels.check(); game.levels.drain();      // badges already deserved are granted quietly
  game.journal.load(s.journal); game.journal.syncItems(game.inv);
  if (s.babies?.length) game.journal.seeHow('baby');
  const e = game.env, E = s.env;
  e.t = E.t; e.abs = E.abs; e.kind = E.kind; e.target = E.target; e.timer = E.timer; e.heat = E.heat; e.rain = E.rain; e.dark = E.dark;
  e.apply();
  game.view.flushAround(o.x, o.z, 170);
  game.camInit = false;
}

// ---------------------------------------------------------------- browser storage (never throws)
const isFuture = (text) => { try { const o = JSON.parse(text); return Number.isInteger(o?.v) && o.v > SAVE_VERSION; } catch { return false; } };
/** a save from an older game (kept under an older key): carry it forward, store it under the current key, forget the old one. Never throws. */
function loadLegacy(storage) {
  for (const k of LEGACY_KEYS) {
    let text; try { text = storage.getItem(k); } catch { return null; }
    if (!text) continue;
    const s = readSaveText(text);
    if (s) { if (writeSave(s, storage)) { try { storage.removeItem(k); } catch { /* ignore */ } } return s; }
    if (!isFuture(text)) { try { storage.removeItem(k); } catch { /* ignore */ } }
  }
  return null;
}
export function loadSave(storage = globalThis.localStorage) {
  let text; try { text = storage?.getItem(SAVE_KEY); } catch { return null; }
  if (!text) return loadLegacy(storage);
  const s = readSaveText(text);
  if (!s && !isFuture(text)) { try { storage.removeItem(SAVE_KEY); } catch { /* ignore */ } }      // damaged: forget it rather than trip on it every time (a newer game's save is left alone)
  return s;
}
export function writeSave(s, storage = globalThis.localStorage) { try { storage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch { return false; } }
export function clearSave(storage = globalThis.localStorage) { try { storage?.removeItem(SAVE_KEY); } catch { /* ignore */ } }

// ---------------------------------------------------------------- transfer code
//  OCTO1-<8 hex check>-<base64url of deflate-raw(JSON)>      (OCTO0-... = same but not compressed, where the browser can't compress)
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = (t) => { const s = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((t.length + 3) % 4)); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
const fnv = (bytes) => { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
async function pipe(bytes, stream) {
  const rs = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(rs).arrayBuffer());
}
export async function encodeCode(save) {
  const raw = new TextEncoder().encode(JSON.stringify(save));
  let body, tag = 'OCTO1';
  try { body = await pipe(raw, new CompressionStream('deflate-raw')); } catch { body = raw; tag = 'OCTO0'; }
  return `${tag}-${fnv(raw)}-${b64(body)}`;
}
/** returns a clean save or null (wrong shape, damaged, tampered, from a newer game ...) */
export async function decodeCode(code) {
  try {
    const m = /^(OCTO[01])-([0-9a-f]{8})-([A-Za-z0-9_-]+)$/.exec(String(code).trim());
    if (!m || m[3].length > 200000) return null;
    let body = unb64(m[3]);
    const raw = m[1] === 'OCTO1' ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
    if (raw.length > 2e6 || fnv(raw) !== m[2]) return null;
    return readSaveText(new TextDecoder().decode(raw));
  } catch { return null; }
}
