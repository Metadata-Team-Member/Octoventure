# Design notes (maintainer-facing; deliberately NOT in the README)

## Hidden mechanics
* **Shell toughening (no indication anywhere).** Every shell collected silently adds `CONFIG.shells.armorPerShell` (6%) damage reduction, capped at `maxArmor` (50%). There is no counter, sound, glow or text. Shells are picked up by walking over them (`systems/collect.js`), progress lives in `systems/progress.js`, and `Octopus.damage()` applies `armor`. Tests: `unit.mjs` (3 shells = 18%, cap 50%).
* **Baby octopuses.** `world.babies` (hidden in puddles/tide pools/shells). Walking near one plays a rescue scene (pop-out, ring glow, bubbles, scurry to water). Progress is counted in `progress.js` but never displayed.
* **Cars ignore camouflage** (`player.damage(..., {ignoreCamo:true})`); the counter-play is audio: engine swell and a horn when one bears down.
* **Daily seed:** FNV-1a of `'octopus-run:' + Perth date` (`util/daily.js`); Shift-click Play or the pause-menu chip.

## End-game hooks (the sea no longer ends the game)
`Game` raises a one-off "quiet moment" the first time the sea is reached (camera drift + fade, nothing on screen). `progress.js` records run time, shells, babies, first sea arrival and which coast kind it was (beach / headland / jetty / estuary). Hooks are there for: a ledger shown once after a long idle in the sea; coast-specific endings; babies-found reveal; a return trip mode.

## Scale choices (t225u: a 20 cm octopus)
* The octopus model is 1.5 u long and is drawn at `CONFIG.octopus.size = 0.42` (0.63 u ~ 20 cm, so **1 u ~ 32 cm**). Shrinking the player instead of enlarging the world kept every layout (lots, fence runs, car slots, roads, water spacing) valid.
* Everything tied to body size scales with `size`: speed (`walk 7`, `sprint 11` x size, so it covers the same number of body lengths per second), collision radius, hide / tunnel / climb / pickup radii, camera distance, height, near plane (0.08) and the ground clearance. FOV 66 and low camera give the vast feel.
* Predators are drawn with `SIZE` multipliers (`predators.js`): person 1.8 (~8.5x the octopus), dog 1.05 (~3.9x), cat 0.8 (~2.8x), fox 0.95, gull 1.15 (~2.6x), magpie 1.0, kookaburra 1.05, eagle 1.3, crab 0.7. Compressed from true scale on purpose (a true 8-9x person is off-screen and unplayable); `features.mjs` asserts the ratios. Attack reach scales with the model; notice radii do not.
* World: trees x1.7, bushes x1.3, grass x1.6 (blades 1.1-2.4 u, taller than the octopus), bins x1.9, lamps/posts/logs/crab pots/cairns x1.4-1.6, fences stretched 2.1x vertically (climb height 3.0), houses 1.7x, shops/barns/sheds 1.4-1.7x vertically, cars 1.25x (parked and driving; slot sizes allow it). Rocks and puddles keep their sizes, which at this scale read as boulders and ponds.
* Travel: straight-line trek is ~720 u; at ~2.9 u/s walking (4.6 sprinting) that is 4 min straight, so 5-12 min of real exploring with no compass. Water density was untouched, so it is denser *in octopus terms* than before - dry-out stays comfortable.
* Camera occluder fade (`world/fade.js`): the grass, prop and tree materials get an `onBeforeCompile` patch that dither-discards fragments in a cone around the camera -> octopus ray and right in the lens. No transparency, no sorting, shadows unaffected.
* Ground thump: each footfall of a person/dog/fox/cat (edge of their gait phase) adds `octopus.thump`, scaled by size, speed and distance (`predators.js THUMP`), jolting the camera and playing a low thud. Bird shadows: eagle, gull, magpie, kookaburra get a dark disc seated on the terrain (tilted to the face normal), sharper/larger when low.

## Placement rules (t226u)
One authority, `world/placement.js`, used by the renderer and by `scripts/placement.mjs`:
* `WorldData.heightAt` is the **exact rendered mesh** (triangle interpolation of the cached grid, same diagonal as the terrain builder). `rawHeightAt` is the analytic height used only to build the grid.
* Objects are seated by their **lowest contact points** (up to 16 extreme bottom vertices + centre), never by their middle. Rocks sink 20% of their height, trees' roots 8%, small props 3% (flat things stay flush). Small things tilt to the **slope of the whole footprint** (capped 0.5-0.8 rad), trees/posts/buildings stay upright.
* Water decals fit a plane through the lowest rim point at the average slope. Taps/sprinklers use the lowest ring height. Creature feet follow `heightAt`.
* Audit tolerance `TOL = 0.0315 u` = 1 cm at octopus scale (revisit if the octopus size changes). Results over seeds 11, 2026, 77, 5150, 9001 (249,102 objects): **before** the fix 23,704 hovering and 328 over-buried; **after** 0 and 0. Exemptions: on-cliff objects (slope > 0.5) and the 24 u world-edge fade for the bury check; water decals use a looser 0.175 u hover limit because they are fitted planes over 5-12 u of ground.

## Awareness without markers (t227u)
No sprites, text or icons over animals. `Predator.cue(level)` sets `aware` (noticed 1 / wary 0.45 / calm 0); `sync()` expresses it: head swings toward the octopus (clamped), head up, tail stiffens, crouch for cat/fox/dog, wings half-raised for ground birds, calls; the octopus's rings flash. A source test forbids `Sprite/CanvasTexture/fillText` in `predators.js`.

## World / performance
Chunks of 100 m, terrain cell 2.5 u, per-chunk InstancedMeshes bucketed by category; 11 biomes from a seeded biome field; `?size=` rescales everything per area. Headless software-render numbers: 360-490 draw calls, 165-320k triangles (see README).
