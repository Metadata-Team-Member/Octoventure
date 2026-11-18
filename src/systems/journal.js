// =====================================================================
//  Field journal, collection and discovery (t254u). Pure data + logic, no three.js.
//  Each creature, plant and material the octopus has actually met is drawn in; the rest stay silhouettes.
//  Saved as a list of ids (and the last satchel tab) on save v5.
// =====================================================================
import { RAW, MADE, POLLEN, loreOf } from './items.js';

/** satchel pages, in the order of the shell tabs */
export const TABS = ['bag', 'journal', 'map', 'collection'];
export const TAB_SET = new Set(TABS);

/**
 * Journal entries. `glyph` is an icon id (ui/icons.js). `how` says how it is discovered:
 *   item:id     held at least once (already in the satchel)
 *   pred:kind   a predator of that kind has been close enough to see
 *   critter:id  a harmless critter of that kind has been close enough to see
 *   baby        a baby octopus has been found
 *   flower      a flower has been brushed
 */
export const ENTRIES = [
  // ---- creatures
  { id: 'octo-baby',  group: 'creature', glyph: 'b_baby',    title: 'A little one',     note: 'A tiny octopus, lost on the land. It follows when it sees you, and hurries to water.', how: 'baby' },
  { id: 'grotto',     group: 'creature', glyph: 'b_grotto',  title: 'The quiet cave',   note: 'A still cave under the reef. The little ones wait there, once they have found the water.', how: 'grotto' },
  { id: 'gull',       group: 'creature', glyph: 'j_gull',    title: 'Seagull',          note: 'A noisy white bird. It hops close, then comes at you with an open beak.', how: 'pred:gull' },
  { id: 'magpie',     group: 'creature', glyph: 'j_magpie',  title: 'Magpie',           note: 'Black and white, watching from a tree. It swoops when you pass underneath.', how: 'pred:magpie' },
  { id: 'kookaburra', group: 'creature', glyph: 'j_kooka',   title: 'Kookaburra',       note: 'A brown bird with a big laugh. It waits, then drops like a stone.', how: 'pred:kookaburra' },
  { id: 'eagle',      group: 'creature', glyph: 'j_eagle',   title: 'Eagle',            note: 'A wide shadow. It circles high, then dives.', how: 'pred:eagle' },
  { id: 'cat',        group: 'creature', glyph: 'j_cat',     title: 'Cat',              note: 'It crouches low and goes still, then pounces.', how: 'pred:cat' },
  { id: 'dog',        group: 'creature', glyph: 'j_dog',     title: 'Dog',              note: 'It follows the trail you leave, sniffing along the ground.', how: 'pred:dog' },
  { id: 'fox',        group: 'creature', glyph: 'j_fox',     title: 'Fox',              note: 'Quiet and rust-coloured. It hunts more when the sun is down.', how: 'pred:fox' },
  { id: 'crab-pred',  group: 'creature', glyph: 'crab',      title: 'Shore crab',       note: 'A heavy crab with raised claws. It lives on the wet sand and will pinch.', how: 'pred:crab' },
  { id: 'human',      group: 'creature', glyph: 'j_human',   title: 'Person',           note: 'A tall walking thing. Some carry a bucket. Best slipped past, never bitten down.', how: 'pred:human' },
  { id: 'snake',      group: 'creature', glyph: 'j_snake',   title: 'Snake',            note: 'A low coil in the grass. It stays still, then strikes.', how: 'pred:snake' },
  { id: 'goanna',     group: 'creature', glyph: 'j_goanna',  title: 'Goanna',           note: 'A long lizard of the dry country. It hunts in the heat and keeps to cover when it rains.', how: 'pred:goanna' },
  { id: 'heron',      group: 'creature', glyph: 'j_heron',   title: 'Heron',            note: 'Tall and grey in the shallows. It stands very still, then the beak comes down.', how: 'pred:heron' },
  { id: 'skink',      group: 'creature', glyph: 'j_skink',   title: 'Skink',            note: 'A little lizard on a warm stone. It darts away if you come close.', how: 'critter:skink' },
  { id: 'ant',        group: 'creature', glyph: 'j_ant',     title: 'Ants',             note: 'A thin line of busy feet, travelling between a nest and a crumb.', how: 'critter:ant' },
  { id: 'dragonfly',  group: 'creature', glyph: 'j_fly',     title: 'Dragonfly',        note: 'A jewel that hovers over damp places, then zips away.', how: 'critter:dragonfly' },
  { id: 'ghostcrab',  group: 'creature', glyph: 'j_gcrab',   title: 'Ghost crab',       note: 'Pale as the sand. It sidles, then pops down a hole when you come close.', how: 'critter:ghostcrab' },
  { id: 'frog',       group: 'creature', glyph: 'j_frog',    title: 'Frog',             note: 'A damp singer in the reeds. It hops into the water when startled.', how: 'critter:frog' },
  { id: 'hermit',     group: 'creature', glyph: 'j_hermit',  title: 'Hermit crab',      note: 'A borrowed shell walking on the beach, pausing to choose a new home.', how: 'critter:hermit' },
  { id: 'butterfly',  group: 'creature', glyph: 'j_butter',  title: 'Butterfly',        note: 'Soft wings over flowers and grass. It flutters off if you brush past.', how: 'critter:butterfly' },
  { id: 'wren',       group: 'creature', glyph: 'j_wren',    title: 'Fairy-wren',       note: 'A tiny bird hopping through the undergrowth, too small to hunt you.', how: 'critter:wren' },
  // ---- plants (gathered plus flowers)
  { id: 'flower',     group: 'plant',    glyph: 'j_flower',  title: 'Flower',           note: 'A bright face in the grass. Brush it and the petals curl; sometimes a sip of dew.', how: 'flower' },
  { id: 'kelp',       group: 'plant',    glyph: 'kelp',      title: 'Kelp',             note: loreOf('kelp').note, how: 'item:kelp' },
  { id: 'lettuce',    group: 'plant',    glyph: 'lettuce',   title: 'Sea lettuce',      note: loreOf('lettuce').note, how: 'item:lettuce' },
  { id: 'moss',       group: 'plant',    glyph: 'moss',      title: 'Dew moss',         note: loreOf('moss').note, how: 'item:moss' },
  { id: 'fungi',      group: 'plant',    glyph: 'fungi',     title: 'Ghost fungi',      note: loreOf('fungi').note, how: 'item:fungi' },
  { id: 'propagule',  group: 'plant',    glyph: 'propagule', title: 'Propagule',        note: loreOf('propagule').note, how: 'item:propagule' },
  ...POLLEN.map((id) => { const L = loreOf(id); return { id, group: 'pollen', glyph: id, title: L.name, note: L.note, how: 'item:' + id }; }),
  // ---- materials (the rest of what can be gathered)
  ...RAW.filter((id) => !['kelp', 'lettuce', 'moss', 'fungi', 'propagule'].includes(id)).map((id) => {
    const L = loreOf(id);
    return { id, group: 'material', glyph: id, title: L.name, note: L.note, how: 'item:' + id };
  }),
  { id: 'rare-gold',  group: 'secret', glyph: 'r_gold',  title: 'Golden shell', note: 'A shell the colour of sunlight, lying where the sand is bright.', how: 'rare:gold' },
  { id: 'rare-pearl', group: 'secret', glyph: 'r_pearl', title: 'Pearl shell',  note: 'A pale pearl, still sitting in its shell.', how: 'rare:pearl' },
  { id: 'rare-frog',  group: 'secret', glyph: 'r_frog',  title: 'Night frog',   note: 'A small frog that glows. It shows itself only after dark, under the thick leaves.', how: 'rare:glowfrog' },
  { id: 'rare-bloom', group: 'secret', glyph: 'r_bloom', title: 'After rain',   note: 'A desert flower. It opens only after the rain has stopped, and only for a little while.', how: 'rare:rainbloom' },
  { id: 'rare-race',  group: 'secret', glyph: 'r_race',  title: 'Moonlit race', note: 'Pale crabs that race the sand, and only under the moon.', how: 'rare:moonrace' },
  { id: 'rare-ring',  group: 'secret', glyph: 'r_ring',  title: 'Fairy ring',   note: 'A circle of mushrooms, easy to walk past.', how: 'rare:ring' },
  { id: 'homes',       group: 'home', glyph: 'b_home',    title: 'Indoors',       note: 'A house with a flap at your height. The room inside is its own.', how: 'place:home' },
  { id: 'lay-lounge',  group: 'home', glyph: 'b_home',    title: 'A lounge',      note: 'A couch to go under, and a sunny patch by the window.', how: 'place:lounge' },
  { id: 'lay-kitchen', group: 'home', glyph: 'b_home',    title: 'A kitchen',     note: 'A table to climb, and a sink left dripping.', how: 'place:kitchen' },
  { id: 'lay-laundry', group: 'home', glyph: 'b_home',    title: 'A laundry',     note: 'A bath with the tap left on.', how: 'place:laundry' },
  { id: 'lay-hall',    group: 'home', glyph: 'b_home',    title: 'A hallway',     note: 'A rug, a shelf, and the long way through.', how: 'place:hall' },
  { id: 'find-button', group: 'home', glyph: 'cap',       title: 'A lost button', note: 'A small round button, under something.', how: 'place:button' },
  { id: 'find-marble', group: 'home', glyph: 'pebble',    title: 'A marble',      note: 'A glass marble, rolled where the floor is quiet.', how: 'place:marble' },
  { id: 'find-glass',  group: 'home', glyph: 'r_pearl',   title: 'Sea glass',     note: 'A piece of sea glass, sitting up on a shelf.', how: 'place:glass' },
  { id: 'find-photo',  group: 'home', glyph: 'b_map',     title: 'A beach photo', note: 'A picture of sand and water, left on the shelf.', how: 'place:photo' },
  { id: 'maze',        group: 'place', glyph: 'b_maze',   title: 'The hedges',    note: 'A maze of round hedges. The middle has water.', how: 'place:maze' },
  { id: 'poi-shed',    group: 'place', glyph: 'b_home',   title: 'A shed',        note: 'Webs, a shelf of bits, and a watering can.', how: 'place:shed' },
  { id: 'poi-drain',   group: 'place', glyph: 'b_wave',   title: 'A storm drain', note: 'A dark pipe that comes out in another street.', how: 'place:drain' },
  { id: 'poi-garden',  group: 'place', glyph: 'b_leaf',   title: 'A shared garden', note: 'Vegetable beds, a scarecrow, and a hose that drips.', how: 'place:garden' },
  { id: 'poi-light',   group: 'place', glyph: 'b_sun',    title: 'The light',     note: 'A tall light on the coast.', how: 'place:light' },
  { id: 'poi-play',    group: 'place', glyph: 'b_star',   title: 'A playground',  note: 'Sand, and a little fountain.', how: 'place:play' },
  { id: 'secret-nest', group: 'place', glyph: 'b_secret', title: 'A little light', note: 'It was not there until a house and the maze were both known.', how: 'place:secret' },
];
export const ENTRY_IDS = ENTRIES.map((e) => e.id);
export const ENTRY_BY = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));

