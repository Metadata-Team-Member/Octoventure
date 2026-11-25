// =====================================================================
//  Bands - the layout of the one world, south to north (pure data, no three.js).
//
//  South (+z, the bottom of the map) is the ocean where every game begins, beside a big shell. Going north the country
//  changes in distinct bands and gets harder:
//     ocean  >  shore (beach, dunes, headland, estuary + mangroves)  >  suburb, town and farm  >  bush (gum forest,
//     wetland, a rainforest corner)  >  mud flats (west) | red outback (east)  >  wasteland (old factory, drain, sludge)
//  Soft round mountains close the west, east and north sides; grey shark fins patrol the outer edge of the sea. A river
//  runs from the northern mountains down to the estuary. Hand-overs between bands are short blends (about 40 m), and the
//  borders wander a little, so each band reads as its own place without a ruled line.
// =====================================================================

/** the shoreline (unwarped) and the start-to-shore span the coast profiles in worldData were tuned for */
export const SHORE_Z = 460;
export const SPAN = 720;

/** inner edges of the playable land: past them the ground rises into the ranges and a soft wall holds the octopus */
export const EDGE = { west: -690, east: 690, north: -690, sea: 735 };
/** how far past the inner edge the octopus may go before the wall (on the foothill slope) */
export const WALL = 26;

/** rounded rocky islets out past the reef, and the big red rock (Uluru-like) in the outback: both are part of the terrain */
export const ISLETS = [{ x: -430, z: 612, r: 30, top: 2.2 }, { x: -205, z: 684, r: 20, top: 1.6 }, { x: 250, z: 650, r: 26, top: 2.0 }, { x: 520, z: 602, r: 22, top: 1.8 }];
export const ROCK = { x: 430, z: -385, rx: 55, rz: 26, h: 20 };

/** band order, south to north, with the northern edge (z) of each band (unwarped) and how dangerous it is */
export const BANDS = [
  { id: 'sea',   label: 'Ocean',            z0: SHORE_Z + 6, z1: 900,  danger: 0.0, biomes: ['sea'] },
  { id: 'shore', label: 'Shore',            z0: 330,  z1: SHORE_Z + 6, danger: 0.55, biomes: ['beach', 'dunes', 'headland', 'estuary', 'wetland'] },
  { id: 'town',  label: 'Suburb & farm',    z0: -40,  z1: 330,  danger: 0.85, biomes: ['suburb', 'town', 'farm'] },
  { id: 'bush',  label: 'Bush',             z0: -270, z1: -40,  danger: 1.15, biomes: ['bush', 'wetland', 'rainforest', 'riverbank'] },
  { id: 'outback', label: 'Mud & outback',  z0: -480, z1: -270, danger: 1.5,  biomes: ['mudflat', 'desert'] },
  { id: 'waste', label: 'Wasteland',        z0: -900, z1: -480, danger: 1.95, biomes: ['wasteland'] },
];
export const BAND_IDS = BANDS.map((b) => b.id);
export const BAND = Object.fromEntries(BANDS.map((b, i) => [b.id, i]));

/** the band index at a (warped) z: 0 sea ... 5 wasteland */
export function bandOfZ(zw) {
  for (let i = 0; i < BANDS.length; i++) if (zw >= BANDS[i].z0) return i;
  return BANDS.length - 1;
}

/** how a predator in band i behaves: notice radius multiplier (they spot you from further away up north) */
export const AGGRO = [0.8, 0.85, 1.0, 1.1, 1.2, 1.32];

/**
 * Who lives in each band: density (animals per hectare of land in the band) and the mix. Each entry names the biomes the
 * animal must stand in (`b`) and, for birds that sit in trees, `tree: true`. The density rises northward.
 */
