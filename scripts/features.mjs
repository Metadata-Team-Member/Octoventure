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
  ok(r.spShallow > 9, `swimming is fast (${r.spShallow.toFixed(1)} m/s)`);
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
  ok(r.moved > 6, `left stick moves (${r.moved.toFixed(1)} m)`);
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
