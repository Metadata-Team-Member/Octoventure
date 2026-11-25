# Design notes

> **SPOILER WARNING.** This file describes the game's hidden mechanics (shell collectibles, baby octopuses, flower dew, the harsh far inland, end-game hooks). If you are play-testing Octoventure, stop reading here and go and play: the game is meant to be discovered.

Maintainer-facing; deliberately not linked from the README.

## Hidden mechanics
* **Shell toughening (no indication anywhere).** Every shell collected silently adds `CONFIG.shells.armorPerShell` (6%) damage reduction, capped at `maxArmor` (50%). There is no counter, sound, glow or text. Shells are picked up by walking over them (`systems/collect.js`), progress lives in `systems/progress.js`, and `Octopus.damage()` applies `armor`. Tests: `unit.mjs` (3 shells = 18%, cap 50%).
* **Baby octopuses.** `world.babies` (hidden in puddles/tide pools/shells). Walking near one plays a rescue scene (pop-out, ring glow, bubbles, scurry to water). Progress is counted in `progress.js` but never displayed.
* **Baby octopuses (t233u).** 28 per 1600 m world (`7 x areaScale`; the same density in every far region). 3-4 within 230 u of the start, ~55% along the start-to-sea corridor, the rest anywhere (spacing 60 u). Hiding places: tins, big shells, tide pools, puddles/ponds, and long grass. Discoverability without markers: when the octopus is within 40 u a tiny wriggling baby (a pool of 24 live slots) peeks out beside the hiding place with a faint additive glint (<=40 u), and within 16 u an occasional very soft blip plays (`audio.babyTell`). Rescue radius `2.6 x max(0.6, size)`. Measured over 8 seeds: 28 babies per world, mean distance from the start 519 u (was 20 per world at 619 u), 11-14 on the corridor and 4-8 within 250 u of the start (was ~3 and ~1).
* **Flower dew (t232u).** Daisies react to a brush: petals curl shut for ~1.4 s and slowly reopen over 9 s, the stem bows away. A flower that still holds dew (cooldown 150 s per flower, global gap 6 s between sips) and an octopus that is a little dry (`health < 99.5`) gets a tiny sip (+0.8 health) with a few dew sparkles and a soft chime. 22% of touches also release a butterfly or bee. No prompt, text or icon anywhere (`systems/flowers.js`). Touched flowers are swapped for one of 8 pooled live meshes; the rest stay instances.
* **Harsh inland (t234u).** `WorldData.harshAt(x, z)` = smoothstep from the original map's inland edge (1 half-width inland of the centre) to 3 half-widths inland: 0 on the original map and on the sea side, 1 far inland. Effects, none of them announced: the octopus dries up to 1.9x faster (`Octopus` dry rates), puddles/ponds become rare (x0.15), trees thin out, flowers disappear, grass turns dry gold, the haze warms (`atmosphere.js`) and visibility shortens 12%, storm puddles stop forming, and more eagles circle (`predators.js farLife`: 1 + 4 x harshness eagles around the player). The way back to water is the gradient: heading toward the sea always makes the land gentler.
* **Endless land (t234u).** There is no map edge. The original 1600 m square is generated whole (as before); everything outside it is generated lazily in 400 u tiles by `world/regions.js` as the octopus approaches (`Regions.ensure` / `WorldView._needRegions`), deterministically per (seed, tile): visiting order never matters (unit test). A far tile has only natural content: trees, rocks, grass, flowers, puddles/ponds/dams/tide pools, reeds, beach bits, seagrass, reef, hide-aways (shell hides, slabs, hollow logs), shells and baby octopuses, all placed with the same `placement.js` seating as the original map; biomes continue analytically (the coast repeats along the shore forever, inland is the farm/bush patchwork; towns and streets do not continue beyond the original square, `biomes.js` fades urban weight out over the last 80 u). `heightAt` uses an unbounded sparse grid (64 x 64 vertex tiles, float32). Chunks stream in and out (`WorldView.chunks` is a Map; chunks further than fogFar + 220 u are disposed), the sea plane follows the player along the shore, far shells borrow slots from a 140-slot pool per model while you are within 120 u, babies use a 24-slot pool, and far wanderers (foxes, dogs, cats, birds, gulls, crabs, eagles) are spawned around you and despawned behind you. Collisions and animals no longer clamp at the old border (the invisible walls were: `WorldData.resolve` clamp at half-14, predator clamps at half-20 (x2) and the storm-gull spawn clamp at half-40, the rain-cloud bounce at half-30, the storm-puddle limit in `environment.js`, the edge-fade of `baseHeight` and the edge mist in terrain vertex colours).
* **Precision.** Positions are JS doubles; terrain/instances are float32 on the GPU. At 10 km float32 resolves ~1 mm in x/z (unit test checks < 1 mm) and heights are sampled from a float32 grid anyway, so no floating-origin rebasing is needed for any realistic walk (the octopus walks ~8 u/s: 10 km would take ~20 minutes).
* **Cars ignore camouflage** (`player.damage(..., {ignoreCamo:true})`); the counter-play is audio: engine swell and a horn when one bears down.
* **Daily start (t239u):** the world is the same every day; the Daily chip (or Shift-click Play, or `?daily`) makes the START POINT a deterministic pick from FNV-1a of `'octopus-run:' + Perth date` (`util/daily.js`) via `WorldData.pickSpawn`, so everyone starts in the same place that day.

## End-game hooks (the sea no longer ends the game)
`Game` raises a one-off "quiet moment" the first time the sea is reached (camera drift + fade, nothing on screen). `progress.js` records run time, shells, babies, first sea arrival and which coast kind it was (beach / headland / jetty / estuary). Hooks are there for: a ledger shown once after a long idle in the sea; coast-specific endings; babies-found reveal; a return trip mode.

## Scale choices (t225u: a 20 cm octopus)
* The octopus model is 1.5 u long and is drawn at `CONFIG.octopus.size = 0.42` (0.63 u ~ 20 cm, so **1 u ~ 32 cm**). Shrinking the player instead of enlarging the world kept every layout (lots, fence runs, car slots, roads, water spacing) valid.
* Everything tied to body size scales with `size`: speed (`walk 7`, `sprint 11` x size, so it covers the same number of body lengths per second), collision radius, hide / tunnel / climb / pickup radii, camera distance, height, near plane (0.08) and the ground clearance. FOV 66 and low camera give the vast feel.
* Predators are drawn with `SIZE` multipliers (`predators.js`): person 1.8 (~8.5x the octopus), dog 1.05 (~3.9x), cat 0.8 (~2.8x), fox 0.95, gull 1.15 (~2.6x), magpie 1.0, kookaburra 1.05, eagle 1.3, crab 0.7, snake 0.9, goanna 1.15, heron 1.05. Compressed from true scale on purpose (a true 8-9x person is off-screen and unplayable); `features.mjs` asserts the ratios. Attack reach scales with the model; notice radii do not.
* World: trees x1.7, bushes x1.3, grass x1.6 (blades 1.1-2.4 u, taller than the octopus), bins x1.9, lamps/posts/logs/crab pots/cairns x1.4-1.6, fences stretched 2.1x vertically (climb height 3.0), houses 1.7x, shops/barns/sheds 1.4-1.7x vertically, cars 1.25x (parked and driving; slot sizes allow it). Rocks and puddles keep their sizes, which at this scale read as boulders and ponds.
* Travel: straight-line trek is ~720 u; at ~2.9 u/s walking (4.6 sprinting) that is 4 min straight, so 5-12 min of real exploring with no compass. Water density was untouched, so it is denser *in octopus terms* than before - dry-out stays comfortable.
* Camera occluder fade (`world/fade.js`): the grass, prop and tree materials get an `onBeforeCompile` patch that dither-discards fragments in a cone around the camera -> octopus ray and right in the lens. No transparency, no sorting, shadows unaffected.
* Ground thump: each footfall of a person/dog/fox/cat/goanna/heron (edge of their gait phase) adds `octopus.thump`, scaled by size, speed and distance (`predators.js THUMP`), jolting the camera and playing a low thud. Bird shadows: eagle, gull, magpie, kookaburra get a dark disc seated on the terrain (tilted to the face normal), sharper and larger when low. An eagle that has noticed you drops into a low circle first, so that disc crosses the ground before the dive.

