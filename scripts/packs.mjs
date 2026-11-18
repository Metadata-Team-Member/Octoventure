// Groups of animals (t257u): nobody interpenetrates (same species too), flocks spread out, landing / perching picks distinct
// spots, camouflage makes hunters search and disperse instead of stacking on the last-known point, at most two strike at
// once, every predator type runs approach -> anticipation -> strike -> recovery. Run after `npm run build`.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!chrome) { console.error('No Chrome found. Set CHROME_PATH.'); process.exit(2); }
const PLAY = process.env.PLAY || 'play/index.html';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 600 });
const problems = []; page.on('pageerror', (e) => problems.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)); });
await page.goto(pathToFileURL(resolve(PLAY)).href + '?nosave&seed=2026', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) fails++; };
const E = (f, ...a) => page.evaluate(f, ...a);
await E(() => {
  const G = window.__game, g = G.game;
  G.freezeTime(true); G.setTime(0.42); G.setWeather('clear');
  const R = { gull: 0.55, cat: 0.65, dog: 0.85, fox: 0.75, crab: 0.6, eagle: 1.5, human: 0.75, magpie: 0.55, kookaburra: 0.55 };
  // smallest centre distance / combined radii over every pair of living predators (3D for birds in the air)
  window.__gap = () => {
    const L = g.predators.list.filter((p) => !p.dead); let m = Infinity;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], ya = (a.alt || 0) + (a.lift || 0), yb = (b.alt || 0) + (b.lift || 0);
      m = Math.min(m, Math.hypot(a.x - b.x, a.z - b.z, ya - yb) / (R[a.kind] * a.scale + R[b.kind] * b.scale));
    }
    return m;
  };
  // run `sec` seconds, keeping the octopus alive and still; returns the worst gap, the most simultaneous strikers and state counts
  window.__sim = (sec, camo = false, after = 0.6) => {
    const o = g.octopus; let worst = Infinity, strikers = 0; const seen = {};
    if (camo) G.pressKey('Space'); else G.releaseKey('Space');
    for (let t = 0; t < sec; t += 1 / 30) {
      o.health = 100; o.energy = 100; o.camoLocked = false; if (!camo) o.camoBlend = 0;
      g.update(1 / 30);
      if (t > after) worst = Math.min(worst, window.__gap());
      let s = 0; for (const p of g.predators.list) { seen[p.state] = (seen[p.state] || 0) + 1; if (p.state === 'attack' || p.state === 'pounce') s++; }
      strikers = Math.max(strikers, s);
    }
    return { worst, strikers, seen };
  };
  window.__open = (biome) => { G.clearPredators(); G.teleportToBiome(biome); const o = g.octopus; o.health = 100; g.update(1 / 30); return { x: o.x, z: o.z }; };
});