/** rare finds shown as collection portraits (silhouettes until found); babies are separate */
export const RARE = ['jar', 'fungi', 'ochre', 'coral', 'coconut', 'urchin', 'dose', 'shellhalf', 'anemone'];
/** secrets: silhouettes until met. Not satchel items. */
export const SECRET_IDS = ['rare-gold', 'rare-pearl', 'rare-frog', 'rare-bloom', 'rare-race', 'rare-ring'];

export class Journal {
  constructor() { this.reset(); }
  reset() {
    this.seen = new Set();
    this.tab = 'bag';
  }
  has(id) { return this.seen.has(id); }
  /** record a discovery; returns true if it is new */
  see(id) {
    if (!ENTRY_BY[id] || this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }
  /** mark from a 'how' token (item:kelp, pred:dog, critter:skink, baby, flower) */
  seeHow(how) {
    let n = 0;
    for (const e of ENTRIES) if (e.how === how && this.see(e.id)) n++;
    return n;
  }
  seeItem(id) { return this.seeHow('item:' + id); }
  seePred(kind) { return this.seeHow('pred:' + kind); }
  seeCritter(id) { return this.seeHow('critter:' + id); }
  /** already-known satchel items count as discovered (so a loaded save fills the journal) */
  syncItems(inv) {
    if (!inv) return;
    for (const id of RAW) if (inv.seen?.has(id) || inv.count?.(id) > 0) this.seeItem(id);
    for (const id of POLLEN) if (inv.seen?.has(id) || inv.count?.(id) > 0) this.seeItem(id);
    for (const id of MADE) if (inv.seen?.has(id) || inv.made?.has(id)) this.seeItem(id);
  }
  entries(group) { return group ? ENTRIES.filter((e) => e.group === group) : ENTRIES; }
  toJSON() { return { seen: ENTRY_IDS.filter((id) => this.seen.has(id)), tab: TAB_SET.has(this.tab) ? this.tab : 'bag' }; }
  load(o) {
    this.reset();
    if (!o || typeof o !== 'object') return this;
    if (Array.isArray(o.seen)) for (const id of o.seen) if (ENTRY_BY[id]) this.seen.add(id);
    if (TAB_SET.has(o.tab)) this.tab = o.tab;
    return this;
  }
}
