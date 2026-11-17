// Bites (t250u / t251u): beak bite (left click / X / pad X) and venomous bite (right click / B / pad RT); level-scaled kills,
// the crafted lethal dose, kill experience, death animation and clean-up, input wiring. Run after `npm run build`.
//   SHOTS=1 writes octo-bite.png / octo-venom-bite.png to $SHOTDIR (default: the system temp dir)
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!chrome) { console.error('No Chrome found. Set CHROME_PATH.'); process.exit(2); }
const SHOTS = !!process.env.SHOTS, DIR = process.env.SHOTDIR || tmpdir();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const problems = []; page.on('pageerror', (e) => problems.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)); });
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?nosave', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) fails++; };
const E = (f, ...a) => page.evaluate(f, ...a);
const frames = async (n) => { const f0 = await E(() => window.__game.frame); await page.waitForFunction((t) => window.__game.frame >= t, { timeout: 120000 }, f0 + n); };

// a clean spot, no other predators, time frozen at midday
await E(() => { const G = window.__game, g = G.game, w = g.world; G.clearPredators(); G.freezeTime?.(true); G.setTime?.(0.42); G.setWeather('clear'); G.teleport(w.start.x, w.start.z); g.advance(0.3); g.octopus.health = 100; });
const setup = `const G = window.__game, g = G.game, o = g.octopus; G.clearPredators(); o.health = 100; o.invuln = 5; o.biteCool = 0; o.nipCool = 0; g.levels.events.length = 0;`;
const run = (body, arg) => E(new Function('arg', setup + body), arg);

