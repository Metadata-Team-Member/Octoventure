// Save / continue tests (headless Chrome via puppeteer-core). Run after `npm run build`:   node scripts/saves.mjs
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failed++; };
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 700 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const URL = pathToFileURL(resolve('play/index.html')).href;
const E = (f, ...a) => page.evaluate(f, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = async (q = '') => { await page.goto(URL + q, { waitUntil: 'load' }); await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 }); };
const KEY = 'octo.save.v2';
const noAutosave = () => E(() => { window.__game.game.saveEnabled = false; });      // (leaving the page saves it: switch that off when a test tampers with storage)
const pauseMenu = async () => { await E(() => { document.exitPointerLock?.(); window.__game.game.setPaused(true); }); await sleep(400); await E(() => { if (!window.__game.paused) window.__game.game.setPaused(true); }); };
const saved = () => E((k) => { const t = localStorage.getItem(k); return t ? JSON.parse(t) : null; }, KEY);

// ================================================================ first visit: no save, start screen is only Play
await load();
await E((k) => localStorage.clear());
await load();
{
  const r = await E(() => ({ start: [...document.querySelectorAll('#start button')].map((b) => b.innerText.trim()).join('|'), vis: document.getElementById('start').hidden, text: document.getElementById('start').innerText.trim(), state: window.__game.state, key: localStorage.getItem('octo.save.v1') }));
  ok(r.start === 'Play' && r.text === 'Play' && !r.vis && r.state === 'menu' && r.key === null, 'first visit: the start screen is only Play and nothing is saved yet');
}
await page.click('#play');
await E(() => { const G = window.__game; G.clearPredators(); G.freezeTime(true); G.setTime(0.45); G.setWeather('clear'); G.game.world.rain.length = 0; });
await sleep(300);
const seed1 = await E(() => window.__game.seed);

// ================================================================ play a little, then it is saved on pause / Tab
let before;
{
  before = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    G.give('crab', 2); G.give('kelp', 3); G.give('lettuce', 1); G.give('shellhalf', 4); G.give('pebble', 3);
    G.craft('shield-shell'); G.craft('wrap');
    // take something from the world
    const it = G.teleportToGather('moss', 0); g.advance(0.7); G.teleport(it.x, it.z); g.advance(0.2);
    const tk = it.id;
    // a shell + a baby
    const s = G.teleportToShell(0); G.teleport(s.x, s.z); g.advance(0.2);
    const b = G.teleportToBaby(0); G.teleport(b.x, b.z); g.advance(0.3);
    // a den, a few effects
    G.teleport(g.world.start.x, g.world.start.z); g.advance(0.2);       // a dry, open spot for the den
    G.give('pebble', 3); G.give('shellhalf', 1); G.craft('den'); G.use('den');
    G.use('wrap'); G.give('shrimp', 2); G.craft('inksac'); G.use('inksac');
    G.setTime(0.71); G.setWeather('rain'); g.env.kind = 'rain'; g.env.rain = 0.6; g.env.timer = 123;
    G.setHealth(73);
    G.teleport(o.x + 9, o.z + 4); g.advance(1.5);
    return { id: tk, pos: { x: o.x, z: o.z }, health: o.health, inv: g.inv.toJSON(), den: g.abilities.dens.length, buff: { ...o.buff }, ink: o.inkCharges, shells: g.progress.shells, babies: g.progress.babies, t: g.env.t, kind: g.env.kind, explored: g.explored.size, run: g.runTime, armor: o.armor };
  });
  await page.keyboard.press('Tab'); await sleep(300);
  const s = await saved();
  ok(!!s && s.v === 3 && s.seed === seed1, 'opening the satchel saves the game (versioned)');
  ok(s && Math.abs(s.octo.x - before.pos.x) < 0.1 && Math.abs(s.octo.z - before.pos.z) < 0.1 && Math.abs(s.octo.health - before.health) < 0.3, 'the save holds position and health');
  ok(s && s.got.includes(before.id) && s.shells.o.length === 1 && s.babies.length === 1 && s.dens.length === 1 && s.fx.ink === 3 && s.inv.counts.crab === 2, `it holds ${s && JSON.stringify({ got: s.got.includes(before.id), so: s.shells.o.length, b: s.babies.length, d: s.dens.length, ink: s.fx.ink, crab: s.inv.counts.crab })} what was taken, the shell, the baby, the den, the ink and the satchel`);// what was taken, the shell, the baby, the den, the ink and the satchel');
  ok(s && s.explored.length > 0 && s.env.kind === 'rain' && Math.abs(s.env.t - before.t) < 0.01, 'and explored cells, time of day and weather');
  ok(s && !JSON.stringify(s).match(/https?:|@|navigator|userAgent/), 'no personal data in the save');
  await page.keyboard.press('Tab'); await sleep(300);
  await E(() => window.__game.game.setPaused(false));
}

