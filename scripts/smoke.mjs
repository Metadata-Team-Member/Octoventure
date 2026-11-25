// Headless smoke test (Chrome + puppeteer-core). Loads the single-file build over file://,
// checks for console errors, that WebGL renders frames, and drives lose / restart / camo
// through the window.__game debug hooks. Also writes a gameplay screenshot.
//   usage: npm run build && npm run smoke [-- --shot=/path/to/shot.png]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shotArg = process.argv.find((a) => a.startsWith('--shot='));
const SHOT = shotArg ? shotArg.slice(7) : 'octopus-game-shot2.png';
const CAMO_SHOT = SHOT.replace(/\.png$/, '-camo.png');
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }
const file = resolve('play/index.html');
if (!existsSync(file)) { console.error('play/index.html missing - run `npm run build` first'); process.exit(2); }

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 675 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const url = pathToFileURL(file).href + '?seed=2026';
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });

// ---- start screen -> playing ---------------------------------------------------
ok(await page.evaluate(() => window.__game.webgl), 'WebGL context created');
ok(await page.evaluate(() => window.__game.state) === 'menu', 'starts on the menu');
const startText = await page.evaluate(() => document.getElementById('start').innerText.trim());
ok(startText === 'Play', `start screen shows only a Play button (text: "${startText}")`);
await page.click('#play');
ok(await page.evaluate(() => window.__game.state) === 'playing', 'Play button starts the game');
const f0 = await page.evaluate(() => window.__game.frame);
let f1 = f0;
for (let i = 0; i < 8 && f1 <= f0; i++) { await sleep(500); f1 = await page.evaluate(() => window.__game.frame); }   // software GL can take a couple of seconds for the first frame
ok(f1 > f0, `game loop is running (frame ${f0} -> ${f1})`);
ok(await page.evaluate(() => window.__game.health) <= 100, 'health starts at/below 100');

