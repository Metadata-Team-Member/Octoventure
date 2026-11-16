// Satchel / gathering / crafting tests (headless Chrome via puppeteer-core). Run after `npm run build`:   node scripts/satchel.mjs
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failed++; };
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?seed=2026', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
const E = (f, ...a) => page.evaluate(f, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await E(() => { const G = window.__game; G.clearPredators(); G.freezeTime(true); G.setTime(0.45); G.setWeather('clear'); G.game.world.rain.length = 0; });
await sleep(500);

// ================================================================ the satchel starts empty and pauses everything
{
  const r0 = await E(() => { const G = window.__game; return { slots: G.inv.slots().length, recipes: G.inv.visibleRecipes().length }; });
  ok(r0.slots === 0 && r0.recipes === 0, 'the satchel starts empty: no items, no recipes shown');
  await E(() => { const G = window.__game; G.setHealth(80); G.advance(0.5); });
  await page.keyboard.press('Tab');
  await sleep(150);
  const a = await E(() => { const G = window.__game, g = G.game, o = g.octopus; return { open: G.satchelOpen, paused: G.paused, pauseVis: G.pauseVisible, vis: !document.getElementById('satchel').hidden, health: o.health, run: G.runTime, t: g.env.t, x: o.x, z: o.z, preds: g.predators.list.length, dry: o.health, lock: G.realLock }; });
  ok(a.open && a.paused && a.vis && !a.pauseVis, 'Tab opens the satchel and pauses the game (the pause screen stays hidden)');
  await sleep(1500);
  const b = await E(() => { const G = window.__game, g = G.game, o = g.octopus; return { health: o.health, run: G.runTime, t: g.env.t, x: o.x, z: o.z }; });
  ok(b.health === a.health && b.run === a.run && b.t === a.t && b.x === a.x && b.z === a.z, 'nothing moves or dries while the satchel is open (health, timers, clock, position frozen)');
  ok(a.lock === false, 'the pointer lock is released while the satchel is open');
  await page.keyboard.press('Tab');
  await sleep(900);
  const c = await E(() => { const G = window.__game; return { open: G.satchelOpen, paused: G.paused, vis: !document.getElementById('satchel').hidden, pauseVis: G.pauseVisible, lock: G.realLock }; });
  ok(!c.open && !c.vis && ((!c.paused && c.lock) || (c.paused && c.pauseVis)), `Tab closes it: play resumes with the pointer back (${c.paused ? 'browser refused the lock: pause screen shown' : 'lock restored'})`);
  await E(() => { const G = window.__game; G.game.setPaused(false); });
  await page.keyboard.press('Tab'); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(900);
  const d = await E(() => { const G = window.__game; return { open: G.satchelOpen, vis: !document.getElementById('satchel').hidden }; });
  ok(!d.open && !d.vis, 'Esc closes the satchel');
  await E(() => { const G = window.__game; G.game.setPaused(false); });
  // gamepad (the page renders slowly under software GL: wait in frames, not milliseconds)
  const frames = async (n) => { const f0 = await E(() => window.__game.frame); await page.waitForFunction((t) => window.__game.frame >= t, { timeout: 60000 }, f0 + n); };
  const pad = (...down) => E((d) => { const btn = new Array(17).fill(false); for (const i of d) btn[i] = true; window.__game.mockPad({ axes: [0, 0, 0, 0], buttons: btn }); }, down);
  await pad(); await frames(2);
  await pad(8); await frames(3);
  const e1 = await E(() => window.__game.satchelOpen);
  await pad(); await frames(2);
  await pad(1); await frames(3);
  const e2 = await E(() => window.__game.satchelOpen);
  await E(() => { const G = window.__game; G.mockPad(null); G.game.setPaused(false); });
  ok(e1 === true && e2 === false, `a gamepad View button opens the satchel and B closes it (${e1}, ${e2})`);
}

// ================================================================ gathering by touch
{
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    const text0 = document.body.innerText.trim();
    const kinds = {};
    for (const it of G.gatherItems) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
    out.kinds = Object.keys(kinds).length;
    const it = G.teleportToGather('kelp', 0); g.advance(0.7);
    out.slot = it.slot;
    G.teleport(it.x, it.z); g.advance(0.15);
    out.got = it.got; out.count = G.inv.count('kelp'); out.anims = g.gather.anims.length;
    g.advance(0.6); out.animsAfter = g.gather.anims.length;
    out.text = document.body.innerText.trim() === text0 && [...document.querySelectorAll('.overlay')].every((e) => e.hidden);
    out.slotsAfter = G.inv.slots().map((s) => s.id).join();
    return out;
  });
  ok(r.kinds === 14, `all 14 gatherable kinds exist in the world (${r.kinds})`);
  ok(r.slot >= 0 && r.got && r.count === 1, 'walking over a kelp frond picks it up (it is shown first, then taken)');
  ok(r.anims >= 1 && r.animsAfter === 0, 'a small pick-up animation plays and then ends');
  ok(r.text, 'picking something up shows no text and no pop-up');
  ok(r.slotsAfter === 'kelp', 'only what has been found appears in the satchel');
  // each kind can be taken
  const k = await E(() => {
    const G = window.__game, g = G.game, res = {};
    for (const kind of ['pebble', 'shellhalf', 'moss', 'coconut', 'cap', 'jar', 'snail', 'mussel', 'sponge', 'coral', 'lettuce']) {
      const it = G.teleportToGather(kind, 0); if (!it) { res[kind] = 'none'; continue; }
      g.advance(0.7); G.teleport(it.x, it.z); g.advance(0.2); res[kind] = G.inv.count(kind);
    }
    return res;
  });
  ok(Object.values(k).every((v) => v === 1), 'every still kind is picked up by touch: ' + JSON.stringify(k));
  // critters
  const c = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    const it = G.teleportToGather('crab', 0); g.advance(0.7);
    out.live = !!it.mesh;
    const x0 = it.cx, z0 = it.cz, d0 = Math.hypot(it.cx - o.x, it.cz - o.z);
    g.advance(1.0);
    out.moved = Math.hypot(it.cx - x0, it.cz - z0); out.d1 = Math.hypot(it.cx - o.x, it.cz - o.z); out.d0 = d0;
    out.stillThere = !it.got;
    G.teleport(it.cx, it.cz); g.advance(0.2);
    out.caught = it.got && G.inv.count('crab') === 1;
    const sh = G.teleportToGather('shrimp', 0); g.advance(0.7);
    out.shrimpLive = !!sh.mesh;
    const px = sh.cx, pz = sh.cz; g.advance(1.2); out.shrimpMoved = Math.hypot(sh.cx - px, sh.cz - pz); out.inPool = Math.hypot(sh.cx - sh.pool.x, sh.cz - sh.pool.z) <= sh.pool.r;
    return out;
  });
  ok(c.live && c.moved > 0.5 && c.d1 > c.d0 - 0.5 && c.stillThere, `a crab scuttles away when you come close (moved ${c.moved.toFixed(1)} u)`);
  ok(c.caught, 'a crab can be caught by touch');
  ok(c.shrimpLive && c.inPool, `a shrimp lives in its pool and stays in it (moved ${c.shrimpMoved.toFixed(1)} u)`);
}

