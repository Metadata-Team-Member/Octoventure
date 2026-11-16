// =====================================================================
//  OCTOPUS RUN TO THE SEA - tweakable settings
//  Change a number, save, and (in `npm run dev`) the game reloads.
// =====================================================================

export const CONFIG = {
  // ---- World -------------------------------------------------------
  worldSize: 800,          // width/depth of the playable square (world units ~ metres)
  terrainCell: 2.5,        // terrain grid spacing (smaller = prettier but heavier)
  startDistance: 0.55,     // how far from the world centre the octopus starts (fraction of half-size)
  coastDistance: 0.55,     // how far the shoreline is on the opposite side (fraction of half-size)
  seed: null,              // null = new random world each run; or a number. URL: ?seed=123

  // ---- Octopus -----------------------------------------------------
  octopus: {
    maxHealth: 100,
    walkSpeed: 7.0,
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
    heatDryBonus: 0.7,     // a heatwave dries you up to 70% faster
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
    counts: { gull: 10, cat: 5, dog: 5, fox: 6, crab: 9, eagle: 3, human: 5 },
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
    distance: 7.5, minDistance: 3.5, maxDistance: 16, height: 1.4, fov: 58, pitch: 0.42,
    usePointerLock: true,    // click once to capture the mouse, then just move it to look (Esc releases + pauses)
    mouseSensitivity: 0.0022, // radians per pixel of mouse movement
    invertY: false,          // true = push mouse up to raise the camera
    minPitch: 0.08, maxPitch: 1.35,
  },

  // ---- Hidden collectibles (never shown on screen) -----------------------------------
  shells: { count: 70, armorPerShell: 0.06, maxArmor: 0.5 },   // every shell quietly absorbs 6% more predator damage (cap 50%)

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
};

/** the active difficulty's multipliers */
export const diff = () => CONFIG.difficulties[CONFIG.difficulty] || CONFIG.difficulties.normal;