// ---- mouse look: Pointer Lock (no button needed), Esc pauses, click resumes ----------------------------------
ok(await page.evaluate(() => window.__game.lockSupported), 'Pointer Lock API available');
ok(await page.evaluate(() => window.__game.lockRequests) >= 1, 'clicking Play asks the browser to capture the mouse');
const real = await page.evaluate(() => window.__game.realLock);
console.log(`info  real pointer lock after clicking Play: ${real ? 'granted (testing the real thing)' : 'not granted in this headless browser (testing with a mock + the click-drag fallback)'}`);
ok(real || await page.evaluate(() => window.__game.lockFailed), 'lock either granted or cleanly fell back');
const lockOff = async () => {          // Esc
  if (real) { await page.evaluate(() => document.exitPointerLock()); await page.waitForFunction(() => window.__game.paused, { timeout: 5000 }); }
  else await page.evaluate(() => window.__game.mockLock(false));
};
const lockOn = async () => {           // click on the overlay -> browser grants the lock
  if (real) await page.waitForFunction(() => window.__game.realLock && !window.__game.paused, { timeout: 5000 });
  else await page.evaluate(() => window.__game.mockLock(true));
};
await page.evaluate(() => { const G = window.__game; G.clearPredators(); G.setHealth(100); });
if (!real) await page.evaluate(() => window.__game.mockLock(true));
const look = await page.evaluate(() => {
  const G = window.__game, g = G.game, i = g.input, sens = 0.0022;
  const y0 = G.yaw;
  G.mouseMove(100, 0);
  const dy = G.yaw - y0;
  G.mouseMove(0, 100000); const pMax = G.pitch;
  G.mouseMove(0, -100000); const pMin = G.pitch;
  i.pitch = 0.6; i.invertY = true; G.mouseMove(0, 50); const inv = G.pitch - 0.6; i.invertY = false;
  const z0 = G.zoom; document.getElementById('game').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })); const zoomed = G.zoom - z0;
  return { dy, expect: -100 * sens, pMax, pMin, inv, zoomed };
});
ok(Math.abs(look.dy - look.expect) < 1e-6, `moving the mouse while locked turns the camera with no button held (yaw ${look.dy.toFixed(3)} rad per 100 px)`);
ok(look.pMax <= 1.351 && look.pMin >= 0.079, `pitch is clamped (${look.pMin.toFixed(2)}..${look.pMax.toFixed(2)})`);
ok(look.inv < 0, 'invertY option flips vertical look');
ok(look.zoomed > 0, 'mouse wheel zoom still works');
await page.evaluate(() => window.__game.game.input.keys.add('KeyW'));
await lockOff();
const paused = await page.evaluate(async () => {
  const G = window.__game;
  const y0 = G.yaw; G.mouseMove(300, 0); const yawMoved = G.yaw !== y0;
  const s0 = { rt: G.runTime, h: G.health, x: G.pos.x, z: G.pos.z, f: G.frame };
  await new Promise((r) => setTimeout(r, 700));
  for (let i = 0; i < 20 && G.frame <= s0.f; i++) await new Promise((r) => setTimeout(r, 250));      // (software GL can need a second or two per frame)
  const s1 = { rt: G.runTime, h: G.health, x: G.pos.x, z: G.pos.z, f: G.frame };
  return { paused: G.paused, overlay: G.pauseVisible, text: document.getElementById('resume').innerText, yawMoved, still: s0.rt === s1.rt && s0.h === s1.h && s0.x === s1.x && s0.z === s1.z, rendering: s1.f > s0.f };
});
ok(paused.paused && paused.overlay && paused.text.trim() === 'Resume', `losing the lock pauses with a single Resume button ("${paused.text.trim()}")`);
ok(paused.still && paused.rendering, 'paused: nothing dries or moves, but the scene keeps rendering');
ok(!paused.yawMoved, 'paused: mouse movement does not turn the camera');
const reqBefore = await page.evaluate(() => window.__game.lockRequests);
await page.click('#resume');
ok(await page.evaluate(() => window.__game.lockRequests) > reqBefore, 'clicking Resume re-requests the lock');
await lockOn();
await sleep(600);
const resumed = await page.evaluate(() => { const G = window.__game; G.game.input.keys.delete('KeyW'); return { paused: G.paused, overlay: G.pauseVisible, rt: G.runTime }; });
ok(!resumed.paused && !resumed.overlay && resumed.rt > 0, 'game resumes after the click');
await page.evaluate(() => window.__game.mockLock(null));
// fallback when the lock is unavailable: click-and-drag still works, plain mouse movement does not, and nothing pauses
await page.evaluate(() => window.__game.forceFallback(true));
await sleep(300);
const noPause = await page.evaluate(() => window.__game.paused);
const drag = await (async () => {
  const y0 = await page.evaluate(() => window.__game.yaw);
  await page.mouse.move(600, 300); await page.mouse.move(640, 300);
  const y1 = await page.evaluate(() => window.__game.yaw);
  await page.mouse.down(); await page.mouse.move(720, 300, { steps: 5 }); await page.mouse.up();
  const y2 = await page.evaluate(() => window.__game.yaw);
  return { hover: y1 - y0, drag: y2 - y1 };
})();
ok(!noPause && Math.abs(drag.hover) < 1e-9 && Math.abs(drag.drag) > 0.1, `fallback (no pointer lock): click-and-drag turns the camera, plain movement does not, no pause (${drag.drag.toFixed(2)} rad)`);
await page.evaluate(() => window.__game.forceFallback(false));

// ---- drying out (moist ground, noon, clear sky: a car or a heatwave must not decide it)
await page.evaluate(() => {
  const G = window.__game, g = G.game, w = g.world, o = g.octopus;
  G.clearPredators();
  G.freezeTime(true); G.setTime(0.5); G.setWeather('clear');
  const env = g.env; env.heat = 0; env.rain = 0; env.dark = 0; env.kind = 'clear'; env.timer = 1e9; env.apply();
  const moist = new Set(['lawn', 'grass', 'pasture', 'forest', 'litter']);
  let spot = null;
  for (let ring = 1; ring < 24 && !spot; ring++) {
    for (let a = 0; a < 8 && !spot; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const x = o.x + Math.cos(ang) * ring * 8, z = o.z + Math.sin(ang) * ring * 8;
      const t = w.typeAt(x, z);
      if (!moist.has(t) || w.waterAt(x, z) || w.isSea(x, z) || w.isRoad(x, z, 6) || w.heightAt(x, z) < 0.6) continue;
      spot = { x, z };
    }
  }
  if (spot) G.teleport(spot.x, spot.z);
  G.setHealth(100);
});
const h0 = await page.evaluate(() => window.__game.health);
await page.evaluate(() => window.__game.advance(20));
const h1 = await page.evaluate(() => window.__game.health);
const inWater = await page.evaluate(() => !!window.__game.waterKind);
await page.evaluate(() => window.__game.freezeTime(false));
ok(inWater || (h1 < h0 && h0 - h1 < 12), `health drains slowly (20 s: ${h0} -> ${h1.toFixed(1)}; ~25% of the old rate)`);