## Placement rules (t226u)
One authority, `world/placement.js`, used by the renderer and by `scripts/placement.mjs`:
* `WorldData.heightAt` is the **exact rendered mesh** (triangle interpolation of the cached grid, same diagonal as the terrain builder). `rawHeightAt` is the analytic height used only to build the grid.
* Objects are seated by their **lowest contact points** (up to 16 extreme bottom vertices + centre), never by their middle. Rocks sink 20% of their height, trees' roots 8%, small props 3% (flat things stay flush). Small things tilt to the **slope of the whole footprint** (capped 0.5-0.8 rad), trees/posts/buildings stay upright.
* Water decals fit a plane through the lowest rim point at the average slope. Taps/sprinklers use the lowest ring height. Creature feet follow `heightAt`.
* Audit tolerance `TOL = 0.0315 u` = 1 cm at octopus scale (revisit if the octopus size changes). Results over seeds 11, 2026, 77, 5150, 9001 (249,102 objects): **before** the fix 23,704 hovering and 328 over-buried; **after** 0 and 0. Exemptions: on-cliff objects (slope > 0.5) for the bury check (the old 24 u world-edge fade exemption is gone: there is no edge any more); water decals use a looser 0.175 u hover limit because they are fitted planes over 5-12 u of ground.

## Awareness without markers (t227u)
No sprites, text or icons over animals. `Predator.cue(level)` sets `aware` (noticed 1 / wary 0.45 / calm 0); `sync()` expresses it: head swings toward the octopus (clamped), head up, tail stiffens, crouch for cat/fox/dog, wings half-raised for ground birds, calls; the octopus's rings flash. A source test forbids `Sprite/CanvasTexture/fillText` in `predators.js`.

## World / performance
Chunks of 100 m, terrain cell 2.5 u, per-chunk InstancedMeshes bucketed by category; 11 biomes from a seeded biome field; `?size=` rescales everything per area. Headless software-render numbers: 360-490 draw calls, 165-320k triangles (see README).

## Endless land, trail, puddles, trees (t230u-t234u)
* **Trail removed (t246u).** The wet tentacle trail (drag lines with sucker dots) read as car tracks, so it is gone entirely: `systems/trail.js` deleted, no ground-mark mesh in `effects.js`; tests now check that walking wet leaves no marks.
* **Audits.** `scripts/placement.mjs` now also generates 9 far tiles per seed (45 tiles, ~64k objects, coast, inland, harsh inland and sea-side) and audits them exactly like the original map (hover / buried / tree integrity / still-water dips). Result over seeds 11, 2026, 77, 5150, 9001: 315,794 objects, 0 hovering, 0 over-buried, 4,082 still-water bodies 0 bad. Unit tests: far tiles are identical regardless of visiting order, generating far tiles never changes the original terrain, terrain is continuous across seams at +-5 km..9 km, harshness is monotonic, far inland has far fewer puddles/flowers and drier grass, far regions have shells and babies.
* **Puddles** are level discs at the lowest rim height (placed only where the ring spread is small), streams leave gaps instead of cutting through pools. Before the fix 2,710 of 3,571 puddle-type bodies clipped/floated; now 0.
* **Trees** are checked for connectivity (`world/treeCheck.js`, overlap not just tangency): before: palm 8 loose parts, gum 1, norfolk 1, mangrove roots hovering 0.55 u; now every kind is one piece.

## One world, many starts (t239u) - SPOILERS
**One canonical world** (`CONFIG.worldSeed = 45`, chosen by scanning seeds so that every one of the 11 biomes is within ~830 m of any start point). It is the same for everybody; `?seed=` only builds a different debug world. The sea direction is therefore fixed (about 48 degrees in world axes, i.e. towards +x +z) and the mystery comes from where you *start*: `WorldData.pickSpawn(rnd)` picks a dry, flat, walkable point (progress -0.08 .. 0.5 along the sea axis, lateral +-0.78 half-width, not on road or in a lot, biome suburb/town/farm/bush/riverbank, with water within 95 m), then `world.start` moves there (`world.home` stays the canonical start garden with the tap and puddle). A new game uses `Math.random`; with Daily on, `mulberry32(dailySeed())` so the Perth day's start is shared. Resume uses the saved position. The pause chip "New world" is now "New start" (same world, new start point).

**Layout** (`world/biomes.js`). Inland -> coast: suburb/town -> farm -> bush -> coast, with the coast changing along the shore in a *fixed natural order*: rocky headland > beach (+ dunes behind) > river mouth (estuary + jetty) > mangrove wetland > (headland again); the creek winds from the bush to the estuary. It is a warped mosaic, not stripes: the band coordinate is warped by two noise scales (borders meander ~70 m), and patches break the bands up - farms inside the bush hills, stands of bush in the paddocks, hamlets (a suburb pocket in the farmland). Neighbour pairs measured over the one world (unit test): bush|farm, farm|suburb, bush|suburb, suburb|town, bush|dunes, bush|headland, farm|town, bush|wetland, headland|sea, beach|dunes, farm|riverbank, beach|sea, estuary|wetland, bush|riverbank, wetland|sea, estuary|sea, dunes|headland, headland|wetland, beach|headland ... and never suburb|sea, town|beach or farm|beach. `node scripts/biomemap.mjs out.png` renders the top-down map.

**Ecotones.** Weights are soft, so a blend is ~30-120 m (median 46 m over 265 sampled crossings; 3 under 16 m; none over 330 m). On top of the weights: ground type in a blend is chosen per ~15 m patch from weight + patchy noise (`WorldData.baseType`), so both grounds interleave and are pure inside a biome (weight >= 0.86); trees and rocks take their biome *at random in proportion to the weights* (`BiomeField.sample`), so both mixes appear and thin out; fog, tint and the ambient sound mix already follow the weights.

**Per-biome materials** (`world/gather.js`: `HABITAT` is the one table to edit - an item is only placed where the dominant biome is in its list; `GATHER_COUNT` is how many per 800 x 800 m; `BIOME_MATERIALS` is the inverted table the tests print). New kinds: sea urchin (rock pools + shallows off the headland), earthworm (farm soil, troughs, a few suburb gardens), beetle (feet of gums/pines in bush), frog spawn (wetland ponds, bush puddles), mangrove seed pod (wetland + estuary mud). By biome: suburb cap, jar, coconut, worm; town cap, jar; farm worm, shrimp (dams); bush beetle, moss, snail, spawn; riverbank pebble, snail, moss; wetland crab, snail, propagule, spawn, moss, lettuce; dunes pebble, shell, coconut, crab; beach crab, shell, pebble, mussel, coconut, cap, jar; headland urchin, mussel, pebble, crab, shell, moss, shrimp; estuary crab, shell, propagule; sea kelp, sponge, coral, shell, lettuce, urchin.
**New / changed recipes** (every one needs two biomes): wrap = kelp + sea lettuce *or* kelp + moss; mimic skin = sponge + coral *or* sponge + moss; venom gland = 2 snails *or* beetle + urchin; **briny tonic** = urchin + mangrove seed (camouflage energy refilled at once, then it drains x0.45 for 80 s); **hearty meal** = worm + frog spawn (full health, rings glow 90 s). Numbers in `FX`. Pictograms for the 5 raw + 2 made items are in `ui/icons.js`. In total 19 raw + 10 made items, 13 recipes.

**Placement-audit changes.** The audit now covers the one world with a ring of 20 far tiles around the original map (plus the usual 9) and 6 debug seeds. Layout changes exposed a few rare tails, fixed at the source: ground ripple is ironed out along the creek bed; streams skip steep / rough nodes and keep clear of pools using the real centre hash; car-park puddles need level ground; puddle / pond / tide-pool ring-spread limits tightened (0.15 / 0.2 / 0.24 u); gatherables inside pools stay in the flat middle. Seed 2026 (a debug world) still has one marginal creek-source disc; the audited seeds are 45, 1, 2, 3, 7, 11, 77.