// ================================================================ recipes
{
  const r = await E(() => {
    const G = window.__game, g = G.game, inv = g.inv, out = {};
    inv.reset();
    out.none = inv.visibleRecipes().length;
    inv.add('crab');
    out.afterCrab = inv.visibleRecipes().map((x) => x.id).join();
    inv.add('shellhalf');
    out.afterShell = inv.visibleRecipes().map((x) => x.id).join();
    out.cantShield = inv.canCraft(inv.visibleRecipes().find((x) => x.id === 'shield-shell'));
    inv.add('shellhalf');
    out.canShield = inv.canCraft(inv.visibleRecipes().find((x) => x.id === 'shield-shell'));
    out.crafted = inv.craft('shield-shell'); out.shells = inv.count('shellhalf'); out.shield = inv.count('shield');
    out.fail = inv.craft('shield-shell');
    return out;
  });
  ok(r.none === 0 && r.afterCrab === 'feast', `a recipe only shows once an ingredient is found (crab -> ${r.afterCrab})`);
  ok(r.afterShell.includes('shield-shell') && r.afterShell.includes('den') && !r.afterShell.includes('shield-coco'), `shell halves reveal the shield and den recipes (${r.afterShell})`);
  ok(!r.cantShield && r.canShield && r.crafted && r.shells === 0 && r.shield === 1 && !r.fail, 'crafting uses up the ingredients and makes the item; missing ingredients can not be crafted');
  // clicking in the panel
  await E(() => { const G = window.__game; G.game.inv.reset(); G.give('crab', 1); G.give('shellhalf', 1); G.game.openSatchel(); });
  const cl = await E(() => { const rows = [...document.querySelectorAll('.sat-recipes .rec')]; return { n: rows.length, no: rows.filter((x) => x.classList.contains('no')).length, can: rows.filter((x) => !x.classList.contains('no')).length, text: document.getElementById('satchel').innerText.trim() }; });
  ok(cl.n === 3 && cl.can === 1 && cl.no === 2 && cl.text.replace(/[\d\s]/g, '') === '', `panel shows picture recipes only, the unaffordable ones greyed (${cl.n} rows, ${cl.can} ready, text "${cl.text}")`);
  await page.click('.sat-recipes .rec:not(.no)'); await sleep(100);
  const cr = await E(() => { const G = window.__game; return { feast: G.inv.count('feast'), crab: G.inv.count('crab') }; });
  ok(cr.feast === 1 && cr.crab === 0, 'clicking a ready recipe crafts it');
  // keyboard navigation + Enter
  await E(() => { const G = window.__game; G.give('crab', 1); G.game.satchel.render(); document.querySelector('.sat-recipes .rec:not(.no)')?.focus(); });
  await page.keyboard.press('Enter'); await sleep(80);
  const kc = await E(() => window.__game.inv.count('feast'));
  ok(kc === 2, 'Enter crafts the focused recipe (once)');
  await page.keyboard.press('ArrowLeft'); await sleep(50);
  const f1 = await E(() => document.activeElement?.className ?? '');
  ok(/slot/.test(f1), `arrow keys move between the items and recipes (focus is now: ${f1})`);
  await E(() => { const G = window.__game; G.game.closeSatchel(); G.game.setPaused(false); });
}