// ---- self-discovery UI: nothing on screen but the game ---------------------------------------------
const ui = await page.evaluate(() => {
  const ids = ['hud', 'bar-health', 'bar-camo', 'health-num', 'timer', 'controls', 'terrain', 'toasts', 'danger', 'camo-note'];
  const txt = document.body.innerText;
  const touch = document.getElementById('touch');
  return { present: ids.filter((i) => document.getElementById(i)), txt, touchVisible: touch && getComputedStyle(touch).display !== 'none' };
});
ok(ui.present.length === 0, `no HUD elements in the page (${ui.present.join(',') || 'none'})`);
ok(!/WASD|Shift|Space|Health|Find the sea|speed|dries|rehydrat|\d:\d\d/i.test(ui.txt), 'no on-screen hints, controls, health text or timer');
ok(!ui.touchVisible, 'touch controls hidden on desktop');

// ---- octopus colour drains toward grey as health falls -------------------------------------------------
const chroma = await page.evaluate(() => {
  const G = window.__game; G.clearPredators(); G.teleport(G.pos.x, G.pos.z);
  const out = {};
  for (const h of [100, 50, 5]) { G.setHealth(h); G.game.octopus.waterKind = null; G.game.octopus.animate(0.016); const c = G.greyness; out[h] = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); }
  return out;
});
ok(chroma[100] > chroma[50] && chroma[50] > chroma[5] && chroma[5] < chroma[100] * 0.3, `body colour fades to grey as health drops (saturation ${chroma[100].toFixed(2)} > ${chroma[50].toFixed(2)} > ${chroma[5].toFixed(2)})`);

// ---- wading is faster than walking ---------------------------------------------------------------------
const spd = await page.evaluate(() => {
  const G = window.__game, g = G.game, w = g.world, o = g.octopus;
  G.clearPredators(); G.setHealth(100);
  G.setWeather('clear'); g.env.rain = 0; w.temp.length = 0;          // a passing shower leaves puddles: measure land on dry land
  g.input.keys.add('KeyW');
  // a start can sit in a pasture puddle, which wades as fast as the pond and used to fail the ratio
  const dry = (x, z) => !w.waterAt(x, z) && !w.isShallow(x, z) && w.heightAt(x, z) > 1.1;
  let land = null;
  for (let i = 0; i < 24 && !land; i++) {
    const a = (i / 24) * Math.PI * 2, rad = 12 + (i % 3) * 14;
    const x = w.home.x + Math.cos(a) * rad, z = w.home.z + Math.sin(a) * rad;      // (banded: the start is in the sea; measure on land at home)
    if (!dry(x, z)) continue;
    G.teleport(x, z); o.speed = 0; G.advance(0.5);
    if (G.waterKind || !dry(o.x, o.z)) continue;
    land = { speed: G.speed, terrain: G.terrain };
  }
  if (!land) { G.teleport(w.home.x, w.home.z); o.speed = 0; G.advance(0.6); land = { speed: G.speed, terrain: G.terrain }; }
  const pond = w.waters.find((q) => q.kind === 'pond' || q.kind === 'stream' || q.kind === 'puddle');
  G.teleport(pond.x, pond.z); o.speed = 0; G.advance(0.5);
  const water = { speed: G.speed, kind: G.waterKind, terrain: G.terrain };
  g.input.keys.delete('KeyW');
  return { land, water };
});
ok(spd.water.kind && spd.water.speed > spd.land.speed * 1.2, `faster in water (${spd.water.speed.toFixed(1)} in ${spd.water.kind} on ${spd.water.terrain}, vs ${spd.land.speed.toFixed(1)} on ${spd.land.terrain})`);
const shallow = await page.evaluate(() => {
  const G = window.__game, w = G.game.world, st = w.home, env = G.game.env;      // walk from home (inland) towards the sea
  const saved = { frozen: env.frozen, t: env.t, target: env.target, timer: env.timer, heat: env.heat, rain: env.rain, dark: env.dark, kind: env.kind };
  w.rain.length = 0;   // moving rain clouds would make this flaky
  G.freezeTime(true); G.setTime(0.5); G.setWeather('clear');
  env.heat = 0; env.rain = 0; env.dark = 0; env.kind = 'clear'; env.apply();
  // the wet band is thin, and a random start can walk the centre ray over it: sample a few parallels
  let found = null, tries = 0;
  for (const off of [0, 12, -12, 28, -28]) {
    const ox = -w.dir.z * off, oz = w.dir.x * off;
    for (let d = 0; d < 2200 && tries < 6; d += 4) {
      const x = st.x + w.dir.x * d + ox, z = st.z + w.dir.z * d + oz;
      if (!(w.isShallow(x, z) && !w.isSea(x, z) && !w.waterAt(x, z))) continue;
      tries++;
      G.teleport(x, z); G.setHealth(40); G.advance(0.5);
      if (G.waterKind === 'sea' && G.health > 40 && G.state === 'playing') { found = { kind: G.waterKind, h: G.health, state: G.state }; break; }
    }
    if (found) break;
  }
  Object.assign(env, saved); env.apply();
  return found;
});
ok(shallow && shallow.kind === 'sea' && shallow.h > 40 && shallow.state === 'playing', `sea shallows count as water (fast + rehydrating${shallow ? `: ${shallow.h.toFixed(0)}` : ''})`);