## Satchel, gathering and crafting (t236u) - SPOILERS
Tab opens a paused panel (`ui/satchel.js`, `ui/icons.js`): left the items found so far (count badge), right the recipes whose ingredients have been seen at least once (ingredients -> arrow -> result; greyed when something is missing). The header holds a small chunky octopus portrait (ochre mantle, electric-blue rings, a dark toon edge, eight arms; it blinks, and worn kelp, jar, shield and mimic skin show on it). Its paint is copied from the octopus itself, so health greying, camouflage and ink show up here too. The blink and the tide-pool motion pause while the satchel is closed. The current level is a number on a ring (the only place a level number appears). Shell-shaped tabs open the bag, the field journal, the explored map and the collection. The panel is a tide-pool nook: soft caustic light, swaying weed and rising bubbles, with a muffled underwater bed of sound while it is open. Ingredients can be dragged onto a recipe as well as clicked; a soft plop plays when something is made. Q / E (or 1-4, gamepad LB / RB) change pages. Short tooltips (t253u) appear on hover or gamepad/keyboard focus: unlocked badges show their name and a one-line note; ingredients show a name and an octopus-flavoured description; crafted results show a name and what the end product does. Locked badges stay silent silhouettes with no tooltip. Nothing in a tooltip mentions hidden shell toughening. Arrows / WASD move the focus, Enter or click uses it, Esc or Tab closes; gamepad: View opens, d-pad / stick moves, A uses, B closes. While open `game.paused` is true (nothing dries or moves), pointer lock is released and requested again on close; if the browser refuses, the normal pause screen is shown instead.

**Gatherables** (`world/gather.js`, `world/gatherModels.js`, runtime `systems/gather.js`). Counts per 800 x 800 m: crab 20, shrimp 18, snail 28, mussel 26, kelp 44, sea lettuce 28, sponge 14, coral fragment 16, shell half 42, pebble 44, dew moss 32, coconut half 14, bottle cap 22, glass jar 8. They have their own RNG stream (so the rest of every world is unchanged) and stable ids (`o<i>` original map, `r<rx>_<rz>_<i>` far tiles). Habitats: crabs on sandy shore / headland / by tide pools; shrimp inside tide pools, ponds, dams (they stay in their pool); snails in wetland, riverbanks, pond rims, rarely bush; mussels on headland rocks and tide pool rims; kelp, sponge, coral on the sea floor (sponge near reef rock, coral near coral); sea lettuce in shallows and pools; shell halves on beach, dunes, estuary, headland, shallows; pebbles on riverbanks, beaches, pond rims; moss at the foot of damp rocks and big trees; coconut halves under palms or on the beach; bottle caps along roads of suburb / town (a few on beaches); jars in suburb / town or on the beach (rare). All of them are audited by `placement.mjs` (category `gather`). Pick-up is by touch (radius 0.35 + 1.3 x size), still things animate (lift, shrink into the octopus) and a soft pluck plays; nothing is written on screen. Crabs scuttle sideways away (bolt within 5.5 u, 2.2 u when camouflaged, stay within 11 u of home, avoid water); shrimp dart in bursts inside their pool. Original shell collecting is untouched: shells still toughen on pick-up (the shell halves here are separate things).

**Recipes** (t236u list; t239u added alternatives and two items, see "One world, many starts") (`systems/items.js`): shield = 2 shell halves or 2 coconut halves; den = 3 pebbles + 1 shell half; ink sac = 2 shrimp; kelp wrap = kelp + sea lettuce; crab feast = crab; venom gland = 2 snails; jar hideaway = jar + bottle cap; mimic skin = sponge + coral fragment. Mussel (+20 health) and dew moss (+12) are eaten straight from the satchel.

**Effects** (`systems/abilities.js`, octopus fields `buff`, `shieldClosed`, ...): *shield* (40 s) is carried on the back while moving and closes around you when you keep still: while closed it counts as `camoProtected` (full protection) and visibility drops x0.3; moving opens it and ends the protection; carrying it is slightly slower (x0.88). *Den*: placed where you stand (not in water, not on roads, 2.4 u from another); at most 3 (oldest is removed); registered in `world.hides` (r 1.15, kind `den`); after ~2 s still inside you recover 2.4 health/s and drying is x0.15; resting triggers an autosave every ~10 s. *Ink sac*: 3 squirts anywhere (also on land) with no cooldown, the skin darkens while it holds ink. *Kelp wrap* (110 s): drying x0.4 on land, kelp fronds and a sea lettuce collar drape on the body, fading near the end. *Crab feast*: +45 health, rings glow brighter for 45 s. *Venom gland*: the next bite reaches x1.6 as far and scares x2.4 as long; rings turn amber while it is ready. *Jar hideaway* (45 s): you tuck into a glass jar, birds (gull, eagle, magpie, kookaburra) cannot see or hurt you (`birdHidden`), everything else still can; speed x0.45. *Mimic skin* (140 s): sponge and coral grow on the back, skin half-matched to the ground, camouflage drains x0.35, visibility x0.55. Quick keys: G shield (else jar), H the sensible helper (feast if hurt, wrap on land, gland, mimic, ink, mussel, moss), V den; gamepad LB / RB.

## Saving (t238u)
`systems/save.js`. Key `octo.save.v2` in localStorage (v1 games used `octo.save.v1`, read once and removed), one JSON object, `v: 2`. Fields: `seed` (the world: 45 unless a debug seed was used), `fresh` (true only straight after a v1 migration: no position yet, a new start is picked), `saved` (ms), `octo {x,z,heading,health,energy}`, `run`, `sea`, `shells {n, o:[original shell indices], r:[far shell ids]}`, `babies:[ids]`, `inv {counts, seen, made}`, `fx {buff{shield,jar,kelp,mimic,feast,tonic}, ink, venom}`, `dens:[{x,z}]` (max 3), `got:[gatherable ids]`, `explored:[100 u cells packed]` (capped), `env {t, abs, kind, target, timer, heat, rain, dark}`. Everything read back goes through `validateSave` (type checks, clamps, whitelists, caps; unknown fields dropped) after `migrate` (chain of `MIGRATIONS[n]`, one version at a time; a save from a newer game is ignored and left alone; a damaged one is removed). The world is rebuilt from `seed` (deterministic) and the rest is applied on top. Autosave: every 30 s of play, when the game pauses, when the satchel opens, when the page is hidden / unloaded, and while resting in a den. Dying, New world and Restart clear it. Worlds started with `?seed=` / `?daily` / `?nosave` never read or write the save. Transfer code: `OCTO1-<fnv8>-<base64url(deflate-raw(JSON))>` (`OCTO0` = uncompressed fallback); decoding checks the format, size and checksum, then the same validation. No personal data is stored.

**v1 -> v2 (t239u).** v1 worlds were random per seed and no longer exist. `MIGRATIONS[1]` keeps what the octopus *is* (satchel `inv`, `fx`, health, energy, armour count `shells.n`, a baby tally as placeholder ids `m0..`, `run`, `sea`, `env`) and drops everything tied to the old map (position, `shells.o/r`, `dens`, `got`, `explored`); it sets `seed` to the one world and `fresh: true`, so `Game.newWorld` picks a fresh start point and `applySave` leaves the octopus there. A damaged v1 save (bad seed / position) is still refused. Unit + browser tests cover it (`unit.mjs`, `saves.mjs`).

**v3 -> v4 (t250u).** Adds `fx.lethal` (a readied lethal venom dose) and `lv.st.kills` / `lv.st.bigKill`. `MIGRATIONS[3]` sets `lethal: false`; missing kill tallies load as 0.

**v4 -> v5 (t254u).** Adds `journal { seen:[ids], tab }`. `MIGRATIONS[4]` starts an older save with an empty journal on the bag tab; already-held items are filled in on load (`Journal.syncItems`). The key stays `octo.save.v2`.

**v5 -> v6.** Adds `lv.st.grotto` (the quiet cave under the reef has been found). `MIGRATIONS[5]` leaves older stats untouched; a missing flag loads as false. The key stays `octo.save.v2`.

**v6 -> v7.** Adds `decor` (things set around dens) and `carry` (an item held in the arms, or null). `MIGRATIONS[6]` starts an older save with an empty ring and nothing carried. The key stays `octo.save.v2`.

**v7 -> v8.** `lv.st.rare` lists secret finds (golden shell, pearl, night frog, desert bloom, moonlit race, fairy ring). `MIGRATIONS[7]` leaves older saves without that list; load treats a missing one as empty. Current `SAVE_VERSION` is 8.

**v2 -> v3 (t241u).** Adds `lv {xp, b:[badge ids], st:{cells, biomes:[names], sea, babies, gathered, crafted, madeAll, shells, nightSwim, rainDance, storm, escapes}}`. `MIGRATIONS[2]` starts an older save at level 1 with what it already did (explored cells, babies, sea, shells) counted towards the badges; badges already deserved are granted quietly on load (no shimmer). The key stays `octo.save.v2`.

