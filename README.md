# 🐙 Blue-Ringed Octopus: Run to the Sea

A third-person 3D browser game (Three.js). You are a tiny **Australian blue-ringed octopus** (*Hapalochlaena*), stranded far inland and slowly drying out in the sun. The ocean is somewhere out there – **in a random direction every game, with no compass** – and you have to find your way back to it across an open world of gardens, roads, meadows, forests, mud, rocky hills, dunes and tidal flats.

> Status: **initial concept / prototype (v0.1)** – built to be played, poked at and adjusted.
> No login, no server, no accounts. The repo is private.

![gameplay](docs/screenshot.png)
![camouflaged](docs/screenshot-camo.png)

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
`play/index.html` is committed on purpose. GitHub Pages is **not** enabled: Pages on a *private* repository needs a paid GitHub plan. If you ever want a shareable link, either upgrade, make a public copy, or drop `dist/` on any static host (Netlify, Cloudflare Pages, S3, …).

## Controls
| Action | Keys |
|---|---|
| Move (relative to the camera) | **W A S D** or **arrow keys** |
| Sprint (dries you out 2× faster) | **Shift** |
| Camouflage (hold) | **Space**, **C** or **E** |
| Look around | **drag with the mouse** |
| Zoom | **mouse wheel** |
| Mute / unmute | **M** |
| Restart after the game ends | button, or **R** |

Touch screens get an on-screen joystick, RUN and CAMO buttons (they only appear once you touch the screen; they stay hidden on desktop). Drag anywhere else to look.
Start: click the title screen or press any key. URL options: `?seed=1234` (fixed first world), `?debug=1` (fps / position / distance-to-sea overlay for developers), `?shadows=0` (faster on weak GPUs), `?autostart=1` (skip the title screen).

## How to play (a self-discovery game)
There is **no HUD, timer, tutorial or hint text** on screen. Controls are listed here only; everything else you work out by playing.
* The octopus **dries out** over time (about 6½ minutes from full to empty on ordinary ground – faster on some surfaces). Its **colour fades toward grey as health drops** and it slumps when it dies. Find water to bring the colour back.
* Water comes in many forms – look and listen for it. Different ground changes your speed and how fast you dry; wading is *faster* than walking.
* **Predators** roam each habitat. When one notices you your **blue rings flash**. Chase, bite, dive – you'll learn who is who.
* **Camouflage** (hold Space): your body takes on the ground colour and the rings fade. **While you are camouflaged no predator can hurt you** – they break off, get confused and wander away, and stay uninterested for a while. It costs camo energy, freezes you and dries you faster; as the energy runs out **the rings go paler and paler** – that is your warning that the hiding is about to end.
* **The sea** is in a random direction every game, and there is no compass or map.
* **Win:** wade into the sea ("You made it to the sea!" / Play again). **Lose:** at 0 health the octopus stops moving and a **Restart game** button appears (new world, new sea direction).

## Features
* Procedural open world (seeded) – heightmap terrain, 10 terrain types, irregular coastline, tidal flats and a shallow sea. Subtle, unlabelled clues to the sea's direction (sand and dunes, gulls and surf, pale haze, a faint sea breeze, streams that drift to the coast; each can be switched off in `src/config.js`).
* Blue-ringed octopus built from primitives: mottled ochre body, 8 animated arms, ~80 iridescent blue rings with black outlines. Colour drains to grey with health; rings flash when a predator has noticed you; under camouflage the body takes the ground colour and the rings fade, going pale as the camo energy runs out.
* 7 predator species with a small state machine (wander → alert → chase → attack → confused → leave); eagles circle and dive. Camouflage makes you untouchable (attacks and dives abort at once).
* Water scenarios: puddles, ponds, streams, tide pools, drips/seeps, sprinklers, rain clouds, sea shallows (wading is faster).
* Low-poly style with fog, shadows, sky dome, clouds, drifting rain and procedural WebAudio sound (wind, surf, gulls, splash, alerts; **M** mutes).

## Tweaking the game
Everything tunable is in **`src/config.js`**: world size, drying rate, sprint cost, camo energy / cooldown / dry multiplier, `waterSpeedMult`, water amounts and refill rates, predator counts and global damage (`damageMult: 0` = peaceful stroll), hints, graphics (tree/grass counts, fog, shadows) and the terrain table (colour, speed, dry multiplier). Predator species stats (speed, notice distance, damage) are at the top of `src/entities/predators.js`.

## Project layout
```
index.html            page + HUD markup           src/config.js       all tunables
src/main.js           bootstrap                   src/game.js         game state, camera, win/lose, loop
src/world/worldData.js  pure world generator      src/world/worldView.js  terrain/sea/water/decor rendering
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
npm test         # unit + build + smoke   (set CHROME_PATH if Chrome/Edge isn't auto-detected)
```
The page exposes `window.__game` (`setHealth`, `teleportToOcean`, `spawnPredator`, `advance`, …) for tests and console tinkering.

## Known limitations / ideas for next iteration
* Prototype art: all models are primitives; animation is simple. Predator legs/gaits are basic.
* No minimap/compass by design – but there's also no way to "learn" the world between runs; ideas: a field journal, discoverable landmarks.
* Water collisions are circles and terrain carving is coarse (2.5 m grid), so puddle edges are a bit faceted.
* Balance numbers are still first guesses (drying is now ~4× slower than v0.1). Needs playtesting – tweak `src/config.js`.
* Ideas: day/night and heat waves, tides, hiding under rocks/seaweed for a camo bonus, venom bite as a last-ditch defence, more predators (snakes, crows, cars), difficulty modes, scoring/leaderboard, save/seed sharing, controller support, better sound, mobile polish, a proper menu/settings, optional login later.
