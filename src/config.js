// =====================================================================
//  OCTOVENTURE - tweakable settings
//  Change a number, save, and (in `npm run dev`) the game reloads.
// =====================================================================

export const CONFIG = {
  // ---- World -------------------------------------------------------
  worldSize: 1600,         // width/depth of the playable square in metres (URL: ?size=2400). All counts below are per 800x800 m and scale with the area.
  terrainCell: 2.5,        // terrain grid spacing (smaller = prettier but heavier)
  startDistance: 0.42,     // how far from the world centre the octopus starts (fraction of half-size)
  coastDistance: 0.48,     // how far the shoreline is on the opposite side (fraction of half-size)
  worldSeed: 45,           // THE world: one fixed map for everybody (chosen so every biome is within ~800 m of every start). Only the start point varies.
  seed: null,              // dev/debug only: null = the one world; or a number for a different one. URL: ?seed=123

  // ---- Octopus -----------------------------------------------------
  octopus: {
    size: 0.42,            // body scale. A blue-ringed octopus is ~20 cm: the model is 1.5 u long, so at 0.42 one unit ~ 33 cm and the whole world towers over it (see DESIGN.md)
    maxHealth: 100,
    walkSpeed: 7.0,        // speeds are for the unscaled body; Octopus multiplies them by `size` so it covers ground at 'octopus pace'
    sprintSpeed: 11.0,
    sprintDryMult: 2.0,    // sprinting dries you out this much faster
    turnRate: 10,
    baseDryRate: 0.25,     // health lost per second on "normal" ground (x terrain dry multiplier). 0.25 = ~6.5 min from full to empty on grass
    waterSpeedMult: 1.4,   // wading is FASTER than walking on land (terrain slow-downs don't apply in water)
  },

  // ---- Camouflage ----------------------------------------------------
  camo: {
    maxEnergy: 100,
    drainPerSec: 16,       // energy used while camouflaged
    regenPerSec: 10,       // energy regained while not camouflaged
    minToStart: 30,        // after running dry you need this much energy before camo works again
    fadeTime: 0.55,        // seconds to blend into the ground (predators only fooled once ~fully blended)
    dryMult: 1.25,         // holding camo costs extra moisture (chromatophores work hard)
    // While hidden (holding camo with energy left) NO predator can hurt you or keep chasing - see Octopus.camoProtected
    moveSpeedMult: 0.0,    // 0 = frozen while camouflaged (a crawl would also be "mostly still")
  },

  // ---- Water -------------------------------------------------------
  water: {
    // health regained per second while standing in each water source
    sea: 40, puddle: 26, stream: 34, tidepool: 30, drip: 16, sprinkler: 20, rain: 11, pond: 32,
    storm: 24, dew: 12, birdbath: 16, bowl: 18, trough: 28, bin: 13, aircon: 17, hose: 18, dam: 32, estuary: 34,
    puddleCount: 130,
    streamCount: 7,
    dripCount: 14,
    sprinklerCount: 8,
    rainCloudCount: 7,
    pondCount: 6,
    tidepoolCount: 22,
    rainCloudSpeed: 1.6,
  },

  // ---- Time, weather, tides --------------------------------------------------------
  env: {
    dayLength: 720,        // seconds for one full day/night cycle
    startTime: 0.28,       // 0 = midnight, 0.25 = sunrise, 0.5 = noon: the run starts just after dawn (dew on the grass)
    firstWeatherAfter: 150,// calm for the first couple of minutes
    weatherMin: 100, weatherMax: 220,
    heatDryBonus: 0.7,
    rainGain: 2.5,         // moisture per second soaked up in a rain shower (x rain strength; storms give the most)     // a heatwave dries you up to 70% faster
    tideRange: 0.45,       // the sea edge moves up/down this many metres...
    tidePeriod: 300,       // ...over this many seconds
    maxTempPuddles: 70, puddleLife: 140,
  },

  // ---- Difficulty (pause menu / ?difficulty=gentle|normal|harsh) ---------------------------------
  difficulty: 'normal',
  difficulties: {
    gentle: { dry: 0.6,  damage: 0.6, notice: 0.8, camoDrain: 0.7 },
    normal: { dry: 1.0,  damage: 1.0, notice: 1.0, camoDrain: 1.0 },
    harsh:  { dry: 1.5,  damage: 1.5, notice: 1.2, camoDrain: 1.25 },
  },

  // ---- Predators -----------------------------------------------------
  predators: {
    enabled: true,
    // counts per species (spawned in the habitat they like)
    counts: { gull: 10, cat: 5, dog: 5, fox: 6, crab: 9, eagle: 3, human: 5, magpie: 6, kookaburra: 4 },
    cars: 7,               // cars on the roads (per 800x800 m); they ignore camouflage, but you can hear them coming
    safeRadiusAtStart: 35, // nothing spawns this close to the start
    activeRadius: 130,     // predators further than this are paused (performance)
    damageMult: 1.0,       // global damage scale (set 0 for a peaceful stroll)
  },

  // ---- Hints (you are never told where the sea is) ------------------------------------
  hints: {
    seaWind: true,         // faint salt-spray specks drift inland, blowing from the sea
    gullSounds: true,      // gull cries & surf get louder near the coast
    saltHaze: true,        // horizon turns pale turquoise near the coast
  },

  // ---- Graphics / camera -------------------------------------------------
  graphics: {
    shadows: true,         // URL: ?shadows=0 to disable
    pixelRatioCap: 2,
    fogNear: 60,
    fogFar: 230,
    treeCount: 1700,
    grassCount: 7000,
    rockCount: 650,
    flowerCount: 700,
  },
  camera: {
    distance: 7.5, minDistance: 3.5, maxDistance: 16, height: 1.4, fov: 66,   // distances are for the unscaled octopus (multiplied by octopus.size): a low camera, a slightly wide lens
    pitch: 0.42,
    usePointerLock: true,    // click once to capture the mouse, then just move it to look (Esc releases + pauses)
    mouseSensitivity: 0.0022, // radians per pixel of mouse movement
    invertY: false,          // true = push mouse up to raise the camera
    minPitch: 0.08, maxPitch: 1.35,
  },

  // ---- Abilities (all discovered by play; keys are only listed in the README) ----------------------
  abilities: {
    inkCooldown: 9, inkRadius: 6.5, inkLife: 7,          // F / Q (or gamepad B): only works in water
    biteCooldown: 28, biteRange: 3.6, biteScare: 9,      // right-click / B (or gamepad X): last resort
    climbPush: 0.55,                                     // seconds of pushing into a fence/wall before the octopus climbs by itself (R / gamepad Y: instantly)
    hideNoticeMult: 0.22,                                // sight range multiplier while tucked into a shell / tin / under a rock
    swimSpeedMult: 1.2,                                  // extra speed in deep sea water (on top of the wading boost)
    tunnelSpeed: 9, tunnelWetGain: 14,                   // squeezing through pipes: speed (m/s), rehydration per second in wet tunnels
    carryTime: 3.6, carryDamage: 18, carDamage: 38,      // bucket people / cars
  },

  // ---- Hidden collectibles (never shown on screen) -----------------------------------
  shells: { count: 70, armorPerShell: 0.06, maxArmor: 0.5 },   // shell collectibles (see DESIGN.md - spoilers)

  audio: { enabled: true, volume: 0.6 },
};

