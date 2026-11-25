// Dev helper: screenshots of the banded world (overview from high up, the start in the sea, and a look at each band).
//   npm run build && node scripts/bandshots.mjs [outDir=/workspace/banded-shots] [mobile]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [out = '/workspace/banded-shots', mobile = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 675 });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
await page.goto(pathToFileURL(resolve('play/index.html')).href + '?nosave' + (mobile ? '&mobile=1' : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.frame > 3, { timeout: 240000 });
const start = await page.evaluate(() => { const g = window.__game.game; return { x: g.octopus.x, z: g.octopus.z, yaw: g.input.yaw, shell: g.world.shell }; });
await page.screenshot({ path: `${out}/00-start-screen.png` });
await page.click('#play');
await page.evaluate(() => { const G = window.__game; G.freezeTime(true); G.setTime(0.42); G.setWeather('clear'); for (let i = 0; i < 40; i++) G.game.update(1 / 30); });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${out}/01-start-in-sea.png` });
const shots = [
  // name, octopus spot, camera, look-at, far fog
  ['03-shell-reef', null, 'shell', null, 0],
  ['04-shore', [-110, 420], [-60, 30, 470], [-110, 2, 400], 0],
  ['05-suburb', 'suburb', 'near', null, 0],
  ['06-farm', 'farm', 'near', null, 0],
  ['07-bush', 'bush', 'near', null, 0],
  ['08-wetland', [-250, -160], [-215, 22, -120], [-250, 0, -165], 0],
  ['09-mudflat', 'mudflat', 'near', null, 0],
  ['10-outback', [430, -330], [470, 26, -250], [430, 6, -385], 900],
  ['11-wasteland', 'factory', 'factory', null, 900],
  ['13-sludge', 'sludge', 'sludge', null, 0],
  ['12-ranges', [0, -600], [0, 30, -480], [0, 40, -800], 1600],
  ['02-overview', [0, 300], [0, 1100, 900], [0, 0, -40], 5000],
];
for (const [name, at, cam, look, far] of shots) {
  const r = await page.evaluate((name, at, cam, look, far) => {
    const G = window.__game, g = G.game, w = g.world;
    let p = null;
    if (Array.isArray(at)) { G.teleport(at[0], at[1]); p = { x: at[0], z: at[1] }; }
    else if (at === 'sludge') { const q = w.waters.filter((q) => q.kind === 'sludge').sort((a, b) => b.r - a.r)[0]; G.teleport(q.x + q.r + 3, q.z + q.r + 3); p = q; }
    else if (at === 'factory') { const f = w.landmarks.find((l) => l.kind === 'factory'); G.teleport(f.x + 30, f.z + 34); p = f; }
    else if (at) { G.teleportToBiome(at); p = { x: g.octopus.x, z: g.octopus.z }; }
    else { const s = w.shell; G.teleport(s.x + 5, s.z + 6); p = s; }
    G.clearPredators();
    g.camera.far = Math.max(900, far || 0); g.camera.updateProjectionMatrix();
    if (name === '02-overview') {               // the whole map: build every chunk, and hold the fog far away
      g.view.flushAround(0, 100, 1100);
      const F = g.scene.fog; Object.defineProperty(F, 'far', { get: () => 5000, set() {}, configurable: true }); Object.defineProperty(F, 'near', { get: () => 4000, set() {}, configurable: true });
      g.view.visRadius = 5000;
    } else if (g.scene.fog && Object.getOwnPropertyDescriptor(g.scene.fog, 'far')) { delete g.scene.fog.far; delete g.scene.fog.near; g.scene.fog.far = 230; g.scene.fog.near = 60; g.view.visRadius = 300; }
    const gy = (x, z) => w.heightAt(x, z);
    if (cam === 'near') { const o = g.octopus; G.setDebugCam(o.x + 22, gy(o.x, o.z) + 14, o.z + 22, o.x, gy(o.x, o.z) + 1, o.z); }
    else if (cam === 'shell') { const s = w.shell; G.setDebugCam(s.x + 16, w.seaLevel + 7, s.z + 18, s.x, w.seaLevel - 1, s.z); }
    else if (cam === 'sludge') { G.setDebugCam(p.x + p.r * 2 + 4, gy(p.x, p.z) + p.r * 1.3 + 3, p.z + p.r * 2 + 4, p.x, gy(p.x, p.z), p.z); }
    else if (cam === 'factory') { G.setDebugCam(p.x + 48, gy(p.x, p.z) + 24, p.z + 52, p.x, gy(p.x, p.z) + 6, p.z); }
    else G.setDebugCam(cam[0], cam[1], cam[2], look[0], look[1], look[2]);
    for (let i = 0; i < 30; i++) { g.update(1 / 30); if (far && g.scene.fog && name !== '02-overview') { g.scene.fog.near = far * 0.6; g.scene.fog.far = far; } }
    return { name, x: Math.round(g.octopus.x), z: Math.round(g.octopus.z), biome: w.biomeAt(g.octopus.x, g.octopus.z), perf: G.perf };
  }, name, at, cam, look, far);
  await new Promise((res) => setTimeout(res, 300));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(JSON.stringify(r));
}
console.log('start', JSON.stringify(start));
if (problems.length) console.log('PROBLEMS\n' + problems.slice(0, 20).join('\n'));
await browser.close();
