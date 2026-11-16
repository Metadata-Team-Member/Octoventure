// Feature tests for the v2 systems (headless Chrome via puppeteer-core): hidden shell armour, baby rescue, ink, bite,
// hiding, tunnels, climbing, swimming, predator personalities, cars, camo protection, day/night & weather, gamepad,
// difficulty/daily menu, clean UI. Run after `npm run build`:   node scripts/features.mjs
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failed++; };
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 560 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?seed=2026', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
const E = (f, ...a) => page.evaluate(f, ...a);
await E(() => { const G = window.__game; G.clearPredators(); G.freezeTime(true); G.setTime(0.45); G.setWeather('clear'); G.game.world.rain.length = 0; });
const uiBefore = await E(() => document.body.innerText.trim());

// ================================================================ shells: silent, hidden armour
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    const s = G.teleportToShell(0); G.advance(0.05);
    const before = { text: document.body.innerText.trim(), shells: G.shellsCollected, armor: G.armor };
    G.teleport(s.x, s.z); G.advance(0.2);
    const after = { text: document.body.innerText.trim(), shells: G.shellsCollected, armor: G.armor, overlays: [...document.querySelectorAll('.overlay')].filter((e) => !e.hidden).length };
    o.health = 100; o.damage(20, 'dog');
    const hit1 = 100 - o.health;
    return { before, after, hit1, total: G.shellTotal };
  });
  ok(r.before.shells === 0 && r.before.armor === 0, 'no armour before any shell');
  ok(r.after.shells === 1 && Math.abs(r.after.armor - 0.06) < 1e-9, `picking up a shell adds 6% armour (${r.after.armor})`);
  ok(r.after.text === r.before.text && r.after.overlays === 0, 'shell pick-up shows nothing on screen (no text, no overlay)');
  ok(Math.abs(r.hit1 - 20 * 0.94) < 0.01, `a 20 point bite does ${r.hit1.toFixed(2)} (6% less)`);
  const cap = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    for (let i = 1; i < 16; i++) { const s = G.teleportToShell(0); if (!s) break; G.teleport(s.x, s.z); G.advance(0.1); }
    o.health = 100; o.damage(40, 'dog');
    return { shells: G.shellsCollected, armor: G.armor, took: 100 - o.health };
  });
  ok(cap.shells >= 10 && Math.abs(cap.armor - 0.5) < 1e-9 && Math.abs(cap.took - 20) < 0.01, `armour is capped at 50% (${cap.shells} shells: 40 damage -> ${cap.took.toFixed(1)})`);
  const mesh = await E(() => { const g = window.__game.game; return { count: g.collect.mesh.count, picked: g.world.shells.filter((s) => s.got).length }; });
  ok(mesh.picked >= 10, `collected shells are consumed (${mesh.picked})`);
}

// ================================================================ baby octopus rescue
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    G.setHealth(60);
    const b = G.teleportToBaby(0); G.advance(0.1);
    const text0 = document.body.innerText.trim();
    G.teleport(b.x, b.z); g.advance(0.2);
    const fx = g.collect.fx[0];
    const found = G.babiesFound;
    g.advance(1.2);
    const mid = { y: fx.mesh.position.y, s: fx.mesh.scale.x, glow: fx.mesh.material.emissiveIntensity, light: fx.light.intensity };
    g.advance(4.5);
    const after = { fx: g.collect.fx.length, puddles: g.world.temp.filter((q) => Math.hypot(q.x - b.x, q.z - b.z) < 1).length, text: document.body.innerText.trim(), found: G.babiesFound, healthUp: G.health };
    G.teleport(b.x + 5, b.z); g.advance(0.1); G.teleport(b.x, b.z); g.advance(0.2);
    return { found, mid, after, again: g.collect.fx.length, text0, total: G.babyTotal };
  });
  ok(r.found === 1, 'finding a baby is tracked internally');
  ok(r.mid.s > 0.5 && r.mid.glow > 0.2 && r.mid.light > 0.5, `the baby pops up with glowing rings (scale ${r.mid.s.toFixed(2)}, glow ${r.mid.glow.toFixed(2)})`);
  ok(r.after.fx === 0 && r.after.puddles >= 1, 'it scampers, then dissolves into a puddle');
  ok(r.after.text === r.text0, 'no counter or message for babies');
  ok(r.again === 0, 'a baby can only be found once');
  ok(r.total >= 12, `babies are scattered across the big map (${r.total})`);
}

// ================================================================ ink: only in water, cooldown, blinds predators
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.teleport(w.start.x, w.start.z); G.advance(0.1);
    const onLand = G.inkNow();
    const q = w.waters.find((a) => a.kind === 'pond' || a.kind === 'puddle');
    G.teleport(q.x, q.z); G.advance(0.2);
    const inW = !!G.waterKind;
    const first = G.inkNow(), cd = G.inkCool, clouds = G.inkClouds, second = G.inkNow();
    const dog = G.spawnPredator('dog', 4, 0); G.advance(0.6);
    const st = dog.state, blind = dog.blind;
    const h0 = G.health; G.advance(5);
    return { onLand, inW, first, cd, clouds, second, st, blind, dmg: Math.max(0, h0 - G.health) };
  });
  ok(r.onLand === false, 'ink does nothing on dry land');
  ok(r.inW && r.first && r.clouds === 1 && r.cd > 5, `ink works in water (cooldown ${r.cd.toFixed(1)} s)`);
  ok(r.second === false, 'ink is on cooldown straight after');
  ok(r.st === 'blind' || r.blind > 0, `a predator inside the cloud is blinded (state ${r.st})`);
  ok(r.dmg < 6, `a blinded dog does no damage (${r.dmg.toFixed(1)})`);
  await E(() => { window.__game.clearPredators(); });
}