// ================================================================ the effects
const fresh = () => E(() => { const G = window.__game, g = G.game, o = g.octopus; g.inv.reset(); G.clearPredators(); G.setHealth(100); o.buff.shield = o.buff.jar = o.buff.kelp = o.buff.mimic = o.buff.feast = 0; o.inkCharges = 0; o.venomReady = false; o.inkCool = 0; o.biteCool = 0; });
{ // shield
  await fresh();
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    G.give('shellhalf', 2); out.crafted = G.craft('shield-shell'); out.used = G.use('shield');
    g.advance(2); out.closed = o.shieldClosed; out.prot = o.camoProtected; out.vis = o.visibility;
    o.health = 100; o.damage(20, 'dog'); out.dmgClosed = 100 - o.health;
    // moving breaks it
    G.pressKey('KeyW', 800); g.advance(0.8); out.closedMoving = o.shieldClosed; out.protMoving = o.camoProtected;
    o.health = 100; o.damage(20, 'dog'); out.dmgMoving = 100 - o.health;
    G.releaseKey('KeyW'); g.advance(3); out.left = o.buff.shield; g.advance(40); out.ended = o.buff.shield === 0 && !g.abilities.shield.visible;
    return out;
  });
  ok(r.crafted && r.used && r.closed > 0.9 && r.prot && r.dmgClosed === 0, `shield: closes around you while still, full protection (closed ${r.closed.toFixed(2)}, damage ${r.dmgClosed})`);
  ok(r.closedMoving < 0.3 && !r.protMoving && r.dmgMoving > 15, `shield: moving opens it again and protection ends (damage ${r.dmgMoving.toFixed(1)})`);
  ok(r.ended, 'shield: lasts a while, then is gone');
}
{ // den
  await fresh();
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    G.give('pebble', 3); G.give('shellhalf', 1); out.crafted = G.craft('den');
    G.teleportNearOcean(120); g.advance(0.3);
    out.used = G.use('den'); out.dens = g.abilities.dens.length; out.hide = G.hiddenIn;
    const evs = []; g.saveSoon = (w) => evs.push(w);
    o.health = 40; const dry0 = o.health; g.advance(1); const h1 = o.health; g.advance(6); out.gain = o.health - h1; out.rest = o.restF; out.evt = evs.includes('den'); delete g.saveSoon;
    // drying is slow inside
    out.dryScale = o.dryScale;
    // limited to three
    for (let i = 0; i < 4; i++) { G.give('pebble', 3); G.give('shellhalf', 1); G.craft('den'); G.teleport(o.x + 6, o.z); g.advance(0.2); G.use('den'); }
    out.max = g.abilities.dens.length; out.hides = g.world.hides.filter((h) => h.kind === 'den').length;
    return out;
  });
  ok(r.crafted && r.used && r.dens === 1 && r.hide === 'den', 'den: placed where you stand, and you settle inside it');
  ok(r.gain > 5 && r.rest > 0.9 && r.dryScale < 0.3, `den: resting inside recovers health (+${r.gain.toFixed(1)} in 6 s) and slows drying (x${r.dryScale})`);
  ok(r.evt, 'den: resting raises the save-point event');
  ok(r.max === 3 && r.hides === 3, `den: at most three are kept (${r.max})`);
}
{ // ink sac
  await fresh();
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    G.teleportToHide('tin'); G.teleport(g.world.heightAt ? o.x + 30 : o.x, o.z); g.advance(0.2);
    out.noWater = G.inkNow();
    G.give('shrimp', 2); G.craft('inksac'); G.use('inksac'); out.charges = o.inkCharges;
    const c0 = G.inkClouds; out.a = G.inkNow(); out.b = G.inkNow(); out.c = G.inkNow(); out.d = G.inkNow(); out.clouds = G.inkClouds - c0; out.cool = o.inkCool;
    return out;
  });
  ok(!r.noWater && r.charges === 3 && r.a && r.b && r.c && !r.d && r.clouds === 3 && r.cool === 0, 'ink sac: three squirts anywhere with no cooldown, then it is spent');
}
{ // kelp wrap
  await fresh();
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    G.teleportNearOcean(250); g.advance(0.5); G.setHealth(100);
    const h0 = o.health; g.advance(5); out.plain = h0 - o.health;
    G.setHealth(100); G.give('kelp'); G.give('lettuce'); G.craft('wrap'); G.use('wrap'); g.advance(1.5);
    const h1 = o.health; g.advance(5); out.wrapped = h1 - o.health; out.kelpF = o.kelpF; out.vis = g.abilities.kelp.visible;
    return out;
  });
  ok(r.plain > 0 && r.wrapped < r.plain * 0.65 && r.vis, `kelp wrap: drying is slowed on land (${r.plain.toFixed(2)} -> ${r.wrapped.toFixed(2)} per 5 s) and the kelp is visible on you`);
}
{ // crab feast
  await fresh();
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    G.give('crab'); G.craft('feast'); G.setHealth(40); G.use('feast'); g.advance(1); out.health = o.health; out.f = o.feastF; out.glow = G.ringGlow;
    G.setHealth(100); g.advance(0.1); const g1 = G.ringGlow; o.buff.feast = 0; g.advance(6); out.dim = g1 > G.ringGlow;
    return out;
  });
  ok(r.health >= 84 && r.f > 0.3 && r.dim, `crab feast: restores health (${r.health.toFixed(0)}) and brightens the rings for a while`);
}
{ // venom gland
  await fresh();
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    G.spawnPredator('dog', 5.2, 0); g.advance(0.05);
    out.before = G.biteNow();
    G.give('snail', 2); G.craft('gland'); G.use('gland'); out.ready = o.venomReady;
    out.after = G.biteNow(); out.spent = !o.venomReady;
    return out;
  });
  ok(!r.before && r.ready && r.after && r.spent, 'venom gland: the next bite reaches further, then the gland is spent');
}
{ // jar hideaway
  await fresh();
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    G.give('jar'); G.give('cap'); G.craft('hideaway'); G.use('hideaway'); g.advance(1.5);
    out.bird = o.birdHidden; o.health = 100; o.damage(20, 'gull'); out.dBird = 100 - o.health;
    o.damage(20, 'dog'); out.dDog = 100 - o.health - out.dBird; out.speed = o.moveMult; out.vis = g.abilities.jar.visible;
    return out;
  });
  ok(r.bird && r.dBird === 0 && r.dDog > 15 && r.speed < 0.5 && r.vis, `jar hideaway: birds cannot touch you, other animals still can (dog ${r.dDog.toFixed(0)}); slow inside (x${r.speed})`);
}
{ // mimic skin
  await fresh();
  const r = await E(() => {
    const G = window.__game, g = G.game, o = g.octopus, out = {};
    const drain = () => { const e0 = o.energy; o.energy = 80; G.pressKey('Space', 0); g.advance(0.01); g.input.keys.add('Space'); g.advance(3); g.input.keys.delete('Space'); const d = 80 - o.energy; o.energy = e0; return d; };
    g.advance(1); out.plain = drain(); g.advance(1);
    G.give('sponge'); G.give('coral'); G.craft('mimic'); G.use('mimic'); g.advance(2.5); out.vis = o.visibility; out.mimicF = o.mimicF;
    out.cheap = drain(); out.show = g.abilities.mimic.visible;
    return out;
  });
  ok(r.vis < 0.7 && r.cheap < r.plain * 0.6 && r.show, `mimic skin: harder to notice (x${r.vis.toFixed(2)}), camouflage drains slower (${r.plain.toFixed(1)} -> ${r.cheap.toFixed(1)})`);
}
{ // mussel
  await fresh();
  const r = await E(() => { const G = window.__game, o = G.game.octopus; G.give('mussel', 1); G.setHealth(60); const ok1 = G.use('mussel'); return { ok1, h: o.health, left: G.inv.count('mussel') }; });
  ok(r.ok1 && r.h > 70 && r.left === 0, 'a mussel eaten from the satchel restores health');
}

