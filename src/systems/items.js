// =====================================================================
//  Items, recipes and the satchel (t236u). Pure data + logic, no three.js, so it is unit-testable and the save file can
//  round-trip it. Pictograms are the satchel's language (see ui/satchel.js); short names and notes live here for tooltips only.
//
//  Raw things are gathered in the world (systems/gather.js); the rest are crafted from them. Effects are applied by
//  systems/abilities.js onto the octopus; the numbers live here so tests and the save can see them.
// =====================================================================
import { GATHER_KINDS } from '../world/gather.js';

export const RAW = GATHER_KINDS;                                   // crab shrimp snail mussel kelp lettuce sponge coral shellhalf pebble moss coconut cap jar + urchin worm beetle spawn propagule
/** pollen brushed off a flower. Not a world spawn: it is taken from the flower itself. */
export const POLLEN = ['py', 'pp', 'pu', 'pw', 'pr', 'pb', 'pd'];
export const POLLEN_COLOR = { py: 0xffe066, pp: 0xff8fa3, pu: 0xc77dff, pw: 0xf7f4ee, pr: 0xe24b4b, pb: 0x6aa6ff, pd: 0xf0b429 };
const POLLEN_NEAR = [[0xffe066, 'py'], [0xff9f45, 'pr'], [0xd96a3a, 'pr'], [0xff8fa3, 'pp'], [0xffffff, 'pw'], [0xf7f4ee, 'pw'], [0xc77dff, 'pu'], [0xe24b4b, 'pr'], [0x6aa6ff, 'pb'], [0xf0b429, 'pd']];
/** nearest pollen id for a flower colour */
export function pollenOf(hex) {
  const n = hex >>> 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  let best = 'py', bd = 1e12;
  for (let i = 0; i < POLLEN_NEAR.length; i++) {
    const h = POLLEN_NEAR[i][0], id = POLLEN_NEAR[i][1];
    const dr = r - ((h >> 16) & 255), dg = g - ((h >> 8) & 255), db = b - (h & 255);
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
export const DYE = POLLEN.map((id) => 'dye' + id);
export const DYE_COLOR = Object.fromEntries(POLLEN.map((id) => ['dye' + id, POLLEN_COLOR[id]]));
export const MADE = ['shield', 'den', 'inksac', 'wrap', 'feast', 'gland', 'hideaway', 'mimic', 'tonic', 'meal', 'dose', 'glow', ...DYE, 'bait', 'glowmix', 'rainbow'];
export const ALL_ITEMS = [...RAW, ...POLLEN, ...MADE];

/** names and short octopus-flavoured notes, shown only as satchel tooltips (never in the world, never on locked or unfound things) */
export const LORE = {
  crab:      { name: 'Crab',          note: 'A scuttling snack. Sweet, and enough for a feast.' },
  shrimp:    { name: 'Shrimp',        note: 'Little darting things. They help fill an ink sac.' },
  snail:     { name: 'Snail',         note: 'A slow, soft morsel. Sharp with venom.' },
  mussel:    { name: 'Mussel',        note: 'A tight shell with a sip of the sea inside. Eaten as it is.' },
  kelp:      { name: 'Kelp',          note: 'Long wet leaves. Good for wrapping.' },
  lettuce:   { name: 'Sea lettuce',   note: 'Soft sea greens. Cool on the skin.' },
  sponge:    { name: 'Sponge',        note: 'A soft sea lump. It takes on other colours.' },
  coral:     { name: 'Coral',         note: 'A hard little branch. Bright, like a disguise.' },
  shellhalf: { name: 'Shell half',    note: 'A broken home. Strong when two are held together.' },
  pebble:    { name: 'Pebble',        note: 'A smooth stone. Good for stacking a den.' },
  moss:      { name: 'Dew moss',      note: 'Damp green fluff. A small sip of wet, eaten as it is.' },
  coconut:   { name: 'Coconut half',  note: 'A hard hollow half. Like a shell, but sweeter.' },
  cap:       { name: 'Bottle cap',    note: 'A round shiny lid. Seals a hideaway.' },
  jar:       { name: 'Glass jar',     note: 'A clear cave you can carry.' },
  urchin:    { name: 'Urchin',        note: 'A prickly bite. Sharp enough for a strong tonic.' },
  worm:      { name: 'Worm',          note: 'A wriggle from the dirt. Filling with a meal.' },
  beetle:    { name: 'Beetle',        note: 'A hard-backed crawler. Bitter, with a sting.' },
  spawn:     { name: 'Frogspawn',     note: 'Jelly dots from still water. A hearty mouthful.' },
  propagule: { name: 'Propagule',     note: 'A mangrove seedling. Briny and strengthening.' },
  ochre:     { name: 'Red ochre',     note: 'Warm red earth. It stains the skin like camouflage.' },
  fungi:     { name: 'Ghost fungi',   note: 'A pale night cap. Strange and potent.' },
  anemone:   { name: 'Anemone',      note: 'A soft flower of the reef. It closes if you touch it.' },
  py:        { name: 'Yellow pollen', note: 'Dust from a yellow flower. It stains the arm tips.' },
  pp:        { name: 'Pink pollen',   note: 'Dust from a pink flower.' },
  pu:        { name: 'Purple pollen', note: 'Dust from a purple flower.' },
  pw:        { name: 'White pollen',  note: 'Dust from a white flower.' },
  pr:        { name: 'Red pollen',    note: 'Dust from a red flower.' },
  pb:        { name: 'Blue pollen',   note: 'Dust from a blue flower.' },
  pd:        { name: 'Desert pollen', note: 'Dust from the flower that opens after rain.' },
  dyepy:     { name: 'Yellow dye',    note: 'A yellow stain for a den. Set it down beside one.' },
  dyepp:     { name: 'Pink dye',      note: 'A pink stain for a den. Set it down beside one.' },
  dyepu:     { name: 'Purple dye',    note: 'A purple stain for a den. Set it down beside one.' },
  dyepw:     { name: 'White dye',     note: 'A white stain for a den. Set it down beside one.' },
  dyepr:     { name: 'Red dye',       note: 'A red stain for a den. Set it down beside one.' },
  dyepb:     { name: 'Blue dye',      note: 'A blue stain for a den. Set it down beside one.' },
  dyepd:     { name: 'Desert dye',    note: 'A warm gold stain for a den. Set it down beside one.' },
  bait:      { name: 'Sweet bait',    note: 'A sweet dust. Something hunting you goes to sniff it instead.' },
  glowmix:   { name: 'Glow mix',      note: 'Pollen and a night-glow. It lights a den.' },
  rainbow:   { name: 'Rainbow dust',  note: 'Every colour of pollen, mixed.' },
  shield:    { name: 'Shell shield',  note: 'Two shells close around you when you keep still.' },
  den:       { name: 'Den',           note: 'A little home of pebbles, set down where you stand.' },
  inksac:    { name: 'Ink sac',       note: 'Three full squirts of ink, even on dry ground.' },
  wrap:      { name: 'Kelp wrap',     note: 'A cool wrap of leaves. You dry more slowly.' },
  feast:     { name: 'Crab feast',    note: 'A rich meal. Health rushes back and the rings glow.' },
  gland:     { name: 'Venom gland',   note: 'The next venomous bite reaches farther and lasts longer.' },
  hideaway:  { name: 'Jar hideaway',  note: 'Tuck into a glass jar. Birds cannot see you.' },
  mimic:     { name: 'Mimic skin',    note: 'A living disguise. Harder to notice, and camouflage lasts.' },
  tonic:     { name: 'Tonic',         note: 'Camouflage energy floods back and stays longer.' },
  meal:      { name: 'Hearty meal',   note: 'A hearty feed. Full health, and the rings shine for a long while.' },
  dose:      { name: 'Lethal dose',   note: 'One drop of lethal venom for the next bite. Spent when it lands.' },
  glow:      { name: 'Reef light',    note: 'A little lamp from the reef. The rings shine, and nothing else changes.' },
};
export const loreOf = (id) => LORE[id] || null;


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
  { id: 'mimic-ochre', out: 'mimic', in: { ochre: 1, sponge: 1 } },          // t241u: desert + sea
  { id: 'shield-ochre', out: 'shield', in: { ochre: 2, shellhalf: 1 } },     // desert + beach
  { id: 'tonic-fungi', out: 'tonic', in: { fungi: 1, kelp: 1 } },            // rainforest + sea
  { id: 'meal-fungi', out: 'meal', in: { fungi: 1, worm: 1 } },              // rainforest + farmland
  { id: 'dose', out: 'dose', in: { fungi: 1, urchin: 1 } },                  // t250u lethal venom dose: rainforest + rocky headland
  { id: 'dose-ochre', out: 'dose', in: { ochre: 1, spawn: 1 } },             //   or red desert + wetland
  { id: 'glow-coral', out: 'glow', in: { anemone: 1, coral: 1 } },
  { id: 'glow-urchin', out: 'glow', in: { anemone: 1, urchin: 1 } },
];
for (const id of POLLEN) {
  RECIPES.push({ id: 'dye-' + id, out: 'dye' + id, in: { [id]: 2 } });
  RECIPES.push({ id: 'bait-' + id, out: 'bait', in: { [id]: 3 } });
}
RECIPES.push({ id: 'glowmix', out: 'glowmix', in: { pb: 1, fungi: 1 } });
RECIPES.push({ id: 'rainbow', out: 'rainbow', in: { py: 1, pp: 1, pu: 1, pw: 1, pr: 1, pb: 1, pd: 1 } });

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
  glow: 70,                   // reef light: rings shine, no heal
  bait: 8,                    // seconds a sweet bait keeps calling
  glowmix: 50,                // seconds a den stays lit
};

/** things you can use straight from the satchel (a click / Enter / quick key) */
export const USABLE = new Set(['shield', 'den', 'inksac', 'wrap', 'feast', 'gland', 'dose', 'hideaway', 'mimic', 'mussel', 'moss', 'tonic', 'meal', 'glow', 'bait', 'glowmix', 'rainbow', ...DYE]);

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