// ================================================================ reload: Play continues exactly there
{
  await load();
  const r = await E(() => { const G = window.__game, g = G.game; return { seed: G.seed, state: G.state, start: document.getElementById('start').innerText.trim(), buttons: [...document.querySelectorAll('#start button')].map((b) => b.innerText.trim()).join('|') }; });
  ok(r.seed === seed1 && r.state === 'menu' && r.start === 'Play' && r.buttons === 'Play', 'reload: the same world, start screen still just Play');
  await page.click('#play'); await sleep(300);
  await E(() => { const G = window.__game; G.clearPredators(); G.freezeTime(true); });
  const a = await E((id) => {
    const G = window.__game, g = G.game, o = g.octopus;
    const it = g.gather.items().find((q) => q.id === id);
    const shellsGot = g.world.shells.filter((s) => !s.reg && s.got).length;
    const babyFound = g.world.babies.filter((b) => b.found).length;
    return { state: G.state, pos: { x: o.x, z: o.z }, health: o.health, inv: g.inv.toJSON(), den: g.abilities.dens.length, hide: g.world.hides.filter((h) => h.kind === 'den').length, buff: { ...o.buff }, ink: o.inkCharges, shells: g.progress.shells, armor: o.armor, babies: g.progress.babies, babyFound, shellsGot, t: g.env.t, kind: g.env.kind, taken: it?.got, slot: it?.slot, explored: g.explored.size, run: g.runTime };
  }, before.id);
  ok(a.state === 'playing' && Math.hypot(a.pos.x - before.pos.x, a.pos.z - before.pos.z) < 0.5, `Play continues at the saved spot (${Math.hypot(a.pos.x - before.pos.x, a.pos.z - before.pos.z).toFixed(2)} u off)`);
  ok(Math.abs(a.health - before.health) < 1.5, `health is as it was (${before.health.toFixed(1)} -> ${a.health.toFixed(1)})`);
  ok(JSON.stringify(a.inv) === JSON.stringify(before.inv), 'the satchel is as it was');
  ok(a.den === 1 && a.hide === 1 && a.ink === 3 && a.buff.kelp > 50 && a.buff.shield === 0, `crafted items and active effects come back (den, ink x${a.ink}, kelp wrap ${a.buff.kelp.toFixed(0)} s left)`);
  ok(a.taken === true && a.slot === -1, 'what was picked up from the world stays gone');
  ok(a.shellsGot === 1 && a.shells === before.shells && Math.abs(a.armor - before.armor) < 1e-9, 'the shell stays collected and the hidden armour is the same');
  ok(a.babyFound === 1 && a.babies === before.babies, 'the rescued baby stays rescued');
  ok(Math.abs(a.t - before.t) < 0.02 && a.kind === 'rain', `time of day and weather continue (${a.t.toFixed(2)}, ${a.kind})`);
  ok(a.explored >= before.explored && a.run >= before.run - 0.5, 'explored cells and run time continue');
  // the world can be played on, and it autosaves
  const adv = await E(() => { const g = window.__game.game; g.advance(31); return g.state; });
  ok(adv === 'playing', 'play continues after loading');
  const s2 = await saved();
  ok(s2 && s2.run > before.run + 25, 'it autosaves while you play (every ~30 s)');
}

