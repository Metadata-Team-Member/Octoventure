// Feature tests for the v2 systems (headless Chrome via puppeteer-core): hidden shell armour, baby rescue, ink, bite,
// hiding, tunnels, climbing, swimming, predator personalities, cars, camo protection, day/night & weather, gamepad,
// difficulty/daily menu, clean UI. Run after `npm run build`:   node scripts/features.mjs
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDGE } from '../src/world/bands.js';

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
    const mid = { y: fx.mesh.position.y, s: fx.mesh.scale.x, glow: fx.mesh.material.emissiveIntensity, light: fx.light.material.opacity };
    g.advance(4.5);
    const after = { fx: g.collect.fx.length, puddles: g.world.temp.filter((q) => Math.hypot(q.x - b.x, q.z - b.z) < 1).length, text: document.body.innerText.trim(), found: G.babiesFound, healthUp: G.health };
    G.teleport(b.x + 5, b.z); g.advance(0.1); G.teleport(b.x, b.z); g.advance(0.2);
    return { found, mid, after, again: g.collect.fx.length, text0, total: G.babyTotal };
  });
  ok(r.found === 1, 'finding a baby is tracked internally');
  ok(r.mid.s > 0.5 && r.mid.glow > 0.2 && r.mid.light > 0.12, `the baby pops up with glowing rings (scale ${r.mid.s.toFixed(2)}, glow ${r.mid.glow.toFixed(2)})`);
  ok(r.after.fx === 0 && r.after.puddles >= 1, 'it scampers, then dissolves into a puddle');
  ok(r.after.text === r.text0, 'no counter or message for babies');
  ok(r.again === 0, 'a baby can only be found once');
  ok(r.total >= 12, `babies are scattered across the big map (${r.total})`);
}

// ================================================================ ink: only in water, cooldown, blinds predators
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.teleport(w.home.x, w.home.z); G.advance(0.1);
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
  // birds overhead lose sight if the octopus is under the cloud, even when the bird itself is high above it
  const bird = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    const q = w.waters.find((a) => a.kind === 'pond' || a.kind === 'puddle');
    G.teleport(q.x, q.z); G.advance(0.15); o.inkCool = 0;
    G.clearPredators();
    const eagle = G.spawnPredator('eagle', 18, 0); eagle.alt = 24; eagle.state = 'dive'; eagle.diveT = 0.4; eagle.diveFrom = { x: eagle.x, z: eagle.z, a: 24 }; eagle.ignore = 0;
    const used = G.inkNow(); G.advance(0.2);
    return { used, st: eagle.state, blind: eagle.blind, ign: eagle.ignore, alt: eagle.alt };
  });
  ok(bird.used && bird.blind > 0 && (bird.st === 'climb' || bird.ign > 0), `an eagle diving from high up aborts when the octopus is under the ink (${bird.st}, blind ${bird.blind.toFixed(1)})`);
  // a crab near the edge of the cloud (just outside the visible radius) is still deterred, and for longer
  const shore = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    const q = w.waters.find((a) => a.kind === 'pond' || a.kind === 'puddle');
    G.teleport(q.x, q.z); G.advance(0.1); o.inkCool = 0; G.clearPredators();
    const used = G.inkNow();
    const crab = G.spawnPredator('crab', 7.6, 0); G.advance(0.25);
    return { used, st: crab.state, blind: crab.blind };
  });
  ok(shore.used && (shore.st === 'blind' || shore.blind > 4), `a crab near the cloud is deterred for longer (state ${shore.st}, ${shore.blind.toFixed(1)} s)`);
  await E(() => { window.__game.clearPredators(); });
}

