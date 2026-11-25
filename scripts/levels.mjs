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
// ---- the ant model (walk / idle, on the ground, not every ant simulating)
{
  await page.waitForFunction(() => window.__game.game.critters.antReady || window.__game.game.critters.antError, { timeout: 20000 });
  const a = await E(() => {
    const G = window.__game, g = G.game, C = g.critters, o = g.octopus;
    G.clearPredators(); G.setWeather('clear'); g.env.rain = 0; g.env.apply();
    G.teleportToBiome('desert'); C.antPace = 1; G.advance(6);
    const tr = C.tr.find((t) => t.on);
    if (tr) { G.teleport(tr.x, tr.z); o.speed = 0; }
    G.advance(0.8);
    const march = C.antProbe();
    const journal = g.journal.has('ant');
    C.antPace = 0; G.advance(0.45);
    const held = C.antProbe();
    C.antPace = 1; G.advance(0.45);
    const again = C.antProbe();
    g.env.rain = 1; G.setWeather('storm'); g.env.apply(); G.advance(4);
    const packed = C.counts().trails;
    C.antPace = 1; g.env.rain = 0; G.setWeather('clear'); g.env.apply();
    const ground = march.samples.reduce((m, s) => Math.max(m, Math.abs(s.y - s.ground)), 0);
    const face = march.samples.reduce((m, s) => Math.max(m, s.face), 0);
    return { march, held, again, journal, packed, ground, face, trails: C.counts().trails };
  });
  ok(a.march.ready && !a.march.error && a.march.clips.includes('walk') && a.march.clips.includes('idle'), `the ant model loaded (${a.march.clips.join('+') || a.march.error})`);
  ok(Math.abs(a.march.dur.walk - 0.5) < 0.05 && Math.abs(a.march.dur.idle - 2) < 0.05, `walk is a 0.5 s loop and idle is 2 s (${a.march.dur.walk}, ${a.march.dur.idle})`);
  ok(a.march.tris > 1000 && a.march.farTris > 0 && a.march.farTris < 180, `the trail uses the glb (${a.march.tris} tris) and a cheap stand-in (${a.march.farTris} tris)`);
  ok(a.march.samples.length > 0 && a.march.samples.every((s) => s.scale === 1) && Math.abs(a.march.instScale - 1) < 1e-5, `ants use scale 1 (mesh ${a.march.samples[0]?.scale}, stand-in ${a.march.instScale})`);
  ok(a.ground < 0.05, `ants sit on the ground (${a.ground.toFixed(3)} u off heightAt)`);
  ok(a.face < 0.05, `ants face along the trail (${a.face.toFixed(3)} rad)`);
  ok(a.march.simulating > 0 && a.march.simulating <= a.march.cap && a.march.simulating < 100 && a.march.instanced > 0, `only nearby ants simulate (${a.march.simulating} mixers, cap ${a.march.cap}, ${a.march.instanced} instanced)`);
  ok(a.march.walk > 0 && a.march.idle === 0, `marching ants play walk (${a.march.walk} walk, ${a.march.idle} idle)`);
  ok(a.held.idle > 0 && a.held.walk === 0, `stopped ants play idle (${a.held.walk} walk, ${a.held.idle} idle)`);
  ok(a.again.walk > 0, `the line walks again when it moves (${a.again.walk})`);
  ok(a.journal, 'ants count in the field journal');
  ok(a.packed === 0, `ants pack up in heavy rain (${a.packed} trails left)`);
}
// ---- the frog model (idle on the ground, hop while airborne, croak from the beat)
{
  await page.waitForFunction(() => window.__game.game.critters.frogReady || window.__game.game.critters.frogError, { timeout: 20000 });
  const f = await E(() => {
    const G = window.__game, g = G.game, C = g.critters, o = g.octopus;
    G.clearPredators(); G.setWeather('clear'); g.env.rain = 0; g.env.apply(); G.setTime(0.45);
    G.teleportToBiome('wetland');
    for (let i = 0; i < 80 && C.counts().frogs < 1; i++) G.advance(0.1);
    const frog = C.fr.find((c) => c.on);
    if (frog) G.teleport(frog.x + 8, frog.z);
    for (const c of C.fr) { c.t = 30; c.hop = 0; c.air = 0; c.croak = 0; c.flick = 0; c.launched = 0; }
    G.advance(0.4);
    const sit = C.frogProbe();
    const s0 = sit.samples.find((s) => s.skinned && s.air <= 0) || sit.samples.find((s) => s.air <= 0);
    const target = s0 ? C.fr[s0.i] : C.fr.find((c) => c.on);
    if (target) { target.hop = 1; target.air = 0; target.t = 30; }
    G.advance(0.22);
    const mid = C.frogProbe();
    const hopping = mid.samples.find((s) => s.air > 0.2);
    if (target) { target.air = 0; target.hop = 0; target.launched = 0; target.y = g.world.heightAt(target.x, target.z); }
    for (const c of C.fr) { c.t = 40; c.hop = 0; if (c.air > 0) { c.air = 0; c.y = g.world.heightAt(c.x, c.z); } c.croak = 0; c.flick = 0; }
    G.advance(0.25);
    const beat = g.audio.croakBeat;
    g.audio.croakBeat = beat + 1;
    G.advance(0.35);
    const sung = C.frogProbe();
    const sitSamples = sit.samples.filter((s) => s.air <= 0);
    const hover = sitSamples.reduce((m, s) => Math.max(m, Math.abs(s.meshY - (s.ground + (s.wet ? -0.02 : 0)))), 0);
    const journal = g.journal.has('frog');
    return { sit, mid, sung, hover, journal, hopping: hopping ? { air: hopping.air, clip: hopping.clip, skinned: hopping.skinned, scale: hopping.scale } : null, n: C.counts().frogs };
  });
  ok(f.sit.ready && !f.sit.error && ['idle', 'hop', 'croak', 'tongue'].every((n) => f.sit.clips.includes(n)), `the frog model loaded (${f.sit.clips.join('+') || f.sit.error})`);
  ok(Math.abs(f.sit.dur.idle - 2.5) < 0.05 && Math.abs(f.sit.dur.hop - 0.583) < 0.02 && Math.abs(f.sit.dur.croak - 0.79) < 0.03 && Math.abs(f.sit.dur.tongue - 0.29) < 0.03, `idle 2.5s, hop 0.58s, croak 0.79s, tongue 0.29s (${f.sit.dur.idle}, ${f.sit.dur.hop}, ${f.sit.dur.croak}, ${f.sit.dur.tongue})`);
  ok(f.sit.tris > 2000 && f.sit.farTris > 40 && f.sit.farTris < 400, `the frog uses the glb (${f.sit.tris} tris) and a cheap stand-in (${f.sit.farTris})`);
  ok(f.sit.minY > -0.01 && f.sit.minY < 0.01, `the frog origin is on the ground (min y ${f.sit.minY.toFixed(4)})`);
  ok(f.n > 0 && f.sit.samples.length > 0 && f.hover < 0.03, `frogs sit on heightAt (${f.n}, worst ${f.hover.toFixed(4)} u)`);
  ok(f.hopping && f.hopping.skinned && f.hopping.clip === 'hop' && f.hopping.scale === 1, `hop plays while airborne (${f.hopping ? f.hopping.clip + ' air ' + f.hopping.air.toFixed(2) : 'none'})`);
  ok(f.sung.croak > 0, `the croak beat plays croak on a frog (${f.sung.croak})`);
  ok(f.journal, 'frogs still fill the field journal');
}
ok(problems.length === 0, `no page errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall levels / badges / day-night / weather checks passed');

process.exit(failed ? 1 : 0);