export const BAND_LIFE = {
  shore: { per: 0.42, mix: [
    { kind: 'gull', b: ['beach', 'dunes', 'headland', 'estuary'], share: 0.42 },
    { kind: 'crab', b: ['beach', 'headland', 'estuary', 'wetland'], share: 0.38 },
    { kind: 'human', b: ['beach', 'estuary'], share: 0.1 },
    { kind: 'heron', b: ['estuary', 'wetland'], share: 0.1 },
  ] },
  town: { per: 0.62, mix: [
    { kind: 'cat', b: ['suburb', 'town'], share: 0.2 },
    { kind: 'dog', b: ['suburb', 'farm', 'town'], share: 0.22 },
    { kind: 'human', b: ['suburb', 'town'], share: 0.12 },
    { kind: 'magpie', b: ['suburb', 'farm', 'town'], share: 0.16, tree: true },
    { kind: 'gull', b: ['town', 'suburb'], share: 0.08 },
    { kind: 'fox', b: ['farm'], share: 0.12 },
    { kind: 'eagle', b: ['farm'], share: 0.05 },
    { kind: 'kookaburra', b: ['farm', 'suburb'], share: 0.05, tree: true },
  ] },
  bush: { per: 0.9, mix: [
    { kind: 'fox', b: ['bush', 'riverbank'], share: 0.22 },
    { kind: 'snake', b: ['bush', 'rainforest', 'wetland', 'riverbank'], share: 0.22 },
    { kind: 'kookaburra', b: ['bush', 'riverbank', 'rainforest'], share: 0.16, tree: true },
    { kind: 'magpie', b: ['bush'], share: 0.08, tree: true },
    { kind: 'eagle', b: ['bush', 'riverbank'], share: 0.12 },
    { kind: 'heron', b: ['wetland', 'riverbank'], share: 0.12 },
    { kind: 'dog', b: ['bush'], share: 0.08 },
  ] },
  outback: { per: 1.2, mix: [
    { kind: 'goanna', b: ['desert'], share: 0.26 },
    { kind: 'snake', b: ['desert', 'mudflat'], share: 0.18 },
    { kind: 'fox', b: ['desert', 'mudflat'], share: 0.18 },
    { kind: 'eagle', b: ['desert', 'mudflat'], share: 0.16 },
    { kind: 'heron', b: ['mudflat'], share: 0.12 },
    { kind: 'crab', b: ['mudflat'], share: 0.1 },
  ] },
  waste: { per: 1.6, mix: [
    { kind: 'fox', b: ['wasteland'], share: 0.22 },
    { kind: 'dog', b: ['wasteland'], share: 0.2 },
    { kind: 'cat', b: ['wasteland'], share: 0.14 },
    { kind: 'snake', b: ['wasteland'], share: 0.12 },
    { kind: 'eagle', b: ['wasteland'], share: 0.12 },
    { kind: 'gull', b: ['wasteland'], share: 0.12 },
    { kind: 'goanna', b: ['wasteland'], share: 0.08 },
  ] },
};

/** area (hectares) of land in band i inside the playable edges */
export function bandArea(i) {
  const b = BANDS[i];
  const z0 = Math.max(b.z0, EDGE.north), z1 = Math.min(b.z1, b.id === 'shore' ? SHORE_Z : EDGE.sea);
  return Math.max(0, (EDGE.east - EDGE.west) * (z1 - z0)) / 10000;
}

/**
 * Plan every resident animal for a world: [{ kind, x, z, band, tree }]. Pure (only uses the world's own random stream and
 * its biome / height queries), so the tests can count densities without a renderer.
 */
export function planLife(world, opts = {}) {
  const rnd = world.rnd, out = [];
  const safe = opts.safe ?? 35;
  const trees = world.decor?.trees ?? [];
  const PERCH = new Set(['gum', 'oak', 'paperbark', 'willow', 'banksia']);
  for (let bi = 1; bi < BANDS.length; bi++) {
    const band = BANDS[bi], life = BAND_LIFE[band.id];
    if (!life) continue;
    const want = Math.round(life.per * bandArea(bi) * (opts.scale ?? 1));
    const z0 = Math.max(band.z0, EDGE.north + 10), z1 = Math.min(band.z1, SHORE_Z + 4);
    for (let n = 0; n < want; n++) {
      let r = rnd(), e = life.mix[0];
      for (const m of life.mix) { r -= m.share; if (r <= 0) { e = m; break; } }
      let spot = null;
      for (let t = 0; t < 200 && !spot; t++) {
        if (e.tree && trees.length) {
          const tr = trees[Math.floor(rnd() * trees.length)];
          if (!tr || !PERCH.has(tr.kind) || tr.z < z0 || tr.z > z1) continue;
          if (world.bandAt(tr.x, tr.z) !== bi || !e.b.includes(world.biomeAt(tr.x, tr.z))) continue;
          if (Math.hypot(tr.x - world.start.x, tr.z - world.start.z) < safe + 10) continue;
          spot = { x: tr.x, z: tr.z };
          continue;
        }
        const x = EDGE.west + 12 + rnd() * (EDGE.east - EDGE.west - 24), z = z0 + rnd() * (z1 - z0);
        if (world.bandAt(x, z) !== bi) continue;
        if (!e.b.includes(world.biomeAt(x, z))) continue;
        if (Math.hypot(x - world.start.x, z - world.start.z) < safe) continue;
        const h = world.heightAt(x, z);
        if (h < 0.3 || world.waterAt(x, z) || world._blocked(x, z, 1.5)) continue;
        spot = { x, z };
      }
      if (spot) out.push({ kind: e.kind, x: spot.x, z: spot.z, band: bi, tree: !!e.tree });
    }
  }
  return out;
}