// ================================================================ venom bite: last resort, long cooldown
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.teleport(w.start.x, w.start.z); g.advance(0.2); o.biteCool = 0; o.health = 100;
    const none = G.biteNow(), cdNone = G.biteCool;
    const dog = G.spawnPredator('dog', 2.2, 0); g.advance(0.05);
    dog.state = 'chase'; dog.chaseT = 0;
    const used = G.biteNow(), cd = G.biteCool, st = dog.state;
    const again = G.biteNow();
    g.advance(2);
    const far = Math.hypot(dog.x - o.x, dog.z - o.z);
    return { none, cdNone, used, cd, st, again, far, ign: dog.ignore };
  });
  ok(r.none === false && r.cdNone === 0, 'the bite needs an adjacent predator (and keeps its cooldown otherwise)');
  ok(r.used && r.cd >= 20 && r.st === 'flee', `the bite scares an adjacent dog off (cooldown ${r.cd.toFixed(0)} s)`);
  ok(r.again === false, 'second bite refused while on cooldown');
  ok(r.ign > 10, 'the scared predator stays away for a good while');
  const ring = await E(() => { const G = window.__game, o = G.game.octopus; o.biteCool = 0; o.alarm = 1; G.advance(0.2); const a = o.ringBlue.emissiveIntensity; o.alarm = 0; G.advance(0.2); const b = o.ringBlue.emissiveIntensity; return { a, b }; });
  ok(ring.a > ring.b, `rings pulse when the bite is ready and danger is near (${ring.a.toFixed(2)} vs ${ring.b.toFixed(2)})`);
  await E(() => { window.__game.clearPredators(); });
}

// ================================================================ hide inside objects (no camo drain, stronger concealment)
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    const h = G.teleportToHide('tin'); g.advance(0.1);
    G.teleport(h.x, h.z); g.advance(0.3);
    const inside = G.hiddenIn, vis = o.visibility;
    o.energy = 100; const e0 = o.energy;
    G.pressKey('Space'); g.advance(2); const eIn = e0 - o.energy; G.releaseKey('Space');
    G.teleport(w.start.x, w.start.z); g.advance(0.3);
    o.energy = 100; G.pressKey('Space'); g.advance(2); const eOut = 100 - o.energy; G.releaseKey('Space');
    return { inside, vis, eIn, eOut, kind: h.kind };
  });
  ok(r.inside === 'tin' && r.vis < 0.5, `walking into a tin hides the octopus (visibility ${r.vis.toFixed(2)})`);
  ok(r.eIn < 0.01 && r.eOut > 3, `camo costs no energy inside the hiding place (${r.eIn.toFixed(2)} vs ${r.eOut.toFixed(1)} outside)`);
}

// ================================================================ squeeze through tunnels
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    const t = G.teleportToTunnel('fence'); g.advance(0.05);
    G.pressKey('KeyW'); const wasYaw = g.input.yaw;
    const dx = t.b.x - t.a.x, dz = t.b.z - t.a.z; g.input.yaw = Math.atan2(-dx, -dz);
    let entered = false, steps = 0; for (; steps < 120; steps++) { g.advance(0.05); if (G.inTunnel) { entered = true; break; } }
    const invisible = !o.group.visible;
    const prot = o.camoProtected;
    let done = false; for (let i = 0; i < 200; i++) { g.advance(0.05); if (!G.inTunnel) { done = true; break; } }
    G.releaseKey('KeyW');
    const exitD = Math.hypot(o.x - t.b.x, o.z - t.b.z);
    return { entered, invisible, prot, done, exitD };
  });
  ok(r.entered, 'walking into a fence hole squeezes the octopus through');
  ok(r.invisible && r.prot, 'inside a tunnel it is unseen and untouchable');
  ok(r.done && r.exitD < 4, `it comes out the other side (${r.exitD.toFixed(1)} m from the far mouth)`);
  const wet = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    const t = G.teleportToTunnel('culvert') || G.teleportToTunnel('drain') || G.teleportToTunnel('pipe');
    const dx = t.b.x - t.a.x, dz = t.b.z - t.a.z; g.input.yaw = Math.atan2(-dx, -dz); G.setHealth(40); G.pressKey('KeyW');
    for (let i = 0; i < 400 && !G.inTunnel; i++) g.advance(0.05);
    const h0 = G.health; for (let i = 0; i < 400 && G.inTunnel; i++) g.advance(0.05); G.releaseKey('KeyW');
    return { wet: t.wet, h0, h1: G.health, kind: t.kind };
  });
  ok(wet.wet && wet.h1 > wet.h0 + 3, `wet tunnels (${wet.kind}) rehydrate on the way through (${wet.h0.toFixed(0)} -> ${wet.h1.toFixed(0)})`);
}

// ================================================================ climbing fences / walls
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    const t = G.teleportToClimbable('fence'); g.advance(0.05);
    const c = t.c; G.pressKey('KeyW'); let climbed = false, peak = 0;
    for (let i = 0; i < 120; i++) { g.advance(0.05); if (G.climbing) { climbed = true; peak = Math.max(peak, o.y - g.world.heightAt(o.x, o.z)); } }
    G.releaseKey('KeyW');
    const along = (o.x - c.x) * t.dx + (o.z - c.z) * t.dz;
    return { climbed, peak, crossed: along > t.depth };
  });
  ok(r.climbed && r.peak > 0.5, `pushing into a fence makes the octopus climb (peak ${r.peak.toFixed(1)} m)`);
  ok(r.crossed, 'and it ends up on the other side');
}

// ================================================================ swimming (fast, depth from camera pitch)
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.teleportToOcean(25); g.input.yaw = Math.atan2(-w.dir.x, -w.dir.z); g.advance(0.2); G.pressKey('KeyW');
    g.input.pitch = 0.3; g.advance(2.5); const shallow = w.seaLevel - o.y, spShallow = o.speed;
    g.input.pitch = 1.25; g.advance(3); const deep = w.seaLevel - o.y;
    g.input.pitch = 0.42; G.releaseKey('KeyW');
    return { shallow, deep, spShallow };
  });
  ok(r.deep > r.shallow + 0.8, `swimming dives deeper when the camera looks down (${r.shallow.toFixed(1)} m -> ${r.deep.toFixed(1)} m)`);
  ok(r.spShallow > 9 * 0.42, `swimming is fast (${r.spShallow.toFixed(1)} m/s)`);
}

