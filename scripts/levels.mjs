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
// ---- the skink model (on the ground, walk while moving, threat before the dart; rats stay procedural)
{
  await page.waitForFunction(() => window.__game.game.critters.skinkReady || window.__game.game.critters.skinkError, { timeout: 20000 });
  const k = await E(() => {
    const G = window.__game, g = G.game, C = g.critters, o = g.octopus, w = g.world;
    G.clearPredators(); G.setWeather('clear'); g.env.rain = 0; g.env.apply(); G.setTime(0.45);
    G.teleportToBiome('desert');
    for (let i = 0; i < 90 && C.counts().skinks < 1; i++) G.advance(0.1);
    const target = C.sk.find((c) => c.on && c.as !== 'rat') || C.sk.find((c) => c.on);
    const id = target ? C.sk.indexOf(target) : -1;
    const settle = (c, extra = {}) => {
      c.t = 40; c.run = 0; c.walk = 0; c.cur = 0; c.bask = 0; c.threat = 0; c.flick = 0; c.launched = 0; c.sp = 0;
      Object.assign(c, extra);
    };
    const only = () => { if (target) for (const c of C.sk) if (c !== target) c.on = false; };
    if (target) {
      only();
      G.teleport(target.x + 3, target.z);
      o.speed = 0;
      settle(target, { bask: 2 });
      G.advance(0.35);
    }
    const sit = C.skinkProbe();
    const sitter = sit.samples.find((s) => s.i === id) || null;
    if (target) { only(); settle(target, { walk: 1.6, bask: 0 }); }
    G.advance(0.35);
    const moving = C.skinkProbe();
    const walker = moving.samples.find((s) => s.i === id && s.sp > 0) || null;
    if (target) {
      only();
      settle(target);
      G.teleport(target.x + 1.2, target.z);
      o.speed = 0;
    }
    G.advance(0.2);
    const scared = C.skinkProbe();
    const gaping = scared.samples.find((s) => s.i === id) || null;
    const journal = g.journal.has('skink');
    const hover = sit.samples.filter((s) => s.as === 'skink').reduce((m, s) => Math.max(m, Math.abs(s.meshY - s.ground)), 0);
    G.setTime(0.45); G.teleportToBiome('wasteland');
    for (let i = 0; i < 80; i++) G.advance(0.1);
    const rats = C.skinkProbe();
    G.setTime(0.02); g.env.apply();
    for (let i = 0; i < 80; i++) G.advance(0.1);
    const packed = C.counts().skinks;
    G.setTime(0.45); G.setWeather('clear'); g.env.rain = 0; g.env.apply();
    return { sit, sitter, walker, gaping, journal, hover, rats, packed, n: sit.samples.length };
  });
  ok(k.sit.ready && !k.sit.error && ['idle', 'walk', 'bask', 'threat', 'tongueFlick'].every((n) => k.sit.clips.includes(n)), `the skink model loaded (${k.sit.clips.join('+') || k.sit.error})`);
  ok(Math.abs(k.sit.dur.idle - 3) < 0.05 && Math.abs(k.sit.dur.walk - 0.833) < 0.02 && Math.abs(k.sit.dur.bask - 3) < 0.05 && Math.abs(k.sit.dur.threat - 1) < 0.02 && Math.abs(k.sit.dur.tongueFlick - 0.417) < 0.02, `idle 3s, walk 0.83s, bask 3s, threat 1s, tongueFlick 0.42s (${k.sit.dur.idle}, ${k.sit.dur.walk}, ${k.sit.dur.bask}, ${k.sit.dur.threat}, ${k.sit.dur.tongueFlick})`);
  ok(k.sit.tris > 3000 && k.sit.farTris > 40 && k.sit.farTris < 500, `the skink uses the glb (${k.sit.tris} tris) and a cheap stand-in (${k.sit.farTris})`);
  ok(k.sit.minY > -0.01 && k.sit.minY < 0.01, `the skink origin is on the ground (min y ${k.sit.minY.toFixed(4)})`);
  ok(k.sitter && k.hover < 0.03 && k.sitter.scale === 1 && k.sitter.skinned && (k.sitter.clip === 'bask' || k.sitter.clip === 'idle'), `skinks sit on heightAt (${k.sitter ? k.sitter.clip + ' off ' + k.hover.toFixed(4) : 'none'})`);
  ok(k.walker && k.walker.skinned && k.walker.clip === 'walk' && k.walker.scale === 1 && Math.abs(k.walker.timeScale - k.walker.sp / 0.5) < 0.08, `walk plays while moving (${k.walker ? k.walker.clip + ' sp ' + k.walker.sp.toFixed(2) + ' x' + k.walker.timeScale.toFixed(2) : 'none'})`);
  ok(k.gaping && k.gaping.skinned && k.gaping.clip === 'threat' && k.gaping.threat > 0 && k.gaping.run === 0, `threat plays on a scare before the dart (${k.gaping ? k.gaping.clip + ' threat ' + k.gaping.threat.toFixed(2) + ' run ' + k.gaping.run : 'none'})`);
  ok(k.journal, 'skinks still fill the field journal');
  ok(k.rats.rats > 0 && k.rats.ratMesh === k.rats.rats && k.rats.samples.filter((s) => s.as === 'rat').every((s) => s.procedural && !s.skinned), `wasteland rats keep the procedural mesh (${k.rats.rats} rats, mesh ${k.rats.ratMesh})`);
  ok(k.packed === 0, `skinks pack up at night (${k.packed} left)`);
}
// ---- the wren model (on the ground, hop and fly, female map, waders stay procedural)
{
  await page.waitForFunction(() => window.__game.game.critters.wrenReady || window.__game.game.critters.wrenError, { timeout: 20000 });
  const w = await E(() => {
    const G = window.__game, g = G.game, C = g.critters, o = g.octopus, world = g.world;
    G.clearPredators(); G.setWeather('clear'); g.env.rain = 0; g.env.apply(); G.setTime(0.45);
    if (g.audio) g.audio.timers.bird = 999;
    G.teleportToBiome('bush');
    for (let i = 0; i < 90 && C.counts().wrens < 1; i++) G.advance(0.1);
    const anchor = C.wr.find((c) => c.on) || C.wr[0];
    const male = C.wr[0], female = C.wr[1];
    const hy = world.heightAt(anchor.x, anchor.z);
    const placeAt = (c, x, z) => {
      c.on = true; c.as = 'wren'; c.x = x; c.z = z; c.y = world.heightAt(x, z); c.g = c.y;
      c.h = 0.4; c.hop = 0; c.fly = 0; c.peck = 0; c.song = 0; c.launched = 0; c.t = 40;
      c.tx = x; c.tz = z; c.ty = c.y;
    };
    for (const c of C.wr) c.on = false;
    placeAt(male, anchor.x, anchor.z);
    placeAt(female, anchor.x + 0.35, anchor.z);
    G.teleport(male.x + 4, male.z);
    o.speed = 0;
    G.advance(0.35);
    placeAt(male, male.x, male.z);
    placeAt(female, female.x, female.z);
    G.advance(0.08);
    const sit = C.wrenProbe();
    const sitter = sit.samples.find((s) => s.i === 0);
    const hen = sit.samples.find((s) => s.i === 1);
    placeAt(male, male.x, male.z);
    male.hop = 1; male.launched = 1;
    for (const c of C.wr) if (c !== male) c.on = false;
    G.advance(0.12);
    const hopping = C.wrenProbe();
    const hopper = hopping.samples.find((s) => s.i === 0);
    placeAt(male, male.x, male.z);
    male.fly = 1; male.launched = 1;
    male.tx = male.x + 3; male.tz = male.z; male.ty = world.heightAt(male.x, male.z) + 0.7;
    G.advance(0.12);
    const flying = C.wrenProbe();
    const flier = flying.samples.find((s) => s.i === 0);
    const hover = sit.samples.filter((s) => s.as === 'wren' && s.fly <= 0 && s.hop <= 0).reduce((m, s) => Math.max(m, Math.abs(s.meshY - s.ground)), 0);
    const journal = g.journal.has('wren');
    G.teleportToBiome('mudflat');
    G.setTime(0.45); G.setWeather('clear');
    for (let i = 0; i < 90; i++) G.advance(0.1);
    const mud = C.wrenProbe();
    return { sit, sitter, hen, hopper, flier, hover, journal, mud, hy };
  });
  ok(w.sit.ready && !w.sit.error && ['idle', 'hop', 'fly', 'peck', 'song'].every((n) => w.sit.clips.includes(n)), `the wren model loaded (${w.sit.clips.join('+') || w.sit.error})`);
  ok(Math.abs(w.sit.dur.idle - 2.5) < 0.05 && Math.abs(w.sit.dur.hop - 0.333) < 0.02 && Math.abs(w.sit.dur.fly - 0.417) < 0.02 && Math.abs(w.sit.dur.peck - 0.5) < 0.02 && Math.abs(w.sit.dur.song - 1) < 0.02, `idle 2.5s, hop 0.33s, fly 0.42s, peck 0.5s, song 1s (${w.sit.dur.idle}, ${w.sit.dur.hop}, ${w.sit.dur.fly}, ${w.sit.dur.peck}, ${w.sit.dur.song})`);
  ok(w.sit.tris > 2000 && w.sit.farTris > 40 && w.sit.farTris < 500, `the wren uses the glb (${w.sit.tris} tris) and a cheap stand-in (${w.sit.farTris})`);
  ok(w.sit.minY > -0.01 && w.sit.minY < 0.01, `the wren origin is on the ground (min y ${w.sit.minY.toFixed(4)})`);
  ok(w.sitter && w.hover < 0.03 && w.sitter.scale === 1 && w.sitter.skinned && w.sitter.clip === 'idle', `wrens sit on heightAt (${w.sitter ? w.sitter.clip + ' off ' + w.hover.toFixed(4) : 'none'})`);
  ok(w.hopper && w.hopper.skinned && w.hopper.clip === 'hop' && w.hopper.hop > 0.2 && w.hopper.scale === 1, `hop plays while hopping (${w.hopper ? w.hopper.clip + ' hop ' + w.hopper.hop.toFixed(2) : 'none'})`);
  ok(w.flier && w.flier.skinned && w.flier.clip === 'fly' && w.flier.fly > 0 && w.flier.meshY > w.flier.ground + 0.05, `fly plays during a flit (${w.flier ? w.flier.clip + ' y ' + w.flier.meshY.toFixed(2) : 'none'})`);
  ok(w.hen && w.hen.female && w.hen.skinned && w.hen.femaleMap && w.hen.body === 'body' && w.hen.flipY === false && w.hen.colorSpace === 'srgb' && w.sitter && !w.sitter.femaleMap && w.sitter.flipY === false, `female plumage swaps the body map (${w.hen ? w.hen.colorSpace + ' flipY ' + w.hen.flipY : 'none'})`);
  ok(w.sit.femaleFlipY === false && w.sit.maleFlipY === false && w.sit.femaleSpace === 'srgb' && w.sit.maleSpace === 'srgb', 'both plumage maps stay sRGB and unflipped');
  ok(w.journal, 'wrens still fill the field journal');
  ok(w.mud.waders > 0 && w.mud.waderMesh === w.mud.waders && w.mud.samples.filter((s) => s.as === 'wader').every((s) => s.procedural && !s.skinned), `mudflat waders keep the procedural mesh (${w.mud.waders} waders, mesh ${w.mud.waderMesh})`);
}
ok(problems.length === 0, `no page errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall levels / badges / day-night / weather checks passed');

process.exit(failed ? 1 : 0);