// ================================================================ venom bite: last resort, long cooldown
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.teleport(w.home.x, w.home.z); g.advance(0.2); o.biteCool = 0; o.health = 100;
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
  ok(r.used && r.cd >= 10 && r.st === 'flee', `at level 1 the venomous bite only scares an adjacent dog off (cooldown ${r.cd.toFixed(0)} s)`);
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
    G.teleport(w.home.x, w.home.z); g.advance(0.3);
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
  for (const kind of ['gull', 'cat', 'dog', 'fox', 'crab', 'eagle', 'human', 'magpie', 'kookaburra', 'snake', 'goanna', 'heron']) {
    const r = await E((kind) => {
      const G = window.__game, g = G.game, o = g.octopus, w = g.world;
      G.clearPredators();
      G.freezeTime(true); G.setTime(0.5); G.setWeather('clear');
      const env = g.env;
      env.heat = 0; env.rain = 0; env.dark = 0; env.kind = 'clear'; env.timer = 1e9; env.apply();
      // stand on moist ground so the dry rate is the low, fixed one (seed 2026, noon, clear)
      const moist = new Set(['swamp', 'mud', 'fern', 'wet', 'bank', 'forest', 'litter']);
      let spot = null;
      const hx = w.home.x, hz = w.home.z;
      for (let ring = 0; ring < 40 && !spot; ring++) {
        const n = ring === 0 ? 1 : 12;
        for (let a = 0; a < n && !spot; a++) {
          const ang = (a / n) * Math.PI * 2;
          const x = hx + Math.cos(ang) * ring * 6, z = hz + Math.sin(ang) * ring * 6;
          const t = w.typeAt(x, z);
          if (!moist.has(t) || w.waterAt(x, z) || w.isSea(x, z) || w.heightAt(x, z) < 0.55) continue;
          spot = { x, z };
        }
      }
      G.teleport(spot ? spot.x : hx, spot ? spot.z : hz);
      g.advance(0.2); o.health = 100; o.energy = 100; o.armor = 0; o.alive = true; o.lastDamage = null;
      const p = G.spawnPredator(kind, 3, 0); if (p.spec.swoop) { p.alt = 3; p.home = { x: o.x + 3, z: o.z }; }
      p.state = p.spec.flying ? 'alert' : 'chase'; p.alertT = 0.1;
      G.pressKey('Space');
      const seen = new Set();
      let drop = 0;
      for (let i = 0; i < 160; i++) {
        const before = o.health;
        g.advance(0.05);
        const lost = before - o.health;
        if (lost > 1) drop += lost; // a bite lands in one step; drying is a trickle and is not counted
        seen.add(p.state);
      }
      G.releaseKey('Space'); G.freezeTime(false);
      return { drop, seen: [...seen].join(',') };
    }, kind);
    ok(r.drop < 0.5, `${kind}: no damage while camouflaged (predator loss ${r.drop.toFixed(1)}; states ${r.seen})`);
  }
  await E(() => { window.__game.clearPredators(); });
  // ...but cars can't be fooled
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    // a stretch of east-west street that runs a good way either side (hamlets have short ones)
    for (let i = 0; i < 6000; i++) { const sp = w.findBiomeSpot('town', 60, 1); if (!sp) continue; const l = g.cars.snapToRoad(sp.x, sp.z, true); if ([-14, -6, 0, 9, 14].every((d) => w.isRoad(sp.x + d, l.z))) { G.teleport(sp.x, l.z); break; } }
    g.advance(0.2); o.armor = 0; o.health = 100; o.lastDamage = null;
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
    G.clearPredators(); G.teleport(w.home.x, w.home.z); g.advance(0.2); o.health = 100; o.armor = 0; o.invuln = 0;
    // --- cat: stalk, then pounce. A random start can put a fence between them, so stand on a clear 12 m line.
    G.freezeTime(true); G.setTime(0.5); G.setWeather('clear');
    const open = (() => {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const clear = (x, z, dx, dz) => {
        for (let t = 0; t <= 12; t += 1) {
          const px = x + dx * t, pz = z + dz * t;
          if (w.heightAt(px, pz) < 0.55) return false;
          const r = w.resolve(px, pz, 0.9);
          if (r.hit || Math.hypot(r.x - px, r.z - pz) > 0.2) return false;
        }
        return true;
      };
      const hx = w.home?.x ?? 0, hz = w.home?.z ?? 0;
      for (let ring = 0; ring < 40; ring++) {
        const n = ring === 0 ? 1 : 12;
        for (let a = 0; a < n; a++) {
          const ang = (a / n) * Math.PI * 2;
          const x = hx + Math.cos(ang) * ring * 7, z = hz + Math.sin(ang) * ring * 7;
          for (const [dx, dz] of dirs) if (clear(x, z, dx, dz)) return { x, z, dx, dz };
        }
      }
      return null;
    })();
    if (open) G.teleport(open.x, open.z);
    g.advance(0.05); o.health = 100; o.alive = true; o.camoWanted = false; o.camoBlend = 0;
    const cdx = open ? open.dx * 8 : 8, cdz = open ? open.dz * 8 : 0;
    let cat = G.spawnPredator('cat', cdx, cdz); cat.state = 'alert'; cat.alertT = 0.45; cat.cool = 0;
    cat.heading = Math.atan2(-cdx, -cdz);
    const seq = []; let stalkSp = 0, wiggle = 0;
    for (let i = 0; i < 280; i++) {
      g.advance(0.05);
      if (cat.state === 'stalk') stalkSp = Math.max(stalkSp, cat.speed);
      if (cat.state === 'wiggle') wiggle += 0.05;
      if (seq[seq.length - 1] !== cat.state) seq.push(cat.state);
      if (cat.state === 'pounce') break;
    }
    out.cat = seq.join('>'); out.catSp = stalkSp; out.catW = wiggle; out.catWalk = cat.spec.walk;
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
    G.teleport(w.home.x, w.home.z); g.advance(0.2);
    const hu = G.spawnPredator('human', 3, 0); hu.hasBucket = true; hu.parts.bucket.visible = true; hu.state = 'chase'; hu.chaseT = 0;
    let grabbed = false, h2 = o.health; for (let i = 0; i < 200 && !grabbed; i++) { g.advance(0.05); grabbed = G.carried; }
    const hGrab = o.health; let dropped = false; for (let i = 0; i < 160; i++) { g.advance(0.05); if (!G.carried) { dropped = true; break; } }
    out.human = { grabbed, dropped, lost: hGrab - o.health, carriedY: 0 };
    return out;
  });
  ok(/alert>stalk>wiggle>pounce/.test(r.cat), `cats freeze, stalk, wiggle, then pounce (${r.cat})`);
  ok(r.catSp > 0.05 && r.catSp < r.catWalk * 0.4, `a stalking cat stays under 40% of its walk (${r.catSp.toFixed(2)} vs ${r.catWalk})`);
  ok(r.catW + 1e-6 >= 0.5, `the pre-pounce wiggle lasts at least half a second (${r.catW.toFixed(2)} s)`);
  ok(r.gull.maxLift > 3 && r.gull.called, `gulls circle overhead and call others (lift ${r.gull.maxLift.toFixed(1)} m, called: ${r.gull.called})`);
  ok(/swoop/.test(r.magpie.states) && r.magpie.lost > 3, `magpies swoop from their tree (${r.magpie.states}; ${r.magpie.lost.toFixed(0)} damage)`);
  ok(/track/.test(r.dog), `dogs follow scent trails (${r.dog})`);
  ok(/search/.test(r.search.states) && r.search.minD < 8, `predators that lose you search the last-known spot (${r.search.states}; closest ${r.search.minD.toFixed(1)} m)`);
  ok(r.human.grabbed && r.human.dropped && r.human.lost > 3, `a person with a bucket grabs, carries, then drops you (${r.human.lost.toFixed(0)} health lost)`);
  const carry = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    G.clearPredators(); G.teleport(w.home.x, w.home.z); g.advance(0.2); o.health = 100; o.energy = 100; o.invuln = 0;
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
    G.clearPredators(); G.teleport(w.home.x, w.home.z); g.advance(0.1);
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
    G.clearPredators(); G.teleport(w.home.x, w.home.z); g.advance(0.2);
    const out = {};
    const pad = (axes, held = []) => ({ axes, buttons: Array.from({ length: 17 }, (_, k) => ({ pressed: held.includes(k), value: held.includes(k) ? 1 : 0 })) });
    // left stick forward moves
    const p0 = { x: o.x, z: o.z }; G.mockPad(pad([0, -1, 0, 0])); g.advance(1); out.moved = Math.hypot(o.x - p0.x, o.z - p0.z);
    // right stick looks
    const y0 = g.input.yaw; G.mockPad(pad([0, 0, 1, 0])); g.advance(0.5); out.looked = Math.abs(g.input.yaw - y0);
    // LT sprints (RT is the venomous bite since t250u)
    G.mockPad(pad([0, -1, 0, 0], [6])); g.advance(1); out.sprint = o.sprinting;
    // A = camo
    G.mockPad(pad([0, 0, 0, 0], [0])); g.advance(0.6); out.camo = o.camoWanted;
    G.mockPad(pad([0, 0, 0, 0])); g.advance(1.2);
    // B = ink (in water), X = bite (needs a predator)
    const q = w.waters.find((a) => a.kind === 'pond' || a.kind === 'puddle'); G.teleport(q.x, q.z); g.advance(0.2);
    G.mockPad(pad([0, 0, 0, 0], [1])); g.advance(0.1); G.mockPad(pad([0, 0, 0, 0])); g.advance(0.05); out.ink = G.inkClouds;
    const dog = G.spawnPredator('dog', 2, 0); g.advance(0.05); dog.state = 'chase'; o.biteCool = 0;
    G.mockPad(pad([0, 0, 0, 0], [7])); g.advance(0.1); G.mockPad(pad([0, 0, 0, 0])); g.advance(0.05); out.bite = G.biteCool;
    o.nipCool = 0; G.mockPad(pad([0, 0, 0, 0], [2])); g.advance(0.02); out.nip = o.nipT > 0; G.mockPad(pad([0, 0, 0, 0])); g.advance(0.05);
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
  ok(r.moved > 4 * 0.42, `left stick moves (${r.moved.toFixed(1)} m)`);
  ok(r.looked > 0.5, `right stick looks (${r.looked.toFixed(2)} rad)`);
  ok(r.sprint, 'LT sprints');
  ok(r.camo, 'A holds camouflage');
  ok(r.ink === 1, 'B makes an ink cloud (in water)');
  ok(r.bite > 10, `RT is the venomous bite (cooldown ${r.bite?.toFixed?.(1)})`);
  ok(r.nip, 'X is the beak bite');
  ok(r.climb, 'Y climbs');
  ok(r.paused, 'Start pauses');
  const resumed = await E(() => { const G = window.__game; const g = G.game; return g.paused; });
  ok(resumed === true, 'paused state holds until Start is pressed again');
}