// ---- water rehydrates ------------------------------------------------------------
const reh = await page.evaluate(() => {
  const G = window.__game, w = G.game.world;
  const p = w.waters.find((q) => q.kind === 'puddle');
  G.teleport(p.x, p.z); G.setHealth(30); G.advance(2);
  return { health: G.health, kind: G.waterKind };
});
ok(reh.health > 60 && reh.kind === 'puddle', `standing in a puddle rehydrates (30 -> ${reh.health.toFixed(0)})`);

// ---- predators: notice, ring flash, camouflage makes them leave -----------------------
const pred = await page.evaluate(() => {
  const G = window.__game, g = G.game, o = g.octopus;
  G.clearPredators();
  G.teleportNearOcean(-10 + 400);          // somewhere neutral inland
  G.setHealth(100);
  const base = G.ringGlow;
  // fox 16 m away in front of the camera; octopus is moving so it gets noticed
  const yaw = g.input.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  g.input.keys.add('KeyW');
  G.advance(0.4);
  const fox = G.spawnPredator('fox', fx * 16, fz * 16);
  let alerted = false, t = 0;
  while (t < 4 && !alerted) { G.advance(1 / 30); t += 1 / 30; alerted = fox.state === 'alert' || fox.state === 'chase'; }
  const flash = (() => { G.advance(0.5); return { alarm: G.alarm, glow: G.ringGlow }; })();
  // now hide
  g.input.keys.delete('KeyW'); g.input.keys.add('Space');
  G.advance(0.2);
  let seen = new Set(), t2 = 0;
  const hp = G.health;
  while (t2 < 6) { G.advance(1 / 30); t2 += 1 / 30; seen.add(fox.state); }
  const out = { alerted, base, flash, seen: [...seen], camo: G.camoActive, stateEnd: fox.state, lost: hp - G.health, alarmEnd: G.alarm };
  g.input.keys.delete('Space');
  return out;
});
ok(pred.alerted, 'a fox notices the moving octopus');
ok(pred.flash.alarm > 0.5 && pred.flash.glow > pred.base, `blue rings flash when noticed (glow ${pred.base.toFixed(2)} -> ${pred.flash.glow.toFixed(2)})`);
ok(pred.camo, 'camouflage becomes active');
ok(pred.seen.includes('confused') || pred.seen.includes('leave'), `fooled predator loses interest (states: ${pred.seen.join(',')})`);
ok(pred.lost < 20, `no big damage taken while hidden (${pred.lost.toFixed(1)})`);
ok(pred.alarmEnd < 0.3, 'rings stop flashing once the threat is gone');