// ================================================================ camouflage protects against everyone except cars
{
  for (const kind of ['gull', 'cat', 'dog', 'fox', 'crab', 'eagle', 'human', 'magpie', 'kookaburra']) {
    const r = await E((kind) => {
      const G = window.__game, g = G.game, o = g.octopus, w = g.world;
      G.clearPredators(); G.teleport(w.start.x, w.start.z); g.advance(0.2); o.health = 100; o.energy = 100; o.armor = 0;
      const p = G.spawnPredator(kind, 3, 0); if (p.spec.swoop) { p.alt = 3; p.home = { x: o.x + 3, z: o.z }; }
      p.state = p.spec.flying ? 'alert' : 'chase'; p.alertT = 0.1;
      G.pressKey('Space'); const h0 = o.health;
      const seen = new Set(); for (let i = 0; i < 160; i++) { g.advance(0.05); seen.add(p.state); }
      G.releaseKey('Space');
      return { drop: h0 - o.health, seen: [...seen].join(',') };
    }, kind);
    ok(r.drop < 5, `${kind}: no damage while camouflaged (lost ${r.drop.toFixed(1)} to drying; states ${r.seen})`);
  }
  await E(() => { window.__game.clearPredators(); });
  // ...but cars can't be fooled
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.teleportToRoad(); g.advance(0.2); o.armor = 0; o.health = 100; o.lastDamage = null;
    const car = G.cars[0]; let camo = false;
    for (let attempt = 0; attempt < 4 && o.lastDamage !== 'car'; attempt++) {
      const ln = g.cars.snapToRoad(o.x, o.z, true);              // the road's centre line, then the car's lane on it
      car.x = o.x - 6; car.z = ln.z; car.alongX = true; car.dir = 1; car.speed = 12; car.hitCool = 0; g.cars.place(car);
      o.z = car.pz; o.y = g.world.heightAt(o.x, o.z);
      G.pressKey('Space'); g.advance(0.1); camo = camo || o.camoProtected;
      car.x = o.x - 6; car.z = ln.z; car.alongX = true; car.dir = 1; g.cars.place(car);
      for (let i = 0; i < 30 && o.lastDamage !== 'car'; i++) g.advance(0.05);
      G.releaseKey('Space');
    }
    return { camo, lost: 100 - o.health, cause: o.lastDamage };
  });
  ok(r.camo && r.lost > 25 && r.cause === 'car', `cars ignore camouflage: ${r.lost.toFixed(0)} damage (cause ${r.cause})`);
}

// ================================================================ predator personalities
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    const out = {};
    G.clearPredators(); G.teleport(w.start.x, w.start.z); g.advance(0.2); o.health = 100; o.armor = 0; o.invuln = 0;
    // --- cat: stalk, then pounce
    let cat = G.spawnPredator('cat', 15, 0); cat.state = 'alert'; cat.alertT = 0.01; const seq = [];
    for (let i = 0; i < 200; i++) { g.advance(0.05); if (seq[seq.length - 1] !== cat.state) seq.push(cat.state); }
    out.cat = seq.join('>');
    G.clearPredators(); o.health = 100;
    // --- gull: circles overhead and calls another gull
    const g1 = G.spawnPredator('gull', 12, 0), g2 = G.spawnPredator('gull', 30, 8); g1.state = 'alert'; g1.alertT = 0.01;
    let maxLift = 0, called = false; for (let i = 0; i < 60; i++) { g.advance(0.05); maxLift = Math.max(maxLift, g1.lift); if (g2.state !== 'wander') called = true; }
    out.gull = { state: g1.state, maxLift, called };
    G.clearPredators(); o.health = 100;
    // --- magpie swoops from its tree and hurts
    const mp = G.spawnPredator('magpie', 5, 0); mp.home = { x: o.x + 5, z: o.z }; mp.alt = mp.perchAlt;
    const ms = new Set(); let lost = 0, h = o.health; for (let i = 0; i < 100; i++) { g.advance(0.05); ms.add(mp.state); }
    out.magpie = { states: [...ms].join(','), lost: h - o.health };
    G.clearPredators(); o.health = 100;
    // --- dog follows a scent trail (the player is invisible to it)
    const dog = G.spawnPredator('dog', 40, 0); dog.act = 1;
    w.scent = []; for (let i = 0; i < 20; i++) w.scent.push({ x: o.x + 38 - i * 1.8, z: o.z, t: g.runTime });
    o.visibility; Object.defineProperty(o, 'visibility', { get: () => 0.01, configurable: true });
    const ds = new Set(); for (let i = 0; i < 60; i++) { g.advance(0.05); ds.add(dog.state); }
    out.dog = [...ds].join(',');
    delete o.visibility;
    G.clearPredators(); o.health = 100; w.scent = [];
    // --- a predator that loses you goes to the last-known spot and searches
    const fx = G.spawnPredator('fox', 10, 0); fx.state = 'chase'; fx.chaseT = 0; fx.act = 1.3; g.advance(0.3);
    const seen = { x: o.x, z: o.z };
    G.teleport(o.x - 60, o.z); o.camoWanted = false; // ran away while it was chasing
    fx.lastSeen = seen; fx.state = 'confused'; fx.timer = 0.1; fx.ignore = 0;
    const ss = new Set(); let minD = 1e9;
    for (let i = 0; i < 160; i++) { g.advance(0.05); ss.add(fx.state); minD = Math.min(minD, Math.hypot(fx.x - seen.x, fx.z - seen.z)); }
    out.search = { states: [...ss].join(','), minD };
    G.clearPredators(); o.health = 100;
    // --- bucket person: grabs, carries, drops; camo ends the carry
    G.teleport(w.start.x, w.start.z); g.advance(0.2);
    const hu = G.spawnPredator('human', 3, 0); hu.hasBucket = true; hu.parts.bucket.visible = true; hu.state = 'chase'; hu.chaseT = 0;
    let grabbed = false, h2 = o.health; for (let i = 0; i < 200 && !grabbed; i++) { g.advance(0.05); grabbed = G.carried; }
    const hGrab = o.health; let dropped = false; for (let i = 0; i < 160; i++) { g.advance(0.05); if (!G.carried) { dropped = true; break; } }
    out.human = { grabbed, dropped, lost: hGrab - o.health, carriedY: 0 };
    return out;
  });
  ok(/alert>stalk>pounce/.test(r.cat) || /stalk>pounce/.test(r.cat), `cats stalk slowly, then pounce (${r.cat})`);
  ok(r.gull.maxLift > 3 && r.gull.called, `gulls circle overhead and call others (lift ${r.gull.maxLift.toFixed(1)} m, called: ${r.gull.called})`);
  ok(/swoop/.test(r.magpie.states) && r.magpie.lost > 3, `magpies swoop from their tree (${r.magpie.states}; ${r.magpie.lost.toFixed(0)} damage)`);
  ok(/track/.test(r.dog), `dogs follow scent trails (${r.dog})`);
  ok(/search/.test(r.search.states) && r.search.minD < 6, `predators that lose you search the last-known spot (${r.search.states}; closest ${r.search.minD.toFixed(1)} m)`);
  ok(r.human.grabbed && r.human.dropped && r.human.lost > 3, `a person with a bucket grabs, carries, then drops you (${r.human.lost.toFixed(0)} health lost)`);
  const carry = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.clearPredators(); G.teleport(w.start.x, w.start.z); g.advance(0.2); o.health = 100; o.energy = 100; o.invuln = 0;
    const hu = G.spawnPredator('human', 3, 0); hu.hasBucket = true; hu.state = 'chase'; hu.chaseT = 0;
    for (let i = 0; i < 200 && !G.carried; i++) g.advance(0.05);
    const was = G.carried; G.pressKey('Space'); g.advance(0.3); G.releaseKey('Space');
    return { was, still: G.carried };
  });
  ok(carry.was && !carry.still, 'camouflaging ends a carry');
  await E(() => { window.__game.clearPredators(); });
}