// ================================================================ pause-menu chips: difficulty, daily start, new start
{
  // like pressing Esc: release the pointer lock (a locked pointer can't click) and show the pause overlay
  const pauseMenu = async () => { await E(() => { const G = window.__game; document.exitPointerLock?.(); G.game.setPaused(true); }); await new Promise((r) => setTimeout(r, 400)); await E(() => { if (!window.__game.paused) window.__game.game.setPaused(true); }); };
  await pauseMenu();
  const vis = await E(() => [...document.querySelectorAll('#opts button')].map((b) => b.innerText.trim()).join('|'));
  ok(vis === 'Gentle|Normal|Harsh|Daily|New start|Copy code|Paste code', `pause menu: Resume plus tiny chips (${vis})`);
  await page.click('[data-diff="harsh"]');
  ok(await E(() => window.__game.game.constructor && document.querySelector('[data-diff="harsh"]').classList.contains('on') && !document.querySelector('[data-diff="normal"]').classList.contains('on')), 'Harsh chip selects Harsh');
  const dmg = await E(() => { const G = window.__game; return { d: G.game.hud && G.difficulty, cfg: G.difficultyName }; });
  ok(dmg.cfg === 'harsh', `difficulty applied live (${dmg.cfg})`);
  await page.click('[data-diff="normal"]');
  const WORLD = await E(() => window.__game.game.world.seed);
  const pos = () => E(() => { const o = window.__game.game.octopus; return [Math.round(o.x), Math.round(o.z)].join(','); });
  const waitNew = (prev) => page.waitForFunction((p) => { const g = window.__game.game, o = g.octopus; return g.state === 'playing' && !window.__game.paused && [Math.round(o.x), Math.round(o.z)].join(',') !== p; }, { timeout: 60000 }, prev);
  const p0 = await pos();
  await page.click('#chip-daily'); await waitNew(p0);
  const p1 = await pos();
  ok(await E(() => window.__game.game.world.seed) === WORLD, `Daily keeps the one world (${WORLD})`);
  ok(p1 !== p0, `Daily moves the start (${p0} -> ${p1})`);
  ok(await E(() => !window.__game.paused && window.__game.game.state === 'playing'), 'new start leaves the pause menu');
  await pauseMenu();
  await page.click('#chip-new'); await new Promise((r) => setTimeout(r, 1500));
  await page.waitForFunction(() => window.__game.game.state === 'playing' && !window.__game.paused, { timeout: 60000 });
  ok(await pos() === p1, 'New start with Daily on gives the same daily start');
  await pauseMenu();
  await page.click('#chip-daily'); await waitNew(p1);
  ok(await E(() => window.__game.game.world.seed) === WORLD && await pos() !== p1, 'turning Daily off gives a random start in the same world');
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
    // hold it calm: a 0.2 s tick is enough for the idle glance to pass the old 5 deg check
    const c = G.spawnPredator('cat', 12, 0); c.state = 'wander'; c.aware = 0; c.awareV = 0; c.headTurn = 0; c.speed = 1; c.sync(0);
    out.calmLook = Math.abs(c.parts.head.rotation.y) * 57.3;
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
    // footstep thump: a person walks past on dry land (a sea start is too deep to stride), the camera gets a jolt
    G.teleport(w.home.x, w.home.z); g.advance(0.2);
    G.setTime(0.5); G.freezeTime(true);
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
    out.fade = [g.view.vcMat, g.view.whiteMat, g.view.grassMat].every((m) => typeof m.onBeforeCompile === 'function' && m.customProgramCacheKey().split('|').includes('fade1'));
    // t248u soft toon look: every lit material is a toon material, outlines only on the octopus / babies / creatures, no point lights
    const kinds = new Set(), lights = [], outlined = new Set();
    g.scene.traverse((x) => { if (x.isLight) lights.push(x.type); if (x.isMesh && !x.userData.isOutline) { const ms = Array.isArray(x.material) ? x.material : [x.material]; for (const m of ms) kinds.add(m.type); }
      if (x.userData.isOutline) { let p = x.parent; while (p && !p.userData.outlineOwner) p = p.parent; outlined.add(p ? p.userData.outlineOwner : 'other'); } });
    out.toon = { kinds: [...kinds], lights, outlined: [...outlined] };
    out.octoLines = g.octopus.outlines.length; out.octoLineVis = g.octopus.outlines[0].visible;
    out.octoCalls = 0; g.octopus.group.traverse((x) => { if ((x.isMesh) && x.visible) out.octoCalls++; });
    const cat = G.spawnPredator('cat', 6, 0); g.advance(0.1); out.catLine = cat.hulls.length > 0 && cat.hulls[0].visible;
    G.clearPredators();
    out.critterLines = g.critters.hulls.length;
    out.peekLine = !!g.collect.peekLine;
    out.tone = g.renderer.toneMapping; out.shadowType = g.renderer.shadowMap.type;
    return out;
  });
  ok(Math.abs(r.sz - 0.42) < 1e-6 && Math.abs(r.scale - r.sz) < 1e-6, `the octopus is drawn at real-scale (size ${r.sz})`);
  ok(r.ratio.human >= 6 && r.ratio.human <= 14, `a person towers over the octopus (~${r.ratio.human}x its length; target ~8x)`);
  ok(r.ratio.dog >= 2.5 && r.ratio.dog <= 6 && r.ratio.gull >= 1.8 && r.ratio.cat >= 1.8, `a dog is ~${r.ratio.dog}x, cat ~${r.ratio.cat}x, gull ~${r.ratio.gull}x, magpie ~${r.ratio.magpie}x`);
  ok(r.thump > 0.05, `a person walking past shakes the ground under the octopus (thump ${r.thump.toFixed(2)})`);
  ok(r.shadowOn && Math.abs(r.shadowDy) < 0.3, `a bird overhead casts a shadow on the ground (visible ${r.shadowOn}, ${r.shadowDy.toFixed(2)} u above terrain)`);
  ok(r.fade, 'camera occluder fade is compiled into the grass, tree and prop materials');
  ok(!r.toon.kinds.includes('MeshStandardMaterial') && !r.toon.kinds.includes('MeshPhysicalMaterial') && r.toon.kinds.includes('MeshToonMaterial'), `soft toon look: lit materials are toon, no PBR left (${r.toon.kinds.join(', ')})`);
  ok(!r.toon.lights.includes('PointLight'), `no point lights (glows are sprites): ${r.toon.lights.join(', ')}`);
  ok(r.octoLines >= 4 && r.octoLineVis, `the octopus has a thin outline (${r.octoLines} hulls)`);
  ok(r.catLine && r.critterLines >= 3 && r.peekLine, 'creatures, critters and babies are outlined too');
  ok(r.octoCalls <= 30, `the octopus is cheap to draw: ${r.octoCalls} visible meshes incl. outlines (was ~226 meshes)`);
  ok(r.tone === 7 /* Neutral */, 'neutral tone mapping keeps the curated palette (ACES greyed the toon colours)');
}