// ================================================================ transfer code
{
  const code = await E(async () => { const g = window.__game.game; const { } = {}; g.hud.el.codeIn.value = ''; await g.copyCode(); return g.hud.el.codeIn.value; });
  ok(/^OCTO1-[0-9a-f]{8}-[A-Za-z0-9_-]+$/.test(code), `Copy code makes a code (${code.length} chars)`);
  const keep = await E(() => { const g = window.__game.game, o = g.octopus; return { seed: g.world.seed, x: o.x, z: o.z, crab: g.inv.count('crab') }; });
  // forget everything, then paste
  await noAutosave(); await E((k) => localStorage.removeItem(k), KEY);
  await load();
  const other = await E(() => window.__game.seed);
  ok(other === keep.seed && other === 45, 'a fresh browser gets the same ONE world (seed 45): the world is not per-player');
  await page.click('#play'); await sleep(200);
  await pauseMenu();
  await page.click('#chip-paste'); await sleep(100);
  const shown = await E(() => !document.getElementById('code-in').hidden);
  ok(shown, 'Paste code shows a small box');
  await page.type('#code-in', 'OCTO1-deadbeef-nonsense'); await page.keyboard.press('Enter'); await sleep(300);
  const shook = await E(() => document.getElementById('code-in').classList.contains('shake') && window.__game.seed !== undefined);
  ok(shook, 'a wrong code just shakes the box (no message)');
  await E((c) => { const i = document.getElementById('code-in'); i.value = c; i.dispatchEvent(new Event('paste')); }, code);
  await page.waitForFunction((s) => window.__game.seed === s, { timeout: 60000 }, keep.seed);
  await sleep(300);
  const p = await E(() => { const g = window.__game.game, o = g.octopus; return { seed: g.world.seed, x: o.x, z: o.z, crab: g.inv.count('crab'), state: g.state, paused: g.paused, loading: !document.getElementById('loading').hidden }; });
  ok(p.seed === keep.seed && Math.abs(p.x - keep.x) < 0.5 && p.crab === keep.crab && p.state === 'playing' && !p.loading, 'a pasted code rebuilds that world and carries on');
}

// ================================================================ a save from the previous (per-seed world) game is carried into the one world
{
  await noAutosave();
  await E(() => localStorage.clear());
  await E(() => localStorage.setItem('octo.save.v1', JSON.stringify({
    v: 1, seed: 2026, saved: 1700000000000, octo: { x: 120.5, z: -33.25, heading: 1.2, health: 61.5, energy: 40 }, run: 812.4, sea: true,
    shells: { n: 3, o: [4], r: [] }, babies: ['0', '1'], inv: { counts: { crab: 2, kelp: 3, shield: 1 }, seen: ['crab', 'kelp', 'shield'], made: ['shield'] },
    fx: { buff: { shield: 0, jar: 0, kelp: 40, mimic: 0, feast: 0 }, ink: 2, venom: true }, dens: [{ x: 10, z: 20 }], got: ['o12'], explored: [50005000],
    env: { t: 0.5, abs: 900, kind: 'clear', target: 'clear', timer: 55, heat: 0, rain: 0, dark: 0 },
  })));
  await load();
  const r = await E((k) => ({ seed: window.__game.seed, state: window.__game.state, legacy: localStorage.getItem('octo.save.v1'), cur: localStorage.getItem(k) !== null }), KEY);
  ok(r.seed === 45 && r.state === 'menu' && r.legacy === null && r.cur, 'an old v1 save loads into the one world, is re-saved as v2 and the old key is removed');
  await page.click('#play'); await sleep(400);
  const p = await E(() => { const g = window.__game.game, o = g.octopus, w = g.world; return { x: o.x, z: o.z, sx: w.start.x, sz: w.start.z, crab: g.inv.count('crab'), kelp: g.inv.count('kelp'), shield: g.inv.count('shield'), babies: g.progress.rescued.size, shells: g.progress.shells, ink: o.inkCharges, venom: o.venomReady, kelpBuff: o.buff.kelp, state: g.state, dens: g.abilities.dens.length, run: g.runTime }; });
  ok(p.state === 'playing' && Math.hypot(p.x - p.sx, p.z - p.sz) < 1 && Math.hypot(p.x - 120.5, p.z + 33.25) > 5, 'the old position is gone: the octopus begins at a start point of the one world');
  ok(p.crab === 2 && p.kelp === 3 && p.shield === 1 && p.ink === 2 && p.venom === true && p.kelpBuff > 30 && p.babies === 2 && p.shells === 3 && p.dens === 0 && p.run > 800, 'but the satchel, effects, babies, shells and clock were kept');
  await E(() => { const g = window.__game.game; g.setPaused(true); });
  const v2 = await saved(); ok(v2 && v2.v === 3 && v2.fresh !== true && Number.isFinite(v2.octo.x), 'the next autosave is a normal v2 save with a position');
}

