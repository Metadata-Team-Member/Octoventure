// Headless smoke test (Chrome + puppeteer-core). Loads the single-file build over file://,
// checks for console errors, that WebGL renders frames, and drives win / lose / restart / camo
// through the window.__game debug hooks. Also writes a gameplay screenshot.
//   usage: npm run build && npm run smoke [-- --shot=/path/to/shot.png]
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shotArg = process.argv.find((a) => a.startsWith('--shot='));
const SHOT = shotArg ? shotArg.slice(7) : '/workspace/octopus-game-shot.png';
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
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 60000 });

// ---- start screen -> playing ---------------------------------------------------
ok(await page.evaluate(() => window.__game.webgl), 'WebGL context created');
ok(await page.evaluate(() => window.__game.state) === 'menu', 'starts on the menu');
await page.click('#play');
ok(await page.evaluate(() => window.__game.state) === 'playing', 'Play button starts the game');
const f0 = await page.evaluate(() => window.__game.frame);
await sleep(1500);
const f1 = await page.evaluate(() => window.__game.frame);
ok(f1 > f0, `game loop is running (frame ${f0} -> ${f1})`);
ok(await page.evaluate(() => window.__game.health) <= 100, 'health starts at/below 100');

// ---- drying out ----------------------------------------------------------------
await page.evaluate(() => { const G = window.__game; G.clearPredators(); G.teleport(G.pos.x + 40, G.pos.z + 40); });
const h0 = await page.evaluate(() => { const G = window.__game; G.setHealth(100); return G.health; });
await page.evaluate(() => window.__game.advance(5));
const h1 = await page.evaluate(() => window.__game.health);
ok(h1 < h0 || await page.evaluate(() => !!window.__game.waterKind), `health drains over time (${h0} -> ${h1.toFixed(1)})`);

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
  // fox 26 m away in front of the camera; octopus is moving so it gets noticed
  const yaw = g.input.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  g.input.keys.add('KeyW');
  G.advance(0.4);
  const fox = G.spawnPredator('fox', fx * 26, fz * 26);
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

// ---- every species can be spawned and updated without errors -------------------------------
const species = await page.evaluate(() => {
  const G = window.__game; G.clearPredators(); G.setHealth(100);
  const kinds = ['gull', 'cat', 'dog', 'fox', 'crab', 'eagle', 'human'];
  kinds.forEach((k, i) => G.spawnPredator(k, 10 + i * 3, 10 - i * 4));
  G.advance(8);
  return G.predators.map((p) => `${p.kind}:${p.state}`);
});
ok(species.length === 7, `all 7 predator species run (${species.join(' ')})`);

// ---- lose -> restart ------------------------------------------------------------------------
const seedBefore = await page.evaluate(() => { const G = window.__game; G.clearPredators(); return G.seed; });
await page.evaluate(() => { const G = window.__game; G.teleport(G.pos.x, G.pos.z); G.setHealth(0.3); window.__game.game.input.keys.add('KeyW'); });
await page.evaluate(() => window.__game.advance(3));
ok(await page.evaluate(() => window.__game.state) === 'dead', 'losing all health -> dead');
const p1 = await page.evaluate(() => window.__game.pos);
await page.evaluate(() => window.__game.advance(1));
const p2 = await page.evaluate(() => window.__game.pos);
ok(Math.hypot(p1.x - p2.x, p1.z - p2.z) < 0.01, 'octopus stops moving when dead (even with W held)');
ok(await page.evaluate(() => window.__game.restartVisible), 'Restart game button appears');
await page.evaluate(() => window.__game.game.input.keys.clear());
await page.click('#restart');
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 30000 });
const after = await page.evaluate(() => ({ h: window.__game.health, seed: window.__game.seed, vis: window.__game.restartVisible }));
ok(after.h > 98 && !after.vis, 'restart resets health and hides the overlay');
ok(after.seed !== seedBefore, 'restart builds a new world (new sea direction)');

// ---- win ---------------------------------------------------------------------------------------
await page.evaluate(() => { const G = window.__game; G.clearPredators(); G.setHealth(100); });
const sea = await page.evaluate(() => window.__game.teleportToOcean(6));
await page.evaluate(() => window.__game.advance(0.5));
const win = await page.evaluate(() => ({ s: window.__game.state, t: window.__game.endTitle, stats: window.__game.endStats }));
ok(sea && win.s === 'won' && /sea/i.test(win.t) && /Time \d+:\d\d/.test(win.stats), `reaching the sea wins ("${win.t}" / ${win.stats})`);

// ---- the sea direction is random per world ------------------------------------------------------------
const angles = [];
for (let i = 0; i < 4; i++) {
  const prev = await page.evaluate(() => window.__game.seed);
  await page.evaluate(() => window.__game.restart());
  await page.waitForFunction((s) => window.__game.seed !== s && window.__game.state === 'playing', { timeout: 30000 }, prev);
  angles.push(await page.evaluate(() => window.__game.seaAngle));
}
ok(new Set(angles.map((a) => a.toFixed(3))).size === 4, `sea direction differs in each new world (${angles.map((a) => (a * 57.3).toFixed(0) + '°').join(', ')})`);

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
});
await sleep(2500);
await page.screenshot({ path: SHOT });
console.log(`screenshot -> ${SHOT}`);

ok(problems.length === 0, `no console errors or warnings${problems.length ? '\n   ' + problems.join('\n   ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