// ================================================================ no ground marks (t246u: removed, they read as car tracks)
{
  const r = await E(async () => {
    const G = window.__game, g = G.game, o = g.octopus, fx = g.fx;
    if (G.paused) g.setPaused(false);
    G.teleport(g.world.home.x, g.world.home.z); G.advance(0.2);
    const before = g.scene.children.length;
    G.pressKey('KeyW');
    for (let i = 0; i < 60; i++) { o.wetness = 1; G.advance(0.05); }
    G.releaseKey('KeyW');
    return { has: 'printMesh' in fx || 'prints' in fx, grew: g.scene.children.length - before };
  });
  ok(!r.has && r.grew <= 0, `walking while wet leaves no trail or footprint marks (fx marks: ${r.has}, scene +${r.grew})`);
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
  ok(['Move', 'Look', 'Sprint', 'Camouflage (hold)', 'Bite', 'Venomous bite', 'Pause'].every((a) => r.rows.some((x) => x[1] === a)), 'it lists move, look, sprint, camouflage, bite, venomous bite and pause');
  ok(/gamepad/i.test(r.pad), 'a compact gamepad line follows the list');
  ok(!r.leak, 'no hidden mechanics are mentioned in the controls list');
  ok(!/move|sprint|esc/i.test(r.startHas), `the start screen carries no controls or hints ("${r.startHas.replace(/\s+/g, ' ').trim()}")`);
}