// ================================================================ day / night / weather
{
  const r = await E(() => {
    const G = window.__game, g = G.game, w = g.world;
    G.freezeTime(true); G.setWeather('clear');
    G.setTime(0.5); g.advance(0.2); const noon = w.dryMult, nNoon = w.night;
    G.setTime(0.02); g.advance(0.2); const night = w.dryMult, nNight = w.night;
    G.setTime(0.5); G.setWeather('heatwave'); g.env.rain = 0; g.advance(5); const heat = w.dryMult;
    G.setWeather('storm'); G.setTime(0.5); g.advance(60); const puddles = w.temp.length;
    G.setWeather('clear'); G.setTime(0.45);
    return { noon, night, heat, nNoon, nNight, puddles };
  });
  ok(r.noon > r.night * 1.3, `midday dries faster than night (x${r.noon.toFixed(2)} vs x${r.night.toFixed(2)})`);
  ok(r.nNight > 0.7 && r.nNoon < 0.1, 'night() is high at night and low at midday');
  ok(r.heat > r.noon, `a heatwave dries faster still (x${r.heat.toFixed(2)})`);
  ok(r.puddles > 3, `storms leave many temporary puddles (${r.puddles})`);
  const noct = await E(() => {
    const G = window.__game, g = G.game, w = g.world, o = g.octopus;
    G.clearPredators(); G.teleport(w.start.x, w.start.z); g.advance(0.1);
    const fox = G.spawnPredator('fox', 60, 0); const cat = G.spawnPredator('cat', 60, 5); const gull = G.spawnPredator('gull', 60, -5);
    G.setTime(0.5); g.advance(0.1); const day = { fox: fox.act, cat: cat.act, gull: gull.act };
    G.setTime(0.02); g.advance(0.1); const night = { fox: fox.act, cat: cat.act, gull: gull.act };
    G.clearPredators(); G.setTime(0.45);
    return { day, night };
  });
  ok(noct.night.fox > noct.day.fox && noct.night.cat > noct.day.cat && noct.night.gull < noct.day.gull, 'foxes and cats are nocturnal; gulls sleep at night');
  const dew = await E(() => { const G = window.__game, g = G.game; G.setTime(0.27); g.advance(0.3); const a = g.world.gates.dew; G.setTime(0.6); g.advance(0.3); return { dawn: a, noon: g.world.gates.dew }; });
  ok(dew.dawn > 0.3 && dew.noon < 0.1, `dew patches appear at dawn and burn off (${dew.dawn.toFixed(2)} -> ${dew.noon.toFixed(2)})`);
  const tide = await E(() => { const G = window.__game, g = G.game; G.setTide(-1); g.advance(0.2); const lo = g.world.seaLevel; G.setTide(1); g.advance(0.2); const hi = g.world.seaLevel; G.setTide(null); return { lo, hi }; });
  ok(tide.hi - tide.lo > 0.4, `the tide moves the sea edge (${tide.lo.toFixed(2)} -> ${tide.hi.toFixed(2)} m)`);
}

