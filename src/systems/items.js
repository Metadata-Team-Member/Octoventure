// =====================================================================
//  Items, recipes and the satchel (t236u). Pure data + logic, no three.js, so it is unit-testable and the save file can
//  round-trip it. Nothing here is ever worded on screen: the satchel panel shows only pictograms (see ui/satchel.js).
//
//  Raw things are gathered in the world (systems/gather.js); the rest are crafted from them. Effects are applied by
//  systems/abilities.js onto the octopus; the numbers live here so tests and the save can see them.
// =====================================================================
import { GATHER_KINDS } from '../world/gather.js';

export const RAW = GATHER_KINDS;                                   // crab shrimp snail mussel kelp lettuce sponge coral shellhalf pebble moss coconut cap jar + urchin worm beetle spawn propagule
export const MADE = ['shield', 'den', 'inksac', 'wrap', 'feast', 'gland', 'hideaway', 'mimic', 'tonic', 'meal'];
export const ALL_ITEMS = [...RAW, ...MADE];

/** craft recipes: `in` = ingredient counts, `out` = the made item. More than one recipe may make the same thing. */
export const RECIPES = [
  { id: 'shield-shell', out: 'shield', in: { shellhalf: 2 } },
  { id: 'shield-coco', out: 'shield', in: { coconut: 2 } },
  { id: 'den', out: 'den', in: { pebble: 3, shellhalf: 1 } },
  { id: 'inksac', out: 'inksac', in: { shrimp: 2 } },
  { id: 'wrap', out: 'wrap', in: { kelp: 1, lettuce: 1 } },
  { id: 'wrap-moss', out: 'wrap', in: { kelp: 1, moss: 1 } },                 // sea + bushland
  { id: 'feast', out: 'feast', in: { crab: 1 } },
  { id: 'gland', out: 'gland', in: { snail: 2 } },
  { id: 'gland-beetle', out: 'gland', in: { beetle: 1, urchin: 1 } },         // bushland + rocky headland
  { id: 'hideaway', out: 'hideaway', in: { jar: 1, cap: 1 } },
  { id: 'mimic', out: 'mimic', in: { sponge: 1, coral: 1 } },
  { id: 'mimic-moss', out: 'mimic', in: { sponge: 1, moss: 1 } },             // sea + bushland
  { id: 'tonic', out: 'tonic', in: { urchin: 1, propagule: 1 } },             // rocky headland + mangroves
  { id: 'meal', out: 'meal', in: { worm: 1, spawn: 1 } },                     // farmland + wetland
];

/** how long each effect lasts (s) and how strong it is */
export const FX = {
  shield: 40,            // the shell pair is carried / closed around you for this long
  jar: 45,               // time spent inside the jar
  kelp: 110, kelpDry: 0.4,        // drying on land x0.4 while wrapped
  mimic: 140, mimicDrain: 0.35, mimicNotice: 0.55,
  feast: 45, feastHeal: 45,       // rings glow brighter; health restored at once
  tonic: 80, tonicDrain: 0.45,    // camouflage energy refilled at once, then drains x0.45 as fast for this long
  mealHeal: 100, mealGlow: 90,    // a hearty meal: full health at once and the rings glow for twice as long
  inkCharges: 3,                  // squirts per ink sac (usable anywhere, no cooldown)
  venomScare: 2.4, venomRange: 1.6,  // the next bite scares for x2.4 as long, from x1.6 as far
  mussel: 20, moss: 12,           // eaten straight from the satchel (health)
  denRest: 2.4, denDry: 0.15, denMax: 3,  // resting inside a den: health per second, drying multiplier, dens kept
};

/** things you can use straight from the satchel (a click / Enter / quick key) */
export const USABLE = new Set(['shield', 'den', 'inksac', 'wrap', 'feast', 'gland', 'hideaway', 'mimic', 'mussel', 'moss', 'tonic', 'meal']);

export class Inventory {
  constructor() { this.reset(); }
  reset() {
    this.counts = {};                 // item id -> n
    this.seen = new Set();            // every item ever held: only these appear in the satchel
    this.made = new Set();            // made items ever crafted (for recipes that stay visible)
  }
  count(id) { return this.counts[id] || 0; }
  add(id, n = 1) { if (!ALL_ITEMS.includes(id)) return false; this.counts[id] = this.count(id) + n; this.seen.add(id); return true; }
  take(id, n = 1) { if (this.count(id) < n) return false; this.counts[id] -= n; if (this.counts[id] <= 0) delete this.counts[id]; return true; }
  has(need) { for (const k in need) if (this.count(k) < need[k]) return false; return true; }
  /** a recipe shows up once at least one of its ingredients has been found */
  discovered(r) { return Object.keys(r.in).some((k) => this.seen.has(k)); }
  visibleRecipes() { return RECIPES.filter((r) => this.discovered(r)); }
  canCraft(r) { return this.has(r.in); }
  craft(r) {
    if (typeof r === 'string') r = RECIPES.find((q) => q.id === r);
    if (!r || !this.canCraft(r)) return false;
    for (const k in r.in) this.take(k, r.in[k]);
    this.add(r.out); this.made.add(r.out);
    this.onCraft?.(r, MADE.every((m) => this.made.has(m)));
    return true;
  }
  /** items shown in the left grid, in a stable order: raw things first, then made things */
  slots() { return ALL_ITEMS.filter((id) => this.seen.has(id)).map((id) => ({ id, n: this.count(id) })); }
  toJSON() {
    const counts = {}; for (const id of ALL_ITEMS) if (this.counts[id] > 0) counts[id] = this.counts[id];
    return { counts, seen: ALL_ITEMS.filter((id) => this.seen.has(id)), made: MADE.filter((id) => this.made.has(id)) };
  }
  load(o) {
    this.reset();
    if (!o || typeof o !== 'object') return this;
    const num = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(999, Math.floor(v))) : 0);
    for (const id of ALL_ITEMS) { const n = num(o.counts?.[id]); if (n > 0) this.counts[id] = n; }
    if (Array.isArray(o.seen)) for (const id of o.seen) if (ALL_ITEMS.includes(id)) this.seen.add(id);
    for (const id in this.counts) this.seen.add(id);
    if (Array.isArray(o.made)) for (const id of o.made) if (MADE.includes(id)) this.made.add(id);
    return this;
  }
}