// ================================================================ flowers react to a touch
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world, F = g.flowers, out = {};
    if (G.paused) g.setPaused(false);
    if (g.state !== 'playing') g.state = 'playing';
    g.places?.leaveNow?.();
    G.clearPredators();
    g.input.keys.clear(); g.input.pressed.clear();
    o.alive = true; o.speed = 0; o.health = 100;
    const armor0 = o.armor; o.armor = 1;   // a passing car must not end the run while a flower reopens
    const f = w.decor.flowers.find((q) => q.inst && q.inst.mesh.parent && w.typeAt(q.x, q.z) !== 'road');
    // stand off the flower, the road and every other bloom, then stay there: a knock or a
    // second touch used to restart the curl, so the instance never came back
    for (let ring = 4; ring <= 16 && !out.parked; ring += 4) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = f.x + Math.cos(a) * ring, z = f.z + Math.sin(a) * ring;
      if (w.isRoad(x, z, 4) || w.waterAt(x, z) || F.near(x, z, 1.6).length) continue;
      G.teleport(x, z); o.speed = 0; out.parked = true; break;
    }
    if (!out.parked) { G.teleport(f.x + 8, f.z); o.speed = 0; }
    G.advance(0.3); o.health = 60; F.rand = () => 0.01; F.nextSip = 0; f.cd = 0;
    const matOf = (flower) => Array.from(flower.inst.mesh.instanceMatrix.array.slice(flower.inst.i * 16, flower.inst.i * 16 + 16));
    const m0 = matOf(f);
    const before = o.health; const rec = F.touch(f, o);
    out.started = !!rec; out.hidden = matOf(f)[0] === 0;
    G.advance(0.6); out.curl = rec.curl;
    out.sipped = o.health - before; out.sparks = Array.from(F.sl).filter((x) => x > 0).length; out.critter = F.critters.some((c) => c.on);
    // touching again right away: no second sip (per-flower cooldown + global gap)
    o.health = 60; F.touch(f, o); G.advance(0.1); out.again = o.health - 60;
    // another flower within the global gap: animates but gives nothing
    const f2 = w.decor.flowers.find((q) => q !== f && q.inst && !q.live); o.health = 60; f2.cd = 0; F.touch(f2, o); out.gap = o.health - 60;
    const still = () => { G.clearPredators(); g.input.keys.clear(); g.input.pressed.clear(); o.speed = 0; o.armor = 1; o.alive = true; if (g.state !== 'playing') g.state = 'playing'; o.health = Math.max(o.health, 80); };
    still(); G.advance(12);
    const m1 = matOf(f);
    out.reopened = m0.every((v, i) => Math.abs(v - m1[i]) < 1e-5) && !f.live;
    out.pool = F.pool.filter((p) => p.busy).length;
    out.state = g.state;
    F.nextSip = 0; o.health = 60; f.cd = F.t + 1000; F.touch(f, o); out.cool = o.health - 60;
    still(); G.advance(12);
    // many flowers at once never exceed the pool
    const near = w.decor.flowers.filter((q) => q.inst && !q.live).slice(0, 40); near.forEach((q) => F.touch(q, o)); out.maxLive = F.live.length;
    still(); G.advance(14);
    out.liveAfter = F.live.length;
    o.armor = armor0;
    return out;
  });
  ok(r.started && r.hidden, 'touching a flower swaps its instance for an animated live copy (instance hidden meanwhile)');
  ok(r.curl > 0.9, `the petals curl shut (${r.curl.toFixed(2)})`);
  ok(r.sipped > 0 && r.sipped <= 1.5, `a little dew gives a tiny sip (+${r.sipped.toFixed(2)})`);
  ok(r.sparks >= 4, `dew sparkles lift off (${r.sparks} sparks)`);
  ok(r.critter, 'a butterfly or bee lifts off (forced here; ~1 touch in 5 otherwise)');
  ok(r.again < 0.1 && r.gap < 0.1 && r.cool < 0.1, 'no second sip: per-flower cooldown, and a global gap between any two sips');
  ok(r.reopened && r.pool === 0, `the flower slowly reopens and its original instance is restored exactly (open ${r.reopened}, pool ${r.pool}, ${r.state})`);
  ok(r.maxLive <= 8 && r.liveAfter === 0, `at most 8 live flowers animate at a time (${r.maxLive}), all released afterwards (${r.liveAfter} left)`);
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
    G.clearPredators(); g.input.keys.clear(); g.input.pressed.clear(); o.alive = true; if (g.state !== 'playing') g.state = 'playing'; o.carried = null; o.tunnel = null;
    let dsp = null;   // a desert spot with 70 m of flat, open, dry sand to the west (not into the big rock or the oasis)
    for (let k = 0; k < 900 && !dsp; k++) { const c = { x: 160 + (k % 30) * 17, z: -300 - Math.floor(k / 30) * 6 }; let okk = w.biomeAt(c.x, c.z) === 'desert'; for (let d = 0; okk && d <= 70; d += 2) { const x = c.x - d, h = w.heightAt(x, c.z); okk = h > 0.5 && Math.abs(h - w.heightAt(c.x, c.z)) < 2 && !w.waterAt?.(x, c.z) && w.biomeAt(x, c.z) === 'desert'; const q = w.resolve(x, c.z, 0.3); okk = okk && Math.hypot(q.x - x, q.z - c.z) < 0.01; } if (okk && !w.decor.rocks.some((rk) => Math.abs(rk.z - c.z) < 2 + (rk.size || 1) && rk.x < c.x + 3 && rk.x > c.x - 75)) dsp = c; } G.teleport(dsp.x, dsp.z); G.advance(0.2); g.input.yaw = Math.PI / 2;   // open, dry, flat red sand (no tide to reach it)
    G.freezeTime(true); G.setTime(0.3); G.setWeather('clear'); g.env.heat = 0;   // a cool morning, so the sand does not dry it between frames
    G.pressKey('KeyW'); for (let i = 0; i < 400; i++) { o.wetness = 1; g.env.heat = 0; o.health = 100; o.energy = 100; G.advance(0.05); } G.releaseKey('KeyW'); g.audio.step = orig; G.freezeTime(false);
    out.steps = n; out.walk = `${Math.abs(o.x - dsp.x).toFixed(0)} m`; return out;
  });
  ok(r.peekNear && r.peekFar, 'a hidden baby wriggles into view only when the octopus is near');
  ok(r.steps <= 10 && r.steps >= 2, `the wet squelch is occasional (${r.steps} in 20 s walking, not 5-8 per second; walked ${r.walk})`);
}