// ---- camouflage = total protection ------------------------------------------------------------------------
const camo1 = await page.evaluate(() => {
  const G = window.__game, g = G.game;
  G.clearPredators(); G.setHealth(100); g.input.keys.clear(); g.octopus.lastDamage = 'dry';
  G.teleportNearOcean(300);
  // every species right on top of the octopus, then hide
  for (const k of ['dog', 'cat', 'fox', 'crab', 'gull', 'human']) G.spawnPredator(k, 1.2 + Math.random(), 1.2);
  g.input.keys.add('Space');
  const seen = new Set(); let t = 0;
  while (t < 5) { G.advance(1 / 30); t += 1 / 30; G.predators.forEach((p) => seen.add(p.state)); }
  g.input.keys.delete('Space');
  return { dmg: g.octopus.lastDamage, states: [...seen], protectedNow: G.camoProtected };
});
ok(camo1.dmg === 'dry' && !camo1.states.includes('attack'), `six predators nose-to-nose do no damage while camouflaged (states seen: ${camo1.states.join(',')})`);
const camo2 = await page.evaluate(() => {
  const G = window.__game, g = G.game;
  G.clearPredators(); G.setHealth(100); g.input.keys.clear(); g.octopus.camoLocked = false; g.octopus.energy = 100; g.octopus.lastDamage = 'dry'; G.advance(2);
  const dog = G.spawnPredator('dog', 6, 0);
  let guard = 0;
  while (dog.state !== 'attack' && guard++ < 300) G.advance(1 / 60);       // dog is lunging at us...
  const wasAttacking = dog.state === 'attack';
  g.input.keys.add('Space');                                                // ...and we hide mid-attack
  const seen = new Set(); let t = 0;
  while (t < 3) { G.advance(1 / 60); t += 1 / 60; seen.add(dog.state); }
  g.input.keys.delete('Space');
  return { wasAttacking, dmg: g.octopus.lastDamage, seen: [...seen] };
});
ok(camo2.wasAttacking && camo2.dmg === 'dry' && camo2.seen.includes('confused'), `hiding mid-attack stops the attack at once (dog states: ${camo2.seen.join(',')})`);
const camo3 = await page.evaluate(() => {
  const G = window.__game, g = G.game;
  G.clearPredators(); G.setHealth(100); g.input.keys.clear(); g.octopus.camoLocked = false; g.octopus.energy = 100; g.octopus.lastDamage = 'dry'; G.advance(2);
  const eagle = G.spawnPredator('eagle', 12, 0);
  g.input.keys.add('KeyW');
  let guard = 0; while (eagle.state !== 'dive' && guard++ < 400) G.advance(1 / 60);
  const diving = eagle.state === 'dive';
  g.input.keys.delete('KeyW'); g.input.keys.add('Space');
  const seen = new Set(); let t = 0;
  while (t < 4) { G.advance(1 / 60); t += 1 / 60; seen.add(eagle.state); }
  g.input.keys.delete('Space');
  return { diving, dmg: g.octopus.lastDamage, seen: [...seen] };
});
ok(camo3.diving && camo3.dmg === 'dry' && camo3.seen.includes('climb'), `an eagle dive is aborted when we camouflage (states: ${camo3.seen.join(',')})`);

// ---- camouflage rings get lighter as the camo energy runs out -------------------------------------------------
const rings = await page.evaluate(() => {
  const G = window.__game, g = G.game;
  G.clearPredators(); G.setHealth(100); g.input.keys.clear(); g.octopus.camoLocked = false; g.octopus.energy = 100; G.advance(1);
  const lum = () => { const c = G.ringColor; return c.r * 0.3 + c.g * 0.59 + c.b * 0.11; };
  g.input.keys.add('Space'); G.advance(0.8);
  const early = lum(); G.advance(3.2); const mid = lum(); G.advance(2.0); const late = lum();
  const e = G.energy; g.input.keys.delete('Space');
  return { early, mid, late, e };
});
ok(rings.early < rings.mid && rings.mid < rings.late && rings.late > rings.early * 2, `rings go paler as camo runs out (luminance ${rings.early.toFixed(2)} -> ${rings.mid.toFixed(2)} -> ${rings.late.toFixed(2)}, energy left ${rings.e.toFixed(0)})`);