## Levels and badges (t241u / t242u) - SPOILERS
`systems/levels.js` (pure), `systems/shimmer.js` (the effect), wired in `Game.updateLevels`. Nothing is written or drawn as a number, bar or popup in the world; the Tab satchel is the one place the current level is shown (a number inside a ring).
- **Experience:** a new 100 m patch of ground 2, gathering 3, a shell 6, crafting 10, getting away from a predator 12 (threat above 0.5, then calm for 3 s), a first visit to a biome 25, a baby 30, the first sea arrival 60, every badge 15, the first night swim 8. Total needed to *be* at level L: `15 (L-1)(L+2)` (L2 60, L3 150, L5 420, L10 1800; capped at 30).
- **Level-up:** the octopus does **not** grow or change colour (t242u). Instead a shimmer plays around it: a spiral of blue-white sparkles rising, a soft halo, a ripple of light over the ground, and a rising chime (`audio.levelUp`). Pooled (one Points cloud, one ring, one sprite; no lights, no per-frame allocation).
- **Hidden perks:** drying x`max(0.75, 1 - 0.012 (L-1))`, camouflage drain x`max(0.8, 1 - 0.01 (L-1))` (`octopus.perkDry`, `perkCamo`).
- **Badges (21, 22 with the t250u hunter badge for a first kill):** wander (25 patches), roamer (150), three places, seven places, every place, the red desert, the rainforest, the sea, first baby, five babies, 50 things gathered, first craft, every made thing crafted, five shells, a night swim, dancing in the rain (20 s moving in the open while it rains), out in a storm (a lightning strike while alive), first escape, ten escapes, level 5, level 10. Earning one plays a smaller warm-gold shimmer and two bell notes; it then sits in the Tab satchel as a medallion token (unearned ones are faint silhouettes with no tooltip, a new one shines twice when the satchel opens). Hovering or focusing an unlocked badge shows its name and a short line (`title` / `note` on each entry in `BADGES`).

## Ink deterrence (t253u) - SPOILERS
`systems/ink.js` (pure), applied in `Predator.update`. An ink cloud (`CONFIG.abilities.inkRadius` 6.5 u, life 7 s) deters predators in or a little past its visible edge (`INK_NEAR` 1.6 u). They enter the existing `blind` state, walk away from the cloud, then leave and ignore the octopus for several seconds. Shore and water hunters (crab, gull) feel it sooner (`INK_AQUA_NEAR` 2.8 u) and stay lost longer (`INK_AQUA_BLIND` 5.2 s vs `INK_BLIND` 3.8 s). Birds (eagle, magpie, kookaburra, and a watching gull) also lose sight if the octopus itself is under the cloud, even when the bird is high above it, as long as they are within 40 u: a dive or swoop is aborted and they climb away. No HUD, no icons. `features.mjs` and `unit.mjs` cover a dog in the cloud, a crab near the edge, and an eagle diving from high up.

## Desert and rainforest (t241u) - SPOILERS
Two more biomes in the one world (`BIOMES` appended, so older placement is unchanged). **Red desert**: noise patches on the harsh inland side (band coordinate < ~0.1, i.e. furthest from the sea), red sand / gibber / spinifex ground (drying x1.7-2.0), sparse mulga scrub and ghost gums, red gibber stones and tall termite mounds, material **red ochre**. **Rainforest gully**: patches inside the bush hills, tall dense canopy (gums, broadleaf trees, bangalow palms), fern and mossy floor (drying x0.40-0.45: the damp keeps you alive), thick soft fog, material **ghost fungi**. Recipes: ochre + sponge = mimic skin; 2 ochre + shell half = shield; fungi + kelp = tonic; fungi + worm = hearty meal (all cross-biome).

## Day, night and weather (t241u) - SPOILERS
The 12-minute day (`CONFIG.env.dayLength` 720 s) and weather already existed; now nights also bring fireflies (more over bush, creeks, wetland and rainforest, none in rain), and a rain shower **soaks the octopus up** in the open (`CONFIG.env.rainGain` 2.5 x rain strength per second instead of drying; not inside tunnels or hides). Heatwaves dry up to 70% faster, nights ~60% slower than noon. Time of day and weather are in the save.

## Sea arrival (t241u) - SPOILERS
The first time the octopus is in the open sea: the camera drifts out to sea (as before), plus shafts of sunlight slant down through the water and bubbles stream up around it (`systems/seabeat.js`, pooled), with a slow rising chord; it earns the sea badge and 60 experience. Play continues.

## Water sounds (t246u)
Entering water used a hard band-passed noise hit (it sounded like a door shutting). Now `audio.splash(kind, speed)`: a bright highpassed spray with a soft 15 ms attack, a light upward-gliding "plip", and a string of bubble blips (short sines gliding up in pitch, as real bubbles do); puddles are smaller and quieter, and it only plays when coming in from dry land (not when one body of water hands over to the next). Going under (`swim > 0.5`) closes a master lowpass to ~750 Hz (muffled world) with a soft lowpassed "whoomp" and rising bubbles; surfacing opens it again with a little drip.

## Ambient critters (t241u)
`systems/critters.js`: harmless and unaffected by the octopus except that skinks dart away from it. Skinks (desert, bush, suburb, farm, headland, dunes, rainforest, riverbank; daytime), ant trails (desert, bush, suburb, farm, town, dunes, rainforest; always), dragonflies hovering 0.6-1.6 m over damp places (wetland, riverbank, estuary, rainforest, farm; daytime), ghost crabs scuttling sideways over beach / dunes / estuary / headland sand (day and night; they dash and pop down a burrow when the octopus comes within ~2.6 m). 4 InstancedMeshes (4 draw calls), fixed pools recycled within 46 m of the player.

## Bites (t250u / t251u) - SPOILERS
A blue-ringed octopus's venom is tetrodotoxin made by bacteria in its salivary glands and delivered with a bite, so both attacks are bites (`systems/combat.js` pure rules, `Game.tryNip` / `Game.tryBite`). Feedback is animation and sound only.
- **Beak bite** - left click (only while the mouse is captured; an uncaptured click just captures it), X, gamepad X. Cooldown 0.55 s, reach 2.4 u. The mantle darts forward and dips; a crisp double beak click (`audio.snap`). The nipped animal flinches (body jerks back). Animals up to one tier above what the octopus can kill back off for 1.6 s. Each predator has `nipsFor(tier) = 2 + 2 tier` nips; when they run out it dies if its tier is within `killTier(level)`, otherwise it bolts and its nips reset. Biting at nothing still snaps.
- **Venomous bite** - right click, B, gamepad RT (LT is now sprint). Cooldown 14 s (was 28 s). Lethal when `TIER[kind] <= killTier(level)`: tiers crab/gull 1, magpie/kookaburra/heron/snake 2, cat/fox/goanna 3, eagle/dog 4; `killTier` = 0 below L3 (deterrent only: the predator flees for `biteScare` s), 1 from L3, 2 from L5, 3 from L8, 4 from L12. People (`human`, tier 9) are never killed, only scared. The venom gland still extends reach x1.6 and scare x2.4.
- **Lethal dose** (`dose`, satchel): fungi + urchin (rainforest + headland) or ochre + frogspawn (desert + wetland). Using it readies `octopus.lethalDose` (the rings flicker violet); the next venomous bite that lands on a predator kills it whatever its size, then the dose is spent (not spent on people).
- **Kills:** the animal yelps (pitch falls with size), keels onto its side (birds drop out of the air first), lies still for 3.5 s, sinks into the ground and is disposed at 6.5 s; dead animals never hurt, threaten or get targeted. Experience `15 x tier (+10 venom)`; first kill earns the **hunter** badge (22 badges now).
- The browser context menu is suppressed over the game. Controls list (Esc): Click / X = Bite, Right-click / B = Venomous bite; gamepad line LT sprint, X bite, RT venomous bite.

