// Levels, badges, day/night and weather in the running game (headless Chrome). Run after `npm run build`:   node scripts/levels.mjs
//   SHOTS=1 also writes screenshots to /workspace/octo-v6-*.png
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
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `/workspace/octo-v6-${name}.png` }); };
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
  const s = await E(() => ({ all: document.querySelectorAll('#satchel .badge').length, got: document.querySelectorAll('#satchel .badge.got').length, txt: document.getElementById('satchel').innerText.replace(/\d+/g, '').trim() }));
  ok(s.all >= 15 && s.got >= 1 && s.got < s.all, `the satchel shows the badges as tokens (${s.got} earned of ${s.all}; the rest are silhouettes)`);
  ok(!/[a-z]{3,}/i.test(s.txt), 'no words in the satchel');
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
  const r = await E(async () => { const G = window.__game, g = G.game, o = g.octopus; G.setTime(0.45); G.setWeather('rain'); g.env.rain = 0.7; g.env.apply(); o.health = 50; G.advance(3); return { h: o.health, raining: g.world.raining }; });
  ok(r.raining && r.h > 50, `rain showers top the octopus up (moisture 50 -> ${r.h.toFixed(1)})`);
  await frames(4); await shot('rain');
  const h = await E(() => { const G = window.__game, g = G.game; G.setWeather('clear'); g.env.rain = 0; g.env.heat = 0; g.env.apply(); const a = g.world.dryMult; G.setWeather('heatwave'); g.env.heat = 1; g.env.apply(); return { a, b: g.world.dryMult }; });
  ok(h.b > h.a * 1.3, 'a hot spell dries the octopus faster');
  await E(() => { const G = window.__game, g = G.game; G.setWeather('clear'); g.env.heat = 0; g.env.apply(); });
}
ok(problems.length === 0, `no page errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall levels / badges / day-night / weather checks passed');
process.exit(failed ? 1 : 0);
