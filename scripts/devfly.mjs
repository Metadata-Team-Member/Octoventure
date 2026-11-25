import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 560 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?seed=2026&nosave', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
await page.click('#play');
const E = (f, ...a) => page.evaluate(f, ...a);
// Dev fly camera: Enter opens a tiny command box, `fly` flies a free camera over a frozen world, Esc puts the follow camera back.
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(400);
await E(() => { const G = window.__game; G.clearPredators(); G.game.setPaused(false); G.game.input._mock = true; });
const before = await E(() => { const g = window.__game.game, c = g.camera.position; return { cam: [c.x, c.y, c.z], o: [g.octopus.x, g.octopus.z], yaw: g.input.yaw, hp: g.octopus.health, cells: g.explored.size }; });
// Enter opens the box; Esc closes it again without doing anything
await page.keyboard.press('Enter'); await sleep(100);
let s = await E(() => ({ box: !!document.getElementById('devcmd'), focused: document.activeElement?.id, fly: !!window.__game.game.dev.fly }));
ok(s.box && s.focused === 'devcmd' && !s.fly, 'Enter opens a small focused command box');
await page.keyboard.press('Escape'); await sleep(100);
s = await E(() => ({ box: !!document.getElementById('devcmd'), fly: !!window.__game.game.dev.fly, paused: window.__game.game.paused }));
ok(!s.box && !s.fly && !s.paused, 'Esc closes the box; nothing else happens');
// an unknown command does nothing
await page.keyboard.press('Enter'); await sleep(80); await page.keyboard.type('dance'); await page.keyboard.press('Enter'); await sleep(100);
s = await E(() => ({ box: !!document.getElementById('devcmd'), fly: !!window.__game.game.dev.fly, sat: window.__game.game.satchelOpen }));
ok(!s.box && !s.fly && !s.sat, 'an unknown command just closes the box');
// fly
await page.keyboard.press('Enter'); await sleep(80); await page.keyboard.type('fly'); await page.keyboard.press('Enter'); await sleep(150);
s = await E(() => ({ fly: !!window.__game.game.dev.fly, box: !!document.getElementById('devcmd') }));
ok(s.fly && !s.box, 'typing fly + Enter starts the fly camera and the box goes away');
const still = await E(() => { const g = window.__game.game, c = g.camera.position; return { cam: [c.x, c.y, c.z], o: [g.octopus.x, g.octopus.z], hp: g.octopus.health, cells: g.explored.size }; });
await page.keyboard.down('KeyW'); await page.keyboard.down('Space'); await sleep(1500); await page.keyboard.up('KeyW'); await page.keyboard.up('Space');
await page.keyboard.press('Tab'); await page.keyboard.press('KeyM'); await sleep(200);
const mid = await E(() => { const g = window.__game.game, c = g.camera.position; return { cam: [c.x, c.y, c.z], o: [g.octopus.x, g.octopus.z], hp: g.octopus.health, sat: g.satchelOpen, cells: g.explored.size, preds: g.predators.list.length }; });
const moved = Math.hypot(mid.cam[0] - still.cam[0], mid.cam[2] - still.cam[2]);
ok(moved > 15 && mid.cam[1] > still.cam[1] + 10, `W and Space fly the camera fast (${moved.toFixed(0)} m across, up ${(mid.cam[1] - still.cam[1]).toFixed(0)} m in 1.5 s of slow headless frames)`);
ok(Math.hypot(mid.o[0] - still.o[0], mid.o[1] - still.o[1]) < 0.01 && Math.abs(mid.hp - still.hp) < 0.01, 'the octopus stays put and untouched while flying (the world is frozen)');
ok(!mid.sat && mid.cells === still.cells, `no satchel and no map exploring while flying (cells ${still.cells} -> ${mid.cells})`);
// wheel changes speed
const sp = await E(() => { const g = window.__game.game, a = g.dev.fly.speed; g.canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })); return [a, g.dev.fly.speed, g.input.zoom]; });
ok(sp[1] > sp[0], `the mouse wheel changes the fly speed (${sp[0].toFixed(0)} -> ${sp[1].toFixed(0)} m/s)`);
// Esc: back to the follow camera behind the octopus
await page.keyboard.press('Escape'); await sleep(200);
const after = await E(() => { const g = window.__game.game, c = g.camera.position, o = g.octopus; return { fly: !!g.dev.fly, d: Math.hypot(c.x - o.x, c.z - o.z), dy: c.y - o.y, yaw: g.input.yaw, paused: g.paused, far: g.camera.far }; });
ok(!after.fly && after.d < 4 && after.dy < 4 && Math.abs(after.yaw - before.yaw) < 1e-6 && after.far < 2000, `Esc ends fly mode and the follow camera is back on the octopus (${after.d.toFixed(2)} m away, same heading)`);
ok(!after.paused, 'and the game carries on (no pause screen)');
// losing the pointer lock (what Esc does in a real browser) also ends it, without pausing
const lock = await E(() => { const g = window.__game.game; g.dev.enterFly(); g.onLockChange(false); return { fly: !!g.dev.fly, paused: g.paused }; });
ok(!lock.fly && !lock.paused, 'losing the pointer lock while flying returns to the octopus instead of pausing');
// Enter is ignored while the satchel is open
await E(() => { window.__game.game.input._mock = null; }); await sleep(300); await page.keyboard.press('Tab'); await sleep(150);   // (no forced lock here: a mocked lock 'regained' would close the satchel) await sleep(150);   // (let a late pointer-lock grant from the fly test land first: regaining the lock closes the satchel)
await page.keyboard.press('Enter'); await sleep(100);
const sat = await E(() => { const g = window.__game.game, r = { box: !!document.getElementById('devcmd'), open: g.satchelOpen, tab: g.satchel.tab }; g.closeSatchel(); return r; });
ok(sat.open && !sat.box, `Enter does not open the box while the satchel is open (${JSON.stringify(sat)})`);
ok(!problems.length, 'no console errors' + (problems.length ? ': ' + problems.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall dev fly checks passed');
process.exit(fails ? 1 : 0);