// ================================================================ damaged / future saves, new start, death
{
  await noAutosave(); await E((k) => localStorage.setItem(k, '{"v":1,"seed":"oops'), KEY);
  await load();
  const r = await E((k) => ({ seed: window.__game.seed, state: window.__game.state, key: localStorage.getItem(k) }), KEY);
  ok(r.state === 'menu' && Number.isInteger(r.seed) && r.key === null, 'a damaged save is ignored: a new world starts and the junk is dropped');
  await noAutosave(); await E((k) => localStorage.setItem(k, JSON.stringify({ v: 99, seed: 5, octo: { x: 1, z: 1 } })), KEY);
  await load();
  const f = await E((k) => ({ seed: window.__game.seed, key: localStorage.getItem(k) !== null }), KEY);
  ok(f.seed !== 5 && f.key, 'a save from a newer game is not used and not deleted');
  // ?seed= never touches the saved game
  await noAutosave(); await E((k) => localStorage.setItem(k, JSON.stringify({ v: 2, seed: 4242, octo: { x: 0, z: 0 } })), KEY);
  await load('?seed=2026');
  await page.click('#play'); await sleep(200);
  await E(() => window.__game.game.setPaused(true));
  const k1 = await E((k) => ({ seed: window.__game.seed, saved: JSON.parse(localStorage.getItem(k)).seed }), KEY);
  ok(k1.seed === 2026 && k1.saved === 4242, '?seed= worlds neither load nor overwrite the real save');
  // New world clears it
  await load();
  const cur = await E(() => window.__game.seed);
  ok(cur === 4242, 'with no ?seed= the saved world is the one that loads');
  await page.click('#play'); await sleep(200);
  await pauseMenu();
  await page.click('#chip-new');
  await page.waitForFunction((s) => window.__game.seed !== s && window.__game.state === 'playing', { timeout: 60000 }, cur);
  await sleep(300);
  const nw = await E((k) => ({ key: localStorage.getItem(k), seed: window.__game.seed }), KEY);
  ok(nw.key === null || JSON.parse(nw.key).seed !== cur, 'New start replaces the old save');
  // death clears it
  await page.waitForFunction(() => document.getElementById('loading').hidden && window.__game.state === 'playing');
  await E(() => { const g = window.__game.game; g.setPaused(false); g.saveNow('t'); });
  const has = await E((k) => localStorage.getItem(k) !== null, KEY);
  await E(() => { const G = window.__game; G.setHealth(1); G.game.octopus.damage(50, 'dry', { ignoreCamo: true }); G.advance(3); });
  const dead = await E((k) => ({ state: window.__game.state, key: localStorage.getItem(k) }), KEY);
  ok(has && dead.state === 'dead' && dead.key === null, `dying ends the run: the save is cleared (had one: ${has}, state ${dead.state}, key ${dead.key ? 'kept' : 'cleared'})`);
}
ok(problems.length === 0, 'no console errors or warnings' + (problems.length ? '\n' + problems.slice(0, 6).join('\n') : ''));
console.log(failed ? `${failed} check(s) FAILED` : 'all save checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