// ================================================================ the endless land: no edge, nothing breaks far from the start
{
  const r = await E(async () => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world, out = {};
    const settle = (n) => { for (let i = 0; i < n; i++) G.advance(0.05); };
    G.clearPredators(); G.freezeTime(true); G.setTime(0.45); G.setWeather('clear'); g.env.rain = 0; g.env.heat = 0; g.env.apply();
    // terrain dryness, so a sandy start and a forested inland can be compared on harshness alone
    const DRY = { lawn: 0.9, grass: 1, forest: 0.7, mud: 0.45, rock: 1.5, scrub: 1.6, road: 2.2, sand: 1.9, dune: 2.1, wet: 0.4, pasture: 1.05, plough: 0.8, litter: 0.8, bank: 0.6, gravel: 1.25, swamp: 0.35, dunegrass: 1.7, headland: 1.35, paving: 2, redsand: 2, gibber: 1.8, spinifex: 1.7, fern: 0.45, mossy: 0.4 };
    const still = () => {
      G.releaseKey('KeyW'); G.releaseKey('Space'); G.releaseKey('ShiftLeft'); G.releaseKey('ShiftRight');
      o.camoWanted = false; o.camoBlend = 0; o.sprinting = false; o.speed = 0; o.hiddenIn = null; o.restF = 0; o.shieldClosed = 0; o.restT = 0;
      if (o.buff) for (const k in o.buff) o.buff[k] = 0;
    };
    const loss1 = () => {
      still(); G.teleport(o.x, o.z);
      if (w.waterAt(o.x, o.z) || w.isShallow(o.x, o.z)) return null;
      const dry = DRY[w.typeAt(o.x, o.z)] || 1;
      o.health = 100; o.wetness = 0; const h0 = o.health; settle(60);
      if (w.waterAt(o.x, o.z) || w.isShallow(o.x, o.z)) return null;
      return (h0 - o.health) / dry;
    };
    // median of dry spots, divided by the ground's own dryness: a dune or a puddle used to hide the inland air
    const loss = () => {
      const x0 = o.x, z0 = o.z; const samples = [];
      for (const [dx, dz] of [[0, 0], [25, 0], [-25, 0], [0, 25], [0, -25], [40, 18], [-18, 40]]) {
        G.teleport(x0 + dx, z0 + dz); settle(2);
        const v = loss1();
        if (v != null && v > 0) samples.push(v);
      }
      G.teleport(x0, z0);
      if (!samples.length) return 0;
      samples.sort((a, b) => a - b);
      return samples[Math.floor(samples.length / 2)];
    };
    const EDGE = w.edge;
    // banded world: home (the town band) is gentle, the wasteland up north dries the octopus fastest
    G.teleport(w.home.x, w.home.z); settle(10); out.lossStart = loss();
    G.teleport(-60, -600); settle(40); out.harsh = w.harshAt(o.x, o.z); out.band = w.bandAt(o.x, o.z); out.lossFar = loss();
    out.regions = w.regions.list.length;
    // the edges hold: walk west into the ranges, north into the ranges, and swim south past the shark fins
    const walk = (x, z, dx, dz, sec) => { G.teleport(x, z); settle(4); g.input.yaw = Math.atan2(-dx, -dz); o.heading = Math.atan2(dx, dz); G.pressKey('KeyW'); for (let i = 0; i < sec * 20; i++) { o.health = 100; G.advance(0.05); } G.releaseKey('KeyW'); settle(2); return { x: o.x, z: o.z, alive: o.alive, finite: Number.isFinite(o.x + o.y + o.z) }; };
    out.west = walk(EDGE.west + 40, -100, -1, 0, 25);
    out.north = walk(200, EDGE.north + 40, 0, -1, 25);
    out.east = walk(EDGE.east - 40, 100, 1, 0, 25);
    out.south = walk(-200, EDGE.sea - 40, 0, 1, 30);
    // memory stays flat as we criss-cross the map, and nothing is built deep in the ranges or far out to sea
    const geos0 = g.renderer.info.memory.geometries;
    for (const [x, z] of [[-600, 400], [600, 400], [600, -600], [-600, -600], [0, 0], [-300, 200], [300, -300], [0, 700]]) { G.teleport(x, z); settle(30); }
    out.chunks = g.view.chunks.size; out.geos = g.renderer.info.memory.geometries - geos0; out.regions2 = w.regions.list.length;
    out.wanted = [...g.view.chunks.values()].every((c) => w.edgeOut(c.userData.cx, c.userData.cz) < 170 && c.userData.cz < EDGE.sea + 270);
    out.predFar = g.predators.list.filter((p) => p.far).length;
    // the ranges are one merged mesh (a backdrop, not a cloud of instances); shark fins patrol beyond the reef
    out.ranges = g.view.ranges?.isInstancedMesh ? g.view.ranges.count : (g.view.ranges?.isMesh ? 1 : 0);
    out.fins = g.view.finMesh?.count ?? 0;
    G.teleport(0, EDGE.sea - 60); settle(10);
    { const m = new (g.camera.matrix.constructor)(), v = new (g.camera.position.constructor)(); let minZ = 1e9; for (let i = 0; i < out.fins; i++) { g.view.finMesh.getMatrixAt(i, m); v.setFromMatrixPosition(m); minZ = Math.min(minZ, v.z); } out.finMinZ = minZ; }
    // the sea plane follows along the shore
    G.teleport(560, EDGE.sea - 120); settle(20);
    const sp = g.view.sea.position; out.seaLat = Math.abs(w.lateral(sp.x, sp.z) - w.lateral(o.x, o.z));
    return out;
  });
  ok(r.lossFar > r.lossStart * 1.3 && r.band === 5, `the wasteland dries the octopus faster than home (${r.lossStart.toFixed(2)} -> ${r.lossFar.toFixed(2)} per 3 s; harsh ${r.harsh.toFixed(2)})`);
  ok(r.regions === 0 && r.regions2 === 0, 'the banded world makes no far tiles');
  const inside = (p) => p.alive && p.finite && p.x >= EDGE.west - 27 && p.x <= EDGE.east + 27 && p.z >= EDGE.north - 27 && p.z <= EDGE.sea + 0.5;
  ok(inside(r.west) && inside(r.north) && inside(r.east) && inside(r.south), `the edges hold: walking into the ranges and swimming out to sea stop gently (west ${r.west.x.toFixed(0)}, north ${r.north.z.toFixed(0)}, east ${r.east.x.toFixed(0)}, south ${r.south.z.toFixed(0)})`);
  ok(r.chunks < 260 && r.geos < 250 && r.wanted, `memory stays flat criss-crossing the map (${r.chunks} chunks, ${r.geos} extra geometries; none deep in the ranges)`);
  ok(r.predFar === 0, 'no wanderers are spawned beyond the map');
  ok(r.ranges === 1 || r.ranges > 30, `the mountain ranges are one cheap draw (${r.ranges === 1 ? 'one merged mesh' : r.ranges + ' peaks'})`);
  ok(r.fins >= 3 && r.finMinZ >= EDGE.sea + 5, `grey shark fins patrol beyond the reef (${r.fins}, nearest z ${r.finMinZ.toFixed(0)})`);
  ok(r.seaLat < 30, `the sea plane follows along the shore (${r.seaLat.toFixed(0)} u off)`);
}

// ================================================================ shore, wading people, living birds
{
  const r = await E(() => {
    const G = window.__game, g = G.game, w = g.world, o = g.octopus;
    G.clearPredators();
    const sea = g.view.sea, m = sea.material;
    const shore = {
      near: g.camera.near, far: g.camera.far,
      off: m.polygonOffsetFactor, units: m.polygonOffsetUnits, depthWrite: m.depthWrite,
      seg: sea.geometry.parameters.widthSegments,
    };
    g.advance(0.05);
    shore.level = Math.abs(sea.position.y - w.seaLevel);
    let sx = o.x, sz = o.z, found = false;
    for (let s = 0; s < 1600 && !found; s += 3) {
      const x = w.start.x + w.dir.x * s, z = w.start.z + w.dir.z * s;
      if (w.seaDepth(x, z) > 2.2) { sx = x; sz = z; found = true; }
    }
    G.teleport(sx - w.dir.x * 12, sz - w.dir.z * 12);
    const h = G.spawnPredator('human', w.dir.x * 12, w.dir.z * 12);
    h.ignore = 99; h.state = 'groom'; h.timer = 40; h.target = null;
    h.heading = Math.atan2(-w.dir.x, -w.dir.z);
    const d0 = w.seaDepth(h.x, h.z);
    let maxTurn = 0, prev = h.heading;
    for (let i = 0; i < 150; i++) {
      g.advance(1 / 30);
      h.ignore = 99;
      const turn = Math.abs(Math.atan2(Math.sin(h.heading - prev), Math.cos(h.heading - prev)));
      if (i) maxTurn = Math.max(maxTurn, turn);
      prev = h.heading;
    }
    const d1 = w.seaDepth(h.x, h.z);
    const a = G.spawnPredator('magpie', 36, 6), b = G.spawnPredator('kookaburra', 36, -7);
    for (const p of [a, b]) { p.ignore = 99; p.state = 'perch'; p.flightIn = 40; p.alt = p.perchAlt; p.home = { x: p.x, z: p.z }; }
    let vary = 0, differ = 0;
    for (let i = 0; i < 80; i++) {
      g.advance(1 / 30);
      vary = Math.max(vary, Math.abs(a.parts.head.rotation.y));
      differ = Math.max(differ, Math.abs(a.idleHead - b.idleHead));
    }
    const perched = a.state === 'perch' && b.state === 'perch';
    G.clearPredators();
    return { shore, found, d0, d1, maxTurn, vary, differ, perched };
  });
  ok(r.shore.off < 0 && r.shore.units < 0 && r.shore.depthWrite === false && r.shore.seg >= 48 && r.shore.near >= 0.15 && r.shore.far <= 1200 && r.shore.level < 1e-4, `the sea sits on the tide without fighting the beach (offset ${r.shore.off}, ${r.shore.seg} cells, near ${r.shore.near}, far ${r.shore.far})`);
  ok(r.found && r.d0 > 2 && r.d1 < r.d0 - 0.3 && r.maxTurn < 0.8, `a person in the sea walks out without snapping (depth ${r.d0.toFixed(2)} -> ${r.d1.toFixed(2)}, turn ${r.maxTurn.toFixed(2)})`);
  ok(r.perched && r.vary > 0.15 && r.differ > 0.04, `forest birds idle out of sync while perched (head ${r.vary.toFixed(2)}, apart ${r.differ.toFixed(2)})`);
}