// ================================================================ gamepad mapping (mock pad)
{
  const press = (i) => Array.from({ length: 17 }, (_, k) => k === i);
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.clearPredators(); G.teleport(w.start.x, w.start.z); g.advance(0.2);
    const out = {};
    const pad = (axes, held = []) => ({ axes, buttons: Array.from({ length: 17 }, (_, k) => ({ pressed: held.includes(k), value: held.includes(k) ? 1 : 0 })) });
    // left stick forward moves
    const p0 = { x: o.x, z: o.z }; G.mockPad(pad([0, -1, 0, 0])); g.advance(1); out.moved = Math.hypot(o.x - p0.x, o.z - p0.z);
    // right stick looks
    const y0 = g.input.yaw; G.mockPad(pad([0, 0, 1, 0])); g.advance(0.5); out.looked = Math.abs(g.input.yaw - y0);
    // triggers sprint
    G.mockPad(pad([0, -1, 0, 0], [7])); g.advance(1); out.sprint = o.sprinting;
    // A = camo
    G.mockPad(pad([0, 0, 0, 0], [0])); g.advance(0.6); out.camo = o.camoWanted;
    G.mockPad(pad([0, 0, 0, 0])); g.advance(1.2);
    // B = ink (in water), X = bite (needs a predator)
    const q = w.waters.find((a) => a.kind === 'pond' || a.kind === 'puddle'); G.teleport(q.x, q.z); g.advance(0.2);
    G.mockPad(pad([0, 0, 0, 0], [1])); g.advance(0.1); G.mockPad(pad([0, 0, 0, 0])); g.advance(0.05); out.ink = G.inkClouds;
    const dog = G.spawnPredator('dog', 2, 0); g.advance(0.05); dog.state = 'chase'; o.biteCool = 0;
    G.mockPad(pad([0, 0, 0, 0], [2])); g.advance(0.1); G.mockPad(pad([0, 0, 0, 0])); g.advance(0.05); out.bite = G.biteCool;
    G.clearPredators();
    // Y = climb
    const c = G.teleportToClimbable('fence'); o.pushT = 0;
    G.mockPad(pad([0, -1, 0, 0], [3])); let climbed = false; for (let i = 0; i < 20; i++) { g.advance(0.05); if (G.climbing) climbed = true; } out.climb = climbed;
    G.mockPad(pad([0, 0, 0, 0])); g.advance(2);
    // Start = pause / resume without pointer lock
    G.mockPad(pad([0, 0, 0, 0], [9])); g.advance(0.1); out.paused = G.paused;
    G.mockPad(pad([0, 0, 0, 0])); g.advance(0.05);
    G.mockPad(null);
    return out;
  });
  ok(r.moved > 6 * 0.42, `left stick moves (${r.moved.toFixed(1)} m)`);
  ok(r.looked > 0.5, `right stick looks (${r.looked.toFixed(2)} rad)`);
  ok(r.sprint, 'trigger sprints');
  ok(r.camo, 'A holds camouflage');
  ok(r.ink === 1, 'B makes an ink cloud (in water)');
  ok(r.bite > 20, 'X bites');
  ok(r.climb, 'Y climbs');
  ok(r.paused, 'Start pauses');
  const resumed = await E(() => { const G = window.__game; const g = G.game; return g.paused; });
  ok(resumed === true, 'paused state holds until Start is pressed again');
}

// ================================================================ pause-menu chips: difficulty, daily seed, new world
{
  // like pressing Esc: release the pointer lock (a locked pointer can't click) and show the pause overlay
  const pauseMenu = async () => { await E(() => { const G = window.__game; document.exitPointerLock?.(); G.game.setPaused(true); }); await new Promise((r) => setTimeout(r, 400)); await E(() => { if (!window.__game.paused) window.__game.game.setPaused(true); }); };
  const waitWorld = (prev) => page.waitForFunction((p) => window.__game.game.world.seed !== p || false, { timeout: 60000 }, prev);
  await pauseMenu();
  const vis = await E(() => [...document.querySelectorAll('#opts button')].map((b) => b.innerText.trim()).join('|'));
  ok(vis === 'Gentle|Normal|Harsh|Daily|New start|Copy code|Paste code', `pause menu: Resume plus tiny chips (${vis})`);
  await page.click('[data-diff="harsh"]');
  ok(await E(() => window.__game.game.constructor && document.querySelector('[data-diff="harsh"]').classList.contains('on') && !document.querySelector('[data-diff="normal"]').classList.contains('on')), 'Harsh chip selects Harsh');
  const dmg = await E(() => { const G = window.__game; return { d: G.game.hud && G.difficulty, cfg: G.difficultyName }; });
  ok(dmg.cfg === 'harsh', `difficulty applied live (${dmg.cfg})`);
  await page.click('[data-diff="normal"]');
  const s0 = await E(() => window.__game.game.world.seed);
  await page.click('#chip-daily'); await waitWorld(s0);
  const s1 = await E(() => window.__game.game.world.seed);
  const daily = await E(() => window.__game.dailySeed);
  ok(s1 === daily, `Daily chip loads today's Perth seed (${s1})`);
  ok(await E(() => !window.__game.paused && window.__game.game.state === 'playing'), 'new world leaves the pause menu');
  await pauseMenu();
  await page.click('#chip-new'); await page.waitForFunction(() => !window.__game.game.hud.el.loading.hidden === false && window.__game.game.state === 'playing', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 400));
  ok(await E(() => window.__game.game.world.seed) === s1, 'New world with Daily on gives the same daily world');
  await pauseMenu();
  await page.click('#chip-daily'); await waitWorld(s1);
  ok(await E(() => window.__game.game.world.seed) !== s1, 'turning Daily off gives a random world again');
  ok(await E(() => JSON.parse(localStorage.getItem('octo.settings')).difficulty) === 'normal', 'settings persist');
  await E(() => { const G = window.__game; G.clearPredators(); G.freezeTime(true); G.setTime(0.45); G.setWeather('clear'); });
}

// ================================================================ no markers over predators' heads; awareness is body language
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus; G.clearPredators(); o.health = 100;
    const out = { sprites: 0, canvases: 0, marks: 0, kinds: [], lookDeg: null, hugeLook: 0 };
    for (const kind of G.speciesList) {
      const p = G.spawnPredator(kind, 14, 0);
      for (const st of (p.spec.flying ? ['alert', 'alert', 'alert'] : ['wander', 'alert', 'chase', 'attack'])) { p.state = st; p.alertT = 0.4; g.advance(0.15); }
      let sp = 0; p.group.traverse((n) => { if (n.isSprite || n.isPoints || n.isLine) sp++; if (n.material?.map?.isCanvasTexture) out.canvases++; });
      out.sprites += sp; if (p.mark !== undefined || p.markTex || p.setMark) out.marks++;
      out.kinds.push(kind); G.clearPredators();
    }
    // a dog that has noticed you turns its head toward you while its body is still pointing elsewhere
    const d = G.spawnPredator('dog', 12, 0); d.heading = Math.PI; d.state = 'alert'; d.alertT = 5; d.speed = 0;
    g.advance(0.05); d.aware = 1; d.awareV = 1; d.headTurn = 0; d.heading = Math.PI; d.toPlayer = -Math.PI / 2; d.sync(0.016);   // body still pointing away
    out.lookDeg = Math.abs(d.parts.head.rotation.y) * 57.3; out.aware = d.awareV;
    G.clearPredators();
    const c = G.spawnPredator('cat', 12, 0); g.advance(0.2); const calm = c.parts.head.rotation.y;
    out.calmLook = Math.abs(calm) * 57.3;
    // scene-wide: no sprite is parented to any predator
    let anySprite = 0; g.scene.traverse((n) => { if (n.isSprite && n.parent && n.parent !== g.scene && n.parent.parent !== g.scene) anySprite++; });
    out.anySprite = anySprite;
    return out;
  });
  ok(r.kinds.length >= 9, `checked every species (${r.kinds.join(', ')})`);
  ok(r.sprites === 0 && r.canvases === 0 && r.marks === 0, `no exclamation / question markers or floating sprites on predators (sprites ${r.sprites}, canvas textures ${r.canvases})`);
  ok(r.lookDeg > 25 && r.aware > 0.8, `an alerted dog turns its head toward you (${r.lookDeg.toFixed(0)} deg, awareness ${r.aware.toFixed(2)})`);
  ok(r.calmLook < 5, `a calm cat does not stare (${r.calmLook.toFixed(1)} deg)`);
}