// ---- level 1: the venomous bite is only a deterrent
{
  const r = await run(`G.setLevel(1); const p = G.spawnPredator('gull', 1.6, 0); g.advance(0.02); const used = G.biteNow(); g.advance(0.3); return { used, dead: !!p.dead, st: p.state, cd: o.biteCool, lunge: o.nipT };`);
  ok(r.used && !r.dead && (r.st === 'flee' || r.st === 'climb') && r.cd > 5, `level 1: a venomous bite sends even a gull packing, nothing dies (${r.st})`);
  ok(r.lunge >= 0, 'the octopus lunges as it bites');
}
// ---- from level 3 small predators die; cats need level 8; dogs level 12
{
  const r = await run(`
    const out = {};
    G.setLevel(3); let p = G.spawnPredator('gull', 1.6, 0); g.advance(0.02); const xp0 = g.levels.xp; G.biteNow(); out.gull3 = !!p.dead; out.xp = g.levels.xp - xp0; out.hunter = g.levels.badges.has('hunter');
    G.clearPredators(); o.biteCool = 0; G.setLevel(5); p = G.spawnPredator('cat', 1.6, 0); g.advance(0.02); G.biteNow(); out.cat5 = !!p.dead; out.cat5st = p.state;
    G.clearPredators(); o.biteCool = 0; G.setLevel(8); p = G.spawnPredator('cat', 1.6, 0); g.advance(0.02); G.biteNow(); out.cat8 = !!p.dead;
    G.clearPredators(); o.biteCool = 0; G.setLevel(11); p = G.spawnPredator('dog', 1.8, 0); g.advance(0.02); G.biteNow(); out.dog11 = !!p.dead;
    G.clearPredators(); o.biteCool = 0; G.setLevel(12); p = G.spawnPredator('dog', 1.8, 0); g.advance(0.02); G.biteNow(); out.dog12 = !!p.dead;
    G.clearPredators(); o.biteCool = 0; G.setLevel(30); p = G.spawnPredator('human', 2.0, 0); g.advance(0.02); G.biteNow(); out.human = !!p.dead;
    return out;`);
  ok(r.gull3 && r.xp > 0, `level 3: the venomous bite kills a gull and earns experience (+${r.xp})`);
  ok(r.hunter, 'the first kill earns the hunter badge');
  ok(!r.cat5 && r.cat5st === 'flee' && r.cat8, 'a cat only bolts at level 5, dies at level 8');
  ok(!r.dog11 && r.dog12, 'a dog needs level 12');
  ok(!r.human, 'people are never killed');
}
// ---- the lethal dose: crafted in the satchel, kills any predator once
{
  const r = await run(`
    G.setLevel(1); g.inv.reset(); G.give('fungi'); G.give('urchin'); const crafted = G.craft('dose'); const used = G.use('dose'); const ready = o.lethalDose;
    const h = G.spawnPredator('human', 2.0, 0); g.advance(0.02); G.biteNow(); const keptOnPeople = o.lethalDose && !h.dead; G.clearPredators(); o.biteCool = 0;
    const p = G.spawnPredator('dog', 1.8, 0); g.advance(0.02); G.biteNow(); const dogDead = !!p.dead, spent = !o.lethalDose;
    G.clearPredators(); o.biteCool = 0; const q = G.spawnPredator('dog', 1.8, 0); g.advance(0.02); G.biteNow(); const second = !!q.dead;
    return { crafted, used, ready, keptOnPeople, dogDead, spent, second };`);
  ok(r.crafted && r.used && r.ready, 'a lethal dose is crafted (rainforest fungi + headland urchin) and readied from the satchel');
  ok(r.keptOnPeople, 'it is not wasted on people');
  ok(r.dogDead && r.spent && !r.second, 'the next venomous bite kills even a dog at level 1, then the dose is spent');
}
// ---- beak bite: a nip makes small things flinch and back off; enough nips finish something small enough
{
  const r = await run(`
    G.setLevel(1); let p = G.spawnPredator('crab', 1.3, 0); g.advance(0.02); const hit = G.nipNow(); const fl = p.flinch > 0; const cd = o.nipCool;
    const again = G.nipNow();
    let n = 1; for (let i = 0; i < 12 && !p.dead; i++) { o.nipCool = 0; p.x = o.x + 1.3; p.z = o.z; if (G.nipNow()) n++; }
    const l1dead = !!p.dead;
    G.clearPredators(); G.setLevel(3); p = G.spawnPredator('crab', 1.3, 0); g.advance(0.02); let k = 0; for (let i = 0; i < 12 && !p.dead; i++) { o.nipCool = 0; p.x = o.x + 1.3; p.z = o.z; if (G.nipNow()) k++; }
    const air = (G.clearPredators(), o.nipCool = 0, G.nipNow());
    return { hit, fl, cd, again, l1dead, k, l3dead: !!p.dead, air, airLunge: o.nipT > 0 };`);
  ok(r.hit && r.fl && r.cd > 0 && r.again === false, 'the beak bite connects, the crab flinches, and there is a short cooldown');
  ok(!r.l1dead, 'at level 1 nips never kill (the crab just backs off)');
  ok(r.l3dead && r.k >= 3, `at level 3 a few nips finish a crab (${r.k})`);
  ok(r.air === false && r.airLunge, 'biting at nothing still snaps (lunge, no hit)');
}
// ---- the dead fall, lie still, sink and are removed; they never hurt the octopus
{
  const r = await run(`
    G.setLevel(5); const p = G.spawnPredator('gull', 1.6, 0); g.advance(0.02); G.biteNow(); const h0 = o.health;
    g.advance(1.2); const tilt = Math.abs(p.group.rotation.z), y1 = p.group.position.y, gy = g.world.heightAt(p.x, p.z);
    g.advance(4.5); const y2 = p.group.position.y; g.advance(2); const gone = !g.predators.list.includes(p);
    return { tilt, y1, gy, y2, gone, hurt: h0 - o.health };`);
  ok(r.tilt > 1.3, `a killed animal keels over onto its side (${r.tilt.toFixed(2)} rad)`);
  ok(r.y1 - r.gy < 0.8 && r.y2 < r.y1, `it lies on the ground, then sinks away (${(r.y1 - r.gy).toFixed(2)} -> ${(r.y2 - r.gy).toFixed(2)} u)`);
  ok(r.gone, 'and is removed (geometry disposed)');
}
// ---- input wiring: left click (captured) = beak bite, right click = venomous bite, no context menu
{
  const r = await run(`
    const c = g.renderer.domElement; g.input._mock = true;
    o.nipCool = 0; c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); g.advance(0.02); const left = o.nipT > 0 && o.nipCool > 0;
    const p = G.spawnPredator('cat', 1.6, 0); g.advance(0.02); o.biteCool = 0;
    c.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true })); g.advance(0.02); const right = o.biteCool > 5;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); c.dispatchEvent(ev);
    g.input._mock = null;
    return { left, right, menu: ev.defaultPrevented };`);
  ok(r.left, 'left click is the beak bite');
  ok(r.right, 'right click is the venomous bite');
  ok(r.menu, 'the browser context menu is suppressed');
}
// ---- screenshots
if (SHOTS) {
  await run(`G.setLevel(8); const p = G.spawnPredator('cat', 2.2, 0.4); g.advance(0.05); g.input.yaw = Math.atan2(-(p.x - o.x), -(p.z - o.z)); o.heading = Math.atan2(p.x - o.x, p.z - o.z); g.input.pitch = 0.25; g.input.zoom = -1.5; g.advance(0.05); window.__p = p; G.nipNow(); g.advance(0.06);`);
  await frames(3); await page.screenshot({ path: `${DIR}/octo-bite.png` });
  await run(`const p = G.spawnPredator('fox', 2.2, 0.4); g.advance(0.05); o.heading = Math.atan2(p.x - o.x, p.z - o.z); g.input.yaw = o.heading + Math.PI; G.biteNow(); g.advance(0.9);`);
  await frames(3); await page.screenshot({ path: `${DIR}/octo-venom-bite.png` });
}
ok(problems.length === 0, `no page errors${problems.length ? ': ' + problems.join(' | ') : ''}`);
console.log(fails ? `${fails} check(s) FAILED` : 'all combat checks passed');
await browser.close();
process.exit(fails ? 1 : 0);