// ---- Terrain types (also what the octopus camouflages to) ------------
// speed = movement multiplier, dry = drying multiplier (lower = safer, moister ground)
export const TERRAIN = {
  lawn:   { name: 'Garden lawn',   color: 0x6dbb48, speed: 1.00, dry: 0.90 },
  grass:  { name: 'Meadow grass',  color: 0x86b04a, speed: 1.00, dry: 1.00 },
  forest: { name: 'Forest floor',  color: 0x44703a, speed: 0.85, dry: 0.70 },
  mud:    { name: 'Squelchy mud',  color: 0x6b4f3a, speed: 0.55, dry: 0.45 },
  rock:   { name: 'Sun-baked rock', color: 0x8d8c88, speed: 0.80, dry: 1.50 },
  scrub:  { name: 'Dry scrub',     color: 0xb59c5a, speed: 0.95, dry: 1.60 },
  road:   { name: 'Hot asphalt',   color: 0x55555c, speed: 1.15, dry: 2.20 },
  sand:   { name: 'Dry sand',      color: 0xe6d29a, speed: 0.70, dry: 1.90 },
  dune:   { name: 'Dune sand',     color: 0xdfc27c, speed: 0.60, dry: 2.10 },
  wet:    { name: 'Wet tidal flat', color: 0xa68e62, speed: 0.85, dry: 0.40 },
  // biome-specific ground
  pasture:   { name: 'Pasture',        color: 0xb2b352, speed: 1.00, dry: 1.05 },
  plough:    { name: 'Ploughed soil',  color: 0x7a5233, speed: 0.80, dry: 0.80 },
  litter:    { name: 'Leaf litter',    color: 0x7b5a3a, speed: 0.92, dry: 0.80 },
  bank:      { name: 'Creek bank',     color: 0x7f6e4b, speed: 0.85, dry: 0.60 },
  gravel:    { name: 'Gravel',         color: 0xa39b8c, speed: 0.92, dry: 1.25 },
  swamp:     { name: 'Swampy mud',     color: 0x4a5a36, speed: 0.60, dry: 0.35 },
  dunegrass: { name: 'Dune grass',     color: 0xcdc47e, speed: 0.72, dry: 1.70 },
  headland:  { name: 'Headland rock',  color: 0x5d6068, speed: 0.78, dry: 1.35 },
  paving:    { name: 'Paving',         color: 0x93918f, speed: 1.10, dry: 2.00 },
  // t241u: desert + rainforest ground
  redsand:   { name: 'Red sand',       color: 0xc0582e, speed: 0.80, dry: 2.00 },
  gibber:    { name: 'Gibber plain',   color: 0x8e4a30, speed: 0.85, dry: 1.80 },
  spinifex:  { name: 'Spinifex',       color: 0xb8a45a, speed: 0.80, dry: 1.70 },
  fern:      { name: 'Fern floor',     color: 0x2f5a2a, speed: 0.80, dry: 0.45 },
  mossy:     { name: 'Mossy floor',    color: 0x3f7a34, speed: 0.85, dry: 0.40 },
};

/** the active difficulty's multipliers */
export const diff = () => CONFIG.difficulties[CONFIG.difficulty] || CONFIG.difficulties.normal;