// ================================================================ real-scale perspective
{
  const r = await E(async () => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    const out = { sz: o.sz, scale: o.group.scale.x };
    const box = (obj) => { let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9; obj.updateMatrixWorld(true); obj.traverse((m) => { if (!m.isMesh) return; m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const e = m.matrixWorld.elements; const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14]; minx = Math.min(minx, X); maxx = Math.max(maxx, X); miny = Math.min(miny, Y); maxy = Math.max(maxy, Y); minz = Math.min(minz, Z); maxz = Math.max(maxz, Z); } }); return { h: maxy - miny, len: Math.max(maxx - minx, maxz - minz) }; };
    const ob = box(o.body); const octoLen = ob.len;
    out.octoLen = octoLen;
    G.clearPredators();
    out.ratio = {};
    for (const k of ['human', 'dog', 'cat', 'gull', 'magpie']) { const p = G.spawnPredator(k, 40, 0); p.group.rotation.set(0, 0, 0); p.group.scale.x; p.sync(0); const b = box(p.group); out.ratio[k] = +(Math.max(b.h, b.len) / octoLen).toFixed(1); G.clearPredators(); }
    // footstep thump: a person walks past, the camera/ground gets a jolt
    G.setTime(12); G.freezeTime(true);
    G.setHealth(100);
    const h = G.spawnPredator('human', 9, 0); h.state = 'wander'; h.target = { x: o.x + 3, z: o.z + 3 }; h.speed = 2.2; h.act = 1;
    let maxT = 0, thumps = 0;
    for (let i = 0; i < 240; i++) { g.advance(1 / 30); if (o.thump > maxT) maxT = o.thump; h.state = h.state === 'wander' ? 'wander' : h.state; }
    out.thump = maxT;
    G.clearPredators();
    // bird shadow: an eagle in the air casts a ground shadow, one on the ground does not
    const e = G.spawnPredator('eagle', 20, 0); g.advance(0.2);
    out.shadowOn = !!e.shadowDisc && e.shadowDisc.visible; out.shadowDy = e.shadowDisc ? e.shadowDisc.position.y - w.heightAt(e.shadowDisc.position.x, e.shadowDisc.position.z) : 9;
    G.clearPredators();
    // occluder fade is compiled into the grass / prop materials
    out.fade = [g.view.vcMat, g.view.whiteMat, g.view.grassMat].every((m) => typeof m.onBeforeCompile === 'function' && m.customProgramCacheKey() === 'fade1');
    return out;
  });
  ok(Math.abs(r.sz - 0.42) < 1e-6 && Math.abs(r.scale - r.sz) < 1e-6, `the octopus is drawn at real-scale (size ${r.sz})`);
  ok(r.ratio.human >= 6 && r.ratio.human <= 14, `a person towers over the octopus (~${r.ratio.human}x its length; target ~8x)`);
  ok(r.ratio.dog >= 2.5 && r.ratio.dog <= 6 && r.ratio.gull >= 1.8 && r.ratio.cat >= 1.8, `a dog is ~${r.ratio.dog}x, cat ~${r.ratio.cat}x, gull ~${r.ratio.gull}x, magpie ~${r.ratio.magpie}x`);
  ok(r.thump > 0.05, `a person walking past shakes the ground under the octopus (thump ${r.thump.toFixed(2)})`);
  ok(r.shadowOn && Math.abs(r.shadowDy) < 0.3, `a bird overhead casts a shadow on the ground (visible ${r.shadowOn}, ${r.shadowDy.toFixed(2)} u above terrain)`);
  ok(r.fade, 'camera occluder fade is compiled into the grass, tree and prop materials');
}

// ================================================================ wet trail: tentacle drag marks, fading
{
  const r = await E(async () => {
    const G = window.__game, g = G.game, o = g.octopus, fx = g.fx, out = {};
    if (G.paused) g.setPaused(false);
    G.teleport(g.world.start.x, g.world.start.z); G.advance(0.2);
    o.wetness = 1; o.hp = 100;
    G.pressKey('KeyW');
    for (let i = 0; i < 90; i++) { o.wetness = 1; G.advance(0.05); }
    G.releaseKey('KeyW');
    const A = fx.printAlpha.array;
    out.marks = Array.from(A).filter((a) => a > 0.05).length;
    const geo = fx.printMesh.geometry; geo.computeBoundingBox();
    out.w = geo.boundingBox.max.x - geo.boundingBox.min.x; out.l = geo.boundingBox.max.z - geo.boundingBox.min.z;
    out.round = geo.type === 'CircleGeometry';
    out.verts = geo.attributes.position.count;
    G.advance(0.3);
    const a0 = Math.max(...A);
    G.advance(12);                      // fades away completely
    out.fadedTo = Math.max(...A); out.a0 = a0;
    return out;
  });
  ok(r.marks >= 3, `walking while wet leaves drag marks (${r.marks} live)`);
  ok(!r.round && r.verts > 100 && r.w < 0.6 && r.l >= 0.9, `marks are thin multi-arm strokes with sucker dots, not footprints (${r.verts} verts, ${r.w.toFixed(2)} wide x ${r.l.toFixed(2)} long)`);
  ok(r.fadedTo === 0, `the marks fade away completely (peak ${r.a0.toFixed(2)} -> ${r.fadedTo})`);
}