// ================================================================ corner map on M, sound on N, doors, scoop
{
  const map = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus;
    if (G.paused) g.setPaused(false);
    const el = document.getElementById('minimap');
    const clock = document.getElementById('clock');
    const hit = (a, b) => a.width > 2 && b.width > 2 && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const off = el.hidden === true && g.minimapOn === false;
    const mode0 = g.soundMode ?? 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
    g.advance(0.05);
    const shown = el.hidden === false && g.minimapOn === true && g.minimap.draws >= 1;
    const savedOn = JSON.parse(localStorage.getItem('octo.settings') || '{}').minimap === true;
    const soundUntouched = (g.soundMode ?? 0) === mode0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN' }));
    const mode1 = g.soundMode;
    g.minimap.draws = 0;
    g.advance(1);
    const draws = g.minimap.draws;
    const desk = hit(el.getBoundingClientRect(), clock.getBoundingClientRect());
    const clockOn = clock.hidden === false && clock.getBoundingClientRect().width > 40;
    document.body.classList.add('is-mobile');
    const touch = document.getElementById('touch');
    touch.hidden = false;
    const mob = hit(el.getBoundingClientRect(), clock.getBoundingClientRect());
    const camo = document.getElementById('btn-camo').getBoundingClientRect();
    const sprint = document.getElementById('btn-sprint').getBoundingClientRect();
    const mobBtn = hit(el.getBoundingClientRect(), camo) || hit(el.getBoundingClientRect(), sprint);
    touch.hidden = true;
    document.body.classList.remove('is-mobile');
    const round = getComputedStyle(el).borderRadius.includes('%') || parseFloat(getComputedStyle(el).borderRadius) >= 40;
    const px = el.getContext('2d').getImageData(80, 80, 1, 1).data;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
    while ((g.soundMode ?? 0) !== 0) g.cycleSound();
    g.minimapOn = false; g.minimap.setOn(false); g.saveSettings();
    const keys = document.getElementById('keys').innerText;
    return { off, shown, savedOn, soundUntouched, mode1, draws, desk, mob, mobBtn, clockOn, round, px: [px[0], px[1], px[2], px[3]], keysM: /M[\s\S]*Map/.test(keys) && /N[\s\S]*Sound/.test(keys), hiddenAgain: el.hidden === true };
  });
  ok(map.off && map.shown && map.savedOn && map.hiddenAgain, `M toggles the corner map and remembers it (off ${map.off}, on ${map.shown}, saved ${map.savedOn})`);
  ok(map.soundUntouched && map.mode1 === 1, `M leaves the sound alone and N cycles it (mode ${map.mode1})`);
  ok(map.draws >= 1 && map.draws <= 5, `the map is redrawn a few times a second (${map.draws} in 1 s)`);
  ok(map.clockOn && !map.desk && !map.mob && !map.mobBtn && map.round, `the map stays round and clear of the tide dial (desktop overlap ${map.desk}, phone ${map.mob}, buttons ${map.mobBtn})`);
  ok(map.px[3] > 0 && map.keysM, 'the map is painted, and the pause list names M and N');

  const doors = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, p = g.places, w = g.world;
    if (G.paused) g.setPaused(false);
    o.camoWanted = true; o.alive = true;
    const step = 1.5 / 0.32;
    const one = (h) => {
      if (p.indoor || p.phase) p.leaveNow();
      for (let i = 0; i < p.flaps.length; i++) { p.flaps[i].cool = 0; p.flaps[i].armed = true; }
      p.leaveCool = 0; p.leaveArmed = true; p.phase = null; p.locking = false;
      const d = h.door;
      o.alive = true; o.moving = true; o.speed = 1; o.camoWanted = true;
      o.x = d.x; o.z = d.z; o.y = w.heightAt(d.x, d.z);
      let ins = 0;
      for (let i = 0; i < 14; i++) {
        const was = p.phase;
        p.update(0.05, o);
        if (was !== 'in' && p.phase === 'in') ins++;
      }
      const pose = { x: o.x, z: o.z, h: o.heading, indoor: !!p.indoor };
      const doorZ = p.wz(-5.6 / 2 + 0.55);
      const inM = Math.hypot(o.x - p.wx(0), o.z - doorZ) * 0.32;
      o.moving = false; o.x = p.wx(0); o.z = p.wz(0);
      for (let i = 0; i < 24; i++) p.update(0.05, o);
      o.moving = true; o.x = p.wx(0); o.z = doorZ;
      p.update(0.05, o);
      for (let i = 0; i < 12; i++) p.update(0.05, o);
      const exit = { x: o.x, z: o.z, y: o.y, h: o.heading, indoor: !!p.indoor, phase: p.phase };
      const outM = Math.hypot(o.x - d.x, o.z - d.z);
      const ground = w.heightAt(o.x, o.z);
      o.x = d.x; o.z = d.z; o.moving = true;
      let bounce = false;
      for (let i = 0; i < 8; i++) { p.update(0.05, o); if (p.phase === 'in' || p.indoor) bounce = true; }
      o.x = d.x; o.z = d.z + step + 1.2; o.moving = true;
      for (let i = 0; i < 24; i++) p.update(0.05, o);
      o.x = d.x; o.z = d.z; o.moving = true;
      p.update(0.05, o);
      const again = p.phase === 'in';
      if (p.indoor || p.phase) p.leaveNow();
      return { ins, pose, inM, exit, outM, yOff: Math.abs(exit.y - ground), bounce, again };
    };
    const first = one(p.plan.homes[0]);
    let bad = 0;
    for (let i = 0; i < p.plan.homes.length; i++) {
      const r = one(p.plan.homes[i]);
      if (r.ins !== 1 || r.bounce || r.exit.indoor || r.exit.phase) bad++;
    }
    if (p.indoor || p.phase) p.leaveNow();
    o.camoWanted = false;
    G.teleport(w.home.x, w.home.z);
    return { first, bad, n: p.plan.homes.length };
  });
  ok(doors.first.pose.indoor && doors.first.pose.h === 0 && doors.first.inM > 1.2 && doors.first.inM <= 1.51, `entry stands about 1.5 m inside, facing in (${doors.first.inM.toFixed(2)} m)`);
  ok(!doors.first.exit.indoor && !doors.first.exit.phase && doors.first.exit.h === 0 && Math.abs(doors.first.outM * 0.32 - 1.5) < 0.05 && doors.first.yOff < 0.05, `exit stands 1.5 m outside on the ground, facing away (${(doors.first.outM * 0.32).toFixed(2)} m, y off ${doors.first.yOff.toFixed(3)})`);
  ok(!doors.first.bounce && doors.first.again, 'the flap does not bounce you back in until you have left and returned');
  ok(doors.bad === 0, `no house loops in or out (${doors.bad} of ${doors.n})`);

  const scoop = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, w = g.world;
    if (G.paused) g.setPaused(false);
    o.alive = true; o.health = 100;
    const it = G.teleportToGather('pebble', 0);
    g.advance(0.4);
    const before = G.inv.count('pebble');
    let picks = 0;
    const prev = g.gather.onPick;
    g.gather.onPick = (item) => { if (item.id === it.id) picks++; return prev(item); };
    G.teleport(it.x, it.z);
    G.pressKey('KeyW');
    g.advance(0.05);
    const early = G.inv.count('pebble');
    const sc = o.scoops[0].on ? o.scoops[0] : o.scoops[1];
    const arm = sc ? sc.arm : 0;
    const tip = (i) => {
      const seg = o.tentacles[i].segs[11].position;
      o.group.updateMatrixWorld(true);
      const e = o.group.matrixWorld.elements;
      const x = e[0] * seg.x + e[4] * seg.y + e[8] * seg.z + e[12];
      const z = e[2] * seg.x + e[6] * seg.y + e[10] * seg.z + e[14];
      return Math.hypot(x - it.x, z - it.z);
    };
    const d0 = tip(arm);
    const x0 = o.x, z0 = o.z;
    g.advance(0.16);
    const d1 = tip(arm);
    const walked = Math.hypot(o.x - x0, o.z - z0);
    const speed = o.speed;
    g.advance(0.4);
    G.releaseKey('KeyW');
    const after = G.inv.count('pebble');
    const d2 = tip(arm);
    const settled = !o.scoops[0].on && !o.scoops[1].on;
    // a second item, at once, on another arm — both collected once
    const a = G.teleportToGather('shellhalf', 0);
    const b = G.teleportToGather('moss', 0);
    g.advance(0.3);
    let na = 0, nb = 0;
    g.gather.onPick = (item) => { if (item.id === a.id) na++; else if (item.id === b.id) nb++; return prev(item); };
    g.gather.take(a, o); g.gather.take(b, o);
    const two = o.scoops[0].on && o.scoops[1].on && o.scoops[0].arm !== o.scoops[1].arm;
    g.advance(0.5);
    // something in the water
    let wet = null;
    const items = g.gather.items();
    for (let i = 0; i < items.length && !wet; i++) {
      const q = items[i];
      if (q.got || q.reg) continue;
      if (!(w.waterAt(q.x, q.z) || w.isShallow(q.x, q.z))) continue;
      const crit = q.kind === 'shrimp' || q.kind === 'crab';
      if (crit && !q.mesh) { G.teleport(q.x, q.z); g.gather.scan(o); if (!q.mesh) g.gather.acquire(q); }
      if (crit && !q.mesh) continue;   // take() needs the live body; a pooled-out critter is not this check
      wet = q;
    }
    let wetOk = false, wetIn = false, wetN = 0;
    if (wet) {
      g.gather.onPick = (item) => { if (item.id === wet.id) wetN++; return prev(item); };
      G.releaseKey('KeyW');
      G.teleport(wet.x, wet.z);
      g.advance(0.08);
      wetIn = !!o.inWater;
      if (!wet.got) g.gather.take(wet, o);
      let saw = o.scoops[0].on || o.scoops[1].on;
      for (let i = 0; i < 18; i++) { g.advance(1 / 30); if (o.scoops[0].on || o.scoops[1].on) saw = true; }
      wetOk = wet.got && wetN === 1 && saw;
    }
    g.gather.onPick = prev;
    G.releaseKey('KeyW');
    return { before, early, after, picks, d0, d1, d2, walked, speed, settled, two, na, nb, wet: !!wet, wetOk, wetIn };
  });
  ok(scoop.early === scoop.before && scoop.after === scoop.before + 1 && scoop.picks === 1, `a pebble is collected once, after the tuck (${scoop.before} -> ${scoop.early} -> ${scoop.after}, calls ${scoop.picks})`);
  ok(scoop.d1 < scoop.d0 - 0.02 && scoop.d2 > scoop.d1 + 0.15 && scoop.settled, `the nearest arm reaches and then settles (tip ${scoop.d0.toFixed(2)} -> ${scoop.d1.toFixed(2)} -> ${scoop.d2.toFixed(2)})`);
  ok(scoop.walked > 0.15 && scoop.speed > 0.3, `the scoop does not freeze the walk (moved ${scoop.walked.toFixed(2)}, speed ${scoop.speed.toFixed(2)})`);
  ok(scoop.two && scoop.na === 1 && scoop.nb === 1, `two quick pickups use two arms and each lands once (${scoop.na}, ${scoop.nb})`);
  ok(scoop.wet && scoop.wetOk && scoop.wetIn, `a pickup in the water still scoops and collects once (found ${scoop.wet}, wet ${scoop.wetIn})`);
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
