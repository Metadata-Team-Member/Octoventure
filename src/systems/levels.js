// =====================================================================
//  Levels & badges (t241u / t242u). Pure data + logic (no three.js) so it is unit-testable and saved as-is.
//
//  Experience comes quietly from doing things (new ground, gathering, making, rescuing, getting away, finding new places, and
//  from t250u biting predators to death). A level-up is felt, not read: a shimmer of light and a soft halo around the
//  octopus with a chime (the octopus never changes size or colour). Each level also gives a tiny hidden perk (it dries and
//  tires a little more slowly). The current level is shown only in the Tab satchel, as a number inside a ring. Badges are
//  discoveries: picture tokens in the satchel; a short tooltip names an unlocked one (locked ones stay silent silhouettes).
// =====================================================================
export const XP = { kill: 0, cell: 2, gather: 3, craft: 10, baby: 30, shell: 6, escape: 12, biome: 25, sea: 60, badge: 15, flower: 1, night: 8 };
export const MAX_LEVEL = 30;
/** total experience needed to BE at level L (L1 = 0, L2 = 60, L3 = 150, L4 = 270, L5 = 420, L10 = 1800) */
export const xpForLevel = (L) => (L <= 1 ? 0 : 15 * (L - 1) * (L + 2));
export function levelOf(xp) { let L = 1; while (L < MAX_LEVEL && xp >= xpForLevel(L + 1)) L++; return L; }
/** hidden perks: drying and camouflage drain a little slower each level (never below 75% / 80%) */
export const perks = (L) => ({ dry: Math.max(0.75, 1 - 0.012 * (L - 1)), camo: Math.max(0.8, 1 - 0.01 * (L - 1)) });

/** the badges. `glyph` is a pictogram in ui/icons.js; `test(st, L)` says whether it has been earned. Order = order in the satchel. */
export const BADGES = [
  { id: 'wander',     glyph: 'b_steps',   title: 'Wanderer',     note: 'Twenty-five new patches of ground under the arms.', test: (s) => s.cells >= 25 },
  { id: 'roamer',     glyph: 'b_compass', title: 'Roamer',       note: 'A long wander. A hundred and fifty patches explored.', test: (s) => s.cells >= 150 },
  { id: 'places3',    glyph: 'b_leaf',    title: 'Three places', note: 'Three different kinds of country felt.', test: (s) => s.biomes.size >= 3 },
  { id: 'places7',    glyph: 'b_map',     title: 'Seven places', note: 'Seven different kinds of country felt.', test: (s) => s.biomes.size >= 7 },
  { id: 'placesAll',  glyph: 'b_globe',   title: 'Every place',  note: 'Every kind of country, from desert to sea.', test: (s, L, all) => all > 0 && s.biomes.size >= all },
  { id: 'desert',     glyph: 'b_sun',     title: 'Red earth',    note: 'The hot red desert, under the sun.', test: (s) => s.biomes.has('desert') },
  { id: 'rainforest', glyph: 'b_fern',    title: 'Green gully',  note: 'The damp rainforest, under the ferns.', test: (s) => s.biomes.has('rainforest') },
  { id: 'sea',        glyph: 'b_wave',    title: 'The sea',      note: 'The open water, at last.', test: (s) => s.sea },
  { id: 'baby1',      glyph: 'b_baby',    title: 'A little one', note: 'A baby octopus found and led to water.', test: (s) => s.babies >= 1 },
  { id: 'baby5',      glyph: 'b_babies',  title: 'A family',     note: 'Five little ones found and led to water.', test: (s) => s.babies >= 5 },
  { id: 'gather50',   glyph: 'b_basket',  title: 'Forager',      note: 'Fifty things gathered along the way.', test: (s) => s.gathered >= 50 },
  { id: 'craft1',     glyph: 'b_mortar',  title: 'First making', note: 'Something made from what was found.', test: (s) => s.crafted >= 1 },
  { id: 'craftAll',   glyph: 'b_star',    title: 'Every making', note: 'Every kind of thing that can be made.', test: (s) => s.madeAll },
  { id: 'shells5',    glyph: 'shellhalf', title: 'Shell finder', note: 'Five shells found along the shore.', test: (s) => s.shells >= 5 },
  { id: 'night',      glyph: 'b_moon',    title: 'Night swim',   note: 'A swim under the moon.', test: (s) => s.nightSwim },
  { id: 'rain',       glyph: 'b_rain',    title: 'Rain dance',   note: 'A wander out in the rain.', test: (s) => s.rainDance >= 20 },
  { id: 'storm',      glyph: 'b_bolt',    title: 'Storm walker', note: 'Out in the open when the sky broke.', test: (s) => s.storm },
  { id: 'escape',     glyph: 'b_eye',     title: 'Got away',     note: 'A predator noticed, then lost.', test: (s) => s.escapes >= 1 },
  { id: 'escape10',   glyph: 'b_eyes',    title: 'Slippery',     note: 'Got away ten times.', test: (s) => s.escapes >= 10 },
  { id: 'hunter',     glyph: 'b_fang',    title: 'Hunter',       note: 'A predator bitten down.', test: (s) => s.kills >= 1 },
  { id: 'level5',     glyph: 'b_spark',   title: 'Fifth shine',  note: 'Five shimmers of growing stronger.', test: (s, L) => L >= 5 },
  { id: 'level10',    glyph: 'b_crown',   title: 'Tenth shine',  note: 'Ten shimmers of growing stronger.', test: (s, L) => L >= 10 },
  { id: 'grotto',     glyph: 'b_grotto',  title: 'The quiet cave', note: 'The little ones, waiting in a cave under the reef.', test: (s) => s.grotto },
];
export const BADGE_IDS = BADGES.map((b) => b.id);