// ---- every species can be spawned and updated without errors -------------------------------
const species = await page.evaluate(() => {
  const G = window.__game; G.clearPredators(); G.setHealth(100);
  const kinds = ['gull', 'cat', 'dog', 'fox', 'crab', 'eagle', 'human', 'magpie', 'kookaburra', 'snake', 'goanna', 'heron'];
  kinds.forEach((k, i) => G.spawnPredator(k, 10 + i * 3, 10 - i * 4));
  G.advance(8);
  return G.predators.map((p) => `${p.kind}:${p.state}`);
});
ok(species.length === 12, `all 12 predator species run (${species.join(' ')})`);

// ---- lose -> restart ------------------------------------------------------------------------
const seedBefore = await page.evaluate(() => { const G = window.__game; G.clearPredators(); return G.seed; });
const startBefore = await page.evaluate(() => ({ ...window.__game.game.world.start }));
await page.evaluate(() => { const G = window.__game; G.teleport(G.pos.x, G.pos.z); G.setHealth(0.3); window.__game.game.input.keys.add('KeyW'); });
await page.evaluate(() => window.__game.advance(3));
ok(await page.evaluate(() => window.__game.state) === 'dead', 'losing all health -> dead');
const p1 = await page.evaluate(() => window.__game.pos);
await page.evaluate(() => window.__game.advance(1));
const p2 = await page.evaluate(() => window.__game.pos);
ok(Math.hypot(p1.x - p2.x, p1.z - p2.z) < 0.01, 'octopus stops moving when dead (even with W held)');
ok(await page.evaluate(() => window.__game.restartVisible), 'Restart game button appears');
await page.evaluate(() => window.__game.game.input.keys.clear());
ok(!(await page.evaluate(() => window.__game.realLock)), 'death screen frees the mouse cursor (lock released)');
const reqR = await page.evaluate(() => window.__game.lockRequests);
await page.click('#restart');
ok(await page.evaluate(() => window.__game.lockRequests) > reqR, 'Restart re-captures the mouse');
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 30000 });
const after = await page.evaluate(() => ({ h: window.__game.health, seed: window.__game.seed, vis: window.__game.restartVisible }));
ok(after.h > 98 && !after.vis, 'restart resets health and hides the overlay');
const startAfter = await page.evaluate(() => ({ ...window.__game.game.world.start, ox: window.__game.game.octopus.x, oz: window.__game.game.octopus.z }));
ok(after.seed === seedBefore, 'restart keeps the ONE world (same seed)');
ok(Math.hypot(startAfter.x - startBefore.x, startAfter.z - startBefore.z) > 0.5 && Math.hypot(startAfter.ox - startAfter.x, startAfter.oz - startAfter.z) < 1, 'restart begins at a new spot by the big shell (the octopus is there)');

// ---- the sea is part of the world: arriving is a quiet moment, play continues ------------------------------
await page.evaluate(() => { const G = window.__game; G.clearPredators(); G.setHealth(40); });
const before = await page.evaluate(() => ({ uiText: document.body.innerText, overlays: [...document.querySelectorAll('.overlay')].filter((e) => !e.hidden).length }));
// banded: every game begins in the sea, so the quiet moment is the homecoming - back to the water after a trip inland
const noMoment = await page.evaluate(() => { const G = window.__game; for (let i = 0; i < 10; i++) G.advance(0.1); return !G.game.seaMoment && !G.game.progress.seaReached; });
ok(noMoment, 'starting in the sea does not count as reaching it (no sea moment at the start)');
await page.evaluate(() => { const G = window.__game, w = G.game.world; G.teleport(w.home.x, w.home.z); for (let i = 0; i < 5; i++) G.advance(0.1); });
const sea = await page.evaluate(() => window.__game.teleportToOcean(6));
await page.evaluate(() => { const G = window.__game; for (let i = 0; i < 25 && !G.game.seaMoment; i++) G.advance(0.1); });
const arr = await page.evaluate(() => ({ s: window.__game.state, reached: window.__game.game.progress.seaReached, moment: !!window.__game.game.seaMoment, h: window.__game.health, end: window.__game.restartVisible }));
ok(sea && arr.s === 'playing' && arr.reached && !arr.end, 'reaching the sea does NOT end the game (state stays playing, no end screen)');
ok(arr.moment, 'first arrival triggers the quiet sea moment (camera drift + fade)');
await page.evaluate(() => window.__game.advance(8));
const arr2 = await page.evaluate(() => ({ s: window.__game.state, h: window.__game.health, moment: !!window.__game.game.seaMoment, fade: document.getElementById('fade').style.opacity, text: document.body.innerText, kind: window.__game.waterKind }));
ok(arr2.s === 'playing' && arr2.h > 95 && arr2.kind === 'sea', `swimming in the sea fully rehydrates (health 40 -> ${arr2.h.toFixed(0)})`);
ok(!arr2.moment && Number(arr2.fade) === 0, 'the quiet moment ends and the screen fade clears');
ok(arr2.text.trim() === before.uiText.trim(), 'no new on-screen text appeared (screen is as clean as before)');
// walk back out of the sea onto land
const back = await page.evaluate(() => {
  const G = window.__game, g = G.game, w = g.world;
  g.input.keys.clear();
  G.teleport(g.octopus.x, g.octopus.z);
  // aim away from the sea and walk
  g.octopus.heading = Math.atan2(-w.dir.x, -w.dir.z);
  g.input.yaw = Math.atan2(-w.dir.x, -w.dir.z);   // camera looks towards the sea, so W walks towards it; S walks back to land
  g.input.keys.add('KeyS');
  G.advance(40);
  g.input.keys.clear();
  return { sea: w.isSea(g.octopus.x, g.octopus.z), state: G.state, d: G.distanceToSea };
});
ok(back.state === 'playing' && !back.sea, 'the octopus can leave the sea and return to land');

