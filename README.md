# 🐙 Octoventure

**Play now: https://metadata-team-member.github.io/Octoventure/**  (desktop browser, mouse + keyboard or a gamepad; click Play)

You are a tiny **Australian blue-ringed octopus** (*Hapalochlaena*), 20 cm long, stranded far inland and slowly drying out. The ocean is somewhere out there - **in a random direction every game, with no compass** - and you have to find your way back across gardens, streets, farms, bush, creeks, wetlands, dunes and beaches, a world that towers over you. There is no HUD, no timer and no tutorial: work it out as you play. Predators will notice you (your blue rings flash), and your defence is camouflage. Water is life. Everything else is for you to discover.

**Quick controls:** WASD move - mouse look - Shift sprint - Space camouflage (hold) - F ink (in water) - B / right-click venom - R climb - Esc pause. Full list below.

![gameplay](docs/screenshot.png)
![camouflaged](docs/screenshot-camo.png)

> Status: **playable prototype (v0.2)** - feedback welcome. No login, no server, no accounts, no data collected. All rights reserved (no licence granted yet).

## How to run it

### Option 1 – zero install (just double-click)
Open **`play/index.html`** in any modern browser (Chrome, Edge, Firefox, Safari). It is one self-contained file – no server, no Node, no internet needed.
* Windows: double-click **`Play.bat`** (or `play\index.html`). macOS/Linux: `./play.sh`.