export class Levels {
  constructor() { this.reset(); }
  reset() {
    this.xp = 0; this.level = 1;
    this.badges = new Set();
    this.st = { cells: 0, biomes: new Set(), sea: false, babies: 0, gathered: 0, crafted: 0, madeAll: false, shells: 0, nightSwim: false, rainDance: 0, storm: false, escapes: 0, kills: 0, bigKill: 0, grotto: false };
    this.allBiomes = 0;                 // how many land/sea biomes exist (set by the game)
    this.events = [];                   // [{type:'level', level} | {type:'badge', id}] drained by the game each frame
  }
  get perks() { return perks(this.level); }
  /** add experience; queues a 'level' event per level gained */
  add(n) {
    if (!(n > 0)) return 0;
    this.xp += n;
    const L = levelOf(this.xp), gained = L - this.level;
    for (let k = this.level + 1; k <= L; k++) this.events.push({ type: 'level', level: k });
    this.level = L;
    if (gained) this.check();
    return gained;
  }
  /** look for newly earned badges (each awards a little experience too) */
  check() {
    for (const b of BADGES) {
      if (this.badges.has(b.id) || !b.test(this.st, this.level, this.allBiomes)) continue;
      this.badges.add(b.id); this.events.push({ type: 'badge', id: b.id });
      this.add(XP.badge);
    }
  }
  /** record something that happened: kind in XP (plus extra stat bookkeeping) */
  did(kind, arg) {
    const s = this.st;
    switch (kind) {
      case 'cell': s.cells++; break;
      case 'biome': if (s.biomes.has(arg)) return; s.biomes.add(arg); break;
      case 'sea': if (s.sea) return; s.sea = true; break;
      case 'baby': s.babies++; break;
      case 'gather': s.gathered++; break;
      case 'craft': s.crafted++; if (arg) s.madeAll = !!arg.all; break;
      case 'shell': s.shells++; break;
      case 'escape': s.escapes++; break;
      case 'night': if (s.nightSwim) return; s.nightSwim = true; break;
      case 'rain': s.rainDance++; this.check(); return;          // seconds out in the rain (no experience, just the badge)
      case 'storm': if (s.storm) return; s.storm = true; break;
      case 'grotto': if (s.grotto) return; s.grotto = true; break;
      case 'flower': break;
      case 'kill': s.kills++; s.bigKill = Math.max(s.bigKill, Math.min(4, arg?.tier || 1)); this.add(arg?.xp || 0); this.check(); return;
      default: return;
    }
    this.add(XP[kind] || 0);
    this.check();
  }
  drain() { const e = this.events; this.events = []; return e; }
  toJSON() {
    const s = this.st;
    return { xp: Math.round(this.xp), b: BADGE_IDS.filter((id) => this.badges.has(id)),
      st: { cells: s.cells, biomes: [...s.biomes], sea: s.sea, babies: s.babies, gathered: s.gathered, crafted: s.crafted, madeAll: s.madeAll, shells: s.shells, nightSwim: s.nightSwim, rainDance: Math.round(s.rainDance), storm: s.storm, escapes: s.escapes, kills: s.kills, bigKill: s.bigKill, grotto: !!s.grotto } };
  }
  /** load a (possibly damaged / hand-edited) saved object; never throws, never queues events */
  load(o) {
    this.reset();
    if (!o || typeof o !== 'object') return this;
    const n = (v, hi = 1e7) => (Number.isFinite(v) ? Math.max(0, Math.min(hi, Math.floor(v))) : 0);
    this.xp = n(o.xp, 1e8); this.level = levelOf(this.xp);
    if (Array.isArray(o.b)) for (const id of o.b) if (BADGE_IDS.includes(id)) this.badges.add(id);
    const t = o.st || {}, s = this.st;
    s.cells = n(t.cells); s.babies = n(t.babies); s.gathered = n(t.gathered); s.crafted = n(t.crafted); s.shells = n(t.shells); s.escapes = n(t.escapes); s.rainDance = n(t.rainDance); s.kills = n(t.kills); s.bigKill = n(t.bigKill, 4);
    s.sea = !!t.sea; s.madeAll = !!t.madeAll; s.nightSwim = !!t.nightSwim; s.storm = !!t.storm; s.grotto = !!t.grotto || this.badges.has('grotto');
    if (Array.isArray(t.biomes)) for (const b of t.biomes.slice(0, 40)) if (typeof b === 'string' && /^[a-z]{2,16}$/.test(b)) s.biomes.add(b);
    return this;
  }
}