// ---- 1. the reported bug: four+ gulls attack, the octopus camouflages, they must not land in one spot inside each other
{
  const r = await E(() => {
    const G = window.__game, g = G.game; window.__open('beach');
    const gulls = []; for (let i = 0; i < 5; i++) { const p = G.spawnPredator('gull', 7, 0.01 * i); p.ignore = 0; gulls.push(p); }   // spawned stacked on one spot
    const attack = window.__sim(5, false, 0.8);
    const camo = window.__sim(9, true, 0);
    // after the search: where did they settle?  spread = mean distance from their common centre
    const L = gulls.filter((p) => !p.dead); const cx = L.reduce((a, p) => a + p.x, 0) / L.length, cz = L.reduce((a, p) => a + p.z, 0) / L.length;
    const spread = L.reduce((a, p) => a + Math.hypot(p.x - cx, p.z - cz), 0) / L.length;
    const landed = L.filter((p) => (p.lift || 0) < 0.3).length;
    const heads = new Set(L.map((p) => Math.round(((p.heading % 6.283) + 6.283) % 6.283 * 2))).size;
    G.releaseKey('Space');
    return { attack, camo, spread, landed, n: L.length, heads, states: L.map((p) => p.state) };
  });
  ok(r.attack.worst >= 0.85, `5 gulls attacking from one spawn point never interpenetrate (worst gap ${r.attack.worst.toFixed(2)} x radii)`);
  ok(r.attack.strikers <= 2, `at most two strike at once, the rest wait their turn (max ${r.attack.strikers})`);
  ok(r.camo.worst >= 0.85, `after camo they search and land apart (worst gap ${r.camo.worst.toFixed(2)} x radii)`);
  ok(r.spread > 2.5, `they spread out instead of converging on the last-known point (mean spread ${r.spread.toFixed(1)} m; states ${r.states.join(',')})`);
  ok(r.heads >= 3, `they face different ways (${r.heads} distinct headings)`);
}
// ---- 2. a mixed pack: separation, turn-taking, every kind keeps its distance
{
  const r = await E(() => {
    const G = window.__game, g = G.game; window.__open('suburb');
    for (const [k, dx, dz] of [['cat', 5, 1], ['cat', 5, -1], ['dog', 6, 0], ['dog', -6, 0], ['fox', 0, 6], ['fox', 0, -6], ['human', -7, 3]]) { const p = G.spawnPredator(k, dx, dz); p.ignore = 0; p.state = 'chase'; p.chaseT = 0; }
    const a = window.__sim(8, false, 0.8);
    const b = window.__sim(6, true, 0);
    G.releaseKey('Space');
    return { a, b };
  });
  ok(r.a.worst >= 0.85, `mixed pack of 7 never interpenetrates (worst ${r.a.worst.toFixed(2)})`);
  ok(r.a.strikers <= 2, `mixed pack takes turns (max ${r.a.strikers} striking at once)`);
  ok(r.b.worst >= 0.85, `mixed pack stays apart while confused / searching / leaving (worst ${r.b.worst.toFixed(2)})`);
  ok((r.b.seen.leave || 0) + (r.b.seen.search || 0) + (r.b.seen.confused || 0) > 0, `camo makes them give up: ${JSON.stringify(r.b.seen)}`);
}
// ---- 3. perching birds that share a tree pick their own branches
{
  const r = await E(() => {
    const G = window.__game, g = G.game; window.__open('bush');
    const a = G.spawnPredator('magpie', 30, 30), b = G.spawnPredator('magpie', 30, 30), c = G.spawnPredator('kookaburra', 30, 30);
    for (const p of [a, b, c]) { p.home = { x: a.x, z: a.z }; p.ignore = 99; }
    const s = window.__sim(4, false, 2.5);
    return { worst: s.worst, st: [a.state, b.state, c.state] };
  });
  ok(r.worst >= 0.85, `three birds sharing one perch tree sit apart (worst ${r.worst.toFixed(2)}; ${r.st.join(',')})`);
}
// ---- 4. every predator type: approach -> anticipation -> strike -> recovery; camo breaks it off
for (const kind of ['gull', 'cat', 'dog', 'fox', 'crab', 'human', 'magpie', 'kookaburra', 'eagle', 'snake', 'goanna', 'heron']) {
  const r = await E((kind) => {
    const G = window.__game, g = G.game, o = g.octopus;
    const biome = kind === 'crab' || kind === 'gull' ? 'beach' : kind === 'eagle' ? 'farm' : kind === 'goanna' ? 'desert' : kind === 'heron' ? 'wetland' : kind === 'human' || kind === 'cat' ? 'suburb' : 'bush';
    window.__open(biome);
    G.freezeTime(true); G.setTime(0.5); G.setWeather('clear');
    const p = G.spawnPredator(kind, kind === 'eagle' ? 20 : 5, 0); p.ignore = 0; p.cool = 0; if (p.spec.swoop) { p.home = { x: o.x + 3, z: o.z }; p.perchOff = { x: 0, z: 0 }; p.x = o.x + 3; p.z = o.z; }
    const states = []; let wound = false, hit = false, hp = 0;
    const dmg0 = o.damage; o.damage = function (n, cause, opts) { if (cause === kind && !this.camoProtected) { hit = true; hp = n; } return dmg0.call(this, n, cause, opts); };
    G.releaseKey('Space');
    for (let t = 0; t < 14 && !hit; t += 1 / 30) {
      o.health = 100; o.energy = 100; o.camoBlend = 0;          // standing still would slowly blend in (passive camo): keep it visible here
      if (p.state === 'carry') hit = true;                       // a person scooping it into a bucket is that strike
      g.update(1 / 30);
      if (states[states.length - 1] !== p.state) states.push(p.state);
      if (p.windup > 0) wound = true;
    }
    for (let t = 0; t < 0.7; t += 1 / 30) { o.health = 100; o.camoBlend = 0; g.update(1 / 30); if (states[states.length - 1] !== p.state) states.push(p.state); }
    const rec = p.recover > 0 || ['climb', 'chase', 'home', 'stalk', 'carry', 'leave'].includes(p.state);
    // then camouflage: it must break off
    G.pressKey('Space'); const before = p.state; for (let t = 0; t < 3; t += 1 / 30) { o.health = 100; o.energy = 100; g.update(1 / 30); if (states[states.length - 1] !== p.state) states.push(p.state); }
    G.releaseKey('Space'); o.damage = dmg0; G.freezeTime(false);
    return { states, wound, hit, hp, rec, end: p.state, before };
  }, kind);
  const stalker = kind === 'cat' || kind === 'snake' || kind === 'heron';
  const ground = !['magpie', 'kookaburra', 'eagle'].includes(kind);
  ok(r.hit, `${kind}: approaches and strikes (${r.states.join(' > ')})`);
  if (stalker) ok(r.states.includes('stalk') && r.states.includes('pounce'), `${kind}: stalks, then strikes`);
  else if (ground) ok(r.wound, `${kind}: winds up before the strike (anticipation)`);
  if (!ground) ok(r.states.includes('alert'), `${kind}: pauses (wings up, looking down) before it dives`);
  ok(r.rec, `${kind}: recovers after the strike (${r.end})`);
  ok(['confused', 'search', 'leave', 'climb', 'home', 'perch', 'wander'].includes(r.end), `${kind}: camo breaks it off (${r.end})`);
}
// ---- 4b. a snake hides, an eagle's shadow leads the dive, day and rain change who hunts
{
  const r = await E(() => {
    const G = window.__game, g = G.game;
    window.__open('bush');
    G.freezeTime(true); G.setTime(0.5); G.setWeather('clear');
    for (let i = 0; i < 20; i++) g.advance(0.05);
    const sn = G.spawnPredator('snake', 8, 0); sn.state = 'wander'; sn.ignore = 99; sn.bury = 0;
    for (let i = 0; i < 40; i++) g.advance(0.05);
    const buried = sn.bury, lowY = sn.parts.g.position.y;
    sn.state = 'chase'; sn.sync(0.5);
    const risen = sn.bury, upY = sn.parts.g.position.y;
    G.clearPredators();
    window.__open('farm');
    const eg = G.spawnPredator('eagle', 16, 0); eg.ignore = 0; eg.cool = 0; eg.state = 'wander';
    let shadowed = false, circled = false, op = 0, moved = 0, x0 = eg.x, z0 = eg.z;
    for (let i = 0; i < 80 && eg.state !== 'dive'; i++) {
      g.advance(0.05);
      if (eg.state === 'alert') {
        circled = true; moved = Math.max(moved, Math.hypot(eg.x - x0, eg.z - z0));
        if (eg.shadowDisc?.visible && eg.shadowDisc.material.opacity > 0.15) { shadowed = true; op = Math.max(op, eg.shadowDisc.material.opacity); }
      }
    }
    const after = eg.state;
    G.clearPredators(); G.setTime(0.5); G.setWeather('clear');
    for (let i = 0; i < 8; i++) g.advance(0.05);
    const go = G.spawnPredator('goanna', 40, 0), sn2 = G.spawnPredator('snake', 42, 0);
    g.advance(0.1); const day = { go: go.act, sn: sn2.act };
    G.setWeather('rain'); for (let i = 0; i < 50; i++) g.advance(0.05);
    const rain = { go: go.act, sn: sn2.act, wet: g.world.raining || g.world.weatherKind === 'rain' };
    G.setWeather('clear'); G.setTime(0.02); for (let i = 0; i < 30; i++) g.advance(0.05);
    const night = { go: go.act, sn: sn2.act };
    return { buried, risen, lowY, upY, shadowed, circled, op, moved, after, day, rain, night };
  });
  ok(r.buried > 0.65 && r.lowY < r.upY - 0.04, `a waiting snake is half in the grass (bury ${r.buried.toFixed(2)}, y ${r.lowY.toFixed(2)} -> ${r.upY.toFixed(2)})`);
  ok(r.risen < 0.4, `it rises to strike (bury ${r.risen.toFixed(2)})`);
  ok(r.circled && r.shadowed && r.moved > 2, `an eagle circles and casts a shadow before the dive (moved ${r.moved.toFixed(1)} m, opacity ${r.op.toFixed(2)}, then ${r.after})`);
  ok(r.night.go < r.day.go * 0.45, `a goanna sleeps at night (${r.day.go.toFixed(2)} -> ${r.night.go.toFixed(2)})`);
  ok(r.rain.wet && r.rain.sn > r.day.sn && r.rain.go < r.day.go * 0.5, `rain wakes a snake and quiets a goanna (snake ${r.day.sn.toFixed(2)}->${r.rain.sn.toFixed(2)}, goanna ${r.day.go.toFixed(2)}->${r.rain.go.toFixed(2)})`);
}
// ---- 5. critters: stacked ones are pushed apart, and they make way for predators
{
  const r = await E(() => {
    const G = window.__game, g = G.game, C = g.critters, o = g.octopus; window.__open('bush');
    for (const c of [...C.sk, ...C.wr, ...C.fr]) c.on = false;
    const L = [C.sk[0], C.sk[1], C.sk[2], C.wr[0], C.fr[0]];
    L.forEach((c, i) => { c.on = true; c.x = o.x + 4 + i * 0.001; c.z = o.z; c.y = g.world.heightAt(c.x, c.z); });
    C.preds = [];
    for (let i = 0; i < 6; i++) C.spread();
    let m = Infinity; const R = [0.24, 0.24, 0.24, 0.15, 0.17];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) m = Math.min(m, Math.hypot(L[i].x - L[j].x, L[i].z - L[j].z) / (R[i] + R[j]));
    return { m };
  });
  ok(r.m >= 0.9, `stacked critters spread apart (worst ${r.m.toFixed(2)})`);
}
ok(!problems.length, 'no page errors' + (problems.length ? ': ' + problems.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall pack tests passed');
process.exit(fails ? 1 : 0);