### Option 2 – developer mode (live reload)
Needs [Node.js 18+](https://nodejs.org).
```bash
npm install
npm run dev          # opens http://localhost:5173
```
Windows shortcut: double-click **`Dev.bat`** (installs on first run, starts the server, opens the browser).

### Option 3 – Visual Studio / VS Code
* **Visual Studio 2022:** *File ▸ Open ▸ Folder…* and pick this folder. Open `package.json`, right-click it ▸ **Open npm Scripts** (or use *View ▸ Terminal*) and run `npm install`, then `npm run dev`. Browse to http://localhost:5173. (You can also just right-click `play/index.html` ▸ *Open With ▸ Browser*.)
* **VS Code:** *File ▸ Open Folder…*, then *Terminal ▸ Run Task…* ▸ **Run game (dev server)**. A launch config for Edge is included.

### Rebuilding the single-file version
```bash
npm run build        # writes play/index.html (committed so Option 1 always works)
npm run build:dist   # normal multi-file build into dist/ (for hosting on any static server)
```
`play/index.html` is committed on purpose so a double-click always works. The public site is the same single file, published to the `gh-pages` branch and served by GitHub Pages (`npm run deploy:pages` rebuilds and publishes it).

## Controls
| Action | Keys / mouse | Gamepad |
|---|---|---|
| Move (relative to the camera) | **W A S D** or arrow keys | left stick |
| Look around | just move the mouse (click Play once to capture it) | right stick |
| Sprint (dries you out 2x faster) | **Shift** | LT / RT |
| Camouflage (hold) | **Space**, **C** or **E** | A (hold) |
| Ink cloud (only works in water) | **F** or **Q** | B |
| Venom bite (last resort, long recharge) | **B** or right-click | X |
| Climb a fence / wall at once | **R** (or just keep pushing into it) | Y (hold) |
| Zoom | mouse wheel | |
| Pause / release the mouse | **Esc** (pause menu: Resume, difficulty, Daily, New world) | Start |
| Mute | **M** | |
| Restart after dying | button, or **R** | |

Mouse-look uses Pointer Lock; Esc releases it and pauses (nothing dries or moves). If the browser refuses the lock it falls back to click-and-drag. Touch screens get an on-screen joystick, RUN and CAMO buttons (shown only once you touch the screen).

**URL options:** `?seed=1234` fixed world - `?daily=1` today's world (Perth date; same for everyone) - `?difficulty=gentle|normal|harsh` - `?size=2400` world width/depth in metres (default 1600, i.e. 4x the area of the first prototype; counts scale with the area) - `?shadows=0` faster on weak GPUs - `?autostart=1` skip the title - `?debug=1` fps / position overlay. Shift-click **Play** starts the daily world.

## How to play (a self-discovery game)
There is **no HUD, timer, tutorial, markers or hint text**. Everything is read from the world and the octopus itself.
* You are **20 cm long** and the world is drawn to match: grass towers over you, puddles are ponds, a person is about 8x your size, a dog 3-4x, gulls and magpies 2-3x, cars are moving buildings. Big animals shake the ground when they walk close, and bird shadows sweep over you. Grass and props that block the camera dither away.
* The octopus **dries out** (about 6.5 min from full on ordinary ground, faster on some surfaces and at midday or in heatwaves). Its **colour fades toward grey as it dries**. Find water: puddles, ponds, streams, tide pools, drips, taps, sprinklers, bird baths, pet bowls, bin lids after rain, dew at dawn, rain, the sea. Wading is faster than walking.
* **Predators** (gull, cat, dog, fox, crab, eagle, person, magpie, kookaburra) each behave differently; you read them by body language - heads turning toward you, freezing, crouching, wings up, calls - and by your **blue rings flashing** when you have been noticed.
* **Camouflage:** your body takes the ground colour and the rings fade; while camouflaged predators cannot hurt you and wander off. It costs energy (rings go paler as it runs out) and freezes you. **Cars ignore camouflage** - they are not looking - so listen: engine noise swells as one approaches and it will honk if it is bearing down on you.
* **Abilities found by playing:** squeeze through drains, pipes, culverts and fence holes (walk into the mouth); hide in tins, shells, logs and under slabs; ink cloud in water blinds attackers; venom bite scares one off; climb fences and walls.
* **Little octopuses** are hiding around the world; finding one plays a small scene. Nothing is counted on screen.
* **The sea** is in a random direction, no compass or map; clues: sand and dunes, gulls and surf, pale haze, a sea breeze, streams drifting to the coast, Norfolk pines, a lighthouse. **Reaching it does not end the game**: you can swim, dive (look down), explore the reef and rock pools and walk back inland. Dying (0 health) stops the octopus and offers **Restart game**.
* The world has 11 biomes: suburb, town, farm, bush, riverbank, wetland, dunes, beach, headland, estuary and the sea.

## Features
* Seeded open world, 1600 x 1600 m, streamed in 100 m chunks of instanced geometry; mesh-exact ground heights, everything seated on the terrain (an automated audit checks every object over 5 worlds).
* Day/night cycle, weather (clear, heatwave, rain, storm), tides, wind and dew; per-biome lighting.
* Spatial WebAudio (surf, wind, gulls, magpies, kookaburras, engines, horns, ground thumps, squelching footsteps, heartbeat when nearly dry), droplets, wet footprints, camera shake on lunges and heavy footsteps.
* Difficulty (gentle / normal / harsh) and the daily world are chosen from the pause menu only.
* Gamepad support (standard mapping).

## Performance notes
Measured headless with a software renderer (so a real GPU does far better): 360-490 draw calls and 165-320k triangles per frame depending on biome, world generation about 0.45 s, chunks build on demand. `?shadows=0` removes the shadow pass. Smaller `?size=` values help low-end machines.

## Tweaking the game
Everything tunable is in **`src/config.js`**: world size, drying rate, sprint cost, camo energy / cooldown / dry multiplier, `waterSpeedMult`, water amounts and refill rates, predator counts and global damage (`damageMult: 0` = peaceful stroll), hints, graphics (tree/grass counts, fog, shadows) and the terrain table (colour, speed, dry multiplier). Predator species stats (speed, notice distance, damage) are at the top of `src/entities/predators.js`.

## Project layout
```
index.html            page + HUD markup           src/config.js       all tunables
src/main.js           bootstrap                   src/game.js         game state, camera, win/lose, loop
src/world/worldData.js  pure world generator      src/world/worldView.js  chunked terrain/decor rendering
src/world/placement.js  ground seating (shared w/ audit)   src/world/fade.js  camera occluder fade
src/world/areas.js    biome layouts, props, water
src/world/models.js   low-poly model helpers      src/entities/octopus.js  player model & rules
src/entities/predators.js  species + AI           src/audio.js, input.js, hud.js, debug.js
scripts/unit.mjs      world-generator checks      scripts/smoke.mjs   headless browser test
play/index.html       built single-file game      vite.config.js      build (single-file plugin)
```

## Tests
```bash
npm run unit     # world generator: sea always reachable, water variety, slow drying, shallows, determinism … (no browser)
npm run smoke    # headless Chrome/Edge: loads play/index.html over file://, no console errors, render loop,
                 # no HUD elements, slow drying, colour → grey, faster in water, rings flash, rings pale as camo runs out,
                 # camouflage = no damage (incl. mid-attack & eagle dives), lose/restart, win, new sea direction
npm run placement  # every object over 5 seeds sits on the ground (no hovering, no burying), 1 cm tolerance at octopus scale
npm run features   # headless browser: abilities, predators, scale, thumps, bird shadows, gamepad, pause menu ...
npm run biomes     # visits all 11 biomes, draw-call budget, screenshots
npm test         # unit + placement + build + smoke + features   (set CHROME_PATH if Chrome/Edge isn't auto-detected)
```
The page exposes `window.__game` (`setHealth`, `teleportToOcean`, `spawnPredator`, `advance`, …) for tests and console tinkering.

## Known limitations / ideas for next iteration
* Prototype art: all models are primitives; animation is simple.
* Terrain is a 2.5 m grid, so narrow creek channels are only roughly resolved.
* The world is not full real scale: people and animals are compressed (a person is ~8x, not ~9x) and buildings are lower than real, so nothing leaves the screen and layouts keep working.
* Balance numbers are first guesses and need playtesting - tweak `src/config.js`.
* Not tested on real GPUs / phones; no save game.