## Soft toon look (t247u / t248u)
Animal Crossing / Fortnite style soft toon, not hard comic-book cel shading:
* **Materials:** every lit surface is `MeshToonMaterial` built by `toonMat()` in `src/world/toon.js` (drop-in for the old physically based standard material; PBR-only params are ignored). A shared 6-texel gradient gives three soft bands (shade 0.50, mid 0.78, lit 1.0) with short linear ramps. A small shader patch adds a warm rim light (`TOON.uRim`) and a gentle saturation lift (`TOON.uSat` 1.05). Patches compose through `addPatch()`, so the camera occluder fade (`fade.js`) still compiles in; program cache keys list the patches (`toon1|fade1`).
* **Outlines:** thin inverted-hull outlines (`outlineMat()` / `outline()`), pushed out a fixed number of screen pixels in clip space, so they stay thin at any distance. Only on the octopus (body, head, eyes, arms), babies (peeking and rescue) and creatures (predators within ~42 m; skinks, dragonflies, ghost crabs). Instanced meshes get instanced hulls that share the instance matrices. The octopus outline disappears while camouflaged or tucked away, so it never gives a hidden octopus away.
* **Readability:** health greying and the camo ring paling are unchanged (they act on base colours, which the toon bands keep).
* **Lighting:** neutral tone mapping (ACES greyed the curated colours), base exposure 0.86; one hemisphere and one sun. The octopus night glow and the baby rescue glow are now additive sprites, not point lights (a point light costs every lit pixel, and adding or removing one recompiled every shader mid-game).
* **Palette:** softer lawn and meadow greens; biome palettes otherwise kept from the terrain table; sky stays a three-stop gradient.
* **Octopus draw cost:** the 96 arm segments are one `InstancedMesh`; the arm rings are two instanced meshes riding on them; the ~50 body rings are merged into two meshes. 226 draw calls -> 17.
* **Shadows:** PCF (not PCF-soft) 1536 map over +/-45 u (was 2048 over +/-60). On phones (coarse pointer, or `?mobile=1`) the shadow map is off (`?shadows=1` forces it on) and soft blob shadows sit under the octopus and ground animals instead; pixel ratio capped at 1.5 (`CONFIG.graphics.mobilePixelRatioCap`), no MSAA on high-DPI phones.
* **Measured** (`node scripts/perf.mjs [--shadows=0] [--mobile]`, SwiftShader software rendering at 1280x720, mean of 30 frames per biome after warm-up, GPU-synced): 

| biome | before calls / ms | toon + shadows | toon, no shadow map | phone settings |
|---|---|---|---|---|
| suburb | 515 / 471 | 194 / 887 | 184 / 501 | 183 / 141 |
| bush | 505 / 541 | 174 / 482 | 160 / 538 | 148 / 145 |
| farm | 452 / 419 | 180 / 389 | 159 / 364 | 170 / 124 |
| beach | 453 / 553 | 108 / 434 | 125 / 434 | 140 / 147 |
| desert | 505 / 409 | 174 / 405 | 141 / 376 | 199 / 125 |
| rainforest | 493 / 499 | 183 / 651 | 158 / 769 | 175 / 150 |

Octopus alone: 226 -> 17 draw calls. Triangles are unchanged (~1.7-2.0 M incl. shadow pass).

 Software-raster frame times are dominated by triangle fill and vary run to run, so they are not phone numbers; test on a real mid-range phone.