// ================================================================ pause screen lists the controls; nowhere else
{
  const r = await E(() => {
    const G = window.__game, g = G.game;
    const keys = document.getElementById('keys');
    const out = { inPause: !!keys && document.getElementById('pause').contains(keys), startHas: document.getElementById('start').innerText, hiddenWhilePlaying: keys.offsetParent === null };
    g.setPaused(true);
    const rows = [...keys.querySelectorAll('dt')].map((dt) => [dt.innerText.replace(/\s+/g, ' ').trim(), dt.nextElementSibling.innerText.trim()]);
    out.rows = rows; out.pad = keys.querySelector('p').innerText; out.shown = keys.offsetParent !== null;
    out.cols = getComputedStyle(keys.querySelector('dl')).gridTemplateColumns.split(' ').length;
    const txt = keys.innerText.toLowerCase(); out.leak = /shell|armou?r|tough|harden|hidden/.test(txt);
    g.setPaused(false);
    return out;
  });
  ok(r.inPause && r.hiddenWhilePlaying, 'the controls list lives only inside the pause overlay (hidden while playing)');
  ok(r.shown && r.cols === 2 && r.rows.length >= 8, `pause shows a two-column key / action list (${r.rows.length} rows)`);
  ok(['Move', 'Look', 'Sprint', 'Camouflage (hold)', 'Pause'].every((a) => r.rows.some((x) => x[1] === a)), 'it lists move, look, sprint, camouflage and pause');
  ok(/gamepad/i.test(r.pad), 'a compact gamepad line follows the list');
  ok(!r.leak, 'no hidden mechanics are mentioned in the controls list');
  ok(!/move|sprint|esc/i.test(r.startHas), `the start screen carries no controls or hints ("${r.startHas.replace(/\s+/g, ' ').trim()}")`);
}

// ================================================================ flowers react to a touch
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world, F = g.flowers, out = {};
    if (G.paused) g.setPaused(false);
    const f = w.decor.flowers.find((q) => q.inst && q.inst.mesh.parent && w.typeAt(q.x, q.z) !== 'road');
    G.teleport(f.x - 3, f.z); G.advance(0.3); o.health = 60; F.rand = () => 0.01; F.nextSip = 0; f.cd = 0;
    const mesh = f.inst.mesh, mat = () => Array.from(mesh.instanceMatrix.array.slice(f.inst.i * 16, f.inst.i * 16 + 16)), m0 = mat();
    const before = o.health; const rec = F.touch(f, o);
    out.started = !!rec; out.hidden = mat()[0] === 0;
    G.advance(0.6); out.curl = rec.curl;
    out.sipped = o.health - before; out.sparks = Array.from(F.sl).filter((x) => x > 0).length; out.critter = F.critters.some((c) => c.on);
    // touching again right away: no second sip (per-flower cooldown + global gap)
    o.health = 60; F.touch(f, o); G.advance(0.1); out.again = o.health - 60;
    // another flower within the global gap: animates but gives nothing
    const f2 = w.decor.flowers.find((q) => q !== f && q.inst && !q.live); o.health = 60; f2.cd = 0; F.touch(f2, o); out.gap = o.health - 60;
    G.advance(12);
    const m1 = mat();
    out.reopened = m0.every((v, i) => Math.abs(v - m1[i]) < 1e-5) && !f.live;
    out.pool = F.pool.filter((p) => p.busy).length;
    F.nextSip = 0; o.health = 60; f.cd = F.t + 1000; F.touch(f, o); out.cool = o.health - 60; G.advance(12);
    // many flowers at once never exceed the pool
    const near = w.decor.flowers.filter((q) => q.inst && !q.live).slice(0, 40); near.forEach((q) => F.touch(q, o)); out.maxLive = F.live.length; G.advance(14);
    out.liveAfter = F.live.length;
    return out;
  });
  ok(r.started && r.hidden, 'touching a flower swaps its instance for an animated live copy (instance hidden meanwhile)');
  ok(r.curl > 0.9, `the petals curl shut (${r.curl.toFixed(2)})`);
  ok(r.sipped > 0 && r.sipped <= 1.5, `a little dew gives a tiny sip (+${r.sipped.toFixed(2)})`);
  ok(r.sparks >= 4, `dew sparkles lift off (${r.sparks} sparks)`);
  ok(r.critter, 'a butterfly or bee lifts off (forced here; ~1 touch in 5 otherwise)');
  ok(r.again < 0.1 && r.gap < 0.1 && r.cool < 0.1, 'no second sip: per-flower cooldown, and a global gap between any two sips');
  ok(r.reopened && r.pool === 0, 'the flower slowly reopens and its original instance is restored exactly');
  ok(r.maxLive <= 8 && r.liveAfter === 0, `at most 8 live flowers animate at a time (${r.maxLive}), all released afterwards`);
}
// ================================================================ hidden babies give a faint tell, and the squelch is occasional
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world, out = {};
    const b = w.babies.find((q) => !q.found);
    G.teleport(b.x - 6, b.z); g.collect.tells(0.1, o);
    out.peekNear = g.collect.peek.count >= 1;
    G.teleport(b.x - 400, b.z); g.collect.tells(0.1, o);
    const within = w.babies.filter((q) => !q.found && Math.hypot(q.x - o.x, q.z - o.z) <= 40).length;
    out.peekFar = g.collect.peek.count === Math.min(24, within);       // only the babies close by get a live slot
    // squelch: walk wet for 20 s and count step sounds
    let n = 0; const orig = g.audio.step; g.audio.step = () => { n++; };
    G.teleport(w.start.x, w.start.z); G.advance(0.2); G.pressKey('KeyW'); for (let i = 0; i < 400; i++) { o.wetness = 1; G.advance(0.05); } G.releaseKey('KeyW'); g.audio.step = orig;
    out.steps = n; return out;
  });
  ok(r.peekNear && r.peekFar, 'a hidden baby wriggles into view only when the octopus is near');
  ok(r.steps <= 10 && r.steps >= 2, `the wet squelch is occasional (${r.steps} in 20 s walking, not 5-8 per second)`);
}

