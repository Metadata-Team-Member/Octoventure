// Levels, badges, day/night and weather in the running game (headless Chrome). Run after `npm run build`:   node scripts/levels.mjs
//   SHOTS=1 also writes screenshots to $SHOTDIR (default: the system temp dir) as octo-*.png
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failed++; };
const SHOTS = !!process.env.SHOTS;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?seed=2026', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
const E = (f, ...a) => page.evaluate(f, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = async (n) => { const f0 = await E(() => window.__game.frame); await page.waitForFunction((t) => window.__game.frame >= t, { timeout: 120000 }, f0 + n); };
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${process.env.SHOTDIR || (await import('node:os')).tmpdir()}/octo-${name}.png` }); };
await E(() => { const G = window.__game; G.clearPredators(); G.freezeTime(true); G.setTime(0.42); G.setWeather('clear'); });
await sleep(400);

// ---- levelling: felt, never shown
{
  const a = await E(() => { const G = window.__game, o = G.game.octopus; return { lv: G.levels.level, sz: o.sz, gs: o.group.scale.x, hud: document.body.innerText.match(/\b(level|xp|badge)\b/i) }; });
  ok(a.lv === 1 && !a.hud, 'a new game starts at level 1, with no level / xp words anywhere on screen');
  await E(() => { window.__game.giveXP(60); window.__game.advance(0.1); });
  const b = await E(() => { const G = window.__game, o = G.game.octopus; return { lv: G.levels.level, sh: G.shimmerActive, sz: o.sz, gs: o.group.scale.x, dry: o.perkDry, txt: document.body.innerText.match(/\b(level|xp)\b/i) }; });
  ok(b.lv === 2 && b.sh, 'a level-up plays the shimmer around the octopus');
  ok(b.sz === a.sz && Math.abs(b.gs - a.gs) < 1e-6, 'the octopus never changes size when it levels up');
  ok(b.dry < 1 && !b.txt, 'a small hidden perk applies (drying a little slower) and still nothing is written on screen');
  await frames(6); await shot('levelup-shimmer');
  // explore: new ground gives experience
  const x0 = await E(() => window.__game.levels.xp);
  await E(() => { const G = window.__game, o = G.game.octopus; G.teleport(o.x + 260, o.z + 260); G.advance(0.2); });
  const x1 = await E(() => window.__game.levels.xp);
  ok(x1 > x0, `exploring new ground gives experience (${x0} -> ${x1})`);
  const f0 = await E(() => { const G = window.__game; G.give('shrimp', 2); G.craft('inksac'); return { c: G.levels.st.crafted, b: G.levels.badges.has('craft1') }; });
  ok(f0.c === 1 && f0.b, 'crafting counts and earns the first-craft badge');
}
// ---- badges in the satchel
{
  await E(() => window.__game.advance(0.1));
  await page.keyboard.press('Tab'); await sleep(300);
  const s = await E(() => { window.__game.game.satchel.hideTip(); return { all: document.querySelectorAll('#satchel .badge').length, got: document.querySelectorAll('#satchel .badge.got').length, txt: document.querySelector('#satchel .sat-panel').innerText.replace(/\d+/g, '').trim(), lv: document.querySelector('#satchel .sat-level')?.textContent }; });
  ok(s.all >= 15 && s.got >= 1 && s.got < s.all, `the satchel shows the badges as tokens (${s.got} earned of ${s.all}; the rest are silhouettes)`);
  ok(!/[a-z]{3,}/i.test(s.txt), 'no words in the satchel until a tooltip is shown');
  const lv = await E(() => document.querySelector('#satchel .sat-level')?.textContent);
  ok(Number(lv) >= 2, `the satchel shows the current level in the ring (${lv})`);
  await shot('satchel-badges');
  await page.keyboard.press('Tab'); await sleep(600);
  await E(() => window.__game.game.setPaused(false));
}
// ---- the save carries levels
{
  const sv = await E(() => { const G = window.__game.game; return JSON.parse(JSON.stringify((G.levels.toJSON()))); });
  ok(sv.xp > 60 && sv.b.includes('craft1'), 'levels and badges are part of the save');
}
// ---- day / night and weather
{
  const d = await E(() => { const G = window.__game, g = G.game; G.setTime(0.5); g.env.apply(); const day = g.world.dryMult; G.setTime(0.0); g.env.apply(); G.advance(0.2); return { day, night: g.world.night, nd: g.world.dryMult }; });
  ok(d.night > 0.9 && d.nd < d.day * 0.7, `nights are dark and cool: the octopus dries slower (${d.nd.toFixed(2)} vs ${d.day.toFixed(2)})`);
  const ff = await E(() => { const g = window.__game.game; return g.atmo.fireflies ? g.atmo.fireflies.material.opacity : -1; });
  ok(ff > 0, 'fireflies come out at night');
  await frames(4); await shot('night');
  const r = await E(async () => { const G = window.__game, g = G.game, o = g.octopus; G.clearPredators(); o.alive = true; o.hiddenIn = null; o.tunnel = null; G.setTime(0.45); G.setWeather('rain'); g.env.rain = 0.7; g.env.apply(); o.health = 50; G.advance(3); return { h: o.health, raining: g.world.raining }; });
  ok(r.raining && r.h > 50, `rain showers top the octopus up (moisture 50 -> ${r.h.toFixed(1)})`);
  await frames(4); await shot('rain');
  const h = await E(() => { const G = window.__game, g = G.game; G.setWeather('clear'); g.env.rain = 0; g.env.heat = 0; g.env.apply(); const a = g.world.dryMult; G.setWeather('heatwave'); g.env.heat = 1; g.env.apply(); return { a, b: g.world.dryMult }; });
  ok(h.b > h.a * 1.3, 'a hot spell dries the octopus faster');
  await E(() => { const G = window.__game, g = G.game; G.setWeather('clear'); g.env.heat = 0; g.env.apply(); });
}
// ---- new biomes, critters and the sea arrival (t241u)
{
  const b = await E(() => { const G = window.__game; const r = {}; for (const n of ['desert', 'rainforest']) { r[n] = G.teleportToBiome(n) && G.biomeAt(G.game.octopus.x, G.game.octopus.z) === n; G.advance(0.6); r[n + 'Badge'] = G.levels.badges.has(n); } return r; });
  ok(b.desert && b.rainforest, 'the red desert and the rainforest gully exist in the one world');
  ok(b.desertBadge && b.rainforestBadge, 'visiting them earns their badges');
  const c = await E(() => { const G = window.__game; G.teleportToBiome('desert'); G.advance(6); return G.critters; });
  ok(c.skinks > 0 && c.trails > 0, `harmless critters live around the octopus (desert: ${c.skinks} skinks, ${c.trails} ant trails)`);
  const f = await E(() => { const G = window.__game; G.teleportToBiome('wetland'); G.advance(8); return G.critters; });
  ok(f.flies > 0, `dragonflies hover over the wetland (${f.flies})`);
  const cb = await E(() => { const G = window.__game; G.teleportToBiome('beach'); G.advance(10); return G.critters; });
  ok(cb.crabs > 0, `ghost crabs scuttle over the beach (${cb.crabs})`);
  const fr = await E(() => { const G = window.__game; G.setTime(0.45); G.setWeather('clear'); G.teleportToBiome('wetland'); G.advance(10); return G.critters; });
  ok(fr.frogs > 0, `frogs hop about the wetland (${fr.frogs})`);
  const hm = await E(() => { const G = window.__game; G.teleportToBiome('beach'); G.advance(10); return G.critters; });
  ok(hm.hermits > 0, `hermit crabs live on the beach (${hm.hermits})`);
  const bw = await E(() => { const G = window.__game; G.setTime(0.45); G.teleportToBiome('rainforest'); G.advance(12); return G.critters; });
  ok(bw.butterflies > 0 && bw.wrens > 0, `butterflies and fairy-wrens live in the rainforest (${bw.butterflies} butterflies, ${bw.wrens} wrens)`);
  const s = await E(() => { const G = window.__game, g = G.game; g.progress.seaReached = false; g.seaMoment = null; G.teleportToOcean(4); for (let i = 0; i < 25 && !g.seaMoment; i++) G.advance(0.1); const a = { sea: g.progress.seaReached, beat: G.seaBeatActive, badge: g.levels.badges.has('sea'), state: g.state }; for (let i = 0; i < 40 && g.seaMoment; i++) G.advance(0.25); a.after = G.seaBeatActive; a.state2 = g.state; return a; });
  ok(s.sea && s.beat && s.badge, 'reaching the sea plays the underwater moment and earns the sea badge');
  ok(!s.after && s.state2 === 'playing', 'then play simply continues');
}
// ---- tide-and-sun dial and night plankton (t254u)
{
  const c = await E(() => { const G = window.__game, g = G.game; g.closeSatchel(); g.setPaused(false); G.setTime(0.5); g.env.apply(); G.advance(0.05); const el = document.getElementById('clock'); const sun = el.querySelector('.tc-sun'); return { hidden: el.hidden, sunOp: getComputedStyle(sun).opacity, hasTide: !!el.querySelector('.tc-tide') }; });
  ok(!c.hidden && +c.sunOp > 0.5 && c.hasTide, 'at midday the tide-and-sun dial is visible with the sun on the arc');
  const n = await E(() => { const G = window.__game, g = G.game; G.setTime(0.02); g.env.apply(); G.advance(0.05); const el = document.getElementById('clock'); const moon = el.querySelector('.tc-moon'); return { moonOp: getComputedStyle(moon).opacity, sunOp: getComputedStyle(el.querySelector('.tc-sun')).opacity }; });
  ok(+n.moonOp > 0.5 && +n.sunOp < 0.5, 'at night the moon travels the arc instead');
  const h = await E(() => { const G = window.__game; G.game.openSatchel(); const hide = document.getElementById('clock').hidden; G.game.closeSatchel(); if (G.game.paused) { G.game.paused = false; } G.game.setPaused(false); return hide; });
  ok(h, 'the dial hides while the satchel is open');
  const p = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    G.teleportToOcean(8); G.setTime(0.0); g.env.apply(); G.advance(0.4);
    const pl = g.plankton; return { on: pl && pl.active, biome: g.world.biomeAt(o.x, o.z), night: g.world.night, op: pl?.mat.opacity || 0 };
  });
  ok(p.night > 0.7 && p.on && p.op > 0, `bioluminescent plankton glows in the night sea (biome ${p.biome}, opacity ${p.op.toFixed(2)})`);
}
ok(problems.length === 0, `no page errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall levels / badges / day-night / weather checks passed');

process.exit(failed ? 1 : 0);