## Field journal, map, collection (t254u) - SPOILERS
`systems/journal.js` (pure). Four satchel pages:
- **Bag:** the original gather / craft grid, badges and tooltips.
- **Journal:** every creature, plant and material (`ENTRIES`). Discovered ones are drawn pictograms with a tooltip (and a flip-page note when opened); the rest are silhouettes. Discovery is by meeting them: picking up a material, coming close to a predator or critter (~22 m / 16 m), brushing a flower, or finding a baby. Nothing is spoiled in advance.
- **Map:** a damp kelp-paper sketch (`renderMap`). Only explored 100 m cells are painted, in a biome tint, with the biome's label sketched on (only biomes already visited). Dens are little shells, the octopus a blue dot. **The ocean is not revealed until the octopus has reached the sea** (`progress.seaReached`): sea-biome cells stay fogged even if they were somehow marked explored.
- **Collection:** a wall of baby-octopus portraits (one per baby in the world; found ones are unique little drawings from the baby's id, the rest silhouettes) and rare finds (jar, ghost fungi, ochre, coral, coconut, urchin, lethal dose, shell half). **No numeric counter.**

## Tide-and-sun dial (t254u)
`ui/clock.js`. The one in-play UI element: a small shell in the bottom-right corner. The sun travels the shell's arc by day and the moon by night (from the existing 720 s `env.t` cycle); a blue fill in the cup shows the tide (`env.tide`). Soft toon colours, no numbers or words. Hidden during the sea-arrival cinematic, while any overlay (satchel, pause, start, end) is open, and before Play.

## Bioluminescent plankton (t254u)
`systems/plankton.js`. A pooled Points cloud (280 specks, additive, no lights) in the sea and the estuary at night. The field follows the octopus; swimming through it spins and brightens the specks for a moment. Hidden by day and on land.


## Harmless critters (t255u) - SPOILERS
`systems/critters.js`. Soft-toon instanced pools with outlines (except ants, which are too small). Existing kinds were given eyes and clearer idle motion: skinks bask flat then dart, ants march between nest and food (and pack up in heavy rain), dragonflies hover and zip (and startle further off), ghost crabs sidle, come a little closer, then dash down a burrow.

Four new harmless kinds, each with a journal entry:
- **Frog** (wetland, rainforest, riverbank, estuary): hops, sits at the water's edge, plops in when startled; livelier in the rain and at dusk.
- **Hermit crab** (beach, dunes, estuary): sidles with a borrowed shell, tucks in when the octopus comes close.
- **Butterfly** (bush, rainforest, wetland, farm, suburb, riverbank, dunes): flutters and lands; hides at night and in the rain.
- **Fairy-wren** (bush, farm, suburb, wetland, rainforest, riverbank): hops and pecks, short flits, flies up when startled; sleeps at night.

None can be hurt or killed. Pools stay small and recycle around the player.

## Ant model
The trail is the soft-toon ant from `src/assets/models/ant.glb` (built by `tools/blender/ant.py`), not the old three-sphere instance. The file is imported as a module so the single-file build inlines it; a `public/` URL would break `file://` and the Pages deploy. `GLTFLoader` parses it once. Each nearby ant is a `SkeletonUtils.clone` of that scene, so it has its own skeleton, and the four glTF materials are baked into vertex colours on one shared `toonMat` (rust `#C2522D`, peach-tan belly `#E8A070`, dark eyes, white catchlight) instead of the glb's matte/gloss PBR. The mesh is already 1.2 cm = 0.0378 u, so the object scale is 1 (not the old instance scale of 1.6). +Z is forward and the origin sits on the ground between the feet; the line is seated with `heightAt`.

`walk` (0.5 s loop) plays while the line marches and `idle` (2 s loop) when the march is held still, with a 0.15 s cross-fade. Only ants within 4 m run an `AnimationMixer`, and only up to 16 of them (8 on a phone). Everyone else on the trail is one instanced bind-pose stand-in that keeps a few dozen triangles of each body part, so a full line stays about as cheap as the old procedural ants (one draw). Ants still march nest-to-food, pack up when the rain is past 0.7, and fill the journal entry `ant`. No outline — they are still too small. Saves stay at v9.

## Beetle model

The gatherable beetle is the soft-toon ladybird from `src/assets/models/beetle.glb` (built by `tools/blender/beetle.py`), not the old green shell. The file is imported as a module so the single-file build inlines it; a `public/` URL would break `file://` and the Pages deploy. The same glTF helper as the ant bakes the seven materials into vertex colours on one shared `toonMat` (shell `#FF5A2A`, seam `#E83C20`, spots, head and legs `#2A221C`, cream `#F3E6C8`, belly `#3D2A24`, dark eyes with a white catchlight) instead of the glb's satin PBR. The mesh is already about 1.4 cm long, so the object scale is 1 and `SIZE.beetle` only varies it a little (0.9–1.2). +Z is forward and the origin sits on the ground between the feet. The usual gather seating (`GATHER_TILT` 0.5, a 0.5 cm bury) puts those feet on `heightAt`.

There are still 26, at the foot of gum, pine and willow trees in the bush and on the riverbank. `idle` (2 s antenna twitch and a tiny shell flutter) plays only for beetles within 4 m, and only up to 8 of them (4 on a phone). Everyone else is one instanced bind-pose stand-in, a few dozen triangles of each part, cheaper than the old spheres. One that close may scuttle about 2.5 cm on `walk` (0.5 s) and then settle back, still pickable, without sitting on a neighbour. Touch still collects it once, the tentacle still tucks it, and the satchel, the journal and the recipes are unchanged. The pictogram is the same red shell and dark spots. No outline. Saves stay at v9.

## Secrets of night and rain

A few finds that are not gatherables (they do not use the gather stream, so nothing else in the world moves). Each 400 m tile, including the original map's sixteen tiles and every far tile, rolls its own hash. Most tiles have none. On the one world each kind shows up a handful of times and no more.

- **Golden shell** on the beach and the dunes. A large ribbed scallop with a soft shine, there whenever you pass.
- **Pearl shell** in the shallows, or on the wet sand of the beach, estuary and headland.
- **Glowing frog** in the rainforest, and only at night. By day the spot is empty.
- **Desert flower** a shut bud while it is raining and until the ground is wet. It opens only after the rain has stopped, and only while the ground is still damp (about a quarter of a minute), then closes.
- **Ghost-crab race** on the beach at night: four pale crabs run a short line between two burrows. By day, only the burrows.
- **Fairy ring** of mushrooms in the bush or the rainforest.

Meeting one (walk up to it while it is actually there) fills its journal entry, which is a silhouette until then, adds a collection portrait, and earns a badge. Nothing is written on the ground. Saved as `lv.st.rare` on save v8 (`MIGRATIONS[7]`). Older saves, including v7 den saves, load with no secrets found.

Try: `?seed=2026`, then `__game.teleportToRare('gold')`. For the frog, `__game.setTime(0.02)` first. For the flower, `__game.setWeather('rain')` and `__game.soakRare()`, or wait out a real shower. For the race, night plus `__game.teleportToRare('moonrace')`.


## Soft & friendly pass (t256u / t257u)
**Research takeaways** (Animal Crossing: New Horizons, A Short Hike, Alba: A Wildlife Adventure, Tunic, Fortnite, Rocket League, Ooblets):
- *Symbolised shapes, not detail* (ACNH's art director calls it "kigōka"): chunky rounded silhouettes with clear readable masses; detail is thrown away on purpose so things read instantly. Trees are a few puffy clustered blobs, darker underneath and lighter on top.
- *Soft continuous surfaces at low polycounts*: Alba keeps assets "proudly low poly" but transfers smooth normals so shapes read soft; Tunic builds tufts and bushes from very few vertices. So: smooth shading on low/medium-poly meshes and bevelled edges, never razor facets or knife-thin blades.
- *Gradients for form*: Alba stretches UVs over a colour gradient to define shadow; we bake a base-dark -> tip-light vertex gradient (cheap fake AO) into foliage, grass and reeds.
- *Warm, saturated-but-soft palette*: light warm, shade cool, never black; soft shadows and restrained AO (ACNH).
- *Bouncy secondary motion is the cheapest delight*: Tunic's grass bending as you pass and the bounce of the fox's hair; Fortnite / Rocket League use squash-and-stretch and anticipation so motion reads at a glance.
- *Readable outlines on actors only* (A Short Hike's soft outline): kept from t248u - octopus, babies and creatures.
- *Grass as rounded clumps / patterned ground*, not dense sharp blades (ACNH draws most grass into the ground pattern; tufts are rounded clumps).

**What changed**
- Every world material is smooth-shaded now (was flat-shaded facets everywhere). `models.js` gains `smooth()`, `puff()` (smooth icosphere), `rbox()` (bevelled box), `tintGrad()` (vertical colour gradient) and `blade()` (a bent ribbon with a rounded tip and up-and-out normals).
- Trees: cones are gone - rounded cedar tiers, puffy oak / gum / paperbark / mangrove crowns, drooping willow lobes, two-lobed palm fronds with coconuts, Norfolk pine tiers as soft discs. A cheaper LOD set (detail-0 puffs, fewer trunk sides) is swapped in for chunks > 150 m away. The tree-integrity audit still proves every part touches the trunk.
- Grass / reeds / seagrass: tufts of six wide bent round-tipped blades with a base-dark gradient; cattail reeds; ribbon seagrass; capsule coral. Grass sways in a travelling breeze and *parts* around the camera -> octopus line and out of the lens (vertex bend, `applyBend` in fade.js) instead of relying only on the dither stipple.
- Rocks: subdivided, softly lumpy pebbles and boulders, flatter underneath. Fish are soft ovals.
- Props: every box is bevelled; fences are round posts with soft caps and round rails; logs have pale cut ends; umbrella gets a finial.
- Houses: plinth, gable roof of two soft overhanging slabs with a round ridge cap, gutters and a downpipe, framed windows with sills, mullions and flower boxes, a framed door with a knob and a front step, a capped chimney (~2000 triangles, instanced).
- Cars: toy-like - bevelled body and cabin, fat wheels with hubcaps, round headlights (a subtle face), bumpers and tail lights.
- Predators: bevelled boxes, capsule limbs, blunted cones, rounder spheres; each body part's static pieces are baked into one vertex-coloured mesh (shared cached geometry), roughly 3-4x fewer draw calls per animal.
- Predator motion: idle look-arounds, sniff / peck dips and breathing; banking into turns; footfall squash; a wind-up (draw back + squash) before each ground strike, a long stretch on the strike and a step back afterwards; birds flick their wings up before a swoop; perched birds look about; fleeing animals run head-low; leavers glance back once, then go.

**Groups (t257u)** - SPOILERS
- `util/separate.js`: boids-style separation on a spatial hash (3D for birds in the air) runs every frame over all predators (same species included) and over all critters (predators are immovable obstacles for critters). Pushes are checked against walls and water.
- At most two animals strike at once; the others hold a personal slot on a ring around the octopus and edge round it until it's their turn.
- Camouflage: hunters get confused, then each searches its *own* spot 2.5-7.5 m around the last sighting (gulls glide down there and preen), then leaves in its own direction. Gulls circle at their own radius / direction. Birds sharing a perch tree sit on their own branch offsets.
- Tests: `npm run packs` (5 stacked gulls through attack + camo, a mixed pack of 7, a shared perch tree, every predator's approach -> anticipation -> strike -> recovery -> camo break-off, stacked critters).
- Map (satchel): `ui/map.js` - kelp paper, watercolour washes sampled every 25 m with soft blended edges, a blobby soft fog-of-war mask, doodled biome icons, dens, puddles and found babies, a dotted wander-trail (saved, pen lifts over jumps), an octopus compass rose and hand-lettered, slightly curved names placed so they never overlap. The sea is neither drawn nor named until it has been found.

**Audit & performance (t256u)**
- Biggest find: the beach / decor seashells were 14x72-cell parametric sheets - 4200 triangles a scallop (turban 1428, cowrie 872), drawn ~234 times each including ~140 zero-scaled pool slots - about half of every frame's triangles. Now 888 / 640 / 512 triangles and the instanced draw count only covers pool slots actually in use.
- Far tree LODs: palms 5 single-lobe fronds (580 -> 200 tris), willows 6 lobes (240 -> 160); coral capsules lighter (380 -> 260).
- Separation bug: an *exactly* stacked pair whose radii summed to <= 1 never split (the overlap was computed against a fake distance of 1). Fixed, with unit tests.
- Dead code: an unused `instanced()` helper, ~25 unused imports / locals (eslint `no-unused-vars` is clean). Storm-bird count no longer allocates per frame; predator geometry is cached and shared and static parts are baked.
- Measured with `scripts/perf.mjs` (6 biomes, SwiftShader, so ms are relative only) and `scripts/wander.mjs` (600-frame 900 m walk across chunk boundaries):

| average of 6 biomes | before (f1e1bc3) | after |
|---|---|---|
| desktop draw calls | 187 | 180 |
| desktop triangles | 1.91 M | 0.77 M |
| desktop frame (software GL) | 510 ms | 229 ms |
| mobile draw calls | 182 | 176 |
| mobile triangles | 1.89 M | 0.68 M |
| mobile frame (software GL) | 144 ms | 80 ms |
| wander desktop mean / p99 / worst frame | 427 / 495 / 1626 ms | 192 / 256 / 897 ms |
| wander mobile mean / p99 / worst frame | 128 / 188 / 482 ms | 71 / 132 / 267 ms |
| heap after the walk (after GC) desktop / mobile | 36.0 / 40.6 MB | 43.1 / 41.5 MB |

## The reef and the quiet cave

Offshore, past the break, the sea floor already holds coral, reef rock and seagrass. Around one hidden grotto (the same place for a given seed: `grottoOf` in `systems/reef.js`) there is a kelp stand, a few rock arches, sand channels, coral heads and sea stars. A school of fish drifts with a swimmer; a turtle patrols the grotto. Caustic light only shows while you are wet. A soft longshore current nudges the octopus only while swimming in the sea (`flowAt`); it fades in the shallows and is gone on land. Swimming still rehydrates.

Anemones grow only on the sea floor. With a piece of coral, or with an urchin, they make a reef light: the rings shine for a while and nothing else changes. The grotto stays quiet until at least one baby has been led to water. Swimming into it then shows the little ones, plays a calm camera drift (no text, no credits) and keeps the "quiet cave" badge. Play continues.

Try `?seed=2026`, then from the console ` __game.teleportToOcean(6)` and `__game.teleportToGrotto()`. `__game.noteBaby()` stands in for a rescue. `__game.grotto` is the cave. Current is `__game.current` while `swim` is high.

## A den you can dress (no prompts)

Drag an item off the satchel (release it outside the panel) and the octopus carries it. Stand still within 3.4 m of a den and it is set on the ring around the den, facing the way you were looking. Stand still on a piece for about half a second to pick it up again; walking past leaves it where it is. Hold camouflage while touching it to turn it an eighth. Opening the satchel puts a carried piece back in the bag. At most 8 pieces per den, 24 in all. When a fourth den replaces the oldest, that den's pieces return to the bag.

The map page grows a quiet home row (den icon, then the things around it) and dots the pieces on the chart. No words.

After at least one baby has been rescued, a little one visits a den that has three or more pieces, while you are nearby, and plays. Four pieces earns the "A home" badge. Play continues.

Saved as `decor` and `carry` on save v7 (`MIGRATIONS[6]`). Older saves, including v6 grotto saves, load with an empty home.

Try: place a den (V), open the satchel, drag a pebble off the panel, stand beside the den. Or `__game.give('pebble'); __game.carryItem('pebble'); __game.dropDecor()`.

## Smarter hunters - SPOILERS
Still the same motion, separation and turn-taking (`MAX_STRIKERS` 2). No markers. Three more animals, and the weather now changes who is hunting.

- **Eagle.** On noticing you it no longer points and drops. It circles low for a little over a second (its own direction and a 12 m radius) while the ground shadow grows, then dives. Magpies and kookaburras still pause on the branch with wings up; their shadow appears as soon as they leave the perch.
- **Snake** (bush, rainforest, riverbank, wetland). An ambush stalker. It lies still in the grass, body sunk so only the head shows, until it has noticed you. Then it creeps and strikes like a cat. Livelier in the rain (`rainLover`).
- **Goanna** (desert). A diurnal chaser, long body and a stiff tail. It hunts in the heat and almost stops at night and in the rain (`rainShy`). Wind-up before the bite, same as a fox.
- **Heron** (wetland, estuary, sometimes the riverbank). A diurnal stalker that wades the shallows (`shore`: it will step where the ground is only just above the water). It stands, creeps, then the beak comes down (the same stalk-and-pounce as a cat, so it never crowds a second striker).
- **Time and rain** only scale `act` (notice and pace), never a HUD. Foxes and cats stay nocturnal. Gulls, eagles and the swooping birds sit the rain out. Goannas and herons sleep through the night. Ink, venom, bite, camouflage and the two-at-a-time rule are unchanged.
- Journal entries (snake, goanna, heron) fill in when you come close. No new badges.
- `npm run packs` also checks the half-buried coil, the eagle's shadow before the dive, and that a goanna sleeps at night while a snake wakes in the rain.

## A quieter start, and a dusk that changes with the place

The world is still built the same way. The first moment only seats the chunks within 120 m; the rest of the visible ring is built a few milliseconds at a time while the Play screen is up, and the shaders are compiled once during that screen so the first step is not also the first compile. The analytical map (`WorldData`) is still one synchronous step before the first frame. Save version stays 8.

The dusk sky is no longer one orange everywhere. Each biome has its own dusk colour (red desert, cool open sea, purple rainforest, warm sand) blended by the same weights as the daylight tint, so the hour feels different as you walk. Night plankton in the sea and the estuary is brighter and a little larger, still a pooled point cloud with no lights.

## Shapes that were too sharp

The little crabs (the ones you can pick up, and the ones that run about) are made of rounded pieces, not boxes and sharp cones. The ants and the gatherable beetles are the soft-toon models above, not those earlier simple shells. The snake is one tapered tube that bends along its curve, not a string of beads; the bend is a vertex wiggle on that snake's own geometry (nothing shared, nothing allocated per frame). The goanna has a snout, four legs and a tail that sways as it walks. Reef arches are rounded rock, sea stars have five puffy arms, and the fish and the turtle have a body, fins and a tail, with the usual creature outlines. Beach shells kept the lower triangle counts; the scallop's hinge and the cowrie's teeth are small spheres again so they still read as shells. The golden shell is a large scallop of that same shape, seated on the sand, with a soft shine.

## Checks

Pull requests and pushes to `main` run `npm ci`, `npm run build` and `npm test` on Node 22 (headless Chrome for the browser suites). After that run is green on `main`, the same publish script as `npm run deploy:pages` updates the site. In Actions the clone and push use the Actions token in the GitHub URL and do not print it. On your own machine the script still uses whatever origin you already have. The workflow can also be started by hand. It only runs from `main` once this file is there.

## Cat and pollen

- **Cat.** A plump bean body (no plank along the spine), a round head with soft ears, cheek fluff, four jointed legs and a tapered tube of a tail. Coat is ginger, tabby, black-and-white or grey, from the same shared shapes. The hunt is body language only: it freezes with ears locked and the tail tip twitching (`alert`), creeps below 40% of its walk and pauses when the octopus moves (`stalk`, sometimes via a bit of cover), crouches and lashes for 0.65–1 s (`wiggle`), then leaps at where the octopus was (`pounce`). A miss and it sits and grooms. Camouflage still breaks the stalk. Sweet bait (a satchel item) pulls it off to sniff.
- **Pollen.** Brushing a flower that still has dust collects that colour (yellow, pink, purple, white, red, blue; the desert flower that opens after rain gives the seventh). A coloured puff plays and the arm tips stay tinted for a few seconds. The flower is ready again after a while; a small glint marks one that is. Bees sit on nearby flowers and only buzz around the octopus, without hurting it, if that flower's pollen is taken. The journal has a pollen section (silhouettes until found). Two pinches of one colour make a dye you can set beside a den; three pinches make a sweet bait; blue pollen and ghost fungi make a glow mix that lights a den; all seven make rainbow dust. Using the dust (or crafting it) earns the rainbow badge. Saved as `lv.st.pollen` (save v9).

## Houses, one maze, and a few places

Sixteen suburb houses grow a pet flap on the front face (the human door stays shut). Walk into the flap: it swings, the view dips dark for a third of a second, and you are in one seeded room (lounge, kitchen, laundry or hall; tile, board or rug). Furniture is shared boxes and spheres: a couch you can walk under, a table whose legs can be climbed, a dripping sink, a bath left running, a fish tank, a pet bowl, a plant, a sunny patch by the window. Some rooms have a sleepy cat or dog (it freezes, creeps, then bats; camouflage sends it back to sleep). A button, a marble, sea-glass and a beach photo are journal finds. Some rooms hide a baby. The interior is built on entry and disposed on the way out; the outdoor world is hidden, not reloaded. Leaving is the same flap. Visited houses get a little room doodle on the map. Badges: five houses, fifteen houses.

**Grounded (the step sits on the grass).** Houses were drawn by `seat()`, which ignores the stored height and plants the lowest vertices. The wall is built 2 m below the floor so it can hide a slope, then stretched 1.7×, so that skirt meets the ground about 2.9 u under the step — about a metre at the octopus's scale — and the plinth, step and door hang in the air with bare wall showing. `baseHeight` versus `heightAt` is only a few centimetres and was not the gap. Each house, including the farm house, now takes the lowest `heightAt` along the front wall and the step. That height is the house record, the collider, the pet-flap door and the interior entry (the room is shifted to it, so the floor you appear on is the same ground). The lot under the footprint, the step and one terrain cell past them is levelled to it, with a short blend at the edge, so the back and sides meet the grass too. The skirt still runs below the floor for the blend. Saves stay at v9.

One hedge maze sits off the walk that finds the sea (deterministic from the seed). Hedges are one instanced puff mesh. Puddles and a fountain in the middle keep you wet. A shell waits there (and sometimes a baby). Two gnomes and a lost ball. Reaching the middle earns a badge; doing it without dropping under half health earns another. Ground predators are not placed inside the hedges.

Small places, found by walking: a shed (webs, a shelf, a watering can), a wet storm drain that squeezes through to another street, a community garden (beds, a scarecrow, a dripping hose), the lighthouse that was already on the coast, and a playground (sand and a fountain). Each fills a journal entry and, once the map cell is known, a doodle. All five earn a badge.

The Perth date picks one daily surprise inside the same world: a hopping visitor at the playground, a flower in the garden that still has pollen, or one flap left open. After at least one house and the maze, a small light appears near the middle of the maze. Touching it is a journal note and a badge. Nothing about any of this is written on the screen during play.

**The flap no longer bounces you.** Entry used to stand 0.9 u inside a leave-trigger of radius 0.42, and the way out stood 0.45 u in front of a flap whose radius is 0.48, so one step sent you straight back through. Entry now stands about 1.5 m inside (`FLAP_STEP`, 1 u ~ 32 cm), facing into the room, stopped just short of the far wall when the room is not that deep. Exit stands the same 1.5 m outside the flap, facing away, on `heightAt` (not the door's stored height). The flap, and the mat inside, then ignore you for a second and until you have walked out of the trigger. Saves stay at v9.

Try: `?home=1` beside the first flap, `?maze=1` at the mouth of the maze, `?poi=shed` (or `drain`, `garden`, `light`, `play`).

## Shore, birds, and a steadier frame

**People and the sea.** A blocked step used to add 1.2 radians to the heading and stay put, so a person meeting the water spun in place. Deeper than that, the body was planted on `heightAt` and walked around under the surface. People now wade up to 1.35 u (shin-deep on the scaled body): the walk slows as the water gets deeper, the body eases down a few centimetres and bobs, and past that they turn — over a fraction of a second, sampling eight headings — back toward shallower ground. If the water is already over them, the feet stay in that wade while they walk out, instead of on the sea floor. A rising tide or a bad spot does the same. Herons still use the old shore rule. Nothing is drawn for the wade; there is no splash sprite.

**Forest birds.** A perched magpie or kookaburra used to hold one pose, with a tiny head sine. Near the octopus they now look about, preen, hop a little along the branch and shuffle their wings, and every so often fly a few metres to another part of the tree and land. The octopus still flushes them into the same swoop as before. Each bird's seed staggers the timer so a tree does not move as one. Past ~78 u they hold still. The hop is a local offset on the shared mesh; the short flight reuses the swoop motion. No extra geometries.

**The waterline.** The sea was one quad the size of the map, drawn at `seaLevel` with no depth offset, so it shared a depth with every beach triangle it crossed. That shimmered at every tide, worse in the distance because the camera near plane was 0.08 against a far plane of 1400. The sea is now a grid (72×72), drawn with `polygonOffset` and without writing depth, the same idea as the puddle discs. The camera near plane is 0.22 and the far plane 1100 (the sky is a 900 u sphere). The water height is still the tide, so the edge moves with it and does not crawl up the sand.

**Frame hazards.** `frameDt` drops a non-finite delta and caps a hitch at 50 ms, so a hidden tab does not fast-forward the world. A non-finite octopus position is put back on the start ground instead of poisoning the frame. `saveNow` cannot throw. A lost WebGL context reloads the page quietly (the save is written first); a restored one resumes. An unhandled promise rejection is swallowed so it does not kill the loop. Saves stay at v9. A NaN position is rejected, and a storage that throws is ignored.

## A map in the corner, and an arm that picks things up

**M** toggles a round sketch in the corner (`ui/minimap.js`, the same watercolour and fog as the satchel map in `ui/map.js`). It is off until asked. The choice is kept in `octo.settings` (`minimap`), not in the save, which stays at v9. The octopus is an arrow in the middle, turned with its heading. Unwalked ground is the paper, and nothing is lettered over the fog. It is redrawn about three times a second, and not at all while it is hidden. It sits above the tide-and-sun dial (and, on a phone, above the touch buttons) so the two do not overlap. **N** is the old sound cycle (all / effects / off). The pause list and the README say so. The dial is still the only *always-on* mark during play.

**A scoop.** Touching a shell, a gatherable or pollen sends the nearest free arm out to it (`Octopus.scoopToward`). The arm curls and draws the thing under the body over about 0.36 s, blended onto the walk so you do not stop. A second pickup can use another arm. The gatherable mesh shrinks as it tucks under, and the satchel, the sound and the journal happen once, when that tuck finishes. Shells still toughen at once (the fade is unchanged). No new meshes, and the arm pose reuses the segments it already has.


## Banded world: from the sea to the wasteland - SPOILERS
The one world is now laid out in bands from south (+z, the start) to north, and it gets harder going north. `src/world/bands.js` holds the bands, the edges and the predator plan; `WorldData.banded` is on for every new world.

| Band | z (south edge to north edge) | Biomes | Danger |
|---|---|---|---|
| Sea | 900 to 466 | sea, islets, reef city round the big shell | 0 |
| Shore | 466 to 330 | beach, rock pools, jetty, headland, estuary and mangroves, dunes | 0.55 |
| Town | 330 to -40 | brick suburb with terracotta roofs, Hills Hoists and letterboxes, town, farm with windmill and sheep, a small stone ruin | 0.85 |
| Bush | -40 to -270 | eucalypt bush, banksia, grass trees, wetland with reeds and lily pads, rainforest corner | 1.15 |
| Outback | -270 to -480 | mud flats with a boardwalk (west), red desert with the big red rock, termite mounds and an oasis (east) | 1.5 |
| Wasteland | -480 to -900 | factory with smoking stacks, storm-drain outfall, purple and mustard sludge pools (never green) | 1.95 |

The playable square is x -690 to 690 and z -690 (north) to 735 (sea edge). Mountains ring the west, east and north: low terrain foothills plus one instanced mesh of low-poly snow-capped peaks (about 140 peaks, 22k triangles, one draw, fog-free so they always read as the horizon). The edges hold through `clampToBounds` in `resolve` (no wall, no UI). Out at sea a soft return current past the reef turns the octopus back gently; five shark fins patrol just beyond it. A river runs from the ranges to the estuary. Bands blend over a short strip.

**Start.** A fresh game starts in the shallows beside the big shell (the future Octo house), heading north towards the beach. The old sea-arrival moment is now a homecoming: it plays when the octopus returns to the sea after it has been inland (band 2 or further).

**Predators.** `planLife` places the land animals per band at a density that rises northward (about 0.45, 0.63, 0.91, 1.21 and 1.59 per hectare for shore to wasteland), with tougher kinds further north, and `AGGRO` widens how far they notice the octopus (0.85 on the shore up to 1.32 in the wasteland). None live at sea. Still at most two strike at once, and animals never overlap (the separation now relaxes over up to four passes).

**Save v10.** `MIGRATIONS[9]`: a v9 save keeps the satchel, effects, levels, badges, journal, shell and baby tallies; den decor and anything carried go back into the satchel; the old position, dens, explored map and taken-item list are cleared (the old map no longer exists), and the octopus starts fresh by the shell. A damaged position is rejected. A saved position outside the bands is clamped back inside.

**Performance (`?mobile=1`, seed 2026, `scripts/perf.mjs`, average of two back-to-back runs against main on the same machine).** Across the nine shared biome spots the mean is 203 draw calls (main 212), 622k triangles (main 751k) and 99.5 ms a frame under software GL (main 98.1 ms, within noise). Mud flats and wasteland are the cheapest places (about 110 calls, 230k triangles). To get there: every shell now streams through the pool within ~120 m instead of all being drawn; pooled gatherables draw only up to their highest used slot; the yard places (gnomes, sheds, garden, playground) are grouped in 80 m cells skipped past the fog; on a phone small clutter props and water discs are skipped past 150 m. Per spot the beach (more clutter on a narrow strip) and the farm still draw more calls than main's spots of the same name.

**Tests.** `scripts/bands.mjs` (in `npm test`): band order south to north, each band's middle is its own biomes, the start is in the sea within 30 m of the shell, the edges hold, the ranges rise past them, v9 to v10 keeps what was earned, the new landmarks sit on the ground, sludge is only purple or yellow, and predator density and alertness rise northward.