// ================================================================ the endless land: no edge, nothing breaks far from the start
{
  const r = await E(async () => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world, out = {};
    const settle = (n) => { for (let i = 0; i < n; i++) G.advance(0.05); };
    const loss = () => { G.teleport(o.x, o.z); o.health = 100; o.wetness = 0; const h0 = o.health; settle(60); return h0 - o.health; };
    G.teleport(w.start.x, w.start.z); settle(10); out.lossStart = loss();
    // 3 km inland (away from the sea), and then keep walking: the old map ended at 800 u
    const ix = -w.dir.x, iz = -w.dir.z;
    const tele = (d) => { G.teleport(w.start.x + ix * d, w.start.z + iz * d); settle(40); };
    tele(1400); out.regions1 = w.regions.list.length; out.chunks1 = g.view.chunks.size;
    tele(3000); out.harsh = w.harshAt(o.x, o.z); out.lossFar = loss();
    out.farFlowers = w.regions.list.reduce((n, q) => n + q.decor.flowers.length, 0);
    G.pressKey('KeyW'); for (let i = 0; i < 400; i++) { o.health = 100; G.advance(0.05); } G.releaseKey('KeyW');
    out.moved = Math.hypot(o.x - (w.start.x + ix * 3000), o.z - (w.start.z + iz * 3000));
    out.alive = o.alive; out.finite = Number.isFinite(o.x) && Number.isFinite(o.y) && Math.abs(o.y) < 400;
    out.chunks2 = g.view.chunks.size; out.visible = g.view.stats.chunksVisible;
    // a long walk streams chunks in and frees them behind: memory stays flat
    const geos0 = g.renderer.info.memory.geometries;
    for (const d of [3200, 3600, 4000, 4400, 4800, 5200, 5600, 6000]) tele(d);
    out.chunks3 = g.view.chunks.size; out.freed = g.view.stats.chunksFreed ?? 0; out.geos = g.renderer.info.memory.geometries - geos0; out.regions3 = w.regions.list.length;
    out.predFar = g.predators.list.filter((p) => p.far).length; out.eagles = g.predators.list.filter((p) => p.far && p.kind === 'eagle').length;
    // the sea plane follows: still under the player's lateral position when we are 5 km along the shore
    G.teleport(w.start.x + w.perp.x * 5000, w.start.z + w.perp.z * 5000); settle(20);
    const sp = g.view.sea.position; out.seaLat = Math.abs(w.lateral(sp.x, sp.z) - w.lateral(o.x, o.z));
    out.shoreChunks = g.view.chunks.size;
    G.teleport(w.start.x + w.dir.x * 7000, w.start.z + w.dir.z * 7000); settle(20);        // 7 km out to sea
    const sp2 = g.view.sea.position, dc = (p) => p.x * w.dir.x + p.z * w.dir.z;
    out.seaOut = Math.abs(dc(sp2) - dc(o)); out.seaHalf = g.view.sea.userData.size / 2;
    // flowers and shells out there still work: touch one, and pick up a shell
    const farF = w.regions.list.filter((q) => Math.abs(q.rx - 1.5) > 3 || Math.abs(q.rz - 1.5) > 3).flatMap((q) => q.decor.flowers);
    const f = farF[Math.floor(farF.length / 2)];
    G.teleport(f.x + 2, f.z); settle(10);
    out.farFlowerInst = !!f.inst && f.inst.mesh.parent !== null;
    const farS = w.shells.filter((q) => q.reg);
    const sh = farS[Math.floor(farS.length / 2)];
    G.teleport(sh.x + 3, sh.z); settle(20);
    out.farShellSlot = sh.slot >= 0 && g.collect.meshes[sh.k].count > 0;
    G.teleport(sh.x, sh.z); settle(4); out.farShellGot = sh.got;
    return out;
  });
  ok(r.lossFar > r.lossStart * 1.3, `far inland dries the octopus faster (${r.lossStart.toFixed(2)} -> ${r.lossFar.toFixed(2)} per 3 s)`);
  ok(r.harsh > 0.95 && r.regions1 > 3 && r.chunks1 > 10, `3 km inland the land exists and is harsh (harshness ${r.harsh.toFixed(2)}, ${r.regions1} regions generated, ${r.chunks1} chunks)`);
  ok(r.moved > 20 && r.alive && r.finite, `walking on beyond 3 km: moved ${r.moved.toFixed(0)} u, alive, finite coordinates`);
  ok(r.chunks3 < 90 && r.freed > 50 && r.geos < 250, `memory stays flat over a 6 km trek (${r.chunks3} chunks resident, ${r.freed} freed, ${r.geos} extra geometries)`);
  ok(r.predFar >= 1 && r.eagles >= 1, `eagles circle far inland (${r.eagles} of ${r.predFar} wanderers)`);
  ok(r.seaOut < r.seaHalf - 600, `the sea has no far edge either: 7 km out the plane still extends ${(r.seaHalf - r.seaOut).toFixed(0)} u beyond the player`);
  ok(r.seaLat < 30, `the sea plane follows along the shore (${r.seaLat.toFixed(0)} u off)`);
  ok(r.farFlowerInst && r.farShellSlot && r.farShellGot, 'flowers and shells out in the far land are drawn, and a far shell can be picked up');
}

// ================================================================ the screen stays clean
{
  await E(() => { const G = window.__game; if (G.paused) G.game.setPaused(false); });
  const uiAfter = await E(() => document.body.innerText.trim());
  ok(uiAfter === uiBefore, `on-screen text is exactly as before all these systems were added ("${uiAfter.replace(/\n/g, ' / ')}")`);
}
ok(problems.length === 0, 'no console errors or warnings' + (problems.length ? '\n' + problems.slice(0, 6).join('\n') : ''));
console.log(failed ? `${failed} check(s) FAILED` : 'all feature checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