// ---- one world, many starts: the sea direction is fixed, the start point is not --------------------------------
const starts = [], angles = [];
for (let i = 0; i < 4; i++) {
  const prevStart = await page.evaluate(() => JSON.stringify(window.__game.game.world.start));
  await page.evaluate(() => window.__game.restart());
  await page.waitForFunction((s) => JSON.stringify(window.__game.game.world.start) !== s && window.__game.state === 'playing', { timeout: 30000 }, prevStart);
  starts.push(await page.evaluate(() => { const w = window.__game.game.world; return { x: w.start.x, z: w.start.z, sea: w.isSea(w.start.x, w.start.z), shell: Math.hypot(w.start.x - w.shell.x, w.start.z - w.shell.z) }; }));
  angles.push(await page.evaluate(() => window.__game.seaAngle));
}
ok(new Set(angles.map((a) => a.toFixed(3))).size === 1, `the sea is always in the same direction in the one world (${(angles[0] * 57.3).toFixed(0)}°)`);
ok(new Set(starts.map((p) => p.x.toFixed(1) + ',' + p.z.toFixed(1))).size === 4 && starts.every((p) => p.sea && p.shell < 30), `each new game starts at a new spot in the sea by the big shell (${starts.map((p) => p.shell.toFixed(0) + ' m').join(', ')})`);

// ---- screenshot ------------------------------------------------------------------------------------
await page.evaluate(() => {
  const G = window.__game, g = G.game;
  g.input.keys.clear();
  G.clearPredators();
  const w = g.world;
  // pick a pleasant spot: the start garden, a dog and a seagull in view, rings flashing
  g.input.pitch = 0.36; g.input.zoom = -2.5;
  const yaw = g.input.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  G.spawnPredator('dog', fx * 9, fz * 9);
  G.spawnPredator('gull', fx * 6 + rx * 3, fz * 6 + rz * 3);
  G.advance(0.25);
  G.setHealth(55);                       // a little drained: the colour is already fading
  g.octopus.animate(0.016);
});
await sleep(2500);
await page.screenshot({ path: SHOT });
console.log(`screenshot -> ${SHOT}`);
// camouflaged with the camo energy nearly spent: ground-coloured body, pale rings
await page.evaluate(() => {
  const G = window.__game, g = G.game;
  G.clearPredators(); G.setHealth(85); g.octopus.camoLocked = false; g.octopus.energy = 100;
  g.input.pitch = 0.5; g.input.zoom = -3.5;
  g.input.keys.add('Space'); G.advance(4.7);
});
await sleep(2500);
await page.screenshot({ path: CAMO_SHOT });
console.log(`screenshot -> ${CAMO_SHOT}`);
await page.evaluate(() => window.__game.game.input.keys.clear());

ok(problems.length === 0, `no console errors or warnings${problems.length ? '\n   ' + problems.join('\n   ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