// ================================================================ keys and layout
{
  await E(() => { const G = window.__game; G.game.setPaused(true); });
  const k = await E(() => document.getElementById('keys').innerText);
  ok(/Tab/.test(k) && /Satchel/.test(k) && /\bG\b/.test(k) && /\bH\b/.test(k) && /\bV\b/.test(k), 'the Esc controls list names Tab, G, H and V');
  await E(() => { const G = window.__game; G.game.setPaused(false); });
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await page.setViewport({ width: w, height: h });
    await E(() => { const G = window.__game; G.game.inv.reset(); for (const k of ['crab', 'shrimp', 'snail', 'mussel', 'kelp', 'lettuce', 'sponge', 'coral', 'shellhalf', 'pebble', 'moss', 'coconut', 'cap', 'jar']) G.give(k, 12); for (const k of ['shield', 'den', 'inksac', 'wrap', 'feast', 'gland', 'hideaway', 'mimic']) G.give(k, 2); G.game.octopus.buff.shield = 20; G.game.octopus.buff.kelp = 50; G.game.octopus.inkCharges = 2; G.game.openSatchel(); });
    await sleep(200);
    const L = await E(() => { const p = document.querySelector('.sat-panel').getBoundingClientRect(), r = document.querySelector('.sat-recipes'); return { top: p.top, bottom: p.bottom, left: p.left, right: p.right, vw: innerWidth, vh: innerHeight, scroll: r.scrollHeight - r.clientHeight, slots: document.querySelectorAll('.sat-bag .slot:not(.empty)').length, recs: document.querySelectorAll('.sat-recipes .rec').length }; });
    ok(L.top >= 0 && L.bottom <= L.vh && L.left >= 0 && L.right <= L.vw && L.scroll <= 1 && L.slots === 22 && L.recs === 9, `layout ${w}x${h}: panel fits the screen (${Math.round(L.bottom - L.top)}px tall), ${L.slots} items, ${L.recs} recipes, no scrolling`);
    if (w === 1440) await page.screenshot({ path: '/workspace/octo-v4-craft.png' });
    await E(() => { const G = window.__game; G.game.closeSatchel(); G.game.setPaused(false); });
  }
}
ok(problems.length === 0, 'no console errors or warnings' + (problems.length ? '\n' + problems.slice(0, 6).join('\n') : ''));
console.log(failed ? `${failed} check(s) FAILED` : 'all satchel checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
